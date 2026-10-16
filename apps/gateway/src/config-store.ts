import {
  apiKeyHashMatches,
  ConfigInvalidation,
  hashApiKey,
  parseApiKeyPrefix,
  SecretBox,
} from '@pulsegate/shared';
import type { Pool } from 'pg';
import type { Logger } from './logger';
import { LruCache } from './lru';

export interface UpstreamConfig {
  id: string;
  name: string;
  baseUrl: URL;
  matchPrefix: string;
  stripMatchPrefix: boolean;
  allowedMethods: Set<string>;
  allowedPathPrefixes: string[];
  connectTimeoutMs: number;
  responseTimeoutMs: number;
  auth: { type: 'bearer' | 'header'; headerName: string; secret: string } | null;
  /** Changes whenever connection-level settings change (used to recycle pools). */
  dispatcherKey: string;
}

export interface RouteRule {
  id: string;
  pathPrefix: string;
  method: string | null;
  limit: number;
  windowSeconds: number;
}

export interface ProjectConfig {
  id: string;
  orgId: string;
  slug: string;
  status: 'active' | 'disabled';
  rateLimit: { requests: number; windowSeconds: number };
  /** Enabled upstreams, longest match prefix first. */
  upstreams: UpstreamConfig[];
  rules: RouteRule[];
}

export interface KeyRecord {
  id: string;
  projectId: string;
  status: 'active' | 'revoked';
  expiresAt: number | null;
  allowedMethods: Set<string> | null;
  allowedPathPrefixes: string[] | null;
  rateLimit: { requests: number; windowSeconds: number } | null;
}

interface Entry<T> {
  value: T;
  loadedAt: number;
}

export class ConfigUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Configuration store unavailable');
    (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * Read-through cache of project/upstream/key configuration.
 *
 * Consistency model: the control plane publishes invalidations on Redis
 * pub/sub after every committed change, which evicts entries immediately on all
 * gateway instances. If a message is missed (e.g. during a Redis reconnect, after
 * which the whole cache is cleared), entries still expire after `ttlMs`. When
 * PostgreSQL is unreachable, expired entries are served for up to `staleMaxMs`
 * so an outage does not take down traffic; invalidated entries are never
 * served stale, so revocations are honoured even then.
 */
export class ConfigStore {
  // Bounded: negative lookups for unknown slugs are cached too.
  private readonly projects = new LruCache<string, Entry<ProjectConfig | null>>(10_000);
  private readonly keys: LruCache<string, Entry<KeyRecord | null>>;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly pool: Pool,
    private readonly box: SecretBox,
    private readonly opts: {
      ttlMs: number;
      staleMaxMs: number;
      keyCacheMax: number;
      pepper: string;
    },
    private readonly logger: Logger,
  ) {
    this.keys = new LruCache(opts.keyCacheMax);
  }

  async getProject(slug: string): Promise<ProjectConfig | null> {
    const cached = this.projects.get(slug);
    const now = Date.now();
    if (cached && now - cached.loadedAt < this.opts.ttlMs) return cached.value;
    try {
      const value = await this.singleFlight(`p:${slug}`, () => this.loadProject(slug));
      this.projects.set(slug, { value, loadedAt: Date.now() });
      return value;
    } catch (err) {
      if (cached && now - cached.loadedAt < this.opts.staleMaxMs) {
        this.logger.warn({ err: (err as Error).message, slug }, 'serving stale project config');
        return cached.value;
      }
      throw new ConfigUnavailableError(err);
    }
  }

  /** Returns the key record if `presented` is a valid key of `projectId`, else null. */
  async getKey(projectId: string, presented: string): Promise<KeyRecord | null> {
    const prefix = parseApiKeyPrefix(presented);
    if (!prefix) return null;
    const hash = hashApiKey(presented, this.opts.pepper).toString('hex');
    const cacheKey = `${projectId}:${hash}`;
    const cached = this.keys.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.loadedAt < this.opts.ttlMs) return cached.value;
    try {
      const value = await this.singleFlight(`k:${cacheKey}`, () =>
        this.loadKey(projectId, prefix, presented),
      );
      this.keys.set(cacheKey, { value, loadedAt: Date.now() });
      return value;
    } catch (err) {
      if (cached && now - cached.loadedAt < this.opts.staleMaxMs) return cached.value;
      throw new ConfigUnavailableError(err);
    }
  }

  invalidate(msg: ConfigInvalidation): void {
    if (msg.kind === 'all') return this.clear();
    if (msg.slug) this.projects.delete(msg.slug);
    if (msg.projectId) {
      this.projects.deleteWhere((entry) => entry.value?.id === msg.projectId);
      this.keys.deleteWhere(
        (entry, key) =>
          key.startsWith(`${msg.projectId}:`) || entry.value?.projectId === msg.projectId,
      );
    }
    if (msg.keyId) this.keys.deleteWhere((entry) => entry.value?.id === msg.keyId);
  }

  clear(): void {
    this.projects.clear();
    this.keys.clear();
  }

  private singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async loadProject(slug: string): Promise<ProjectConfig | null> {
    const { rows } = await this.pool.query(
      `SELECT id, org_id, slug, status, rate_limit_requests, rate_limit_window_seconds
         FROM projects WHERE slug = $1`,
      [slug],
    );
    if (rows.length === 0) return null;
    const p = rows[0];
    const [ups, rules] = await Promise.all([
      this.pool.query(
        `SELECT id, name, base_url, match_prefix, strip_match_prefix, allowed_methods, allowed_path_prefixes,
                connect_timeout_ms, response_timeout_ms, auth_type, auth_header_name, auth_secret_enc
           FROM upstreams WHERE project_id = $1 AND enabled = true`,
        [p.id],
      ),
      this.pool.query(
        `SELECT id, path_prefix, method, limit_requests, window_seconds FROM rate_limit_rules WHERE project_id = $1`,
        [p.id],
      ),
    ]);
    const upstreams: UpstreamConfig[] = [];
    for (const u of ups.rows) {
      let auth: UpstreamConfig['auth'] = null;
      if (u.auth_type !== 'none' && u.auth_secret_enc) {
        try {
          const secret = this.box.decrypt(u.auth_secret_enc, u.id);
          auth =
            u.auth_type === 'bearer'
              ? { type: 'bearer', headerName: 'authorization', secret }
              : { type: 'header', headerName: String(u.auth_header_name).toLowerCase(), secret };
        } catch (err) {
          // Fail closed for this upstream rather than forwarding unauthenticated.
          this.logger.error(
            { upstreamId: u.id, err: (err as Error).message },
            'cannot decrypt upstream secret; upstream skipped',
          );
          continue;
        }
      }
      upstreams.push({
        id: u.id,
        name: u.name,
        baseUrl: new URL(u.base_url),
        matchPrefix: u.match_prefix,
        stripMatchPrefix: u.strip_match_prefix,
        allowedMethods: new Set(u.allowed_methods),
        allowedPathPrefixes: u.allowed_path_prefixes,
        connectTimeoutMs: u.connect_timeout_ms,
        responseTimeoutMs: u.response_timeout_ms,
        auth,
        dispatcherKey: `${u.id}:${u.base_url}:${u.connect_timeout_ms}`,
      });
    }
    upstreams.sort((a, b) => b.matchPrefix.length - a.matchPrefix.length);
    return {
      id: p.id,
      orgId: p.org_id,
      slug: p.slug,
      status: p.status,
      rateLimit: { requests: p.rate_limit_requests, windowSeconds: p.rate_limit_window_seconds },
      upstreams,
      rules: rules.rows.map((r) => ({
        id: r.id,
        pathPrefix: r.path_prefix,
        method: r.method,
        limit: r.limit_requests,
        windowSeconds: r.window_seconds,
      })),
    };
  }

  private async loadKey(
    projectId: string,
    prefix: string,
    presented: string,
  ): Promise<KeyRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT id, project_id, key_hash, status, expires_at, allowed_methods, allowed_path_prefixes,
              rate_limit_requests, rate_limit_window_seconds
         FROM api_keys WHERE prefix = $1`,
      [prefix],
    );
    const k = rows[0];
    if (!k || k.project_id !== projectId) return null;
    if (!apiKeyHashMatches(presented, this.opts.pepper, k.key_hash)) return null;
    return {
      id: k.id,
      projectId: k.project_id,
      status: k.status,
      expiresAt: k.expires_at ? new Date(k.expires_at).getTime() : null,
      allowedMethods: k.allowed_methods ? new Set(k.allowed_methods) : null,
      allowedPathPrefixes: k.allowed_path_prefixes,
      rateLimit:
        k.rate_limit_requests && k.rate_limit_window_seconds
          ? { requests: k.rate_limit_requests, windowSeconds: k.rate_limit_window_seconds }
          : null,
    };
  }
}

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createDemoUpstream } from '@pulsegate/demo-upstream';
import { generateApiKey, hashApiKey, SecretBox } from '@pulsegate/shared';
import { Pool } from 'pg';
import { createGatewayApp, GatewayApp } from '../src/app';
import { GatewayConfig, loadGatewayConfig } from '../src/config';
import { createLogger } from '../src/logger';

export const logger = createLogger('test', 'silent');

export function testPool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
}

export async function startDemoUpstream(): Promise<{ server: Server; url: string }> {
  const server = createDemoUpstream({
    slowDefaultMs: 100,
    slowMaxMs: 10_000,
    maxBodyBytes: 5 * 1024 * 1024,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

export function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return { ...loadGatewayConfig(), adminPort: 0, gatewayId: 'test-gw', ...overrides };
}

export async function startGateway(
  pool: Pool,
  overrides: Partial<GatewayConfig> = {},
): Promise<GatewayApp> {
  return createGatewayApp(testConfig(overrides), pool, logger);
}

export interface Fixture {
  orgId: string;
  projectId: string;
  slug: string;
  upstreamId: string;
  key: string;
  keyId: string;
}

export interface FixtureOptions {
  upstreamUrl: string;
  matchPrefix?: string;
  allowedMethods?: string[];
  allowedPathPrefixes?: string[];
  responseTimeoutMs?: number;
  auth?: { type: 'bearer' | 'header'; headerName?: string; secret: string };
  projectLimit?: { requests: number; windowSeconds: number };
  keyLimit?: { requests: number; windowSeconds: number };
  keyMethods?: string[];
  keyPaths?: string[];
}

const box = SecretBox.fromEnv(process.env.ENCRYPTION_KEYS);

export async function createFixture(pool: Pool, opts: FixtureOptions): Promise<Fixture> {
  const slug = `gw-${randomUUID().slice(0, 8)}`;
  const org = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name) VALUES ('gw test') RETURNING id`,
  );
  const project = await pool.query<{ id: string }>(
    `INSERT INTO projects (org_id, name, slug, rate_limit_requests, rate_limit_window_seconds) VALUES ($1, $2, $2, $3, $4) RETURNING id`,
    [
      org.rows[0].id,
      slug,
      opts.projectLimit?.requests ?? 1000,
      opts.projectLimit?.windowSeconds ?? 60,
    ],
  );
  const upstreamId = await addUpstream(pool, project.rows[0].id, opts);
  const { key, keyId } = await addKey(pool, project.rows[0].id, opts);
  return { orgId: org.rows[0].id, projectId: project.rows[0].id, slug, upstreamId, key, keyId };
}

export async function addUpstream(
  pool: Pool,
  projectId: string,
  opts: FixtureOptions,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO upstreams (id, project_id, name, base_url, match_prefix, allowed_methods, allowed_path_prefixes,
       connect_timeout_ms, response_timeout_ms, auth_type, auth_header_name, auth_secret_enc, enabled)
     VALUES ($1, $2, 'test upstream', $3, $4, $5, $6, 1000, $7, $8, $9, $10, true)`,
    [
      id,
      projectId,
      opts.upstreamUrl,
      opts.matchPrefix ?? '/',
      opts.allowedMethods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      opts.allowedPathPrefixes ?? ['/'],
      opts.responseTimeoutMs ?? 5000,
      opts.auth?.type ?? 'none',
      opts.auth?.headerName ?? null,
      opts.auth ? box.encrypt(opts.auth.secret, id) : null,
    ],
  );
  return id;
}

export async function addKey(pool: Pool, projectId: string, opts: Partial<FixtureOptions> = {}) {
  const { key, prefix } = generateApiKey();
  const res = await pool.query<{ id: string }>(
    `INSERT INTO api_keys (project_id, name, prefix, key_hash, allowed_methods, allowed_path_prefixes,
       rate_limit_requests, rate_limit_window_seconds) VALUES ($1, 'test key', $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      projectId,
      prefix,
      hashApiKey(key, process.env.API_KEY_PEPPER as string),
      opts.keyMethods ?? null,
      opts.keyPaths ?? null,
      opts.keyLimit?.requests ?? null,
      opts.keyLimit?.windowSeconds ?? null,
    ],
  );
  return { key, keyId: res.rows[0].id };
}

export async function waitFor(fn: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition not met in time');
}

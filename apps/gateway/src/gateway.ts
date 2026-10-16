import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  assertHostAllowed,
  buildUpstreamTarget,
  classifyUpstreamError,
  connectionListedHeaders,
  createUpstreamDispatcher,
  extractApiKey,
  HOP_BY_HOP_HEADERS,
  matchesPrefix,
  normalizeRoute,
  RateLimitDecision,
  rateLimitHeaders,
  RateLimiterUnavailableError,
  RateLimitSpec,
  RequestEvent,
  RequestOutcome,
  sanitizeGatewayPath,
  SLUG_RE,
  SlidingWindowRateLimiter,
  stripPrefix,
  STRIPPED_REQUEST_HEADERS,
  STRIPPED_RESPONSE_HEADERS,
} from '@pulsegate/shared';
import type { Agent, Dispatcher } from 'undici';
import type { GatewayConfig } from './config';
import {
  ConfigStore,
  ConfigUnavailableError,
  KeyRecord,
  ProjectConfig,
  UpstreamConfig,
} from './config-store';
import type { Logger } from './logger';
import type { GatewayMetrics } from './metrics';

export interface GatewayDeps {
  config: GatewayConfig;
  store: ConfigStore;
  limiter: SlidingWindowRateLimiter;
  analytics: { push(event: RequestEvent): void };
  metrics: GatewayMetrics;
  logger: Logger;
  readiness: () => Promise<{ ok: boolean; checks: Record<string, string> }>;
}

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  start: number;
  requestId: string;
  method: string;
  path: string;
  route: string;
  project: ProjectConfig | null;
  key: KeyRecord | null;
  upstream: UpstreamConfig | null;
  requestBytes: number;
  responseBytes: number;
  upstreamLatencyMs: number | null;
  finished: boolean;
}

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

class LimitExceeded extends Error {}

/**
 * The data-plane request handler. Plain node:http (no framework) keeps the hot
 * path small. Control-plane concerns (users, CRUD, dashboards) live in the API
 * service; this process only reads configuration through `ConfigStore`.
 */
export class Gateway {
  private inflight = 0;
  private shuttingDown = false;
  private readonly dispatchers = new Map<string, { key: string; agent: Agent }>();

  constructor(private readonly deps: GatewayDeps) {}

  get inflightRequests(): number {
    return this.inflight;
  }

  readonly handler = (req: IncomingMessage, res: ServerResponse): void => {
    this.handle(req, res).catch((err: Error) => {
      this.deps.logger.error({ err: err.message }, 'unhandled gateway error');
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ error: { code: 'internal_error', message: 'Internal gateway error' } }),
        );
      } else {
        res.destroy();
      }
    });
  };

  beginShutdown(): void {
    this.shuttingDown = true;
  }

  async closeDispatchers(): Promise<void> {
    await Promise.allSettled([...this.dispatchers.values()].map((d) => d.agent.close()));
    this.dispatchers.clear();
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { config, store, logger } = this.deps;
    const incomingId = req.headers['x-request-id'];
    const requestId =
      typeof incomingId === 'string' && REQUEST_ID_RE.test(incomingId) ? incomingId : randomUUID();
    res.setHeader('x-request-id', requestId);

    const rawUrl = req.url ?? '/';
    const q = rawUrl.indexOf('?');
    const rawPath = q === -1 ? rawUrl : rawUrl.slice(0, q);
    const rawQuery = q === -1 ? '' : rawUrl.slice(q + 1);

    if (rawPath === '/healthz') return this.json(res, 200, { status: 'ok' });
    if (rawPath === '/readyz') {
      if (this.shuttingDown) return this.json(res, 503, { status: 'shutting_down' });
      const r = await this.deps.readiness();
      return this.json(res, r.ok ? 200 : 503, {
        status: r.ok ? 'ready' : 'not_ready',
        checks: r.checks,
      });
    }

    const ctx: Ctx = {
      req,
      res,
      start: performance.now(),
      requestId,
      method: (req.method ?? 'GET').toUpperCase(),
      path: '/',
      route: '/',
      project: null,
      key: null,
      upstream: null,
      requestBytes: 0,
      responseBytes: 0,
      upstreamLatencyMs: null,
      finished: false,
    };

    if (this.inflight >= config.maxConcurrency) {
      return this.reject(
        ctx,
        503,
        'gateway_overloaded',
        'Gateway is at capacity, retry shortly',
        'unavailable',
        {
          'retry-after': '1',
        },
      );
    }
    this.inflight++;
    res.once('close', () => {
      this.inflight--;
      // writableFinished means the response completed and its continuation will record it.
      if (!ctx.finished && !res.writableFinished)
        this.finish(ctx, 499, 'client_aborted', 'client_closed_request');
    });

    // 1. Identify the project from the slug.
    const second = rawPath.indexOf('/', 1);
    const slug = second === -1 ? rawPath.slice(1) : rawPath.slice(1, second);
    const rest = second === -1 ? '/' : rawPath.slice(second);
    if (!SLUG_RE.test(slug)) {
      return this.reject(ctx, 404, 'project_not_found', 'Unknown project', 'not_found');
    }
    let project: ProjectConfig | null;
    try {
      project = await store.getProject(slug);
    } catch (err) {
      if (err instanceof ConfigUnavailableError) {
        logger.error({ requestId, slug }, 'config store unavailable');
        return this.reject(
          ctx,
          503,
          'config_unavailable',
          'Gateway configuration temporarily unavailable',
          'unavailable',
          {
            'retry-after': '2',
          },
        );
      }
      throw err;
    }
    if (!project) return this.reject(ctx, 404, 'project_not_found', 'Unknown project', 'not_found');
    ctx.project = project;

    const sanitized = sanitizeGatewayPath(rest);
    if (!sanitized.ok) {
      ctx.path = ctx.route = '[invalid]';
      return this.reject(
        ctx,
        400,
        'invalid_path',
        `Invalid request path: ${sanitized.reason}`,
        'bad_request',
      );
    }
    ctx.path = sanitized.path;
    ctx.route = normalizeRoute(sanitized.path);

    if (project.status !== 'active') {
      return this.reject(ctx, 403, 'project_disabled', 'This project is disabled', 'forbidden');
    }

    // 2. Authenticate the client with its PulseGate key.
    const { key: presented, authorizationIsPulseGate } = extractApiKey(req.headers);
    const authHeaders = { 'www-authenticate': 'Bearer realm="pulsegate"' };
    if (!presented) {
      return this.reject(
        ctx,
        401,
        'missing_api_key',
        'Provide a PulseGate key via X-PulseGate-Key',
        'unauthorized',
        authHeaders,
      );
    }
    let key: KeyRecord | null;
    try {
      key = await store.getKey(project.id, presented);
    } catch {
      return this.reject(
        ctx,
        503,
        'config_unavailable',
        'Gateway configuration temporarily unavailable',
        'unavailable',
        {
          'retry-after': '2',
        },
      );
    }
    if (!key)
      return this.reject(
        ctx,
        401,
        'invalid_api_key',
        'Invalid API key',
        'unauthorized',
        authHeaders,
      );
    ctx.key = key;
    if (key.status !== 'active') {
      return this.reject(
        ctx,
        401,
        'api_key_revoked',
        'This API key has been revoked',
        'unauthorized',
        authHeaders,
      );
    }
    if (key.expiresAt !== null && key.expiresAt <= Date.now()) {
      return this.reject(
        ctx,
        401,
        'api_key_expired',
        'This API key has expired',
        'unauthorized',
        authHeaders,
      );
    }

    // 3. Route and policy checks.
    const upstream = project.upstreams.find((u) => matchesPrefix(ctx.path, u.matchPrefix));
    if (!upstream)
      return this.reject(
        ctx,
        404,
        'route_not_found',
        'No upstream is configured for this path',
        'not_found',
      );
    ctx.upstream = upstream;
    if (!upstream.allowedMethods.has(ctx.method)) {
      return this.reject(
        ctx,
        405,
        'method_not_allowed',
        `Method ${ctx.method} is not allowed`,
        'forbidden',
        {
          allow: [...upstream.allowedMethods].join(', '),
        },
      );
    }
    if (!upstream.allowedPathPrefixes.some((p) => matchesPrefix(ctx.path, p))) {
      return this.reject(
        ctx,
        403,
        'path_not_allowed',
        'This path is not exposed by the gateway',
        'forbidden',
      );
    }
    if (key.allowedMethods && !key.allowedMethods.has(ctx.method)) {
      return this.reject(
        ctx,
        403,
        'key_method_not_allowed',
        'This API key may not use this method',
        'forbidden',
      );
    }
    if (
      key.allowedPathPrefixes &&
      !key.allowedPathPrefixes.some((p) => matchesPrefix(ctx.path, p))
    ) {
      return this.reject(
        ctx,
        403,
        'key_route_not_allowed',
        'This API key may not access this path',
        'forbidden',
      );
    }

    // 4. Rate limits (per key, plus any matching route rules), atomically in Redis.
    const decision = await this.checkRateLimit(ctx, project, key);
    if (decision === 'handled') return;
    const rlHeaders = decision ? rateLimitHeaders(decision) : {};
    if (decision && !decision.allowed) {
      return this.reject(
        ctx,
        429,
        'rate_limited',
        'Rate limit exceeded',
        'rate_limited',
        rlHeaders,
      );
    }

    // 5. Request size limits.
    const declaredLength = parseContentLength(req.headers['content-length']);
    if (declaredLength === -1)
      return this.reject(
        ctx,
        400,
        'invalid_content_length',
        'Invalid Content-Length',
        'bad_request',
      );
    if (declaredLength !== null && declaredLength > config.maxRequestBodyBytes) {
      return this.reject(
        ctx,
        413,
        'payload_too_large',
        'Request body too large',
        'payload_too_large',
        {
          ...rlHeaders,
          connection: 'close',
        },
      );
    }

    // 6. Build the upstream target; host always comes from configuration.
    const upstreamPath = upstream.stripMatchPrefix
      ? stripPrefix(ctx.path, upstream.matchPrefix)
      : ctx.path;
    let target: { origin: string; path: string };
    try {
      assertHostAllowed(upstream.baseUrl, { allowPrivate: config.allowPrivateUpstreams });
      target = buildUpstreamTarget(upstream.baseUrl, upstreamPath, rawQuery);
    } catch {
      return this.reject(
        ctx,
        502,
        'upstream_blocked',
        'Upstream destination is not permitted',
        'upstream_unreachable',
      );
    }

    await this.forward(ctx, upstream, target, authorizationIsPulseGate, declaredLength, rlHeaders);
  }

  private async checkRateLimit(
    ctx: Ctx,
    project: ProjectConfig,
    key: KeyRecord,
  ): Promise<RateLimitDecision | null | 'handled'> {
    const base = key.rateLimit ?? project.rateLimit;
    const specs: RateLimitSpec[] = [
      { scope: 'key', id: key.id, limit: base.requests, windowSeconds: base.windowSeconds },
    ];
    for (const rule of project.rules) {
      if (
        matchesPrefix(ctx.path, rule.pathPrefix) &&
        (!rule.method || rule.method === ctx.method)
      ) {
        specs.push({
          scope: 'route',
          id: `${rule.id}:${key.id}`,
          limit: rule.limit,
          windowSeconds: rule.windowSeconds,
        });
      }
    }
    try {
      return await this.deps.limiter.check(project.id, specs);
    } catch (err) {
      if (!(err instanceof RateLimiterUnavailableError)) throw err;
      if (this.deps.config.rateLimitFailureMode === 'open') {
        this.deps.logger.warn(
          { requestId: ctx.requestId },
          'rate limiter unavailable; failing open (configured)',
        );
        ctx.res.setHeader('x-pulsegate-ratelimit', 'bypassed');
        return null;
      }
      this.deps.logger.error(
        { requestId: ctx.requestId },
        'rate limiter unavailable; failing closed',
      );
      this.reject(
        ctx,
        503,
        'rate_limiter_unavailable',
        'Rate limiting is temporarily unavailable',
        'unavailable',
        {
          'retry-after': '1',
        },
      );
      return 'handled';
    }
  }

  private async forward(
    ctx: Ctx,
    upstream: UpstreamConfig,
    target: { origin: string; path: string },
    authorizationIsPulseGate: boolean,
    declaredLength: number | null,
    rlHeaders: Record<string, string>,
  ): Promise<void> {
    const { config, logger } = this.deps;
    const { req, res } = ctx;

    // Headers: drop hop-by-hop, Connection-listed, internal and credential headers.
    const listed = connectionListedHeaders(req.headers.connection);
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (HOP_BY_HOP_HEADERS.has(name) || STRIPPED_REQUEST_HEADERS.has(name) || listed.has(name))
        continue;
      if (name.startsWith('x-pulsegate-')) continue;
      if (name === 'authorization' && authorizationIsPulseGate) continue;
      headers[name] = value;
    }
    if (declaredLength !== null) headers['content-length'] = String(declaredLength);
    const clientIp = req.socket.remoteAddress ?? '';
    const priorXff = config.trustProxy ? req.headers['x-forwarded-for'] : undefined;
    headers['x-forwarded-for'] = priorXff ? `${priorXff}, ${clientIp}` : clientIp;
    const proto = config.trustProxy ? req.headers['x-forwarded-proto'] : undefined;
    headers['x-forwarded-proto'] = typeof proto === 'string' ? proto : 'http';
    if (req.headers.host) headers['x-forwarded-host'] = req.headers.host;
    headers['x-request-id'] = ctx.requestId;
    if (upstream.auth) {
      headers[upstream.auth.headerName] =
        upstream.auth.type === 'bearer' ? `Bearer ${upstream.auth.secret}` : upstream.auth.secret;
    }

    // Body: streamed through a byte counter that enforces the size limit.
    const hasBody =
      (declaredLength !== null && declaredLength > 0) ||
      req.headers['transfer-encoding'] !== undefined;
    let body: Readable | undefined;
    let requestTooLarge = false;
    if (hasBody) {
      const max = config.maxRequestBodyBytes;
      const counter = new Transform({
        transform: (chunk: Buffer, _enc, cb) => {
          ctx.requestBytes += chunk.length;
          if (ctx.requestBytes > max) {
            requestTooLarge = true;
            cb(new LimitExceeded('request body too large'));
          } else cb(null, chunk);
        },
      });
      // Not stream.pipeline(): destroying `req` would kill the socket before a 413 can be sent.
      req.pipe(counter);
      req.once('error', (err) => counter.destroy(err));
      counter.once('error', () => req.unpipe(counter));
      body = counter;
    }

    const timeout = Math.min(upstream.responseTimeoutMs, config.maxUpstreamTimeoutMs);
    const abort = new AbortController();
    res.once('close', () => {
      if (!res.writableFinished) abort.abort();
    });

    const t0 = performance.now();
    let upstreamRes: Dispatcher.ResponseData;
    try {
      upstreamRes = await this.dispatcherFor(upstream).request({
        origin: target.origin,
        path: target.path,
        method: ctx.method as Dispatcher.HttpMethod,
        headers,
        body,
        headersTimeout: timeout,
        bodyTimeout: timeout,
        signal: abort.signal,
      });
    } catch (err) {
      ctx.upstreamLatencyMs = Math.round(performance.now() - t0);
      if (requestTooLarge) {
        return this.reject(
          ctx,
          413,
          'payload_too_large',
          'Request body too large',
          'payload_too_large',
          {
            ...rlHeaders,
            connection: 'close',
          },
        );
      }
      if (abort.signal.aborted)
        return this.finish(ctx, 499, 'client_aborted', 'client_closed_request');
      const failure = classifyUpstreamError(err);
      logger.warn(
        {
          requestId: ctx.requestId,
          upstreamId: upstream.id,
          code: failure.code,
          cause: (err as { code?: string }).code,
        },
        'upstream request failed',
      );
      const timedOut =
        failure.code === 'upstream_timeout' || failure.code === 'upstream_connect_timeout';
      return this.reject(
        ctx,
        failure.status,
        failure.code,
        timedOut ? 'Upstream did not respond in time' : 'Upstream could not be reached',
        timedOut ? 'upstream_timeout' : 'upstream_unreachable',
        rlHeaders,
      );
    }
    ctx.upstreamLatencyMs = Math.round(performance.now() - t0);

    const status = upstreamRes.statusCode;
    const declaredResponse = parseContentLength(upstreamRes.headers['content-length']);
    if (declaredResponse !== null && declaredResponse > config.maxResponseBodyBytes) {
      upstreamRes.body.destroy();
      return this.reject(
        ctx,
        502,
        'upstream_response_too_large',
        'Upstream response exceeds the size limit',
        'upstream_error',
        rlHeaders,
      );
    }

    const outHeaders: Record<string, string | string[]> = {};
    const upstreamListed = connectionListedHeaders(upstreamRes.headers.connection);
    for (const [name, value] of Object.entries(upstreamRes.headers)) {
      if (value === undefined) continue;
      if (
        HOP_BY_HOP_HEADERS.has(name) ||
        STRIPPED_RESPONSE_HEADERS.has(name) ||
        upstreamListed.has(name)
      )
        continue;
      if (
        name.startsWith('x-pulsegate-') ||
        name.startsWith('ratelimit') ||
        name.startsWith('x-ratelimit')
      )
        continue;
      outHeaders[name] = value;
    }
    Object.assign(outHeaders, rlHeaders, {
      'x-request-id': ctx.requestId,
      'server-timing': `upstream;dur=${ctx.upstreamLatencyMs}`,
    });
    res.writeHead(status, outHeaders);

    const maxResponse = config.maxResponseBodyBytes;
    let responseTooLarge = false;
    const counter = new Transform({
      transform: (chunk: Buffer, _enc, cb) => {
        ctx.responseBytes += chunk.length;
        if (ctx.responseBytes > maxResponse) {
          responseTooLarge = true;
          cb(new LimitExceeded('response too large'));
        } else cb(null, chunk);
      },
    });
    try {
      await pipeline(upstreamRes.body, counter, res);
      this.finish(
        ctx,
        status,
        status >= 500 ? 'upstream_error' : 'ok',
        status >= 500 ? `upstream_${status}` : null,
      );
    } catch (err) {
      // Headers are already sent: the only safe signal left is to abort the connection.
      res.destroy();
      if (responseTooLarge)
        return this.finish(ctx, status, 'upstream_error', 'upstream_response_too_large');
      if (abort.signal.aborted && !ctx.finished)
        return this.finish(ctx, 499, 'client_aborted', 'client_closed_request');
      const failure = classifyUpstreamError(err);
      this.finish(
        ctx,
        status,
        failure.code === 'upstream_timeout' ? 'upstream_timeout' : 'upstream_error',
        `${failure.code}_mid_stream`,
      );
    }
  }

  private dispatcherFor(upstream: UpstreamConfig): Agent {
    const existing = this.dispatchers.get(upstream.id);
    if (existing && existing.key === upstream.dispatcherKey) return existing.agent;
    if (existing) void existing.agent.close().catch(() => undefined);
    const agent = createUpstreamDispatcher({
      allowPrivate: this.deps.config.allowPrivateUpstreams,
      connectTimeoutMs: upstream.connectTimeoutMs,
      maxConnections: this.deps.config.upstreamMaxConnections,
    });
    this.dispatchers.set(upstream.id, { key: upstream.dispatcherKey, agent });
    return agent;
  }

  private reject(
    ctx: Ctx,
    status: number,
    code: string,
    message: string,
    outcome: RequestOutcome,
    headers: Record<string, string> = {},
  ): void {
    const { res } = ctx;
    if (!res.headersSent) {
      const payload = JSON.stringify({ error: { code, message }, requestId: ctx.requestId });
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        'cache-control': 'no-store',
        ...headers,
      });
      res.end(payload);
      ctx.responseBytes = Buffer.byteLength(payload);
    }
    this.finish(ctx, status, outcome, code);
  }

  private finish(
    ctx: Ctx,
    status: number,
    outcome: RequestOutcome,
    errorCode: string | null,
  ): void {
    if (ctx.finished) return;
    ctx.finished = true;
    const latencyMs = Math.round(performance.now() - ctx.start);
    this.deps.metrics.record(outcome, latencyMs);
    const log = {
      requestId: ctx.requestId,
      project: ctx.project?.slug,
      method: ctx.method,
      path: ctx.path,
      status,
      outcome,
      latencyMs,
      upstreamLatencyMs: ctx.upstreamLatencyMs,
      keyId: ctx.key?.id,
    };
    if (this.deps.config.accessLog) this.deps.logger.info(log, 'request');
    else this.deps.logger.debug(log, 'request');
    if (!ctx.project) return; // no tenant to attribute the request to
    this.deps.analytics.push({
      id: randomUUID(),
      ts: Date.now(),
      requestId: ctx.requestId,
      orgId: ctx.project.orgId,
      projectId: ctx.project.id,
      upstreamId: ctx.upstream?.id ?? null,
      apiKeyId: ctx.key?.id ?? null,
      method: ctx.method.slice(0, 16),
      path: ctx.path.slice(0, 512),
      route: ctx.route,
      status,
      outcome,
      latencyMs,
      upstreamLatencyMs: ctx.upstreamLatencyMs,
      requestBytes: ctx.requestBytes,
      responseBytes: ctx.responseBytes,
      errorCode,
      gatewayId: this.deps.config.gatewayId,
    });
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(payload);
  }
}

/** null = absent, -1 = invalid, otherwise the byte count. */
function parseContentLength(value: string | string[] | undefined): number | null {
  if (value === undefined) return null;
  const v = Array.isArray(value) ? value[0] : value;
  if (!/^\d{1,15}$/.test(v)) return -1;
  return Number(v);
}

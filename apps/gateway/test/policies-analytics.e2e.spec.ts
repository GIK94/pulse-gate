import { createServer, Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  EVENTS_STREAM,
  RateLimiterUnavailableError,
  RequestEvent,
  SlidingWindowRateLimiter,
} from '@pulsegate/shared';
import Redis from 'ioredis';
import type { Pool } from 'pg';
import request from 'supertest';
import type { GatewayApp } from '../src/app';
import { Gateway } from '../src/gateway';
import { GatewayMetrics } from '../src/metrics';
import { IngestWorker } from '../src/worker/ingest';
import {
  createFixture,
  logger,
  startDemoUpstream,
  startGateway,
  testConfig,
  testPool,
} from './helpers';

describe('rate limiting', () => {
  let pool: Pool;
  let gw: GatewayApp;
  let demo: { server: Server; url: string };

  beforeAll(async () => {
    pool = testPool();
    demo = await startDemoUpstream();
    gw = await startGateway(pool);
  });
  afterAll(async () => {
    await gw.close();
    gw.server.close();
    demo.server.close();
    await pool.end();
  });

  it('enforces the per-key limit with 429, Retry-After and RateLimit headers', async () => {
    const f = await createFixture(pool, {
      upstreamUrl: demo.url,
      keyLimit: { requests: 3, windowSeconds: 60 },
    });
    const statuses: number[] = [];
    let last: request.Response | null = null;
    for (let i = 0; i < 5; i++) {
      last = await request(gw.server).get(`/${f.slug}/products`).set('x-pulsegate-key', f.key);
      statuses.push(last.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(last!.body.error.code).toBe('rate_limited');
    expect(Number(last!.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(last!.headers['ratelimit-limit']).toBe('3');
    expect(last!.headers['ratelimit-remaining']).toBe('0');
    expect(last!.headers['ratelimit-policy']).toBe('3;w=60');
    expect(last!.headers['x-ratelimit-limit']).toBe('3');
  });

  it('applies the project default when the key has no override, per key', async () => {
    const f = await createFixture(pool, {
      upstreamUrl: demo.url,
      projectLimit: { requests: 2, windowSeconds: 60 },
    });
    await request(gw.server).get(`/${f.slug}/products`).set('x-pulsegate-key', f.key).expect(200);
    await request(gw.server).get(`/${f.slug}/products`).set('x-pulsegate-key', f.key).expect(200);
    await request(gw.server).get(`/${f.slug}/products`).set('x-pulsegate-key', f.key).expect(429);
  });

  it('applies route rules in addition to the key limit, without consuming budget on rejection', async () => {
    const f = await createFixture(pool, {
      upstreamUrl: demo.url,
      keyLimit: { requests: 4, windowSeconds: 60 },
    });
    await pool.query(
      `INSERT INTO rate_limit_rules (project_id, path_prefix, method, limit_requests, window_seconds) VALUES ($1, '/orders', 'POST', 1, 60)`,
      [f.projectId],
    );
    const k = { 'x-pulsegate-key': f.key };
    await request(gw.server).post(`/${f.slug}/orders`).set(k).send({ productId: 1 }).expect(201);
    const limited = await request(gw.server)
      .post(`/${f.slug}/orders`)
      .set(k)
      .send({ productId: 1 })
      .expect(429);
    expect(limited.headers['ratelimit-limit']).toBe('1');
    // GETs are not covered by the POST /orders rule and still have key budget (3 of 4 left,
    // because the rejected POST did not consume the key limit).
    for (let i = 0; i < 3; i++)
      await request(gw.server).get(`/${f.slug}/products`).set(k).expect(200);
    await request(gw.server).get(`/${f.slug}/products`).set(k).expect(429);
  });

  it('shares counters across gateway instances (state lives in Redis)', async () => {
    const f = await createFixture(pool, {
      upstreamUrl: demo.url,
      keyLimit: { requests: 2, windowSeconds: 60 },
    });
    const second = await startGateway(pool);
    try {
      await request(gw.server).get(`/${f.slug}/products`).set('x-pulsegate-key', f.key).expect(200);
      await request(second.server)
        .get(`/${f.slug}/products`)
        .set('x-pulsegate-key', f.key)
        .expect(200);
      await request(gw.server).get(`/${f.slug}/products`).set('x-pulsegate-key', f.key).expect(429);
      await request(second.server)
        .get(`/${f.slug}/products`)
        .set('x-pulsegate-key', f.key)
        .expect(429);
    } finally {
      await second.close();
      second.server.close();
    }
  });

  describe('when Redis is unavailable', () => {
    const brokenLimiter = {
      check: async () => {
        throw new RateLimiterUnavailableError(new Error('connection refused'));
      },
    } as unknown as SlidingWindowRateLimiter;

    function gatewayWith(mode: 'closed' | 'open'): Server {
      const events: RequestEvent[] = [];
      const g = new Gateway({
        config: testConfig({ rateLimitFailureMode: mode }),
        store: gw.store,
        limiter: brokenLimiter,
        analytics: { push: (e) => events.push(e) },
        metrics: new GatewayMetrics(),
        logger,
        readiness: async () => ({ ok: true, checks: {} }),
      });
      return createServer(g.handler);
    }

    it('fails closed by default (503, never silently bypasses limits)', async () => {
      const f = await createFixture(pool, { upstreamUrl: demo.url });
      const res = await request(gatewayWith('closed'))
        .get(`/${f.slug}/products`)
        .set('x-pulsegate-key', f.key)
        .expect(503);
      expect(res.body.error.code).toBe('rate_limiter_unavailable');
      expect(res.headers['retry-after']).toBe('1');
    });

    it('can be configured to fail open, flagging the response', async () => {
      const f = await createFixture(pool, { upstreamUrl: demo.url });
      const res = await request(gatewayWith('open'))
        .get(`/${f.slug}/products`)
        .set('x-pulsegate-key', f.key)
        .expect(200);
      expect(res.headers['x-pulsegate-ratelimit']).toBe('bypassed');
    });
  });

  it('computes Retry-After consistently with the sliding window', async () => {
    const redis = new Redis(process.env.REDIS_URL as string);
    const limiter = new SlidingWindowRateLimiter(redis, 'pg:test-rl');
    const tag = randomUUID();
    const spec = { scope: 'key', id: 'k', limit: 2, windowSeconds: 2 };
    expect((await limiter.check(tag, [spec]))!.allowed).toBe(true);
    expect((await limiter.check(tag, [spec]))!.allowed).toBe(true);
    const denied = (await limiter.check(tag, [spec]))!;
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(4);
    await new Promise((r) => setTimeout(r, denied.retryAfterSeconds * 1000 + 50));
    expect((await limiter.check(tag, [spec]))!.allowed).toBe(true);
    await limiter.reset(tag);
    await redis.quit();
  }, 15_000);
});

describe('SSRF protection at connection time', () => {
  let pool: Pool;
  let strict: GatewayApp;
  let demo: { server: Server; url: string };

  beforeAll(async () => {
    pool = testPool();
    demo = await startDemoUpstream();
    strict = await startGateway(pool, { allowPrivateUpstreams: false });
  });
  afterAll(async () => {
    await strict.close();
    strict.server.close();
    demo.server.close();
    await pool.end();
  });

  it('blocks private IP-literal upstreams even if they were stored', async () => {
    const f = await createFixture(pool, { upstreamUrl: demo.url }); // 127.0.0.1:<port>
    const res = await request(strict.server)
      .get(`/${f.slug}/products`)
      .set('x-pulsegate-key', f.key)
      .expect(502);
    expect(res.body.error.code).toBe('upstream_blocked');
  });

  it('re-resolves hostnames at connect time and blocks private resolutions', async () => {
    const port = new URL(demo.url).port;
    const f = await createFixture(pool, { upstreamUrl: `http://localhost:${port}` });
    const res = await request(strict.server)
      .get(`/${f.slug}/products`)
      .set('x-pulsegate-key', f.key)
      .expect(502);
    expect(res.body.error.code).toBe('upstream_blocked');
  });
});

describe('analytics pipeline (gateway -> Redis stream -> worker -> PostgreSQL)', () => {
  let pool: Pool;
  let gw: GatewayApp;
  let demo: { server: Server; url: string };
  let redis: Redis;
  let worker: IngestWorker;

  beforeAll(async () => {
    pool = testPool();
    redis = new Redis(process.env.REDIS_URL as string);
    await redis.del(EVENTS_STREAM);
    demo = await startDemoUpstream();
    gw = await startGateway(pool);
    worker = new IngestWorker(
      redis,
      pool,
      { consumer: 'test', batchSize: 500, blockMs: 100, claimIdleMs: 60_000 },
      logger,
    );
    await worker.ensureGroup();
  });
  afterAll(async () => {
    await gw.close();
    gw.server.close();
    demo.server.close();
    await redis.quit();
    await pool.end();
  });

  async function drain(): Promise<void> {
    await gw.analytics.flush();
    while ((await worker.processOnce()) > 0) {
      /* keep draining */
    }
  }

  it('records accepted and rejected requests against the right tenant, without secrets', async () => {
    const secret = 'analytics-upstream-secret';
    const f = await createFixture(pool, {
      upstreamUrl: demo.url,
      keyLimit: { requests: 2, windowSeconds: 60 },
      auth: { type: 'bearer', secret },
    });
    const other = await createFixture(pool, { upstreamUrl: demo.url });
    const k = { 'x-pulsegate-key': f.key };
    await request(gw.server).get(`/${f.slug}/products/3?secret=query`).set(k).expect(200);
    await request(gw.server).post(`/${f.slug}/orders`).set(k).send({ productId: 1 }).expect(201);
    await request(gw.server).get(`/${f.slug}/products`).set(k).expect(429);
    await request(gw.server).get(`/${f.slug}/products`).expect(401);
    await request(gw.server)
      .get(`/${f.slug}/products`)
      .set('x-pulsegate-key', other.key)
      .expect(401);
    await drain();

    const { rows } = await pool.query(
      `SELECT * FROM request_logs WHERE project_id = $1 ORDER BY created_at`,
      [f.projectId],
    );
    expect(rows.map((r) => [r.method, r.path, r.status, r.outcome])).toEqual([
      ['GET', '/products/3', 200, 'ok'],
      ['POST', '/orders', 201, 'ok'],
      ['GET', '/products', 429, 'rate_limited'],
      ['GET', '/products', 401, 'unauthorized'],
      ['GET', '/products', 401, 'unauthorized'],
    ]);
    expect(rows[0]).toMatchObject({
      org_id: f.orgId,
      api_key_id: f.keyId,
      upstream_id: f.upstreamId,
      route: '/products/:id',
    });
    expect(Number(rows[1].request_bytes)).toBeGreaterThan(0);
    expect(Number(rows[0].response_bytes)).toBeGreaterThan(0);
    expect(rows[0].upstream_latency_ms).not.toBeNull();
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(f.key);
    expect(dump).not.toContain(other.key);
    expect(dump).not.toContain(secret);
    expect(dump).not.toContain('secret=query');

    const otherRows = await pool.query(
      'SELECT count(*)::int AS n FROM request_logs WHERE project_id = $1',
      [other.projectId],
    );
    expect(otherRows.rows[0].n).toBe(0);
    const key = await pool.query('SELECT last_used_at FROM api_keys WHERE id = $1', [f.keyId]);
    expect(key.rows[0].last_used_at).not.toBeNull();
  });

  it('is idempotent on redelivery and discards malformed events', async () => {
    const f = await createFixture(pool, { upstreamUrl: demo.url });
    const requestId = `dup-${randomUUID()}`;
    const event: RequestEvent = {
      id: randomUUID(),
      ts: Date.now(),
      requestId,
      orgId: f.orgId,
      projectId: f.projectId,
      upstreamId: null,
      apiKeyId: null,
      method: 'GET',
      path: '/dup',
      route: '/dup',
      status: 200,
      outcome: 'ok',
      latencyMs: 1,
      upstreamLatencyMs: null,
      requestBytes: 0,
      responseBytes: 0,
      errorCode: null,
      gatewayId: 'test',
    };
    await redis.xadd(EVENTS_STREAM, '*', 'e', JSON.stringify(event));
    await redis.xadd(EVENTS_STREAM, '*', 'e', JSON.stringify(event));
    await redis.xadd(EVENTS_STREAM, '*', 'e', '{not json');
    await drain();
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM request_logs WHERE request_id = $1',
      [requestId],
    );
    expect(rows[0].n).toBe(1);
    const pending = (await redis.xpending(EVENTS_STREAM, 'ingest')) as [number, ...unknown[]];
    expect(pending[0]).toBe(0);
  });
});

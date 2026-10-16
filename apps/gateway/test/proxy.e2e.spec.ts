import { request as httpRequest, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CONFIG_CHANNEL } from '@pulsegate/shared';
import Redis from 'ioredis';
import type { Pool } from 'pg';
import request from 'supertest';
import type { GatewayApp } from '../src/app';
import {
  addUpstream,
  createFixture,
  Fixture,
  startDemoUpstream,
  startGateway,
  testPool,
  waitFor,
} from './helpers';

describe('gateway proxy behaviour', () => {
  let pool: Pool;
  let gw: GatewayApp;
  let demo: { server: Server; url: string };
  let fx: Fixture;
  const UPSTREAM_SECRET = 'upstream-secret-value-123';

  beforeAll(async () => {
    pool = testPool();
    const redis = new Redis(process.env.REDIS_URL as string);
    await redis.flushdb();
    await redis.quit();
    demo = await startDemoUpstream();
    gw = await startGateway(pool);
    fx = await createFixture(pool, {
      upstreamUrl: demo.url,
      auth: { type: 'header', headerName: 'x-test-upstream-secret', secret: UPSTREAM_SECRET },
    });
  });

  afterAll(async () => {
    await gw.close();
    gw.server.close();
    demo.server.close();
    await pool.end();
  });

  const call = () => request(gw.server);
  const auth = () => ({ 'x-pulsegate-key': fx.key });

  it('proxies GET with query parameters and returns the upstream response', async () => {
    const res = await call()
      .get(`/${fx.slug}/products?category=audio&limit=5`)
      .set(auth())
      .expect(200);
    expect(res.body).toEqual({ data: [expect.objectContaining({ category: 'audio' })], count: 1 });
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
    expect(res.headers['ratelimit-limit']).toBe('1000');
    expect(res.headers['server-timing']).toMatch(/^upstream;dur=\d+$/);
  });

  it('forwards JSON bodies and returns upstream status codes', async () => {
    const created = await call()
      .post(`/${fx.slug}/orders`)
      .set(auth())
      .send({ productId: 1, quantity: 2 })
      .expect(201);
    expect(created.body.data).toMatchObject({ productId: 1, quantity: 2, totalCents: 25800 });
    await call().post(`/${fx.slug}/orders`).set(auth()).send({ productId: 999 }).expect(422);
    await call()
      .post(`/${fx.slug}/orders`)
      .set(auth())
      .set('content-type', 'application/json')
      .send('{bad json')
      .expect(400);
  });

  it.each(['PUT', 'PATCH', 'DELETE', 'OPTIONS'])('supports %s', async (method) => {
    const verb = method.toLowerCase() as 'put';
    const client = call();
    const res = await client[verb](`/${fx.slug}/echo/item/7?x=1`)
      .set(auth())
      .send(method === 'DELETE' || method === 'OPTIONS' ? undefined : { a: 1 })
      .expect(200);
    expect(res.body).toMatchObject({ method, path: '/echo/item/7', query: { x: '1' } });
  });

  it('supports HEAD and binary bodies', async () => {
    const head = await call().head(`/${fx.slug}/products`).set(auth()).expect(200);
    expect(head.text ?? '').toBe('');
    const bin = Buffer.alloc(3000, 1);
    const res = await call()
      .post(`/${fx.slug}/echo/bin`)
      .set(auth())
      .set('content-type', 'application/octet-stream')
      .send(bin)
      .expect(200);
    expect(res.body.bodyBytes).toBe(3000);
  });

  it('never forwards the PulseGate credential, cookies or hop-by-hop headers, and injects upstream auth', async () => {
    const res = await call()
      .get(`/${fx.slug}/echo/headers`)
      .set('authorization', `Bearer ${fx.key}`)
      .set('cookie', 'session=abc')
      .set('connection', 'x-hop-secret')
      .set('x-hop-secret', 'should-not-pass')
      .set('x-pulsegate-internal', 'nope')
      .set('x-forwarded-for', '6.6.6.6')
      .set('x-app-header', 'kept')
      .expect(200);
    const h = res.body.headers;
    expect(h.authorization).toBeUndefined();
    expect(h['x-pulsegate-key']).toBeUndefined();
    expect(h.cookie).toBeUndefined();
    expect(h['x-hop-secret']).toBeUndefined();
    expect(h['x-pulsegate-internal']).toBeUndefined();
    expect(h['x-forwarded-for']).not.toContain('6.6.6.6'); // TRUST_PROXY=false
    expect(h['x-app-header']).toBe('kept');
    expect(h['x-test-upstream-secret']).toBe(UPSTREAM_SECRET);
    expect(h.host).toBe(new URL(demo.url).host);
    expect(JSON.stringify(res.headers)).not.toContain(UPSTREAM_SECRET);
  });

  it("forwards the client's own Authorization header when it is not a PulseGate key", async () => {
    const res = await call()
      .get(`/${fx.slug}/echo/a`)
      .set(auth())
      .set('authorization', 'Bearer client-token')
      .expect(200);
    expect(res.body.headers.authorization).toBe('[present]');
  });

  it('strips Set-Cookie from upstream responses (shared gateway origin)', async () => {
    const res = await call().get(`/${fx.slug}/set-cookie`).set(auth()).expect(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['x-demo']).toBe('kept');
  });

  it('authenticates clients', async () => {
    const missing = await call().get(`/${fx.slug}/products`).expect(401);
    expect(missing.body.error.code).toBe('missing_api_key');
    expect(missing.headers['www-authenticate']).toMatch(/Bearer/);
    const invalid = await call()
      .get(`/${fx.slug}/products`)
      .set('x-pulsegate-key', 'pgk_0000000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
      .expect(401);
    expect(invalid.body.error.code).toBe('invalid_api_key');
    await call().get(`/${fx.slug}/products`).set('x-pulsegate-key', 'garbage').expect(401);
  });

  it("rejects another project's key", async () => {
    const other = await createFixture(pool, { upstreamUrl: demo.url });
    const res = await call()
      .get(`/${fx.slug}/products`)
      .set('x-pulsegate-key', other.key)
      .expect(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('propagates key revocation to the gateway via config invalidation', async () => {
    const victim = await createFixture(pool, { upstreamUrl: demo.url });
    await call().get(`/${victim.slug}/products`).set('x-pulsegate-key', victim.key).expect(200); // now cached
    await pool.query(`UPDATE api_keys SET status = 'revoked', revoked_at = now() WHERE id = $1`, [
      victim.keyId,
    ]);
    const pub = new Redis(process.env.REDIS_URL as string);
    await pub.publish(
      CONFIG_CHANNEL,
      JSON.stringify({ kind: 'key', projectId: victim.projectId, keyId: victim.keyId }),
    );
    await pub.quit();
    await waitFor(
      async () =>
        (await call().get(`/${victim.slug}/products`).set('x-pulsegate-key', victim.key)).status ===
        401,
    );
    const res = await call()
      .get(`/${victim.slug}/products`)
      .set('x-pulsegate-key', victim.key)
      .expect(401);
    expect(res.body.error.code).toBe('api_key_revoked');
  });

  it('rejects expired keys', async () => {
    const f = await createFixture(pool, { upstreamUrl: demo.url });
    await pool.query(`UPDATE api_keys SET expires_at = now() - interval '1 second' WHERE id = $1`, [
      f.keyId,
    ]);
    const res = await call().get(`/${f.slug}/products`).set('x-pulsegate-key', f.key).expect(401);
    expect(res.body.error.code).toBe('api_key_expired');
  });

  it.each([
    ['/a/../../admin', 'dot segment'],
    ['/a/%2e%2e/admin', 'encoded dot segment'],
    ['/a%2fb', 'encoded slash'],
    ['/a%5cb', 'encoded backslash'],
    ['/a/%zz', 'bad escape'],
  ])('blocks path traversal: %s (%s)', async (path) => {
    const res = await call().get(`/${fx.slug}${path}`).set(auth()).expect(400);
    expect(res.body.error.code).toBe('invalid_path');
  });

  it('cannot override the upstream host via path or Host header', async () => {
    const res = await call()
      .get(`/${fx.slug}//evil.example/echo`)
      .set(auth())
      .set('host', 'evil.example')
      .expect(404);
    expect(res.body.path).toBe('/evil.example/echo'); // reached the configured upstream, not evil.example
  });

  it('returns 404 for unknown projects and unrouted paths', async () => {
    await call().get('/no-such-project/x').expect(404);
    const scoped = await createFixture(pool, { upstreamUrl: demo.url, matchPrefix: '/api' });
    const res = await call()
      .get(`/${scoped.slug}/other`)
      .set('x-pulsegate-key', scoped.key)
      .expect(404);
    expect(res.body.error.code).toBe('route_not_found');
  });

  it('routes by longest match prefix and strips it', async () => {
    const f = await createFixture(pool, { upstreamUrl: demo.url });
    await addUpstream(pool, f.projectId, { upstreamUrl: `${demo.url}/echo`, matchPrefix: '/v2' });
    const pub = new Redis(process.env.REDIS_URL as string);
    await pub.publish(
      CONFIG_CHANNEL,
      JSON.stringify({ kind: 'project', projectId: f.projectId, slug: f.slug }),
    );
    await pub.quit();
    await waitFor(
      async () =>
        (await call().get(`/${f.slug}/v2/thing`).set('x-pulsegate-key', f.key)).status === 200,
    );
    const res = await call().get(`/${f.slug}/v2/thing`).set('x-pulsegate-key', f.key).expect(200);
    expect(res.body.path).toBe('/echo/thing');
  });

  it('enforces upstream method/path rules and per-key policies', async () => {
    const f = await createFixture(pool, {
      upstreamUrl: demo.url,
      allowedMethods: ['GET', 'POST'],
      allowedPathPrefixes: ['/products', '/echo'],
      keyMethods: ['GET'],
      keyPaths: ['/products'],
    });
    const k = { 'x-pulsegate-key': f.key };
    const del = await call().delete(`/${f.slug}/products/1`).set(k).expect(405);
    expect(del.headers.allow).toBe('GET, POST');
    expect((await call().get(`/${f.slug}/orders`).set(k).expect(403)).body.error.code).toBe(
      'path_not_allowed',
    );
    expect((await call().post(`/${f.slug}/products`).set(k).expect(403)).body.error.code).toBe(
      'key_method_not_allowed',
    );
    expect((await call().get(`/${f.slug}/echo/x`).set(k).expect(403)).body.error.code).toBe(
      'key_route_not_allowed',
    );
    await call().get(`/${f.slug}/products`).set(k).expect(200);
  });

  it('rejects disabled projects', async () => {
    const f = await createFixture(pool, { upstreamUrl: demo.url });
    await pool.query(`UPDATE projects SET status = 'disabled' WHERE id = $1`, [f.projectId]);
    const res = await call().get(`/${f.slug}/products`).set('x-pulsegate-key', f.key).expect(403);
    expect(res.body.error.code).toBe('project_disabled');
  });

  it('passes upstream 5xx through and maps timeouts and connection failures', async () => {
    const fail = await call().get(`/${fx.slug}/fail?status=503`).set(auth()).expect(503);
    expect(fail.body).toEqual({ error: 'simulated_failure', status: 503 });

    const slow = await createFixture(pool, { upstreamUrl: demo.url, responseTimeoutMs: 200 });
    const timeout = await call()
      .get(`/${slow.slug}/slow?delay=2000`)
      .set('x-pulsegate-key', slow.key)
      .expect(504);
    expect(timeout.body.error.code).toBe('upstream_timeout');

    const dead = await startDemoUpstream();
    const deadUrl = dead.url;
    await new Promise((r) => dead.server.close(r));
    const down = await createFixture(pool, { upstreamUrl: deadUrl });
    const res = await call()
      .get(`/${down.slug}/products`)
      .set('x-pulsegate-key', down.key)
      .expect(502);
    expect(res.body.error.code).toBe('upstream_unreachable');
    expect(JSON.stringify(res.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);
  });

  it('rejects WebSocket upgrades explicitly', async () => {
    const port = await listenPort(gw.server);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({
        port,
        path: `/${fx.slug}/ws`,
        headers: { connection: 'Upgrade', upgrade: 'websocket', 'x-pulsegate-key': fx.key },
      });
      req.on('response', (r) => resolve(r.statusCode ?? 0));
      req.on('upgrade', (r) => resolve(r.statusCode ?? 0));
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(501);
  });
});

describe('gateway limits', () => {
  let pool: Pool;
  let gw: GatewayApp;
  let demo: { server: Server; url: string };
  let fx: Fixture;

  beforeAll(async () => {
    pool = testPool();
    demo = await startDemoUpstream();
    gw = await startGateway(pool, { maxRequestBodyBytes: 1024, maxResponseBodyBytes: 2048 });
    fx = await createFixture(pool, { upstreamUrl: demo.url });
  });
  afterAll(async () => {
    await gw.close();
    gw.server.close();
    demo.server.close();
    await pool.end();
  });

  it('rejects oversized request bodies by Content-Length (413)', async () => {
    const res = await request(gw.server)
      .post(`/${fx.slug}/echo/big`)
      .set('x-pulsegate-key', fx.key)
      .set('content-type', 'application/octet-stream')
      .send(Buffer.alloc(4096))
      .expect(413);
    expect(res.body.error.code).toBe('payload_too_large');
  });

  it('rejects oversized chunked request bodies while streaming (413)', async () => {
    const port = await listenPort(gw.server);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({
        port,
        method: 'POST',
        path: `/${fx.slug}/echo/chunked`,
        headers: { 'x-pulsegate-key': fx.key, 'transfer-encoding': 'chunked' },
      });
      req.on('response', (r) => {
        r.resume();
        resolve(r.statusCode ?? 0);
      });
      req.on('error', reject);
      for (let i = 0; i < 8; i++) req.write(Buffer.alloc(512));
      req.end();
    });
    expect(status).toBe(413);
  });

  it('rejects upstream responses larger than the limit (502)', async () => {
    await request(gw.server)
      .get(`/${fx.slug}/large?bytes=1000`)
      .set('x-pulsegate-key', fx.key)
      .expect(200);
    const res = await request(gw.server)
      .get(`/${fx.slug}/large?bytes=100000`)
      .set('x-pulsegate-key', fx.key)
      .expect(502);
    expect(res.body.error.code).toBe('upstream_response_too_large');
  });
});

async function listenPort(server: Server): Promise<number> {
  if (!server.listening) await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
}

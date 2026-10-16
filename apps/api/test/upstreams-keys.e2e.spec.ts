import { AddressInfo } from 'node:net';
import { createServer, IncomingHttpHeaders, Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import {
  createProject,
  createTestApp,
  resetState,
  signup,
  testPool,
  TestUser,
  withEnv,
} from './helpers';

describe('upstream configuration: SSRF validation and secret handling', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let u: TestUser;
  let project: { id: string; slug: string; orgId: string };
  const SECRET = 'sk_live_upstream_SUPER_secret_value_123';

  beforeAll(async () => {
    pool = testPool();
    await resetState(pool);
    app = await createTestApp(); // ALLOW_PRIVATE_UPSTREAMS=false
    u = await signup(app, 'ops');
    project = await createProject(u);
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const post = (body: object) =>
    u.agent.post(`/api/projects/${project.id}/upstreams`).set('x-csrf-token', u.csrf).send(body);

  it.each([
    'http://127.0.0.1:8080',
    'http://localhost:4100',
    'http://10.0.0.5',
    'http://192.168.1.10',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'http://[fd00:ec2::254]/',
    'http://0x7f000001/',
    'http://metadata.google.internal/',
    'ftp://93.184.215.14/',
    'https://user:pass@93.184.215.14/',
    'not a url',
  ])('rejects prohibited upstream %s', async (baseUrl) => {
    const res = await post({
      name: 'bad',
      baseUrl,
      matchPrefix: `/x${Math.random().toString(36).slice(2, 6)}`,
    }).expect(400);
    expect(JSON.stringify(res.body)).toMatch(/baseUrl/);
  });

  it('stores credentials encrypted and never returns or logs them in history', async () => {
    const res = await post({
      name: 'Billing',
      baseUrl: 'https://93.184.215.14/v2/',
      matchPrefix: '/billing',
      allowedMethods: ['get', 'POST'],
      auth: { type: 'header', headerName: 'X-Billing-Token', secret: SECRET },
    }).expect(201);
    expect(res.body.baseUrl).toBe('https://93.184.215.14/v2');
    expect(res.body.allowedMethods).toEqual(['GET', 'POST']);
    expect(res.body.enabled).toBe(false);
    expect(res.body.auth).toEqual({
      type: 'header',
      headerName: 'X-Billing-Token',
      hasSecret: true,
    });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);

    const { rows } = await pool.query('SELECT auth_secret_enc FROM upstreams WHERE id = $1', [
      res.body.id,
    ]);
    expect(rows[0].auth_secret_enc).toMatch(/^v1\.test\./);
    expect(rows[0].auth_secret_enc).not.toContain(SECRET);

    // Update without a secret keeps it; with a new secret rotates it.
    const upd = await u.agent
      .patch(`/api/projects/${project.id}/upstreams/${res.body.id}`)
      .set('x-csrf-token', u.csrf)
      .send({ name: 'Billing v2', auth: { type: 'header', headerName: 'X-Billing-Token' } })
      .expect(200);
    expect(upd.body.auth.hasSecret).toBe(true);
    await u.agent
      .patch(`/api/projects/${project.id}/upstreams/${res.body.id}`)
      .set('x-csrf-token', u.csrf)
      .send({ auth: { type: 'bearer', secret: 'another-secret-value' } })
      .expect(200);

    for (const path of [
      `/api/projects/${project.id}/upstreams`,
      `/api/projects/${project.id}/upstreams/${res.body.id}`,
      `/api/projects/${project.id}/upstreams/${res.body.id}/history`,
      `/api/projects/${project.id}/audit`,
    ]) {
      const body = JSON.stringify((await u.agent.get(path).expect(200)).body);
      expect(body).not.toContain(SECRET);
      expect(body).not.toContain('another-secret-value');
    }
    const audit = await pool.query(
      'SELECT changes::text AS c FROM audit_log WHERE entity_id = $1',
      [res.body.id],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(3);
    for (const r of audit.rows) expect(r.c).not.toContain(SECRET);
    const history = (
      await u.agent.get(`/api/projects/${project.id}/upstreams/${res.body.id}/history`)
    ).body;
    expect(history.map((h: { action: string }) => h.action)).toEqual([
      'updated',
      'updated',
      'created',
    ]);
  });

  it('rejects reserved custom auth header names and missing secrets', async () => {
    await post({
      name: 'x',
      baseUrl: 'https://93.184.215.14',
      matchPrefix: '/h1',
      auth: { type: 'header', headerName: 'Host', secret: 's' },
    }).expect(400);
    await post({
      name: 'x',
      baseUrl: 'https://93.184.215.14',
      matchPrefix: '/h2',
      auth: { type: 'bearer' },
    }).expect(400);
    await post({ name: 'x', baseUrl: 'https://93.184.215.14', matchPrefix: '/../h3' }).expect(400);
  });

  it('rejects duplicate match prefixes within a project', async () => {
    await post({ name: 'a', baseUrl: 'https://93.184.215.14', matchPrefix: '/dup' }).expect(201);
    await post({ name: 'b', baseUrl: 'https://93.184.215.14', matchPrefix: '/dup/' }).expect(409);
  });

  describe('connection test (dev mode with a local upstream)', () => {
    let devApp: NestExpressApplication;
    let server: Server;
    let seen: IncomingHttpHeaders | null = null;

    beforeAll(async () => {
      server = createServer((req, res) => {
        seen = req.headers;
        res.writeHead(req.url === '/health' ? 200 : 503, { 'content-type': 'application/json' });
        res.end(`{"echo":"${String(req.headers['x-local-token'])}"}`);
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      devApp = await withEnv({ ALLOW_PRIVATE_UPSTREAMS: 'true' }, () => createTestApp());
    });
    afterAll(async () => {
      await devApp.close();
      server.close();
    });

    it('tests through the SSRF-safe client, injects auth, and never echoes the upstream body', async () => {
      const dev = await signup(devApp, 'dev');
      const p = await createProject(dev);
      const port = (server.address() as AddressInfo).port;
      const up = await dev.agent
        .post(`/api/projects/${p.id}/upstreams`)
        .set('x-csrf-token', dev.csrf)
        .send({
          name: 'local',
          baseUrl: `http://127.0.0.1:${port}`,
          auth: { type: 'header', headerName: 'X-Local-Token', secret: 'local-secret' },
        })
        .expect(201);
      const ok = await dev.agent
        .post(`/api/projects/${p.id}/upstreams/${up.body.id}/test`)
        .set('x-csrf-token', dev.csrf)
        .send({ path: '/health' })
        .expect(200);
      expect(ok.body).toMatchObject({ ok: true, status: 200, error: null });
      expect(JSON.stringify(ok.body)).not.toContain('local-secret');
      expect(seen?.['x-local-token']).toBe('local-secret');
      const failing = await dev.agent
        .post(`/api/projects/${p.id}/upstreams/${up.body.id}/test`)
        .set('x-csrf-token', dev.csrf)
        .send({ path: '/down' })
        .expect(200);
      expect(failing.body).toMatchObject({ ok: false, status: 503, error: 'upstream_503' });
      const stored = (await dev.agent.get(`/api/projects/${p.id}/upstreams/${up.body.id}`)).body;
      expect(stored.lastTest).toMatchObject({ ok: false, status: 503 });
    });

    it('still blocks cloud metadata addresses in dev mode', async () => {
      const dev = await signup(devApp, 'dev2');
      const p = await createProject(dev);
      await dev.agent
        .post(`/api/projects/${p.id}/upstreams`)
        .set('x-csrf-token', dev.csrf)
        .send({ name: 'meta', baseUrl: 'http://169.254.169.254' })
        .expect(400);
    });
  });
});

describe('client API keys', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let u: TestUser;
  let project: { id: string; slug: string; orgId: string };

  beforeAll(async () => {
    pool = testPool();
    app = await createTestApp();
    u = await signup(app, 'keys');
    project = await createProject(u);
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('returns the raw key exactly once and stores only an HMAC hash', async () => {
    const res = await u.agent
      .post(`/api/projects/${project.id}/keys`)
      .set('x-csrf-token', u.csrf)
      .send({
        name: 'web',
        allowedMethods: ['get'],
        allowedPathPrefixes: ['/products/'],
        rateLimit: { requests: 5, windowSeconds: 10 },
      })
      .expect(201);
    const raw: string = res.body.key;
    expect(raw).toMatch(/^pgk_[0-9a-f]{10}_[A-Za-z0-9_-]{32}$/);
    expect(res.body.apiKey).toMatchObject({
      prefix: raw.slice(0, 14),
      status: 'active',
      allowedMethods: ['GET'],
      allowedPathPrefixes: ['/products'],
      rateLimit: { requests: 5, windowSeconds: 10 },
    });

    const { rows } = await pool.query('SELECT * FROM api_keys WHERE id = $1', [res.body.apiKey.id]);
    const dbDump = JSON.stringify(rows[0]);
    expect(dbDump).not.toContain(raw.slice(15));
    expect(Buffer.from(rows[0].key_hash).length).toBe(32);

    const list = await u.agent.get(`/api/projects/${project.id}/keys`).expect(200);
    const listed = JSON.stringify(list.body);
    expect(listed).not.toContain(raw.slice(15));
    expect(listed).not.toMatch(/key_?hash/i);
  });

  it('revokes and rotates keys with an optional grace period', async () => {
    const created = await u.agent
      .post(`/api/projects/${project.id}/keys`)
      .set('x-csrf-token', u.csrf)
      .send({ name: 'rotating' })
      .expect(201);
    const id = created.body.apiKey.id;
    const rotated = await u.agent
      .post(`/api/projects/${project.id}/keys/${id}/rotate`)
      .set('x-csrf-token', u.csrf)
      .send({ gracePeriodSeconds: 3600 })
      .expect(200);
    expect(rotated.body.key).not.toBe(created.body.key);
    expect(rotated.body.apiKey.rotatedFromId).toBe(id);
    const old = await pool.query('SELECT status, expires_at FROM api_keys WHERE id = $1', [id]);
    expect(old.rows[0].status).toBe('active');
    expect(new Date(old.rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());

    const revoked = await u.agent
      .post(`/api/projects/${project.id}/keys/${rotated.body.apiKey.id}/revoke`)
      .set('x-csrf-token', u.csrf)
      .expect(200);
    expect(revoked.body.status).toBe('revoked');
    expect(revoked.body.revokedAt).toBeTruthy();
    await u.agent
      .post(`/api/projects/${project.id}/keys/${rotated.body.apiKey.id}/rotate`)
      .set('x-csrf-token', u.csrf)
      .send({})
      .expect(400);
  });

  it('manages rate-limit policy (default + route rules)', async () => {
    await u.agent
      .put(`/api/projects/${project.id}/rate-limits/default`)
      .set('x-csrf-token', u.csrf)
      .send({ requests: 100, windowSeconds: 60 })
      .expect(200);
    const rule = await u.agent
      .post(`/api/projects/${project.id}/rate-limits/rules`)
      .set('x-csrf-token', u.csrf)
      .send({ pathPrefix: '/orders/', method: 'post', requests: 10, windowSeconds: 60 })
      .expect(201);
    expect(rule.body).toMatchObject({ pathPrefix: '/orders', method: 'POST', requests: 10 });
    const res = await u.agent.get(`/api/projects/${project.id}/rate-limits`).expect(200);
    expect(res.body.default).toEqual({ requests: 100, windowSeconds: 60 });
    expect(res.body.rules).toHaveLength(1);
    await u.agent
      .put(`/api/projects/${project.id}/rate-limits/default`)
      .set('x-csrf-token', u.csrf)
      .send({ requests: 0, windowSeconds: 60 })
      .expect(400);
  });
});

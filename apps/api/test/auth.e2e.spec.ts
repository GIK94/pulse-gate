import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request from 'supertest';
import { createTestApp, resetState, signup, testPool, withEnv } from './helpers';

describe('auth, sessions and CSRF', () => {
  let app: NestExpressApplication;
  let pool: Pool;

  beforeAll(async () => {
    pool = testPool();
    await resetState(pool);
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('registers, stores an argon2id hash (never the password) and starts an HttpOnly session', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'Ada@Example.test', password: 'correct-horse-battery', name: 'Ada' })
      .expect(201);
    expect(res.body.user.email).toBe('ada@example.test');
    expect(res.body.csrfToken).toEqual(expect.any(String));
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/pg_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE email = $1', [
      'ada@example.test',
    ]);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0].password_hash).not.toContain('correct-horse-battery');
    const sessions = await pool.query('SELECT token_hash FROM sessions');
    const token = /pg_session=([^;]+)/.exec(cookie)![1];
    expect(
      sessions.rows.some((s) => Buffer.from(s.token_hash).toString('utf8').includes(token)),
    ).toBe(false);
  });

  it('rejects duplicate emails, weak passwords and unknown fields', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/api/auth/register')
      .send({ email: 'ada@example.test', password: 'correct-horse-battery', name: 'Ada' })
      .expect(409);
    await request(server)
      .post('/api/auth/register')
      .send({ email: 'x@example.test', password: 'short', name: 'X' })
      .expect(400);
    await request(server)
      .post('/api/auth/register')
      .send({
        email: 'y@example.test',
        password: 'correct-horse-battery',
        name: 'Y',
        role: 'owner',
      })
      .expect(400);
  });

  it('logs in with valid credentials and returns a generic error otherwise', async () => {
    const server = app.getHttpServer();
    const bad = await request(server)
      .post('/api/auth/login')
      .send({ email: 'ada@example.test', password: 'wrong-password!' })
      .expect(401);
    const unknown = await request(server)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.test', password: 'wrong-password!' })
      .expect(401);
    expect(bad.body.message).toBe(unknown.body.message);
    await request(server)
      .post('/api/auth/login')
      .send({ email: 'ada@example.test', password: 'correct-horse-battery' })
      .expect(200);
  });

  it('requires a session for management endpoints', async () => {
    await request(app.getHttpServer()).get('/api/orgs').expect(401);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', 'pg_session=forged')
      .expect(401);
  });

  it('requires the CSRF token for mutations and rejects foreign origins', async () => {
    const u = await signup(app, 'csrf');
    await u.agent.post(`/api/orgs/${u.orgId}/projects`).send({ name: 'No token' }).expect(403);
    await u.agent
      .post(`/api/orgs/${u.orgId}/projects`)
      .set('x-csrf-token', 'wrong')
      .send({ name: 'Bad token' })
      .expect(403);
    await u.agent
      .post(`/api/orgs/${u.orgId}/projects`)
      .set('x-csrf-token', u.csrf)
      .set('origin', 'https://evil.example')
      .send({ name: 'Evil origin' })
      .expect(403);
    await u.agent
      .post(`/api/orgs/${u.orgId}/projects`)
      .set('x-csrf-token', u.csrf)
      .set('origin', 'http://localhost:5173')
      .send({ name: 'Good request' })
      .expect(201);
  });

  it('logout destroys the server-side session', async () => {
    const u = await signup(app, 'logout');
    await u.agent.get('/api/auth/me').expect(200);
    await u.agent.post('/api/auth/logout').set('x-csrf-token', u.csrf).expect(204);
    await u.agent.get('/api/auth/me').expect(401);
  });

  it('throttles repeated login attempts per account (429 with Retry-After)', async () => {
    await withEnv({ LOGIN_RATE_LIMIT_PER_EMAIL: '3' }, async () => {
      const throttled = await createTestApp();
      try {
        const server = throttled.getHttpServer();
        const attempt = () =>
          request(server)
            .post('/api/auth/login')
            .send({ email: 'victim@example.test', password: 'guess-guess-guess' });
        for (let i = 0; i < 3; i++) await attempt().expect(401);
        const res = await attempt().expect(429);
        expect(res.body.message).toMatch(/Too many login attempts/);
      } finally {
        await throttled.close();
      }
    });
  });

  it('sets security headers and a correlation id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .set('x-request-id', 'trace-abc-123')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('trace-abc-123');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import {
  createProject,
  createTestApp,
  insertRequestLogs,
  resetState,
  signup,
  testPool,
  TestUser,
} from './helpers';

/**
 * Tenant boundary tests: a user in organization B must not be able to read or
 * modify anything that belongs to organization A, and non-members get 404s
 * (existence is not disclosed). Members without admin rights cannot mutate.
 */
describe('tenant isolation and RBAC', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let alice: TestUser;
  let mallory: TestUser;
  let project: { id: string; slug: string; orgId: string };
  let upstreamId: string;
  let keyId: string;
  let requestId: string;

  beforeAll(async () => {
    pool = testPool();
    await resetState(pool);
    app = await createTestApp();
    alice = await signup(app, 'alice');
    mallory = await signup(app, 'mallory');
    project = await createProject(alice);
    const up = await alice.agent
      .post(`/api/projects/${project.id}/upstreams`)
      .set('x-csrf-token', alice.csrf)
      .send({
        name: 'Public API',
        baseUrl: 'https://93.184.215.14',
        auth: { type: 'bearer', secret: 'alice-upstream-secret' },
      })
      .expect(201);
    upstreamId = up.body.id;
    const key = await alice.agent
      .post(`/api/projects/${project.id}/keys`)
      .set('x-csrf-token', alice.csrf)
      .send({ name: 'alice key' })
      .expect(201);
    keyId = key.body.apiKey.id;
    [requestId] = await insertRequestLogs(pool, project, [
      { status: 200, outcome: 'ok', latencyMs: 12, apiKeyId: keyId },
    ]);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it.each([
    ['org', () => `/api/orgs/${alice.orgId}`],
    ['org members', () => `/api/orgs/${alice.orgId}/members`],
    ['org projects', () => `/api/orgs/${alice.orgId}/projects`],
    ['org analytics', () => `/api/orgs/${alice.orgId}/analytics/summary`],
    ['project', () => `/api/projects/${project.id}`],
    ['upstreams', () => `/api/projects/${project.id}/upstreams`],
    ['upstream', () => `/api/projects/${project.id}/upstreams/${upstreamId}`],
    ['upstream history', () => `/api/projects/${project.id}/upstreams/${upstreamId}/history`],
    ['keys', () => `/api/projects/${project.id}/keys`],
    ['rate limits', () => `/api/projects/${project.id}/rate-limits`],
    ['summary', () => `/api/projects/${project.id}/analytics/summary`],
    ['timeseries', () => `/api/projects/${project.id}/analytics/timeseries`],
    ['breakdown', () => `/api/projects/${project.id}/analytics/breakdown?dimension=apiKey`],
    ['upstream health', () => `/api/projects/${project.id}/analytics/upstream-health`],
    ['requests', () => `/api/projects/${project.id}/requests`],
    ['request detail', () => `/api/projects/${project.id}/requests/${requestId}`],
    ['audit', () => `/api/projects/${project.id}/audit`],
  ])('another tenant cannot read %s (404)', async (_name, path) => {
    await mallory.agent.get(path()).expect(404);
  });

  it('another tenant cannot mutate resources', async () => {
    const m = mallory.agent;
    const h = { 'x-csrf-token': mallory.csrf };
    await m.patch(`/api/projects/${project.id}`).set(h).send({ name: 'pwned' }).expect(404);
    await m.delete(`/api/projects/${project.id}`).set(h).expect(404);
    await m.post(`/api/orgs/${alice.orgId}/projects`).set(h).send({ name: 'intruder' }).expect(404);
    await m.post(`/api/projects/${project.id}/keys`).set(h).send({ name: 'stolen' }).expect(404);
    await m.post(`/api/projects/${project.id}/keys/${keyId}/revoke`).set(h).expect(404);
    await m
      .patch(`/api/projects/${project.id}/upstreams/${upstreamId}`)
      .set(h)
      .send({ baseUrl: 'https://93.184.215.15' })
      .expect(404);
    await m
      .post(`/api/projects/${project.id}/upstreams/${upstreamId}/test`)
      .set(h)
      .send({})
      .expect(404);
    await m
      .put(`/api/projects/${project.id}/rate-limits/default`)
      .set(h)
      .send({ requests: 1, windowSeconds: 1 })
      .expect(404);
    await m
      .post(`/api/orgs/${alice.orgId}/members`)
      .set(h)
      .send({ email: mallory.email, role: 'owner' })
      .expect(404);
    const { rows } = await pool.query('SELECT name FROM projects WHERE id = $1', [project.id]);
    expect(rows[0].name).not.toBe('pwned');
  });

  it("another tenant's analytics never include foreign rows", async () => {
    const own = await createProject(mallory);
    await insertRequestLogs(pool, own, [{ status: 500, outcome: 'upstream_error', latencyMs: 5 }]);
    const res = await mallory.agent
      .get(`/api/projects/${own.id}/analytics/summary?range=1h`)
      .expect(200);
    expect(res.body.totalRequests).toBe(1);
    const orgRes = await mallory.agent
      .get(`/api/orgs/${mallory.orgId}/analytics/breakdown?dimension=project`)
      .expect(200);
    expect(orgRes.body.items.map((i: { key: string }) => i.key)).toEqual([own.id]);
    // Asking for Alice's request id under Mallory's own project yields nothing.
    await mallory.agent.get(`/api/projects/${own.id}/requests/${requestId}`).expect(404);
  });

  it('members can read but not mutate; only owners grant elevated roles', async () => {
    const bob = await signup(app, 'bob');
    await alice.agent
      .post(`/api/orgs/${alice.orgId}/members`)
      .set('x-csrf-token', alice.csrf)
      .send({ email: bob.email, role: 'member' })
      .expect(201);
    await bob.agent.get(`/api/projects/${project.id}/keys`).expect(200);
    await bob.agent
      .post(`/api/projects/${project.id}/keys`)
      .set('x-csrf-token', bob.csrf)
      .send({ name: 'nope' })
      .expect(403);
    await bob.agent
      .post(`/api/projects/${project.id}/upstreams/${upstreamId}/test`)
      .set('x-csrf-token', bob.csrf)
      .send({})
      .expect(403);
    await bob.agent
      .post(`/api/orgs/${alice.orgId}/members`)
      .set('x-csrf-token', bob.csrf)
      .send({ email: mallory.email, role: 'member' })
      .expect(403);
    await alice.agent
      .patch(`/api/orgs/${alice.orgId}/members/${bob.userId}`)
      .set('x-csrf-token', alice.csrf)
      .send({ role: 'admin' })
      .expect(200);
    await bob.agent
      .post(`/api/orgs/${alice.orgId}/members`)
      .set('x-csrf-token', bob.csrf)
      .send({ email: mallory.email, role: 'owner' })
      .expect(403);
    await bob.agent
      .post(`/api/projects/${project.id}/keys`)
      .set('x-csrf-token', bob.csrf)
      .send({ name: 'admin key' })
      .expect(201);
  });

  it('the last owner cannot be demoted or removed', async () => {
    await alice.agent
      .patch(`/api/orgs/${alice.orgId}/members/${alice.userId}`)
      .set('x-csrf-token', alice.csrf)
      .send({ role: 'member' })
      .expect(400);
    await alice.agent
      .delete(`/api/orgs/${alice.orgId}/members/${alice.userId}`)
      .set('x-csrf-token', alice.csrf)
      .expect(400);
  });
});

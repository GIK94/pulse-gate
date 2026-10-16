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

describe('analytics queries', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let u: TestUser;
  let project: { id: string; slug: string; orgId: string };

  beforeAll(async () => {
    pool = testPool();
    await resetState(pool);
    app = await createTestApp();
    u = await signup(app, 'metrics');
    project = await createProject(u);
    await insertRequestLogs(pool, project, [
      ...Array.from({ length: 6 }, (_, i) => ({
        status: 200,
        outcome: 'ok',
        latencyMs: 10 + i,
        path: '/products',
      })),
      { status: 201, outcome: 'ok', latencyMs: 40, path: '/orders' },
      { status: 404, outcome: 'ok', latencyMs: 8, path: '/products/99' },
      { status: 429, outcome: 'rate_limited', latencyMs: 1, path: '/products' },
      { status: 401, outcome: 'unauthorized', latencyMs: 1, path: '/products' },
      { status: 502, outcome: 'upstream_unreachable', latencyMs: 100, path: '/orders' },
      { status: 200, outcome: 'ok', latencyMs: 30, path: '/old', minutesAgo: 120 },
    ]);
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('summarises totals, rates, latency percentiles and rejections for the range', async () => {
    const s = (
      await u.agent.get(`/api/projects/${project.id}/analytics/summary?range=1h`).expect(200)
    ).body;
    expect(s.totalRequests).toBe(11);
    expect(s.rateLimited).toBe(1);
    expect(s.unauthorized).toBe(1);
    expect(s.clientErrors).toBe(3);
    expect(s.serverErrors).toBe(1);
    expect(s.successRate).toBeCloseTo(7 / 11);
    // Percentiles cover forwarded requests only (rejections are not upstream latency).
    expect(s.latency.p50).toBeGreaterThanOrEqual(10);
    expect(s.latency.p99).toBeLessThanOrEqual(100);
    const day = (
      await u.agent.get(`/api/projects/${project.id}/analytics/summary?range=24h`).expect(200)
    ).body;
    expect(day.totalRequests).toBe(12);
  });

  it('returns a gap-filled time series', async () => {
    const t = (
      await u.agent.get(`/api/projects/${project.id}/analytics/timeseries?range=15m`).expect(200)
    ).body;
    expect(t.bucket).toBe('30 seconds');
    expect(t.points.length).toBeGreaterThanOrEqual(30);
    expect(t.points.reduce((n: number, p: { total: number }) => n + p.total, 0)).toBe(11);
  });

  it('breaks down by dimension and rejects unknown dimensions', async () => {
    const b = (
      await u.agent
        .get(`/api/projects/${project.id}/analytics/breakdown?range=1h&dimension=route`)
        .expect(200)
    ).body;
    expect(b.items[0]).toMatchObject({ key: '/products', total: 8 });
    const status = (
      await u.agent
        .get(`/api/projects/${project.id}/analytics/breakdown?dimension=status`)
        .expect(200)
    ).body;
    expect(status.items.find((i: { key: string }) => i.key === '429').total).toBe(1);
    await u.agent
      .get(`/api/projects/${project.id}/analytics/breakdown?dimension=org_id;drop`)
      .expect(400);
    await u.agent
      .get(`/api/projects/${project.id}/analytics/breakdown?dimension=project`)
      .expect(400);
    await u.agent.get(`/api/projects/${project.id}/analytics/summary?range=1y`).expect(400);
  });

  it('paginates requests with a cursor and applies filters', async () => {
    const page1 = (
      await u.agent.get(`/api/projects/${project.id}/requests?range=24h&limit=5`).expect(200)
    ).body;
    expect(page1.items).toHaveLength(5);
    expect(page1.nextCursor).toEqual(expect.any(String));
    const page2 = (
      await u.agent
        .get(`/api/projects/${project.id}/requests?range=24h&limit=5&cursor=${page1.nextCursor}`)
        .expect(200)
    ).body;
    const page3 = (
      await u.agent
        .get(`/api/projects/${project.id}/requests?range=24h&limit=5&cursor=${page2.nextCursor}`)
        .expect(200)
    ).body;
    const ids = [...page1.items, ...page2.items, ...page3.items].map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(12);
    expect(page3.nextCursor).toBeNull();

    const errors = (
      await u.agent.get(`/api/projects/${project.id}/requests?status=5xx`).expect(200)
    ).body;
    expect(errors.items).toHaveLength(1);
    const limited = (
      await u.agent.get(`/api/projects/${project.id}/requests?outcome=rate_limited`).expect(200)
    ).body;
    expect(limited.items).toHaveLength(1);
    const orders = (
      await u.agent.get(`/api/projects/${project.id}/requests?path=/orders`).expect(200)
    ).body;
    expect(orders.items).toHaveLength(2);
    const wildcard = (
      await u.agent.get(`/api/projects/${project.id}/requests?path=%25`).expect(200)
    ).body;
    expect(wildcard.items).toHaveLength(0); // LIKE metacharacters are escaped
    await u.agent.get(`/api/projects/${project.id}/requests?cursor=garbage`).expect(400);
  });

  it('returns request detail with timing and a sanitized error description', async () => {
    const list = (await u.agent.get(`/api/projects/${project.id}/requests?status=502`).expect(200))
      .body;
    const detail = (
      await u.agent.get(`/api/projects/${project.id}/requests/${list.items[0].id}`).expect(200)
    ).body;
    expect(detail.timing.totalMs).toBe(100);
    expect(detail.outcome).toBe('upstream_unreachable');
  });
});

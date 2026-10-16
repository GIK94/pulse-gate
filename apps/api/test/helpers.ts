import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { Pool } from 'pg';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

/** Runs `fn` with temporary env overrides (config is read when the app is created). */
export async function withEnv<T>(
  overrides: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

export function testPool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
}

export async function resetState(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE users, organizations, sessions, audit_log, request_logs CASCADE');
  const redis = new Redis(process.env.REDIS_URL as string);
  await redis.flushdb();
  await redis.quit();
}

export interface TestUser {
  agent: TestAgent;
  csrf: string;
  userId: string;
  orgId: string;
  email: string;
}

export async function signup(app: NestExpressApplication, label = 'user'): Promise<TestUser> {
  const agent = request.agent(app.getHttpServer());
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const res = await agent
    .post('/api/auth/register')
    .send({
      email,
      password: 'correct-horse-battery',
      name: label,
      organizationName: `${label} org`,
    })
    .expect(201);
  const me = await agent.get('/api/auth/me').expect(200);
  return {
    agent,
    csrf: res.body.csrfToken,
    userId: res.body.user.id,
    orgId: me.body.organizations[0].id,
    email,
  };
}

export async function createProject(u: TestUser, slug = `p-${randomUUID().slice(0, 8)}`) {
  const res = await u.agent
    .post(`/api/orgs/${u.orgId}/projects`)
    .set('x-csrf-token', u.csrf)
    .send({ name: `Project ${slug}`, slug })
    .expect(201);
  return res.body as { id: string; slug: string; orgId: string };
}

/** Inserts synthetic analytics rows directly (the gateway/worker path is tested in the gateway suite). */
export async function insertRequestLogs(
  pool: Pool,
  project: { id: string; orgId: string },
  rows: {
    status: number;
    outcome: string;
    latencyMs: number;
    path?: string;
    apiKeyId?: string | null;
    minutesAgo?: number;
  }[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const r of rows) {
    const id = randomUUID();
    ids.push(id);
    await pool.query(
      `INSERT INTO request_logs (id, created_at, request_id, org_id, project_id, api_key_id, method, path, route, status,
         outcome, latency_ms, upstream_latency_ms, request_bytes, response_bytes)
       VALUES ($1, now() - make_interval(mins => $2), $3, $4, $5, $6, 'GET', $7, $7, $8, $9, $10, $10, 10, 100)`,
      [
        id,
        r.minutesAgo ?? 1,
        randomUUID(),
        project.orgId,
        project.id,
        r.apiKeyId ?? null,
        r.path ?? '/items',
        r.status,
        r.outcome,
        r.latencyMs,
      ],
    );
  }
  return ids;
}

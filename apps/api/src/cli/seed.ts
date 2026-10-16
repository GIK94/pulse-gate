/**
 * Local development seed. Creates a demo account, organization, project,
 * upstream (pointing at the demo upstream service) and two client keys with
 * well-known values. Refuses to run in production: these credentials are
 * published in the README.
 */
import { createPool } from '@pulsegate/db';
import { hashApiKey, isProduction, SecretBox } from '@pulsegate/shared';
import { hashPassword } from '../auth/passwords';

export const DEMO = {
  email: 'demo@pulsegate.local',
  password: process.env.DEMO_USER_PASSWORD ?? 'pulsegate-demo-123',
  orgName: 'Demo Org',
  projectSlug: 'demo-store',
  upstreamUrl: process.env.DEMO_UPSTREAM_URL ?? 'http://localhost:4100',
  upstreamToken: 'demo-upstream-token',
  // Well-known LOCAL-ONLY keys (format pgk_<10 hex>_<32 chars>).
  key: 'pgk_00000000de_LocalDemoKeyDoNotUseInProduct01x',
  rateLimitKey: 'pgk_000000000a_RateLimitDemoKeyLocalOnly0000000',
  loadTestKey: 'pgk_000000000b_LoadTestKeyLocalOnlyHighLimit000',
};

async function main(): Promise<void> {
  if (isProduction()) throw new Error('Refusing to seed demo data with NODE_ENV=production');
  const pepper = process.env.API_KEY_PEPPER;
  if (!pepper) throw new Error('API_KEY_PEPPER is required');
  const box = SecretBox.fromEnv(process.env.ENCRYPTION_KEYS);
  const pool = createPool({ max: 2 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let user = (
      await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [DEMO.email])
    ).rows[0];
    if (!user) {
      user = (
        await client.query<{ id: string }>(
          'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
          [DEMO.email, 'Demo Developer', await hashPassword(DEMO.password)],
        )
      ).rows[0];
    }
    let project = (
      await client.query<{ id: string; org_id: string }>(
        'SELECT id, org_id FROM projects WHERE slug = $1',
        [DEMO.projectSlug],
      )
    ).rows[0];
    if (!project) {
      const org = (
        await client.query<{ id: string }>(
          'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
          [DEMO.orgName],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [org.id, user.id],
      );
      project = (
        await client.query<{ id: string; org_id: string }>(
          `INSERT INTO projects (org_id, name, slug, rate_limit_requests, rate_limit_window_seconds)
           VALUES ($1, 'Demo Store', $2, 600, 60) RETURNING id, org_id`,
          [org.id, DEMO.projectSlug],
        )
      ).rows[0];
    }
    const upstream = (
      await client.query('SELECT id FROM upstreams WHERE project_id = $1', [project.id])
    ).rows[0];
    if (!upstream) {
      const id = (await client.query<{ id: string }>('SELECT gen_random_uuid() AS id')).rows[0].id;
      await client.query(
        `INSERT INTO upstreams (id, project_id, name, base_url, match_prefix, allowed_methods, allowed_path_prefixes,
           connect_timeout_ms, response_timeout_ms, auth_type, auth_header_name, auth_secret_enc, enabled)
         VALUES ($1, $2, 'Acme demo store', $3, '/', ARRAY['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'], ARRAY['/'],
           2000, 5000, 'header', 'x-demo-upstream-token', $4, true)`,
        [id, project.id, DEMO.upstreamUrl, box.encrypt(DEMO.upstreamToken, id)],
      );
    }
    const keys: [string, string, number | null, number | null][] = [
      [DEMO.key, 'Local demo key', null, null],
      [DEMO.rateLimitKey, 'Rate-limit demo key (10 req / 10 s)', 10, 10],
      [DEMO.loadTestKey, 'Load-test key (high limit, k6 only)', 1_000_000, 60],
    ];
    for (const [key, name, limit, window] of keys) {
      const prefix = key.slice(0, 14);
      await client.query(
        `INSERT INTO api_keys (project_id, name, prefix, key_hash, rate_limit_requests, rate_limit_window_seconds, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (prefix) DO UPDATE SET key_hash = EXCLUDED.key_hash, status = 'active', revoked_at = NULL,
           expires_at = NULL, rate_limit_requests = EXCLUDED.rate_limit_requests,
           rate_limit_window_seconds = EXCLUDED.rate_limit_window_seconds`,
        [project.id, name, prefix, hashApiKey(key, pepper), limit, window, user.id],
      );
    }
    // Demo route rule: POST /orders gets its own per-key limit on top of the key limit.
    await client.query(
      `DELETE FROM rate_limit_rules WHERE project_id = $1 AND path_prefix = '/orders' AND method = 'POST'`,
      [project.id],
    );
    await client.query(
      `INSERT INTO rate_limit_rules (project_id, path_prefix, method, limit_requests, window_seconds)
       VALUES ($1, '/orders', 'POST', 1200, 60)`,
      [project.id],
    );
    await client.query('COMMIT');
    console.warn(
      [
        'Seeded LOCAL DEVELOPMENT data (never use these credentials in production):',
        `  login:      ${DEMO.email} / ${process.env.DEMO_USER_PASSWORD ? '(DEMO_USER_PASSWORD)' : DEMO.password}`,
        `  project:    ${DEMO.projectSlug} -> ${DEMO.upstreamUrl}`,
        `  demo key:   ${DEMO.key}`,
        `  rate key:   ${DEMO.rateLimitKey} (10 requests / 10 seconds)`,
        `  load key:   ${DEMO.loadTestKey} (k6 only)`,
      ].join('\n'),
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err: Error) => {
    console.error(`seed failed: ${err.message}`);
    process.exit(1);
  });
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FORWARDED_OUTCOMES } from '@pulsegate/shared';
import { DatabaseService } from '../common/database.service';
import { Dimension, RangeKey, RANGES, RequestsQueryDto } from './analytics.dto';

/**
 * Analytics queries. Every query is constrained by a tenant scope
 * (`project_id = $1` or `org_id = $1`) resolved by the controller after an
 * authorization check, plus a time range that enables partition pruning.
 * Column and dimension expressions come from fixed allowlists, never input.
 */
export type Scope = { kind: 'project' | 'org'; id: string };

const SCOPE_COLUMN = { project: 'project_id', org: 'org_id' } as const;
const FAILURE_OUTCOMES = ['upstream_error', 'upstream_timeout', 'upstream_unreachable'];
const BIN_ORIGIN = `TIMESTAMPTZ '2000-01-01 00:00:00+00'`;

const DIMENSION_SQL: Record<Dimension, string> = {
  route: 'route',
  method: 'method',
  status: 'status::text',
  apiKey: `COALESCE(api_key_id::text, 'none')`,
  upstream: `COALESCE(upstream_id::text, 'none')`,
  outcome: 'outcome',
  project: 'project_id::text',
};

export const ERROR_DESCRIPTIONS: Record<string, string> = {
  missing_api_key: 'No PulseGate API key was supplied.',
  invalid_api_key: 'The API key was not recognised for this project.',
  api_key_revoked: 'The API key has been revoked.',
  api_key_expired: 'The API key has expired.',
  project_disabled: 'The project is disabled.',
  route_not_found: 'No upstream is configured for this path.',
  method_not_allowed: 'The HTTP method is not allowed for this upstream.',
  path_not_allowed: 'The path is not exposed by the upstream configuration.',
  key_method_not_allowed: 'The API key policy does not allow this method.',
  key_route_not_allowed: 'The API key policy does not allow this route.',
  rate_limited: 'A rate limit was exceeded.',
  rate_limiter_unavailable: 'The rate limiter backend was unavailable (fail-closed).',
  payload_too_large: 'The request body exceeded the configured limit.',
  invalid_path: 'The request path was rejected (traversal or invalid encoding).',
  invalid_content_length: 'The Content-Length header was invalid.',
  gateway_overloaded: 'The gateway was at its concurrency limit.',
  config_unavailable: 'Gateway configuration could not be loaded.',
  upstream_timeout: 'The upstream did not respond within the response timeout.',
  upstream_connect_timeout: 'Connecting to the upstream timed out.',
  upstream_unreachable: 'The upstream connection failed (refused, reset or DNS error).',
  upstream_blocked: 'The upstream resolved to a blocked network address (SSRF protection).',
  upstream_response_too_large: 'The upstream response exceeded the configured size limit.',
  client_closed_request: 'The client closed the connection before the response completed.',
};

function round(n: number | null | undefined): number | null {
  return n === null || n === undefined ? null : Math.round(Number(n));
}

function window(range: RangeKey = '1h') {
  const to = new Date();
  const from = new Date(to.getTime() - RANGES[range].ms);
  return { from, to, bucket: RANGES[range].bucket };
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly db: DatabaseService) {}

  async summary(scope: Scope, range: RangeKey = '1h') {
    const { from, to } = window(range);
    const col = SCOPE_COLUMN[scope.kind];
    const row = await this.db.one<{
      total: number;
      success: number;
      client_errors: number;
      server_errors: number;
      rate_limited: number;
      unauthorized: number;
      pcts: number[] | null;
      avg: number | null;
      request_bytes: string;
      response_bytes: string;
    }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status < 400)::int AS success,
              count(*) FILTER (WHERE status BETWEEN 400 AND 499)::int AS client_errors,
              count(*) FILTER (WHERE status >= 500)::int AS server_errors,
              count(*) FILTER (WHERE outcome = 'rate_limited')::int AS rate_limited,
              count(*) FILTER (WHERE outcome = 'unauthorized')::int AS unauthorized,
              percentile_cont(ARRAY[0.5, 0.95, 0.99]) WITHIN GROUP (ORDER BY latency_ms)
                FILTER (WHERE outcome = ANY($4)) AS pcts,
              avg(latency_ms) FILTER (WHERE outcome = ANY($4)) AS avg,
              COALESCE(sum(request_bytes), 0) AS request_bytes,
              COALESCE(sum(response_bytes), 0) AS response_bytes
         FROM request_logs
        WHERE ${col} = $1 AND created_at >= $2 AND created_at <= $3`,
      [scope.id, from, to, FORWARDED_OUTCOMES],
    );
    const r = row!;
    const rate = (n: number) => (r.total ? n / r.total : 0);
    return {
      range,
      from,
      to,
      totalRequests: r.total,
      successRate: rate(r.success),
      clientErrorRate: rate(r.client_errors),
      serverErrorRate: rate(r.server_errors),
      clientErrors: r.client_errors,
      serverErrors: r.server_errors,
      rateLimited: r.rate_limited,
      unauthorized: r.unauthorized,
      latency: {
        p50: round(r.pcts?.[0]),
        p95: round(r.pcts?.[1]),
        p99: round(r.pcts?.[2]),
        avg: round(r.avg),
      },
      requestBytes: Number(r.request_bytes),
      responseBytes: Number(r.response_bytes),
      requestsPerMinute: r.total / (RANGES[range].ms / 60_000),
    };
  }

  async timeseries(scope: Scope, range: RangeKey = '1h') {
    const { from, to, bucket } = window(range);
    const col = SCOPE_COLUMN[scope.kind];
    const rows = await this.db.query<{
      bucket: Date;
      total: number;
      success: number;
      client_errors: number;
      server_errors: number;
      rate_limited: number;
      p50: number | null;
      p95: number | null;
      avg: number | null;
    }>(
      `WITH buckets AS (
         SELECT generate_series(date_bin($4::interval, $2::timestamptz, ${BIN_ORIGIN}), $3::timestamptz, $4::interval) AS bucket
       ), agg AS (
         SELECT date_bin($4::interval, created_at, ${BIN_ORIGIN}) AS bucket,
                count(*)::int AS total,
                count(*) FILTER (WHERE status < 400)::int AS success,
                count(*) FILTER (WHERE status BETWEEN 400 AND 499)::int AS client_errors,
                count(*) FILTER (WHERE status >= 500)::int AS server_errors,
                count(*) FILTER (WHERE outcome = 'rate_limited')::int AS rate_limited,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE outcome = ANY($5)) AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE outcome = ANY($5)) AS p95,
                avg(latency_ms) FILTER (WHERE outcome = ANY($5)) AS avg
           FROM request_logs
          WHERE ${col} = $1 AND created_at >= $2 AND created_at <= $3
          GROUP BY 1
       )
       SELECT b.bucket, COALESCE(a.total, 0) AS total, COALESCE(a.success, 0) AS success,
              COALESCE(a.client_errors, 0) AS client_errors, COALESCE(a.server_errors, 0) AS server_errors,
              COALESCE(a.rate_limited, 0) AS rate_limited, a.p50, a.p95, a.avg
         FROM buckets b LEFT JOIN agg a USING (bucket)
        ORDER BY b.bucket`,
      [scope.id, from, to, bucket, FORWARDED_OUTCOMES],
    );
    return {
      range,
      bucket,
      points: rows.map((r) => ({
        t: r.bucket,
        total: r.total,
        success: r.success,
        clientErrors: r.client_errors,
        serverErrors: r.server_errors,
        rateLimited: r.rate_limited,
        p50: round(r.p50),
        p95: round(r.p95),
        avg: round(r.avg),
      })),
    };
  }

  async breakdown(scope: Scope, dimension: Dimension = 'route', range: RangeKey = '1h') {
    if (dimension === 'project' && scope.kind !== 'org') {
      throw new BadRequestException('dimension=project is only available at organization scope');
    }
    const { from, to } = window(range);
    const col = SCOPE_COLUMN[scope.kind];
    const expr = DIMENSION_SQL[dimension];
    const rows = await this.db.query<{
      key: string;
      total: number;
      errors: number;
      server_errors: number;
      rate_limited: number;
      p95: number | null;
      avg: number | null;
    }>(
      `SELECT ${expr} AS key,
              count(*)::int AS total,
              count(*) FILTER (WHERE status >= 400)::int AS errors,
              count(*) FILTER (WHERE status >= 500)::int AS server_errors,
              count(*) FILTER (WHERE outcome = 'rate_limited')::int AS rate_limited,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE outcome = ANY($4)) AS p95,
              avg(latency_ms) FILTER (WHERE outcome = ANY($4)) AS avg
         FROM request_logs
        WHERE ${col} = $1 AND created_at >= $2 AND created_at <= $3
        GROUP BY 1 ORDER BY total DESC LIMIT 25`,
      [scope.id, from, to, FORWARDED_OUTCOMES],
    );
    const labels = await this.labels(
      scope,
      dimension,
      rows.map((r) => r.key),
    );
    return {
      range,
      dimension,
      items: rows.map((r) => ({
        key: r.key,
        label: labels.get(r.key) ?? r.key,
        total: r.total,
        errors: r.errors,
        errorRate: r.total ? r.errors / r.total : 0,
        serverErrors: r.server_errors,
        rateLimited: r.rate_limited,
        p95: round(r.p95),
        avg: round(r.avg),
      })),
    };
  }

  /** Resolves ids to names, constrained to the same tenant scope. */
  private async labels(
    scope: Scope,
    dimension: Dimension,
    keys: string[],
  ): Promise<Map<string, string>> {
    const ids = keys.filter((k) => /^[0-9a-f-]{36}$/.test(k));
    const map = new Map<string, string>([['none', '—']]);
    if (ids.length === 0) return map;
    const projectFilter =
      scope.kind === 'project'
        ? 'project_id = $2'
        : 'project_id IN (SELECT id FROM projects WHERE org_id = $2)';
    let rows: { id: string; label: string }[] = [];
    if (dimension === 'apiKey') {
      rows = await this.db.query(
        `SELECT id::text, name || ' (' || prefix || ')' AS label FROM api_keys WHERE id = ANY($1::uuid[]) AND ${projectFilter}`,
        [ids, scope.id],
      );
    } else if (dimension === 'upstream') {
      rows = await this.db.query(
        `SELECT id::text, name AS label FROM upstreams WHERE id = ANY($1::uuid[]) AND ${projectFilter}`,
        [ids, scope.id],
      );
    } else if (dimension === 'project' && scope.kind === 'org') {
      rows = await this.db.query(
        `SELECT id::text, name || ' (' || slug || ')' AS label FROM projects WHERE id = ANY($1::uuid[]) AND org_id = $2`,
        [ids, scope.id],
      );
    }
    for (const r of rows) map.set(r.id, r.label);
    return map;
  }

  async requests(projectId: string, q: RequestsQueryDto) {
    const { from, to } = window(q.range ?? '24h');
    const limit = q.limit ?? 50;
    const params: unknown[] = [projectId, from, to];
    const where = ['r.project_id = $1', 'r.created_at >= $2', 'r.created_at <= $3'];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.status) {
      if (q.status.endsWith('xx')) {
        const base = Number(q.status[0]) * 100;
        add('r.status >= ?', base);
        add('r.status < ?', base + 100);
      } else add('r.status = ?', Number(q.status));
    }
    if (q.method) add('r.method = ?', q.method);
    if (q.outcome) add('r.outcome = ?', q.outcome);
    if (q.apiKeyId) add('r.api_key_id = ?', q.apiKeyId);
    if (q.upstreamId) add('r.upstream_id = ?', q.upstreamId);
    if (q.path) add(`r.path LIKE ? ESCAPE '\\'`, `${q.path.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      params.push(c.t, c.id);
      where.push(
        `(r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }
    params.push(limit + 1);
    const rows = await this.db.query(
      `SELECT r.id, r.created_at, r.request_id, r.method, r.path, r.route, r.status, r.outcome, r.latency_ms,
              r.upstream_latency_ms, r.request_bytes, r.response_bytes, r.error_code, r.api_key_id, r.upstream_id,
              k.name AS key_name, k.prefix AS key_prefix, u.name AS upstream_name
         FROM request_logs r
         LEFT JOIN api_keys k ON k.id = r.api_key_id AND k.project_id = r.project_id
         LEFT JOIN upstreams u ON u.id = r.upstream_id AND u.project_id = r.project_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit).map(mapRequest);
    const last = rows.length > limit ? rows[limit - 1] : null;
    return {
      items: page,
      nextCursor: last ? encodeCursor(last.created_at as Date, last.id as string) : null,
    };
  }

  async request(projectId: string, id: string) {
    const row = await this.db.one(
      `SELECT r.*, k.name AS key_name, k.prefix AS key_prefix, u.name AS upstream_name, u.base_url AS upstream_base_url
         FROM request_logs r
         LEFT JOIN api_keys k ON k.id = r.api_key_id AND k.project_id = r.project_id
         LEFT JOIN upstreams u ON u.id = r.upstream_id AND u.project_id = r.project_id
        WHERE r.project_id = $1 AND r.id = $2`,
      [projectId, id],
    );
    if (!row) throw new NotFoundException('Request not found');
    return {
      ...mapRequest(row),
      gatewayId: row.gateway_id,
      upstreamBaseUrl: row.upstream_base_url,
      timing: {
        totalMs: row.latency_ms,
        upstreamMs: row.upstream_latency_ms,
        gatewayOverheadMs:
          row.upstream_latency_ms === null
            ? null
            : Math.max(0, row.latency_ms - row.upstream_latency_ms),
      },
      errorDescription: row.error_code
        ? (ERROR_DESCRIPTIONS[row.error_code] ?? describeUpstreamCode(row.error_code))
        : null,
    };
  }

  async upstreamHealth(projectId: string) {
    const upstreams = await this.db.query<{
      id: string;
      name: string;
      base_url: string;
      enabled: boolean;
      last_test_at: Date | null;
      last_test_ok: boolean | null;
      last_test_error: string | null;
    }>(
      'SELECT id, name, base_url, enabled, last_test_at, last_test_ok, last_test_error FROM upstreams WHERE project_id = $1 ORDER BY created_at',
      [projectId],
    );
    const recent = await this.db.query<{
      upstream_id: string;
      total: number;
      failures: number;
      p95: number | null;
    }>(
      `SELECT upstream_id, count(*)::int AS total,
              count(*) FILTER (WHERE outcome = ANY($2) OR status >= 500)::int AS failures,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
         FROM request_logs
        WHERE project_id = $1 AND created_at >= now() - interval '15 minutes' AND upstream_id IS NOT NULL
        GROUP BY 1`,
      [projectId, FAILURE_OUTCOMES],
    );
    const trend = await this.db.query<{
      upstream_id: string;
      bucket: Date;
      total: number;
      failures: number;
      last_failure: Date | null;
    }>(
      `SELECT upstream_id, date_bin('1 hour', created_at, ${BIN_ORIGIN}) AS bucket, count(*)::int AS total,
              count(*) FILTER (WHERE outcome = ANY($2) OR status >= 500)::int AS failures,
              max(created_at) FILTER (WHERE outcome = ANY($2) OR status >= 500) AS last_failure
         FROM request_logs
        WHERE project_id = $1 AND created_at >= now() - interval '24 hours' AND upstream_id IS NOT NULL
        GROUP BY 1, 2`,
      [projectId, FAILURE_OUTCOMES],
    );
    const now = Date.now();
    const hourMs = 3600_000;
    const startHour = Math.floor((now - 23 * hourMs) / hourMs) * hourMs;
    return upstreams.map((u) => {
      const r = recent.find((x) => x.upstream_id === u.id);
      const points = Array.from({ length: 24 }, (_, i) => ({
        t: new Date(startHour + i * hourMs),
        total: 0,
        failures: 0,
      }));
      let lastFailureAt: Date | null = null;
      for (const t of trend.filter((x) => x.upstream_id === u.id)) {
        const idx = Math.round((new Date(t.bucket).getTime() - startHour) / hourMs);
        if (idx >= 0 && idx < 24) {
          points[idx].total = t.total;
          points[idx].failures = t.failures;
        }
        if (t.last_failure && (!lastFailureAt || t.last_failure > lastFailureAt))
          lastFailureAt = t.last_failure;
      }
      const errorRate = r && r.total ? r.failures / r.total : 0;
      let status: 'healthy' | 'degraded' | 'down' | 'unknown' | 'disabled';
      if (!u.enabled) status = 'disabled';
      else if (!r || r.total === 0)
        status = u.last_test_at ? (u.last_test_ok ? 'healthy' : 'down') : 'unknown';
      else if (errorRate >= 0.5 && r.total >= 5) status = 'down';
      else if (errorRate >= 0.05) status = 'degraded';
      else status = 'healthy';
      return {
        upstreamId: u.id,
        name: u.name,
        baseUrl: u.base_url,
        enabled: u.enabled,
        status,
        last15m: {
          requests: r?.total ?? 0,
          failures: r?.failures ?? 0,
          errorRate,
          p95: round(r?.p95),
        },
        lastFailureAt,
        lastTest: u.last_test_at
          ? { at: u.last_test_at, ok: u.last_test_ok, error: u.last_test_error }
          : null,
        failureTrend: points,
      };
    });
  }
}

function describeUpstreamCode(code: string): string {
  if (/^upstream_5\d\d$/.test(code)) return `The upstream returned HTTP ${code.slice(9)}.`;
  if (code.endsWith('_mid_stream'))
    return 'The upstream connection failed while streaming the response.';
  return 'See error code.';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRequest(r: any) {
  return {
    id: r.id,
    createdAt: r.created_at,
    requestId: r.request_id,
    method: r.method,
    path: r.path,
    route: r.route,
    status: r.status,
    outcome: r.outcome,
    latencyMs: r.latency_ms,
    upstreamLatencyMs: r.upstream_latency_ms,
    requestBytes: Number(r.request_bytes),
    responseBytes: Number(r.response_bytes),
    errorCode: r.error_code,
    apiKey: r.api_key_id ? { id: r.api_key_id, name: r.key_name, prefix: r.key_prefix } : null,
    upstream: r.upstream_id ? { id: r.upstream_id, name: r.upstream_name } : null,
  };
}

function encodeCursor(t: Date, id: string): string {
  return Buffer.from(JSON.stringify([new Date(t).toISOString(), id])).toString('base64url');
}

function decodeCursor(cursor: string): { t: string; id: string } {
  try {
    const [t, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [
      string,
      string,
    ];
    if (Number.isNaN(Date.parse(t)) || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('bad cursor');
    return { t, id };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

import { EVENTS_GROUP, EVENTS_STREAM, REQUEST_OUTCOMES, RequestEvent } from '@pulsegate/shared';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import type { Logger } from '../logger';

type StreamEntry = [id: string, fields: string[]];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseEvent(fields: string[]): RequestEvent | null {
  const idx = fields.indexOf('e');
  if (idx === -1) return null;
  try {
    const e = JSON.parse(fields[idx + 1]) as RequestEvent;
    if (!UUID_RE.test(e.id) || !UUID_RE.test(e.projectId) || !UUID_RE.test(e.orgId)) return null;
    if (!REQUEST_OUTCOMES.includes(e.outcome) || !Number.isFinite(e.ts)) return null;
    return e;
  } catch {
    return null;
  }
}

/**
 * Analytics pipeline, stage 2: consumes the Redis Stream with a consumer
 * group, batch-inserts into the partitioned request_logs table and only then
 * XACKs. Unacknowledged entries from crashed consumers are reclaimed with
 * XAUTOCLAIM. Inserts use ON CONFLICT DO NOTHING on (created_at, id), so
 * redelivery never duplicates rows (at-least-once delivery, idempotent writes).
 */
export class IngestWorker {
  private running = false;
  private loop: Promise<void> | null = null;
  inserted = 0;

  constructor(
    private readonly redis: Redis,
    private readonly pool: Pool,
    private readonly opts: {
      consumer: string;
      batchSize: number;
      blockMs: number;
      claimIdleMs: number;
    },
    private readonly logger: Logger,
  ) {}

  async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', EVENTS_STREAM, EVENTS_GROUP, '0', 'MKSTREAM');
    } catch (err) {
      if (!String((err as Error).message).includes('BUSYGROUP')) throw err;
    }
  }

  start(): void {
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  /** Processes one batch; returns the number of stream entries handled. */
  async processOnce(): Promise<number> {
    const reclaimed = await this.reclaim();
    if (reclaimed > 0) return reclaimed;
    const res = (await this.redis.xreadgroup(
      'GROUP',
      EVENTS_GROUP,
      this.opts.consumer,
      'COUNT',
      this.opts.batchSize,
      'BLOCK',
      this.opts.blockMs,
      'STREAMS',
      EVENTS_STREAM,
      '>',
    )) as [string, StreamEntry[]][] | null;
    if (!res || res.length === 0) return 0;
    const entries = res[0][1];
    await this.persist(entries);
    return entries.length;
  }

  private lastClaimAt = 0;

  private async reclaim(): Promise<number> {
    if (Date.now() - this.lastClaimAt < this.opts.claimIdleMs / 2) return 0;
    this.lastClaimAt = Date.now();
    const res = (await this.redis.xautoclaim(
      EVENTS_STREAM,
      EVENTS_GROUP,
      this.opts.consumer,
      this.opts.claimIdleMs,
      '0-0',
      'COUNT',
      this.opts.batchSize,
    )) as [string, StreamEntry[], string[]?];
    const entries = (res?.[1] ?? []).filter(
      (e): e is StreamEntry => Array.isArray(e) && Array.isArray(e[1]),
    );
    if (entries.length > 0) {
      this.logger.info({ count: entries.length }, 'reclaimed pending analytics events');
      await this.persist(entries);
    }
    return entries.length;
  }

  private async persist(entries: StreamEntry[]): Promise<void> {
    const ids = entries.map(([id]) => id);
    const events: RequestEvent[] = [];
    for (const [, fields] of entries) {
      const e = parseEvent(fields);
      if (e) events.push(e);
    }
    if (events.length < entries.length) {
      this.logger.warn(
        { dropped: entries.length - events.length },
        'discarded malformed analytics events',
      );
    }
    if (events.length > 0) {
      const cols = {
        id: [] as string[],
        createdAt: [] as string[],
        requestId: [] as string[],
        orgId: [] as string[],
        projectId: [] as string[],
        upstreamId: [] as (string | null)[],
        apiKeyId: [] as (string | null)[],
        method: [] as string[],
        path: [] as string[],
        route: [] as string[],
        status: [] as number[],
        outcome: [] as string[],
        latency: [] as number[],
        upstreamLatency: [] as (number | null)[],
        reqBytes: [] as number[],
        resBytes: [] as number[],
        errorCode: [] as (string | null)[],
        gatewayId: [] as string[],
      };
      for (const e of events) {
        cols.id.push(e.id);
        cols.createdAt.push(new Date(e.ts).toISOString());
        cols.requestId.push(String(e.requestId).slice(0, 128));
        cols.orgId.push(e.orgId);
        cols.projectId.push(e.projectId);
        cols.upstreamId.push(e.upstreamId);
        cols.apiKeyId.push(e.apiKeyId);
        cols.method.push(String(e.method).slice(0, 16));
        cols.path.push(String(e.path).slice(0, 512));
        cols.route.push(String(e.route).slice(0, 256));
        cols.status.push(Math.trunc(e.status));
        cols.outcome.push(e.outcome);
        cols.latency.push(Math.max(0, Math.trunc(e.latencyMs)));
        cols.upstreamLatency.push(
          e.upstreamLatencyMs === null ? null : Math.max(0, Math.trunc(e.upstreamLatencyMs)),
        );
        cols.reqBytes.push(Math.max(0, Math.trunc(e.requestBytes)));
        cols.resBytes.push(Math.max(0, Math.trunc(e.responseBytes)));
        cols.errorCode.push(e.errorCode ? String(e.errorCode).slice(0, 64) : null);
        cols.gatewayId.push(String(e.gatewayId).slice(0, 64));
      }
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO request_logs (id, created_at, request_id, org_id, project_id, upstream_id, api_key_id, method,
             path, route, status, outcome, latency_ms, upstream_latency_ms, request_bytes, response_bytes, error_code, gateway_id)
           SELECT * FROM unnest($1::uuid[], $2::timestamptz[], $3::text[], $4::uuid[], $5::uuid[], $6::uuid[], $7::uuid[],
             $8::text[], $9::text[], $10::text[], $11::smallint[], $12::text[], $13::int[], $14::int[], $15::bigint[],
             $16::bigint[], $17::text[], $18::text[])
           ON CONFLICT (created_at, id) DO NOTHING`,
          [
            cols.id,
            cols.createdAt,
            cols.requestId,
            cols.orgId,
            cols.projectId,
            cols.upstreamId,
            cols.apiKeyId,
            cols.method,
            cols.path,
            cols.route,
            cols.status,
            cols.outcome,
            cols.latency,
            cols.upstreamLatency,
            cols.reqBytes,
            cols.resBytes,
            cols.errorCode,
            cols.gatewayId,
          ],
        );
        // last_used_at is maintained here, off the request path.
        const lastUsed = new Map<string, number>();
        for (const e of events) {
          if (e.apiKeyId && e.outcome !== 'unauthorized') {
            lastUsed.set(e.apiKeyId, Math.max(lastUsed.get(e.apiKeyId) ?? 0, e.ts));
          }
        }
        if (lastUsed.size > 0) {
          await client.query(
            `UPDATE api_keys k SET last_used_at = v.ts
               FROM unnest($1::uuid[], $2::timestamptz[]) AS v(id, ts)
              WHERE k.id = v.id AND (k.last_used_at IS NULL OR k.last_used_at < v.ts)`,
            [[...lastUsed.keys()], [...lastUsed.values()].map((t) => new Date(t).toISOString())],
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err; // not acked: retried via XAUTOCLAIM
      } finally {
        client.release();
      }
      this.inserted += events.length;
    }
    await this.redis.xack(EVENTS_STREAM, EVENTS_GROUP, ...ids);
  }

  private async run(): Promise<void> {
    let backoff = 500;
    while (this.running) {
      try {
        await this.processOnce();
        backoff = 500;
      } catch (err) {
        this.logger.warn(
          { err: (err as Error).message, retryInMs: backoff },
          'ingest batch failed',
        );
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }
}

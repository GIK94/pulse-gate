import { EVENTS_STREAM, RequestEvent } from '@pulsegate/shared';
import type Redis from 'ioredis';
import type { Logger } from './logger';

/**
 * Non-blocking analytics pipeline, stage 1 of 2.
 *
 * The proxy path only appends an event to an in-memory buffer. A timer flushes
 * batches to a Redis Stream with a pipelined XADD; the ingest worker (stage 2)
 * persists them to PostgreSQL and acknowledges them.
 *
 * Delivery semantics (documented in the README):
 *  - Events can be lost if the gateway process crashes before a flush (at most
 *    one flush interval of events), or if the buffer overflows while Redis is
 *    unavailable (oldest events are dropped and counted in `dropped`).
 *  - Graceful shutdown flushes the buffer.
 *  - Once in the stream, delivery to PostgreSQL is at-least-once and inserts are
 *    idempotent on event id, so duplicates are not stored. The stream is capped
 *    (approximate MAXLEN) to bound Redis memory if the worker falls far behind.
 */
export class AnalyticsBuffer {
  private buffer: RequestEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private lastErrorLogAt = 0;
  dropped = 0;
  published = 0;

  constructor(
    private readonly redis: Redis,
    private readonly opts: {
      flushIntervalMs: number;
      batchSize: number;
      maxBuffer: number;
      streamMaxLen: number;
    },
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.flush(), this.opts.flushIntervalMs);
    this.timer.unref();
  }

  get size(): number {
    return this.buffer.length;
  }

  push(event: RequestEvent): void {
    if (this.buffer.length >= this.opts.maxBuffer) {
      this.buffer.shift();
      this.dropped++;
    }
    this.buffer.push(event);
    if (this.buffer.length >= this.opts.batchSize && !this.flushing) void this.flush();
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.buffer.length === 0) return Promise.resolve();
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    while (this.buffer.length > 0) {
      const batch = this.buffer.splice(0, this.opts.batchSize);
      const pipeline = this.redis.pipeline();
      for (const e of batch) {
        pipeline.xadd(
          EVENTS_STREAM,
          'MAXLEN',
          '~',
          this.opts.streamMaxLen,
          '*',
          'e',
          JSON.stringify(e),
        );
      }
      try {
        const results = await pipeline.exec();
        const failed = results?.filter(([err]) => err).length ?? batch.length;
        if (failed > 0) throw new Error(`${failed} XADD commands failed`);
        this.published += batch.length;
      } catch (err) {
        // Put the batch back (bounded) and retry on the next tick.
        const room = Math.max(0, this.opts.maxBuffer - this.buffer.length);
        const keep = batch.slice(Math.max(0, batch.length - room));
        this.dropped += batch.length - keep.length;
        this.buffer.unshift(...keep);
        if (Date.now() - this.lastErrorLogAt > 10_000) {
          this.lastErrorLogAt = Date.now();
          this.logger.warn(
            { err: (err as Error).message, buffered: this.buffer.length, dropped: this.dropped },
            'analytics flush failed',
          );
        }
        return;
      }
    }
  }

  async stop(timeoutMs = 5000): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const deadline = Date.now() + timeoutMs;
    while (this.buffer.length > 0 && Date.now() < deadline) {
      const before = this.buffer.length;
      await this.flush();
      if (this.buffer.length >= before) break; // Redis unavailable; give up
    }
    if (this.buffer.length > 0) {
      this.logger.warn({ lost: this.buffer.length }, 'analytics events not flushed at shutdown');
    }
  }
}

import { hostname } from 'node:os';
import { createPool, runMaintenance } from '@pulsegate/db';
import { envInt, envStr } from '@pulsegate/shared';
import Redis from 'ioredis';
import { createLogger } from '../logger';
import { IngestWorker } from './ingest';

/**
 * Analytics worker process: drains gateway events into PostgreSQL and runs
 * periodic maintenance (partition creation, retention, session cleanup).
 * Scale it horizontally; consumers in the same group share the stream.
 */
async function main(): Promise<void> {
  process.env.SERVICE_NAME ??= 'pulsegate-worker';
  const logger = createLogger('worker');
  const pool = createPool();
  const redis = new Redis(envStr('REDIS_URL'), { maxRetriesPerRequest: null });
  redis.on('error', (err: Error) => logger.warn({ err: err.message }, 'redis error'));

  const worker = new IngestWorker(
    redis,
    pool,
    {
      consumer: envStr('WORKER_ID', `${hostname()}-${process.pid}`),
      batchSize: envInt('INGEST_BATCH_SIZE', 1000, 1, 10_000),
      blockMs: envInt('INGEST_BLOCK_MS', 2000, 100),
      claimIdleMs: envInt('INGEST_CLAIM_IDLE_MS', 60_000, 1000),
    },
    logger,
  );
  await worker.ensureGroup();
  worker.start();
  logger.info('analytics ingest worker started');

  const retentionDays = envInt('RETENTION_DAYS', 30, 1, 3650);
  const maintain = async () => {
    try {
      const res = await runMaintenance(pool, { retentionDays });
      if (res.ran) logger.info(res, 'maintenance completed');
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'maintenance failed');
    }
  };
  await maintain();
  const timer = setInterval(
    () => void maintain(),
    envInt('MAINTENANCE_INTERVAL_MS', 3_600_000, 10_000),
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    clearInterval(timer);
    await worker.stop();
    await redis.quit().catch(() => undefined);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: Error) => {
  console.error(
    JSON.stringify({ level: 'fatal', msg: 'worker failed to start', err: err.message }),
  );
  process.exit(1);
});

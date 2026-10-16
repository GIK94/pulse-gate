import { createServer, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { CONFIG_CHANNEL, ConfigInvalidation, SlidingWindowRateLimiter } from '@pulsegate/shared';
import Redis from 'ioredis';
import type { Pool } from 'pg';
import { AnalyticsBuffer } from './analytics-buffer';
import type { GatewayConfig } from './config';
import { ConfigStore } from './config-store';
import { Gateway } from './gateway';
import type { Logger } from './logger';
import { GatewayMetrics } from './metrics';

export interface GatewayApp {
  server: Server;
  gateway: Gateway;
  store: ConfigStore;
  analytics: AnalyticsBuffer;
  metrics: GatewayMetrics;
  redis: Redis;
  close(): Promise<void>;
}

/** Wires the gateway's dependencies. Used by main.ts and by integration tests. */
export async function createGatewayApp(
  config: GatewayConfig,
  pool: Pool,
  logger: Logger,
): Promise<GatewayApp> {
  // Fail fast instead of queueing commands while Redis is down, so rate-limit
  // checks surface errors (and the configured failure mode) immediately.
  const redis = new Redis(config.redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: config.redisCommandTimeoutMs,
    lazyConnect: true,
  });
  const analyticsRedis = new Redis(config.redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 2_000,
    lazyConnect: true,
  });
  const subscriber = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: null });
  for (const [name, client] of [
    ['redis', redis],
    ['analytics-redis', analyticsRedis],
    ['subscriber', subscriber],
  ] as const) {
    client.on('error', (err: Error) =>
      logger.warn({ client: name, err: err.message }, 'redis error'),
    );
  }
  await Promise.all([redis.connect(), analyticsRedis.connect(), subscriber.connect()]);

  const store = new ConfigStore(
    pool,
    config.secretBox,
    {
      ttlMs: config.configCacheTtlMs,
      staleMaxMs: config.configStaleMaxMs,
      keyCacheMax: config.keyCacheMaxEntries,
      pepper: config.apiKeyPepper,
    },
    logger,
  );

  // Config invalidation: immediate eviction on change; full flush after a
  // reconnect because messages published while disconnected are lost.
  let subscribedOnce = false;
  subscriber.on('ready', () => {
    if (subscribedOnce) {
      store.clear();
      logger.info('config subscriber reconnected; caches cleared');
    }
    subscribedOnce = true;
  });
  subscriber.on('message', (_channel: string, message: string) => {
    try {
      store.invalidate(JSON.parse(message) as ConfigInvalidation);
    } catch {
      store.clear();
    }
  });
  await subscriber.subscribe(CONFIG_CHANNEL);

  const analytics = new AnalyticsBuffer(analyticsRedis, config.analytics, logger);
  analytics.start();
  const metrics = new GatewayMetrics();
  const limiter = new SlidingWindowRateLimiter(redis);

  let lastReady: { at: number; result: { ok: boolean; checks: Record<string, string> } } | null =
    null;
  const readiness = async () => {
    if (lastReady && Date.now() - lastReady.at < 1_000) return lastReady.result;
    const checks: Record<string, string> = {};
    await Promise.all([
      pool.query('SELECT 1').then(
        () => (checks.postgres = 'ok'),
        () => (checks.postgres = 'unavailable'),
      ),
      redis.ping().then(
        () => (checks.redis = 'ok'),
        () => (checks.redis = 'unavailable'),
      ),
    ]);
    const result = { ok: Object.values(checks).every((c) => c === 'ok'), checks };
    lastReady = { at: Date.now(), result };
    return result;
  };

  const gateway = new Gateway({ config, store, limiter, analytics, metrics, logger, readiness });
  const server = createServer(
    {
      headersTimeout: 30_000,
      requestTimeout: Number(process.env.GATEWAY_REQUEST_TIMEOUT_MS ?? 120_000),
      keepAliveTimeout: 65_000,
    },
    gateway.handler,
  );
  server.on('upgrade', (_req, socket: Duplex) => {
    const body = JSON.stringify({
      error: {
        code: 'upgrade_not_supported',
        message: 'WebSocket/upgrade requests are not supported',
      },
    });
    socket.end(
      `HTTP/1.1 501 Not Implemented\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`,
    );
  });

  return {
    server,
    gateway,
    store,
    analytics,
    metrics,
    redis,
    async close() {
      gateway.beginShutdown();
      await analytics.stop();
      await gateway.closeDispatchers();
      await Promise.allSettled([redis.quit(), analyticsRedis.quit(), subscriber.quit()]);
    },
  };
}

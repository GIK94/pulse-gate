import { createServer } from 'node:http';
import { once } from 'node:events';
import { createPool } from '@pulsegate/db';
import { createGatewayApp } from './app';
import { loadGatewayConfig } from './config';
import { createLogger } from './logger';

async function main(): Promise<void> {
  process.env.SERVICE_NAME ??= 'pulsegate-gateway';
  const config = loadGatewayConfig();
  const logger = createLogger('gateway', config.logLevel);
  if (config.allowPrivateUpstreams) {
    logger.warn(
      'ALLOW_PRIVATE_UPSTREAMS is enabled: private/loopback upstreams are reachable (development only)',
    );
  }
  const pool = createPool();
  const app = await createGatewayApp(config, pool, logger);

  app.server.listen(config.port, config.host);
  await once(app.server, 'listening');
  logger.info({ port: config.port, gatewayId: config.gatewayId }, 'gateway listening');

  // Metrics on a separate port so they are not exposed alongside tenant traffic.
  const admin =
    config.adminPort > 0
      ? createServer((req, res) => {
          if (req.url === '/metrics') {
            res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
            res.end(
              app.metrics.render({
                pulsegate_gateway_inflight_requests: app.gateway.inflightRequests,
                pulsegate_analytics_buffered_events: app.analytics.size,
                pulsegate_analytics_dropped_events_total: app.analytics.dropped,
                pulsegate_analytics_published_events_total: app.analytics.published,
              }),
            );
          } else {
            res.writeHead(404).end();
          }
        }).listen(config.adminPort, config.host)
      : null;

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info(
      { signal, inflight: app.gateway.inflightRequests },
      'shutting down: draining connections',
    );
    app.gateway.beginShutdown(); // readiness now fails so load balancers stop routing here
    const closed = new Promise<void>((resolve) => app.server.close(() => resolve()));
    app.server.closeIdleConnections();
    const timer = setTimeout(() => {
      logger.warn(
        { inflight: app.gateway.inflightRequests },
        'grace period elapsed; closing remaining connections',
      );
      app.server.closeAllConnections();
    }, config.shutdownGraceMs);
    await closed;
    clearTimeout(timer);
    admin?.close();
    await app.close();
    await pool.end();
    logger.info('gateway stopped');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: Error) => {
  console.error(
    JSON.stringify({ level: 'fatal', msg: 'gateway failed to start', err: err.message }),
  );
  process.exit(1);
});

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function main(): Promise<void> {
  process.env.SERVICE_NAME ??= 'pulsegate-api';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  const config = configureApp(app);
  if (config.ssrf.allowPrivate) {
    app
      .get(Logger)
      .warn(
        'ALLOW_PRIVATE_UPSTREAMS is enabled: private upstream URLs are accepted (development only)',
      );
  }
  await app.listen(config.port, config.host);
  app
    .get(Logger)
    .log(`API listening on :${config.port}${config.swaggerEnabled ? ' (docs at /api/docs)' : ''}`);
}

main().catch((err: Error) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'api failed to start', err: err.message }));
  process.exit(1);
});

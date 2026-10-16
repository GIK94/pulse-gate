import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { APP_CONFIG, AppConfig } from './config/app-config';

/** Shared HTTP setup for main.ts and the e2e tests. */
export function configureApp(app: NestExpressApplication): AppConfig {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: config.maxBodyBytes });

  const strict = helmet();
  // Swagger UI needs inline scripts/styles; relax CSP only for the docs route.
  const docs = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith('/api/docs') ? docs(req, res, next) : strict(req, res, next),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'x-csrf-token', 'x-request-id'],
    exposedHeaders: [
      'x-request-id',
      'ratelimit-limit',
      'ratelimit-remaining',
      'ratelimit-reset',
      'retry-after',
    ],
    maxAge: 600,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
    }),
  );
  app.enableShutdownHooks();

  if (config.swaggerEnabled) setupSwagger(app);
  return config;
}

function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('PulseGate control-plane API')
      .setDescription(
        'Management API for organizations, projects, upstreams, API keys, rate limits and analytics. ' +
          'Authenticate with POST /api/auth/login (sets the pg_session cookie). Mutating requests also need ' +
          'the X-CSRF-Token header (returned by login and GET /api/auth/me). The gateway data plane is a ' +
          'separate service and is not described here.',
      )
      .setVersion('0.1.0')
      .addCookieAuth('pg_session')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, 'csrf')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' });
}

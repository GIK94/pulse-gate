import { randomUUID } from 'node:crypto';
import { Module, RequestMethod } from '@nestjs/common';
import { LOG_REDACT_PATHS } from '@pulsegate/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditController } from './audit/audit.controller';
import { AuthModule } from './auth/auth.module';
import { CoreModule } from './common/core.module';
import { HealthController } from './health/health.controller';
import { KeysModule } from './keys/keys.module';
import { OrgsModule } from './orgs/orgs.module';
import { ProjectsModule } from './projects/projects.module';
import { RateLimitsModule } from './rate-limits/rate-limits.module';
import { UpstreamsModule } from './upstreams/upstreams.module';

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

@Module({
  imports: [
    LoggerModule.forRoot({
      // Express 5 / path-to-regexp v8 wildcard syntax.
      forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        base: { service: 'api' },
        redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
        // Correlation id: honour a well-formed inbound X-Request-Id, else generate one.
        genReqId: (req: IncomingMessage, res: ServerResponse) => {
          const incoming = req.headers['x-request-id'];
          const id =
            typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        // Log only method and path: no headers, cookies, query strings or bodies.
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            path: req.url?.split('?')[0],
          }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
        autoLogging: {
          ignore: (req: IncomingMessage) => req.url === '/api/health' || req.url === '/api/ready',
        },
      },
    }),
    CoreModule,
    AuthModule,
    OrgsModule,
    ProjectsModule,
    UpstreamsModule,
    KeysModule,
    RateLimitsModule,
    AnalyticsModule,
  ],
  controllers: [HealthController, AuditController],
})
export class AppModule {}

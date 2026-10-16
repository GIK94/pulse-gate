import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, loadAppConfig } from '../config/app-config';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import { ConfigBusService } from './config-bus.service';
import { DatabaseService } from './database.service';
import { CsrfGuard, ManagementThrottleGuard, SessionGuard } from './guards';
import { RedisService } from './redis.service';
import { SessionsService } from './sessions.service';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: loadAppConfig },
    DatabaseService,
    RedisService,
    SessionsService,
    AccessService,
    AuditService,
    ConfigBusService,
    // Order matters: identify the caller, then throttle, then CSRF-check.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: ManagementThrottleGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [
    APP_CONFIG,
    DatabaseService,
    RedisService,
    SessionsService,
    AccessService,
    AuditService,
    ConfigBusService,
  ],
})
export class CoreModule {}

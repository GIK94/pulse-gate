import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DatabaseService } from '../common/database.service';
import { RedisService } from '../common/redis.service';
import { Public, SkipThrottle } from '../common/request-context';
import { APP_CONFIG, AppConfig } from '../config/app-config';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, string> = {};
    await Promise.all([
      this.db.pool.query('SELECT 1').then(
        () => (checks.postgres = 'ok'),
        () => (checks.postgres = 'unavailable'),
      ),
      this.redis.client.ping().then(
        () => (checks.redis = 'ok'),
        () => (checks.redis = 'unavailable'),
      ),
    ]);
    const ok = Object.values(checks).every((v) => v === 'ok');
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ready' : 'not_ready', checks };
  }

  @Get('meta')
  meta() {
    return {
      gatewayBaseUrl: this.config.gatewayPublicUrl,
      registrationEnabled: this.config.registrationEnabled,
      allowPrivateUpstreams: this.config.ssrf.allowPrivate,
      environment: this.config.production ? 'production' : 'development',
    };
  }
}

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SlidingWindowRateLimiter } from '@pulsegate/shared';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/app-config';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  readonly limiter: SlidingWindowRateLimiter;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Redis(config.redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 1_000,
      lazyConnect: true,
    });
    this.client.on('error', (err: Error) => this.logger.warn(`redis error: ${err.message}`));
    this.limiter = new SlidingWindowRateLimiter(this.client, 'pg:api-rl');
  }

  /** Connect before serving so early requests do not fail on an empty offline queue. */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch (err) {
      // Keep starting: /api/ready reports Redis as unavailable and ioredis keeps retrying.
      this.logger.warn(`initial redis connection failed: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}

import { Module } from '@nestjs/common';
import { RateLimitsController } from './rate-limits.controller';
import { RateLimitsService } from './rate-limits.service';

@Module({ controllers: [RateLimitsController], providers: [RateLimitsService] })
export class RateLimitsModule {}

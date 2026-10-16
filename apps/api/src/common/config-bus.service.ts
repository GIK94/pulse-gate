import { Injectable, Logger } from '@nestjs/common';
import { CONFIG_CHANNEL, ConfigInvalidation } from '@pulsegate/shared';
import { DatabaseService } from './database.service';
import { RedisService } from './redis.service';

/**
 * Notifies gateway instances that a project's configuration changed. Called
 * after the database transaction commits. If Redis is unavailable the change
 * still takes effect once gateway caches expire (GATEWAY_CONFIG_CACHE_TTL_MS).
 */
@Injectable()
export class ConfigBusService {
  private readonly logger = new Logger(ConfigBusService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  async projectChanged(projectId: string, extra: Partial<ConfigInvalidation> = {}): Promise<void> {
    const row = await this.db.one<{ slug: string }>(
      'UPDATE projects SET config_version = config_version + 1, updated_at = now() WHERE id = $1 RETURNING slug',
      [projectId],
    );
    await this.publish({
      kind: extra.keyId ? 'key' : 'project',
      projectId,
      slug: row?.slug,
      ...extra,
    });
  }

  async publish(msg: ConfigInvalidation): Promise<void> {
    try {
      await this.redis.client.publish(CONFIG_CHANNEL, JSON.stringify(msg));
    } catch (err) {
      this.logger.warn(
        `config invalidation not published (gateways will refresh on cache TTL): ${(err as Error).message}`,
      );
    }
  }
}

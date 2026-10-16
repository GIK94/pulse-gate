import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePrefix, sanitizeGatewayPath } from '@pulsegate/shared';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { ConfigBusService } from '../common/config-bus.service';
import { DatabaseService } from '../common/database.service';
import { RateLimitDto } from '../common/dto';
import { RouteRuleDto } from './rate-limits.dto';

interface RuleRow {
  id: string;
  path_prefix: string;
  method: string | null;
  limit_requests: number;
  window_seconds: number;
  created_at: Date;
  updated_at: Date;
}

const ruleToDto = (r: RuleRow) => ({
  id: r.id,
  pathPrefix: r.path_prefix,
  method: r.method,
  requests: r.limit_requests,
  windowSeconds: r.window_seconds,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * Policy model:
 *  - Project default: per-key limit applied to every key without an override.
 *  - Key override: replaces the project default for that key (keys endpoint).
 *  - Route rules: extra per-key limits for requests matching a path prefix
 *    (and optionally a method). All applicable limits must pass.
 */
@Injectable()
export class RateLimitsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly bus: ConfigBusService,
  ) {}

  async get(userId: string, projectId: string) {
    const { project } = await this.access.requireProject(userId, projectId);
    const rules = await this.db.query<RuleRow>(
      'SELECT * FROM rate_limit_rules WHERE project_id = $1 ORDER BY path_prefix, method NULLS FIRST',
      [projectId],
    );
    const overrides = await this.db.query(
      `SELECT id, name, prefix, rate_limit_requests AS requests, rate_limit_window_seconds AS "windowSeconds"
         FROM api_keys WHERE project_id = $1 AND rate_limit_requests IS NOT NULL AND status = 'active' ORDER BY name`,
      [projectId],
    );
    return {
      default: {
        requests: project.rate_limit_requests,
        windowSeconds: project.rate_limit_window_seconds,
      },
      rules: rules.map(ruleToDto),
      keyOverrides: overrides,
      algorithm: 'sliding-window-counter',
    };
  }

  async updateDefault(userId: string, projectId: string, dto: RateLimitDto) {
    const { project } = await this.access.requireProject(userId, projectId, 'admin');
    await this.db.query(
      'UPDATE projects SET rate_limit_requests = $2, rate_limit_window_seconds = $3, updated_at = now() WHERE id = $1',
      [projectId, dto.requests, dto.windowSeconds],
    );
    await this.audit.record({
      orgId: project.org_id,
      projectId,
      actorUserId: userId,
      entityType: 'rate_limit_default',
      entityId: projectId,
      action: 'updated',
      changes: {
        from: {
          requests: project.rate_limit_requests,
          windowSeconds: project.rate_limit_window_seconds,
        },
        to: dto,
      },
    });
    await this.bus.projectChanged(projectId);
    return { requests: dto.requests, windowSeconds: dto.windowSeconds };
  }

  async createRule(userId: string, projectId: string, dto: RouteRuleDto) {
    const { project } = await this.access.requireProject(userId, projectId, 'admin');
    const row = await this.db.one<RuleRow>(
      `INSERT INTO rate_limit_rules (project_id, path_prefix, method, limit_requests, window_seconds)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [projectId, this.prefix(dto.pathPrefix), dto.method ?? null, dto.requests, dto.windowSeconds],
    );
    await this.audit.record({
      orgId: project.org_id,
      projectId,
      actorUserId: userId,
      entityType: 'rate_limit_rule',
      entityId: row?.id,
      action: 'created',
      changes: { ...dto },
    });
    await this.bus.projectChanged(projectId);
    return ruleToDto(row as RuleRow);
  }

  async updateRule(userId: string, projectId: string, ruleId: string, dto: RouteRuleDto) {
    const { project } = await this.access.requireProject(userId, projectId, 'admin');
    const before = await this.db.one<RuleRow>(
      'SELECT * FROM rate_limit_rules WHERE id = $1 AND project_id = $2',
      [ruleId, projectId],
    );
    if (!before) throw new NotFoundException('Rule not found');
    const row = await this.db.one<RuleRow>(
      `UPDATE rate_limit_rules SET path_prefix = $3, method = $4, limit_requests = $5, window_seconds = $6, updated_at = now()
        WHERE id = $1 AND project_id = $2 RETURNING *`,
      [
        ruleId,
        projectId,
        this.prefix(dto.pathPrefix),
        dto.method ?? null,
        dto.requests,
        dto.windowSeconds,
      ],
    );
    await this.audit.record({
      orgId: project.org_id,
      projectId,
      actorUserId: userId,
      entityType: 'rate_limit_rule',
      entityId: ruleId,
      action: 'updated',
      changes: { from: ruleToDto(before), to: dto },
    });
    await this.bus.projectChanged(projectId);
    return ruleToDto(row as RuleRow);
  }

  async deleteRule(userId: string, projectId: string, ruleId: string): Promise<void> {
    const { project } = await this.access.requireProject(userId, projectId, 'admin');
    const rows = await this.db.query(
      'DELETE FROM rate_limit_rules WHERE id = $1 AND project_id = $2 RETURNING id',
      [ruleId, projectId],
    );
    if (rows.length === 0) throw new NotFoundException('Rule not found');
    await this.audit.record({
      orgId: project.org_id,
      projectId,
      actorUserId: userId,
      entityType: 'rate_limit_rule',
      entityId: ruleId,
      action: 'deleted',
    });
    await this.bus.projectChanged(projectId);
  }

  private prefix(raw: string): string {
    const p = normalizePrefix(raw);
    if (!sanitizeGatewayPath(p).ok)
      throw new BadRequestException('pathPrefix contains an invalid path');
    return p;
  }
}

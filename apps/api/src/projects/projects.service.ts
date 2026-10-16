import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { isValidSlug, slugify } from '@pulsegate/shared';
import { AccessService, ProjectRow, Role } from '../common/access.service';
import { AuditService, diff } from '../common/audit.service';
import { ConfigBusService } from '../common/config-bus.service';
import { DatabaseService, isUniqueViolation } from '../common/database.service';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly bus: ConfigBusService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  toDto(p: ProjectRow, extra: { role?: Role; upstreamCount?: number; keyCount?: number } = {}) {
    return {
      id: p.id,
      orgId: p.org_id,
      name: p.name,
      slug: p.slug,
      status: p.status,
      rateLimit: { requests: p.rate_limit_requests, windowSeconds: p.rate_limit_window_seconds },
      gatewayUrl: `${this.config.gatewayPublicUrl}/${p.slug}`,
      configVersion: Number(p.config_version),
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      ...extra,
    };
  }

  async list(userId: string, orgId: string) {
    const role = await this.access.requireOrg(userId, orgId);
    const rows = await this.db.query<ProjectRow & { upstream_count: number; key_count: number }>(
      `SELECT p.*,
              (SELECT count(*)::int FROM upstreams u WHERE u.project_id = p.id) AS upstream_count,
              (SELECT count(*)::int FROM api_keys k WHERE k.project_id = p.id AND k.status = 'active') AS key_count
         FROM projects p WHERE p.org_id = $1 ORDER BY p.created_at`,
      [orgId],
    );
    return rows.map((r) =>
      this.toDto(r, { role, upstreamCount: r.upstream_count, keyCount: r.key_count }),
    );
  }

  async create(userId: string, orgId: string, dto: CreateProjectDto) {
    await this.access.requireOrg(userId, orgId, 'admin');
    const slug = dto.slug ?? slugify(dto.name);
    if (!isValidSlug(slug)) {
      throw new BadRequestException(
        'Slug must be 3-48 lowercase letters, digits or dashes and not a reserved word',
      );
    }
    try {
      const row = await this.db.tx(async (c) => {
        const res = await c.query<ProjectRow>(
          `INSERT INTO projects (org_id, name, slug, rate_limit_requests, rate_limit_window_seconds)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [
            orgId,
            dto.name,
            slug,
            dto.rateLimit?.requests ?? 600,
            dto.rateLimit?.windowSeconds ?? 60,
          ],
        );
        await this.audit.record(
          {
            orgId,
            projectId: res.rows[0].id,
            actorUserId: userId,
            entityType: 'project',
            entityId: res.rows[0].id,
            action: 'created',
            changes: { name: dto.name, slug },
          },
          c,
        );
        return res.rows[0];
      });
      await this.bus.publish({ kind: 'project', projectId: row.id, slug });
      return this.toDto(row, { role: 'admin' });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException(`The slug "${slug}" is already taken`);
      throw err;
    }
  }

  async get(userId: string, projectId: string) {
    const { project, role } = await this.access.requireProject(userId, projectId);
    return this.toDto(project, { role });
  }

  async update(userId: string, projectId: string, dto: UpdateProjectDto) {
    const { project, role } = await this.access.requireProject(userId, projectId, 'admin');
    const row = await this.db.one<ProjectRow>(
      `UPDATE projects SET name = COALESCE($2, name), status = COALESCE($3, status), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [projectId, dto.name ?? null, dto.status ?? null],
    );
    await this.audit.record({
      orgId: project.org_id,
      projectId,
      actorUserId: userId,
      entityType: 'project',
      entityId: projectId,
      action: 'updated',
      changes: diff(
        { name: project.name, status: project.status },
        { name: dto.name, status: dto.status },
      ),
    });
    await this.bus.projectChanged(projectId);
    return this.toDto(row as ProjectRow, { role });
  }

  async remove(userId: string, projectId: string): Promise<void> {
    const { project } = await this.access.requireProject(userId, projectId, 'admin');
    await this.db.tx(async (c) => {
      await c.query('DELETE FROM projects WHERE id = $1', [projectId]);
      await this.audit.record(
        {
          orgId: project.org_id,
          projectId,
          actorUserId: userId,
          entityType: 'project',
          entityId: projectId,
          action: 'deleted',
          changes: { slug: project.slug },
        },
        c,
      );
    });
    await this.bus.publish({ kind: 'project', projectId, slug: project.slug });
  }
}

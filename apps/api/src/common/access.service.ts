import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from './database.service';

export type Role = 'owner' | 'admin' | 'member';
const RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export interface ProjectRow {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  status: 'active' | 'disabled';
  rate_limit_requests: number;
  rate_limit_window_seconds: number;
  config_version: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Central tenant-authorization checks. Every management endpoint resolves the
 * caller's membership through here before touching tenant data. Resources in
 * organizations the caller does not belong to are reported as 404 (not 403) so
 * their existence is not disclosed.
 */
@Injectable()
export class AccessService {
  constructor(private readonly db: DatabaseService) {}

  async requireOrg(userId: string, orgId: string, min: Role = 'member'): Promise<Role> {
    const row = await this.db.one<{ role: Role }>(
      'SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2',
      [orgId, userId],
    );
    if (!row) throw new NotFoundException('Organization not found');
    if (!roleAtLeast(row.role, min)) throw new ForbiddenException(`Requires ${min} role or higher`);
    return row.role;
  }

  async requireProject(
    userId: string,
    projectId: string,
    min: Role = 'member',
  ): Promise<{ project: ProjectRow; role: Role }> {
    const row = await this.db.one<ProjectRow & { role: Role }>(
      `SELECT p.*, m.role
         FROM projects p
         JOIN memberships m ON m.org_id = p.org_id AND m.user_id = $2
        WHERE p.id = $1`,
      [projectId, userId],
    );
    if (!row) throw new NotFoundException('Project not found');
    if (!roleAtLeast(row.role, min)) throw new ForbiddenException(`Requires ${min} role or higher`);
    const { role, ...project } = row;
    return { project, role };
  }
}

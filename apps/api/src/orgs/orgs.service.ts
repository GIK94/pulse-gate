import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessService, Role, roleAtLeast } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { DatabaseService, isUniqueViolation, Queryable } from '../common/database.service';
import { AddMemberDto, UpdateMemberDto } from './orgs.dto';

@Injectable()
export class OrgsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  list(userId: string) {
    return this.db.query(
      `SELECT o.id, o.name, m.role, o.created_at AS "createdAt",
              (SELECT count(*)::int FROM projects p WHERE p.org_id = o.id) AS "projectCount"
         FROM memberships m JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = $1 ORDER BY o.created_at`,
      [userId],
    );
  }

  async create(userId: string, name: string) {
    return this.db.tx(async (c) => {
      const org = await c.query<{ id: string; name: string }>(
        'INSERT INTO organizations (name) VALUES ($1) RETURNING id, name',
        [name],
      );
      await c.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [
        org.rows[0].id,
        userId,
      ]);
      await this.audit.record(
        {
          orgId: org.rows[0].id,
          actorUserId: userId,
          entityType: 'organization',
          entityId: org.rows[0].id,
          action: 'created',
          changes: { name },
        },
        c,
      );
      return { ...org.rows[0], role: 'owner' as Role };
    });
  }

  async get(userId: string, orgId: string) {
    const role = await this.access.requireOrg(userId, orgId);
    const org = await this.db.one(
      'SELECT id, name, created_at AS "createdAt" FROM organizations WHERE id = $1',
      [orgId],
    );
    return { ...org, role };
  }

  async members(userId: string, orgId: string) {
    await this.access.requireOrg(userId, orgId);
    return this.db.query(
      `SELECT u.id AS "userId", u.email, u.name, m.role, m.created_at AS "joinedAt"
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.org_id = $1 ORDER BY m.created_at`,
      [orgId],
    );
  }

  async addMember(actorId: string, orgId: string, dto: AddMemberDto) {
    const actorRole = await this.access.requireOrg(actorId, orgId, 'admin');
    if (dto.role !== 'member' && actorRole !== 'owner') {
      throw new ForbiddenException('Only owners can grant admin or owner roles');
    }
    const user = await this.db.one<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      dto.email,
    ]);
    if (!user)
      throw new NotFoundException('No user with that email; ask them to create an account first');
    try {
      await this.db.query('INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3)', [
        orgId,
        user.id,
        dto.role,
      ]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('User is already a member');
      throw err;
    }
    await this.audit.record({
      orgId,
      actorUserId: actorId,
      entityType: 'membership',
      entityId: user.id,
      action: 'added',
      changes: { email: dto.email, role: dto.role },
    });
    return { userId: user.id, email: dto.email, role: dto.role };
  }

  async updateMember(actorId: string, orgId: string, userId: string, dto: UpdateMemberDto) {
    await this.access.requireOrg(actorId, orgId, 'owner');
    return this.db.tx(async (c) => {
      const current = await c.query<{ role: Role }>(
        'SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2 FOR UPDATE',
        [orgId, userId],
      );
      if (!current.rows[0]) throw new NotFoundException('Member not found');
      if (current.rows[0].role === 'owner' && dto.role !== 'owner')
        await this.assertNotLastOwner(c, orgId);
      await c.query('UPDATE memberships SET role = $3 WHERE org_id = $1 AND user_id = $2', [
        orgId,
        userId,
        dto.role,
      ]);
      await this.audit.record(
        {
          orgId,
          actorUserId: actorId,
          entityType: 'membership',
          entityId: userId,
          action: 'role_changed',
          changes: { role: { from: current.rows[0].role, to: dto.role } },
        },
        c,
      );
      return { userId, role: dto.role };
    });
  }

  async removeMember(actorId: string, orgId: string, userId: string): Promise<void> {
    const actorRole = await this.access.requireOrg(actorId, orgId);
    await this.db.tx(async (c) => {
      const target = await c.query<{ role: Role }>(
        'SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2 FOR UPDATE',
        [orgId, userId],
      );
      if (!target.rows[0]) throw new NotFoundException('Member not found');
      const targetRole = target.rows[0].role;
      const self = actorId === userId;
      if (!self) {
        if (!roleAtLeast(actorRole, 'admin'))
          throw new ForbiddenException('Requires admin role or higher');
        if (actorRole !== 'owner' && targetRole !== 'member')
          throw new ForbiddenException('Only owners can remove admins or owners');
      }
      if (targetRole === 'owner') await this.assertNotLastOwner(c, orgId);
      await c.query('DELETE FROM memberships WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
      await this.audit.record(
        {
          orgId,
          actorUserId: actorId,
          entityType: 'membership',
          entityId: userId,
          action: 'removed',
        },
        c,
      );
    });
  }

  private async assertNotLastOwner(c: Queryable, orgId: string) {
    const owners = await c.query(
      `SELECT count(*)::int AS n FROM memberships WHERE org_id = $1 AND role = 'owner'`,
      [orgId],
    );
    if ((owners.rows[0] as { n: number }).n <= 1)
      throw new BadRequestException('An organization must keep at least one owner');
  }
}

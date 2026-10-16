import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AccessService } from '../common/access.service';
import { DatabaseService } from '../common/database.service';
import { AuthedUser, CurrentUser } from '../common/request-context';

@ApiTags('audit')
@ApiCookieAuth()
@Controller('projects/:projectId/audit')
export class AuditController {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    await this.access.requireProject(user.id, projectId);
    return this.db.query(
      `SELECT a.id, a.entity_type AS "entityType", a.entity_id AS "entityId", a.action, a.changes,
              a.created_at AS "createdAt", u.email AS "actorEmail"
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.project_id = $1 ORDER BY a.created_at DESC LIMIT 200`,
      [projectId],
    );
  }
}

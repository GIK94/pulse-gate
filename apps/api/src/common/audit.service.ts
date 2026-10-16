import { Injectable } from '@nestjs/common';
import { redactObject } from '@pulsegate/shared';
import { DatabaseService, Queryable } from './database.service';

export interface AuditEntry {
  orgId: string;
  projectId?: string | null;
  actorUserId: string | null;
  entityType:
    | 'organization'
    | 'membership'
    | 'project'
    | 'upstream'
    | 'api_key'
    | 'rate_limit_rule'
    | 'rate_limit_default';
  entityId?: string | null;
  action: string;
  changes?: Record<string, unknown>;
}

/** Records configuration history. Secret-bearing fields are always redacted. */
@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  async record(entry: AuditEntry, client?: Queryable): Promise<void> {
    const q = client ?? this.db.pool;
    await q.query(
      `INSERT INTO audit_log (org_id, project_id, actor_user_id, entity_type, entity_id, action, changes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.orgId,
        entry.projectId ?? null,
        entry.actorUserId,
        entry.entityType,
        entry.entityId ?? null,
        entry.action,
        JSON.stringify(redactObject(entry.changes ?? {})),
      ],
    );
  }
}

/** Shallow diff of two plain objects, for audit entries. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (after[key] === undefined) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      out[key] = { from: before[key], to: after[key] };
  }
  return out;
}

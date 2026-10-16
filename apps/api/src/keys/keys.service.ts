import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { generateApiKey, hashApiKey, normalizePrefix } from '@pulsegate/shared';
import { AccessService } from '../common/access.service';
import { AuditService, diff } from '../common/audit.service';
import { ConfigBusService } from '../common/config-bus.service';
import { DatabaseService, Queryable } from '../common/database.service';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { CreateKeyDto, KeyPolicyDto, RotateKeyDto, UpdateKeyDto } from './keys.dto';

interface KeyRow {
  id: string;
  project_id: string;
  name: string;
  prefix: string;
  status: 'active' | 'revoked';
  allowed_methods: string[] | null;
  allowed_path_prefixes: string[] | null;
  rate_limit_requests: number | null;
  rate_limit_window_seconds: number | null;
  expires_at: Date | null;
  last_used_at: Date | null;
  rotated_from_id: string | null;
  created_at: Date;
  revoked_at: Date | null;
}

const KEY_COLUMNS = `id, project_id, name, prefix, status, allowed_methods, allowed_path_prefixes, rate_limit_requests,
  rate_limit_window_seconds, expires_at, last_used_at, rotated_from_id, created_at, revoked_at`;

/** Public shape. Never includes the hash; the raw key is only returned by create/rotate. */
export function keyToDto(k: KeyRow) {
  const expired = k.expires_at !== null && new Date(k.expires_at).getTime() <= Date.now();
  return {
    id: k.id,
    projectId: k.project_id,
    name: k.name,
    prefix: k.prefix,
    status: k.status === 'revoked' ? 'revoked' : expired ? 'expired' : 'active',
    allowedMethods: k.allowed_methods,
    allowedPathPrefixes: k.allowed_path_prefixes,
    rateLimit:
      k.rate_limit_requests && k.rate_limit_window_seconds
        ? { requests: k.rate_limit_requests, windowSeconds: k.rate_limit_window_seconds }
        : null,
    expiresAt: k.expires_at,
    lastUsedAt: k.last_used_at,
    rotatedFromId: k.rotated_from_id,
    createdAt: k.created_at,
    revokedAt: k.revoked_at,
  };
}

@Injectable()
export class KeysService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly bus: ConfigBusService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(userId: string, projectId: string) {
    await this.access.requireProject(userId, projectId);
    const rows = await this.db.query<KeyRow>(
      `SELECT ${KEY_COLUMNS} FROM api_keys WHERE project_id = $1 ORDER BY status, created_at DESC`,
      [projectId],
    );
    return rows.map(keyToDto);
  }

  async create(userId: string, projectId: string, dto: CreateKeyDto) {
    const { project } = await this.access.requireProject(userId, projectId, 'admin');
    if (dto.expiresAt && new Date(dto.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future');
    }
    const policy = this.policy(dto);
    const { key, row } = await this.db.tx(async (c) => {
      const created = await this.insertKey(
        c,
        projectId,
        userId,
        dto.name,
        policy,
        dto.expiresAt ?? null,
        null,
      );
      await this.audit.record(
        {
          orgId: project.org_id,
          projectId,
          actorUserId: userId,
          entityType: 'api_key',
          entityId: created.row.id,
          action: 'created',
          changes: { name: dto.name, prefix: created.row.prefix, ...policy },
        },
        c,
      );
      return created;
    });
    return { key, apiKey: keyToDto(row) };
  }

  async update(userId: string, projectId: string, keyId: string, dto: UpdateKeyDto) {
    const { project } = await this.access.requireProject(userId, projectId, 'admin');
    const existing = await this.load(projectId, keyId);
    const policy = this.policy(dto, existing);
    const row = await this.db.one<KeyRow>(
      `UPDATE api_keys SET name = $3, allowed_methods = $4, allowed_path_prefixes = $5, rate_limit_requests = $6,
         rate_limit_window_seconds = $7 WHERE id = $1 AND project_id = $2 RETURNING ${KEY_COLUMNS}`,
      [
        keyId,
        projectId,
        dto.name ?? existing.name,
        policy.allowed_methods,
        policy.allowed_path_prefixes,
        policy.rate_limit_requests,
        policy.rate_limit_window_seconds,
      ],
    );
    await this.audit.record({
      orgId: project.org_id,
      projectId,
      actorUserId: userId,
      entityType: 'api_key',
      entityId: keyId,
      action: 'updated',
      changes: diff(
        { name: existing.name, ...this.policy({}, existing) },
        { name: dto.name, ...policy },
      ),
    });
    await this.bus.projectChanged(projectId, { keyId });
    return keyToDto(row as KeyRow);
  }

  async revoke(userId: string, projectId: string, keyId: string) {
    const { project } = await this.access.requireProject(userId, projectId, 'admin');
    await this.load(projectId, keyId);
    const row = await this.db.one<KeyRow>(
      `UPDATE api_keys SET status = 'revoked', revoked_at = COALESCE(revoked_at, now())
        WHERE id = $1 AND project_id = $2 RETURNING ${KEY_COLUMNS}`,
      [keyId, projectId],
    );
    await this.audit.record({
      orgId: project.org_id,
      projectId,
      actorUserId: userId,
      entityType: 'api_key',
      entityId: keyId,
      action: 'revoked',
    });
    await this.bus.projectChanged(projectId, { keyId });
    return keyToDto(row as KeyRow);
  }

  /**
   * Issues a replacement key with the same name and policies. The old key is
   * revoked immediately, or set to expire after the grace period so clients
   * can be redeployed without downtime.
   */
  async rotate(userId: string, projectId: string, keyId: string, dto: RotateKeyDto) {
    const { project } = await this.access.requireProject(userId, projectId, 'admin');
    const grace = dto.gracePeriodSeconds ?? 0;
    const result = await this.db.tx(async (c) => {
      const old = await c.query<KeyRow>(
        `SELECT ${KEY_COLUMNS} FROM api_keys WHERE id = $1 AND project_id = $2 FOR UPDATE`,
        [keyId, projectId],
      );
      const existing = old.rows[0];
      if (!existing) throw new NotFoundException('API key not found');
      if (existing.status === 'revoked')
        throw new BadRequestException('Cannot rotate a revoked key');
      const created = await this.insertKey(
        c,
        projectId,
        userId,
        existing.name,
        this.policy({}, existing),
        existing.expires_at ? new Date(existing.expires_at).toISOString() : null,
        existing.id,
      );
      if (grace === 0) {
        await c.query(`UPDATE api_keys SET status = 'revoked', revoked_at = now() WHERE id = $1`, [
          keyId,
        ]);
      } else {
        await c.query(
          `UPDATE api_keys SET expires_at = LEAST(COALESCE(expires_at, 'infinity'), now() + make_interval(secs => $2))
            WHERE id = $1`,
          [keyId, grace],
        );
      }
      await this.audit.record(
        {
          orgId: project.org_id,
          projectId,
          actorUserId: userId,
          entityType: 'api_key',
          entityId: keyId,
          action: 'rotated',
          changes: {
            newKeyId: created.row.id,
            newPrefix: created.row.prefix,
            gracePeriodSeconds: grace,
          },
        },
        c,
      );
      return created;
    });
    await this.bus.projectChanged(projectId, { keyId });
    return { key: result.key, apiKey: keyToDto(result.row) };
  }

  private async insertKey(
    c: Queryable,
    projectId: string,
    userId: string,
    name: string,
    policy: ReturnType<KeysService['policy']>,
    expiresAt: string | null,
    rotatedFrom: string | null,
  ): Promise<{ key: string; row: KeyRow }> {
    const { key, prefix } = generateApiKey();
    const res = await c.query<KeyRow>(
      `INSERT INTO api_keys (project_id, name, prefix, key_hash, allowed_methods, allowed_path_prefixes,
         rate_limit_requests, rate_limit_window_seconds, expires_at, rotated_from_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${KEY_COLUMNS}`,
      [
        projectId,
        name,
        prefix,
        hashApiKey(key, this.config.apiKeyPepper),
        policy.allowed_methods,
        policy.allowed_path_prefixes,
        policy.rate_limit_requests,
        policy.rate_limit_window_seconds,
        expiresAt,
        rotatedFrom,
        userId,
      ],
    );
    return { key, row: res.rows[0] };
  }

  /** Merges a policy DTO over existing values; explicit null clears an override. */
  private policy(dto: KeyPolicyDto, existing?: KeyRow) {
    const pick = <T>(v: T | null | undefined, fallback: T | null): T | null =>
      v === undefined ? fallback : v;
    const methods = pick(dto.allowedMethods, existing?.allowed_methods ?? null);
    const prefixes = pick(dto.allowedPathPrefixes, existing?.allowed_path_prefixes ?? null);
    const rl =
      dto.rateLimit === undefined
        ? existing?.rate_limit_requests
          ? {
              requests: existing.rate_limit_requests,
              windowSeconds: existing.rate_limit_window_seconds as number,
            }
          : null
        : dto.rateLimit;
    return {
      allowed_methods: methods ? [...new Set(methods.map((m) => m.toUpperCase()))] : null,
      allowed_path_prefixes: prefixes ? prefixes.map(normalizePrefix) : null,
      rate_limit_requests: rl?.requests ?? null,
      rate_limit_window_seconds: rl?.windowSeconds ?? null,
    };
  }

  private async load(projectId: string, keyId: string): Promise<KeyRow> {
    const row = await this.db.one<KeyRow>(
      `SELECT ${KEY_COLUMNS} FROM api_keys WHERE id = $1 AND project_id = $2`,
      [keyId, projectId],
    );
    if (!row) throw new NotFoundException('API key not found');
    return row;
  }
}

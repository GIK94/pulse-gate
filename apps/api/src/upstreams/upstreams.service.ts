import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HTTP_METHODS,
  isValidCustomHeaderName,
  normalizePrefix,
  sanitizeGatewayPath,
  SsrfError,
  validateUpstreamUrl,
} from '@pulsegate/shared';
import { AccessService } from '../common/access.service';
import { AuditService, diff } from '../common/audit.service';
import { ConfigBusService } from '../common/config-bus.service';
import { DatabaseService, isUniqueViolation } from '../common/database.service';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { UpstreamTester } from './upstream-tester';
import {
  CreateUpstreamDto,
  TestUpstreamDto,
  UpdateUpstreamDto,
  UpstreamAuthDto,
} from './upstreams.dto';

interface UpstreamRow {
  id: string;
  project_id: string;
  name: string;
  base_url: string;
  match_prefix: string;
  strip_match_prefix: boolean;
  allowed_methods: string[];
  allowed_path_prefixes: string[];
  connect_timeout_ms: number;
  response_timeout_ms: number;
  auth_type: 'none' | 'bearer' | 'header';
  auth_header_name: string | null;
  auth_secret_enc: string | null;
  enabled: boolean;
  last_test_at: Date | null;
  last_test_ok: boolean | null;
  last_test_status: number | null;
  last_test_latency_ms: number | null;
  last_test_error: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Public shape: credentials are reduced to `hasSecret`. */
export function upstreamToDto(r: UpstreamRow) {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    baseUrl: r.base_url,
    matchPrefix: r.match_prefix,
    stripMatchPrefix: r.strip_match_prefix,
    allowedMethods: r.allowed_methods,
    allowedPathPrefixes: r.allowed_path_prefixes,
    connectTimeoutMs: r.connect_timeout_ms,
    responseTimeoutMs: r.response_timeout_ms,
    auth: {
      type: r.auth_type,
      headerName: r.auth_header_name,
      hasSecret: Boolean(r.auth_secret_enc),
    },
    enabled: r.enabled,
    lastTest: r.last_test_at
      ? {
          at: r.last_test_at,
          ok: r.last_test_ok,
          status: r.last_test_status,
          latencyMs: r.last_test_latency_ms,
          error: r.last_test_error,
        }
      : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Non-secret snapshot used for audit diffs. */
function snapshot(r: Partial<UpstreamRow>) {
  return {
    name: r.name,
    baseUrl: r.base_url,
    matchPrefix: r.match_prefix,
    stripMatchPrefix: r.strip_match_prefix,
    allowedMethods: r.allowed_methods,
    allowedPathPrefixes: r.allowed_path_prefixes,
    connectTimeoutMs: r.connect_timeout_ms,
    responseTimeoutMs: r.response_timeout_ms,
    authType: r.auth_type,
    authHeaderName: r.auth_header_name,
    enabled: r.enabled,
  };
}

@Injectable()
export class UpstreamsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly bus: ConfigBusService,
    private readonly tester: UpstreamTester,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(userId: string, projectId: string) {
    await this.access.requireProject(userId, projectId);
    const rows = await this.db.query<UpstreamRow>(
      'SELECT * FROM upstreams WHERE project_id = $1 ORDER BY created_at',
      [projectId],
    );
    return rows.map(upstreamToDto);
  }

  async get(userId: string, projectId: string, upstreamId: string) {
    await this.access.requireProject(userId, projectId);
    return upstreamToDto(await this.load(projectId, upstreamId));
  }

  async create(userId: string, projectId: string, dto: CreateUpstreamDto) {
    const { project } = await this.access.requireProject(userId, projectId, 'admin');
    const id = randomUUID();
    const baseUrl = await this.validateBaseUrl(dto.baseUrl);
    const auth = this.resolveAuth(id, dto.auth, null);
    const values = {
      name: dto.name,
      base_url: baseUrl,
      match_prefix: this.validatePrefix(dto.matchPrefix ?? '/', 'matchPrefix'),
      strip_match_prefix: dto.stripMatchPrefix ?? true,
      allowed_methods: this.validateMethods(dto.allowedMethods ?? [...HTTP_METHODS]),
      allowed_path_prefixes: (dto.allowedPathPrefixes ?? ['/']).map((p) =>
        this.validatePrefix(p, 'allowedPathPrefixes'),
      ),
      connect_timeout_ms: dto.connectTimeoutMs ?? 3000,
      response_timeout_ms: dto.responseTimeoutMs ?? 15000,
      ...auth,
      enabled: dto.enabled ?? false,
    };
    try {
      const row = await this.db.tx(async (c) => {
        const res = await c.query<UpstreamRow>(
          `INSERT INTO upstreams (id, project_id, name, base_url, match_prefix, strip_match_prefix, allowed_methods,
             allowed_path_prefixes, connect_timeout_ms, response_timeout_ms, auth_type, auth_header_name, auth_secret_enc, enabled)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
          [
            id,
            projectId,
            values.name,
            values.base_url,
            values.match_prefix,
            values.strip_match_prefix,
            values.allowed_methods,
            values.allowed_path_prefixes,
            values.connect_timeout_ms,
            values.response_timeout_ms,
            values.auth_type,
            values.auth_header_name,
            values.auth_secret_enc,
            values.enabled,
          ],
        );
        await this.audit.record(
          {
            orgId: project.org_id,
            projectId,
            actorUserId: userId,
            entityType: 'upstream',
            entityId: id,
            action: 'created',
            changes: { ...snapshot(res.rows[0]), secretSet: Boolean(values.auth_secret_enc) },
          },
          c,
        );
        return res.rows[0];
      });
      await this.bus.projectChanged(projectId);
      return upstreamToDto(row);
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException('Another upstream already uses this match prefix');
      throw err;
    }
  }

  async update(userId: string, projectId: string, upstreamId: string, dto: UpdateUpstreamDto) {
    const { project } = await this.access.requireProject(userId, projectId, 'admin');
    const existing = await this.load(projectId, upstreamId);
    const baseUrl =
      dto.baseUrl !== undefined ? await this.validateBaseUrl(dto.baseUrl) : existing.base_url;
    const auth = dto.auth ? this.resolveAuth(upstreamId, dto.auth, existing) : null;
    const next: Partial<UpstreamRow> = {
      name: dto.name ?? existing.name,
      base_url: baseUrl,
      match_prefix:
        dto.matchPrefix !== undefined
          ? this.validatePrefix(dto.matchPrefix, 'matchPrefix')
          : existing.match_prefix,
      strip_match_prefix: dto.stripMatchPrefix ?? existing.strip_match_prefix,
      allowed_methods: dto.allowedMethods
        ? this.validateMethods(dto.allowedMethods)
        : existing.allowed_methods,
      allowed_path_prefixes: dto.allowedPathPrefixes
        ? dto.allowedPathPrefixes.map((p) => this.validatePrefix(p, 'allowedPathPrefixes'))
        : existing.allowed_path_prefixes,
      connect_timeout_ms: dto.connectTimeoutMs ?? existing.connect_timeout_ms,
      response_timeout_ms: dto.responseTimeoutMs ?? existing.response_timeout_ms,
      auth_type: auth?.auth_type ?? existing.auth_type,
      auth_header_name: auth ? auth.auth_header_name : existing.auth_header_name,
      auth_secret_enc: auth ? auth.auth_secret_enc : existing.auth_secret_enc,
      enabled: dto.enabled ?? existing.enabled,
    };
    try {
      const row = await this.db.tx(async (c) => {
        const res = await c.query<UpstreamRow>(
          `UPDATE upstreams SET name = $3, base_url = $4, match_prefix = $5, strip_match_prefix = $6, allowed_methods = $7,
             allowed_path_prefixes = $8, connect_timeout_ms = $9, response_timeout_ms = $10, auth_type = $11,
             auth_header_name = $12, auth_secret_enc = $13, enabled = $14, updated_at = now()
           WHERE id = $1 AND project_id = $2 RETURNING *`,
          [
            upstreamId,
            projectId,
            next.name,
            next.base_url,
            next.match_prefix,
            next.strip_match_prefix,
            next.allowed_methods,
            next.allowed_path_prefixes,
            next.connect_timeout_ms,
            next.response_timeout_ms,
            next.auth_type,
            next.auth_header_name,
            next.auth_secret_enc,
            next.enabled,
          ],
        );
        const changes = diff(snapshot(existing), snapshot(res.rows[0]));
        if (dto.auth?.secret !== undefined || next.auth_secret_enc !== existing.auth_secret_enc)
          changes.secretChanged = true;
        const action =
          dto.enabled !== undefined &&
          dto.enabled !== existing.enabled &&
          Object.keys(changes).length === 1
            ? dto.enabled
              ? 'enabled'
              : 'disabled'
            : 'updated';
        await this.audit.record(
          {
            orgId: project.org_id,
            projectId,
            actorUserId: userId,
            entityType: 'upstream',
            entityId: upstreamId,
            action,
            changes,
          },
          c,
        );
        return res.rows[0];
      });
      await this.bus.projectChanged(projectId);
      return upstreamToDto(row);
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException('Another upstream already uses this match prefix');
      throw err;
    }
  }

  async remove(userId: string, projectId: string, upstreamId: string): Promise<void> {
    const { project } = await this.access.requireProject(userId, projectId, 'admin');
    const existing = await this.load(projectId, upstreamId);
    await this.db.tx(async (c) => {
      await c.query('DELETE FROM upstreams WHERE id = $1 AND project_id = $2', [
        upstreamId,
        projectId,
      ]);
      await this.audit.record(
        {
          orgId: project.org_id,
          projectId,
          actorUserId: userId,
          entityType: 'upstream',
          entityId: upstreamId,
          action: 'deleted',
          changes: snapshot(existing),
        },
        c,
      );
    });
    await this.bus.projectChanged(projectId);
  }

  async test(userId: string, projectId: string, upstreamId: string, dto: TestUpstreamDto) {
    await this.access.requireProject(userId, projectId, 'admin');
    const u = await this.load(projectId, upstreamId);
    let authHeader: { name: string; value: string } | undefined;
    if (u.auth_type !== 'none' && u.auth_secret_enc) {
      const secret = this.config.secretBox.decrypt(u.auth_secret_enc, u.id);
      authHeader =
        u.auth_type === 'bearer'
          ? { name: 'authorization', value: `Bearer ${secret}` }
          : { name: String(u.auth_header_name).toLowerCase(), value: secret };
    }
    const result = await this.tester.test({
      baseUrl: u.base_url,
      path: dto.path,
      connectTimeoutMs: u.connect_timeout_ms,
      responseTimeoutMs: u.response_timeout_ms,
      authHeader,
    });
    await this.db.query(
      `UPDATE upstreams SET last_test_at = $3, last_test_ok = $4, last_test_status = $5, last_test_latency_ms = $6,
         last_test_error = $7 WHERE id = $1 AND project_id = $2`,
      [
        upstreamId,
        projectId,
        result.testedAt,
        result.ok,
        result.status,
        result.latencyMs,
        result.error,
      ],
    );
    return result;
  }

  async history(userId: string, projectId: string, upstreamId: string) {
    await this.access.requireProject(userId, projectId);
    return this.db.query(
      `SELECT a.id, a.action, a.changes, a.created_at AS "createdAt", u.email AS "actorEmail"
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.project_id = $1 AND a.entity_type = 'upstream' AND a.entity_id = $2
        ORDER BY a.created_at DESC LIMIT 100`,
      [projectId, upstreamId],
    );
  }

  private async load(projectId: string, upstreamId: string): Promise<UpstreamRow> {
    const row = await this.db.one<UpstreamRow>(
      'SELECT * FROM upstreams WHERE id = $1 AND project_id = $2',
      [upstreamId, projectId],
    );
    if (!row) throw new NotFoundException('Upstream not found');
    return row;
  }

  private async validateBaseUrl(raw: string): Promise<string> {
    try {
      const url = await validateUpstreamUrl(raw, this.config.ssrf);
      const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
      return `${url.origin}${path}`;
    } catch (err) {
      if (err instanceof SsrfError)
        throw new BadRequestException(`baseUrl rejected: ${err.message}`);
      throw err;
    }
  }

  private validatePrefix(raw: string, field: string): string {
    const p = normalizePrefix(raw);
    if (!sanitizeGatewayPath(p).ok)
      throw new BadRequestException(`${field} contains an invalid path`);
    return p;
  }

  private validateMethods(methods: string[]): string[] {
    return [...new Set(methods.map((m) => m.toUpperCase()))].filter((m) =>
      (HTTP_METHODS as readonly string[]).includes(m),
    );
  }

  private resolveAuth(
    upstreamId: string,
    auth: UpstreamAuthDto | undefined,
    existing: UpstreamRow | null,
  ) {
    if (!auth || auth.type === 'none')
      return { auth_type: 'none' as const, auth_header_name: null, auth_secret_enc: null };
    let headerName: string | null = null;
    if (auth.type === 'header') {
      headerName = auth.headerName ?? existing?.auth_header_name ?? null;
      if (!headerName || !isValidCustomHeaderName(headerName)) {
        throw new BadRequestException(
          'auth.headerName must be a valid, non-reserved HTTP header name',
        );
      }
    }
    let secretEnc: string | null;
    if (auth.secret !== undefined) {
      secretEnc = this.config.secretBox.encrypt(auth.secret, upstreamId);
    } else if (existing && existing.auth_type === auth.type && existing.auth_secret_enc) {
      secretEnc = existing.auth_secret_enc;
    } else {
      throw new BadRequestException('auth.secret is required for this auth type');
    }
    return { auth_type: auth.type, auth_header_name: headerName, auth_secret_enc: secretEnc };
  }
}

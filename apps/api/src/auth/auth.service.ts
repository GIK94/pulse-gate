import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { RateLimiterUnavailableError } from '@pulsegate/shared';
import { DatabaseService, isUniqueViolation } from '../common/database.service';
import { RedisService } from '../common/redis.service';
import { SessionsService } from '../common/sessions.service';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { LoginDto, RegisterDto } from './auth.dto';
import { burnPasswordCheck, hashPassword, verifyPassword } from './passwords';

export interface SessionResult {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  user: { id: string; email: string; name: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly sessions: SessionsService,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(dto: RegisterDto, userAgent?: string): Promise<SessionResult> {
    if (!this.config.registrationEnabled) throw new ForbiddenException('Registration is disabled');
    const passwordHash = await hashPassword(dto.password);
    let user: { id: string; email: string; name: string };
    try {
      user = await this.db.tx(async (c) => {
        const u = await c.query<{ id: string; email: string; name: string }>(
          'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name',
          [dto.email, dto.name, passwordHash],
        );
        const org = await c.query<{ id: string }>(
          'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
          [dto.organizationName ?? `${dto.name}'s workspace`],
        );
        await c.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [
          org.rows[0].id,
          u.rows[0].id,
        ]);
        return u.rows[0];
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException('An account with this email already exists');
      throw err;
    }
    const session = await this.sessions.create(user.id, userAgent);
    return { ...session, user };
  }

  async login(dto: LoginDto, userAgent?: string): Promise<SessionResult> {
    await this.throttleEmail(dto.email);
    const row = await this.db.one<{
      id: string;
      email: string;
      name: string;
      password_hash: string;
    }>('SELECT id, email, name, password_hash FROM users WHERE email = $1', [dto.email]);
    if (!row) {
      await burnPasswordCheck(dto.password);
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!(await verifyPassword(row.password_hash, dto.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const session = await this.sessions.create(row.id, userAgent);
    return { ...session, user: { id: row.id, email: row.email, name: row.name } };
  }

  async me(userId: string) {
    const orgs = await this.db.query<{ id: string; name: string; role: string }>(
      `SELECT o.id, o.name, m.role FROM memberships m JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = $1 ORDER BY o.created_at`,
      [userId],
    );
    return orgs;
  }

  /** Per-email attempt limit (in addition to the per-IP guard) against credential stuffing. */
  private async throttleEmail(email: string): Promise<void> {
    const l = this.config.loginEmailLimit;
    const id = createHash('sha256').update(email).digest('hex').slice(0, 32);
    try {
      const d = await this.redis.limiter.check('mgmt', [
        { scope: 'login-email', id, limit: l.requests, windowSeconds: l.windowSeconds },
      ]);
      if (d && !d.allowed) {
        throw new HttpException(
          'Too many login attempts for this account; try again later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof RateLimiterUnavailableError)
        throw new ServiceUnavailableException('Login temporarily unavailable');
      throw err;
    }
  }
}

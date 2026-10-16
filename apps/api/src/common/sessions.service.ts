import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DatabaseService } from './database.service';
import type { AuthedUser } from './request-context';

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/**
 * Opaque server-side sessions. The browser holds a random 256-bit token in an
 * HttpOnly cookie; the database stores only its SHA-256. Sessions have an
 * absolute lifetime and an idle timeout, and are deleted on logout.
 * Each session carries a CSRF token (synchronizer-token pattern) that the SPA
 * obtains from /auth/me and echoes in the X-CSRF-Token header.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(
    userId: string,
    userAgent?: string,
  ): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 3600_000);
    await this.db.query(
      `INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at, user_agent) VALUES ($1, $2, $3, $4, $5)`,
      [userId, hashToken(token), csrfToken, expiresAt, userAgent?.slice(0, 256) ?? null],
    );
    return { token, csrfToken, expiresAt };
  }

  async resolve(
    token: string,
  ): Promise<{ sessionId: string; csrfToken: string; user: AuthedUser } | null> {
    if (!token || token.length > 128) return null;
    const row = await this.db.one<{
      id: string;
      csrf_token: string;
      last_seen_at: Date;
      user_id: string;
      email: string;
      name: string;
    }>(
      `SELECT s.id, s.csrf_token, s.last_seen_at, u.id AS user_id, u.email, u.name
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()
          AND s.last_seen_at > now() - make_interval(hours => $2)`,
      [hashToken(token), this.config.sessionIdleHours],
    );
    if (!row) return null;
    // Touch at most once a minute to avoid a write per request.
    if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
      await this.db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.id]);
    }
    return {
      sessionId: row.id,
      csrfToken: row.csrf_token,
      user: { id: row.user_id, email: row.email, name: row.name },
    };
  }

  async destroy(sessionId: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  }

  async destroyAllForUser(userId: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
}

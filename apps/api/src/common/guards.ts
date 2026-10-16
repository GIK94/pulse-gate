import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { rateLimitHeaders, RateLimiterUnavailableError, RateLimitSpec } from '@pulsegate/shared';
import type { Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { RedisService } from './redis.service';
import {
  AppRequest,
  EXTRA_LIMIT,
  IS_PUBLIC,
  LimitConfigKey,
  SESSION_COOKIE,
  SKIP_THROTTLE,
} from './request-context';
import { SessionsService } from './sessions.service';

/** Resolves the session cookie; rejects non-public routes without a session. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (token) {
      const session = await this.sessions.resolve(token);
      if (session) {
        req.user = session.user;
        req.sessionInfo = { id: session.sessionId, csrfToken: session.csrfToken };
      }
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic || req.user) return true;
    throw new UnauthorizedException('Authentication required');
  }
}

/**
 * Redis-backed rate limiting for the management API: a global per-user (or
 * per-IP when anonymous) limit, plus optional stricter named limits such as
 * login attempts. Fails closed (503) if Redis is unavailable.
 */
@Injectable()
export class ManagementThrottleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_THROTTLE, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const identity = req.user ? `u:${req.user.id}` : `ip:${req.ip}`;
    const m = this.config.managementLimit;
    const specs: RateLimitSpec[] = [
      { scope: 'mgmt', id: identity, limit: m.requests, windowSeconds: m.windowSeconds },
    ];
    const extra = this.reflector.getAllAndOverride<{ name: string; configKey: LimitConfigKey }>(
      EXTRA_LIMIT,
      targets,
    );
    if (extra) {
      const l = this.config[extra.configKey];
      specs.push({
        scope: extra.name,
        id: `ip:${req.ip}`,
        limit: l.requests,
        windowSeconds: l.windowSeconds,
      });
    }
    let decision;
    try {
      decision = await this.redis.limiter.check('mgmt', specs);
    } catch (err) {
      if (err instanceof RateLimiterUnavailableError) {
        throw new ServiceUnavailableException(
          'Rate limiting backend unavailable; try again shortly',
        );
      }
      throw err;
    }
    if (!decision) return true;
    for (const [k, v] of Object.entries(rateLimitHeaders(decision))) res.setHeader(k, v);
    if (!decision.allowed)
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated requests:
 *  1. Unsafe methods with an Origin header must come from an allowlisted origin.
 *  2. Authenticated unsafe requests must echo the session's CSRF token in
 *     X-CSRF-Token (compared in constant time).
 * SameSite=Lax on the session cookie is an additional layer, not the only one.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      const self = `${req.protocol}://${req.get('host')}`;
      if (origin !== self && !this.config.corsOrigins.includes(origin)) {
        throw new ForbiddenException('Origin not allowed');
      }
    } else if (origin === 'null') {
      throw new ForbiddenException('Origin not allowed');
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic || !req.sessionInfo) return true;
    const header = req.headers['x-csrf-token'];
    const presented = Buffer.from(typeof header === 'string' ? header : '');
    const expected = Buffer.from(req.sessionInfo.csrfToken);
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      throw new ForbiddenException('Missing or invalid CSRF token');
    }
    return true;
  }
}

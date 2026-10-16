import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AppConfig, LimitConfig } from '../config/app-config';

export const SESSION_COOKIE = 'pg_session';

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
}

export interface AppRequest extends Request {
  user?: AuthedUser;
  sessionInfo?: { id: string; csrfToken: string };
}

export const IS_PUBLIC = 'pulsegate:isPublic';
/** Route does not require a session (login, register, health...). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const SKIP_THROTTLE = 'pulsegate:skipThrottle';
export const SkipThrottle = () => SetMetadata(SKIP_THROTTLE, true);

export type LimitConfigKey = {
  [K in keyof AppConfig]: AppConfig[K] extends LimitConfig ? K : never;
}[keyof AppConfig];
export const EXTRA_LIMIT = 'pulsegate:extraLimit';
/** Adds a stricter, named rate limit on top of the global management limit. */
export const RateLimit = (name: string, configKey: LimitConfigKey) =>
  SetMetadata(EXTRA_LIMIT, { name, configKey });

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser => {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    return req.user as AuthedUser;
  },
);

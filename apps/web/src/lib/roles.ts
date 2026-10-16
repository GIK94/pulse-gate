import type { Role } from './types';

/** admin+ can mutate project configuration (upstreams, keys, rate limits, settings). */
export function canManage(role: Role | undefined | null): boolean {
  return role === 'owner' || role === 'admin';
}

export function isOwner(role: Role | undefined | null): boolean {
  return role === 'owner';
}

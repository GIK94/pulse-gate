import type { Dimension, Range } from './types';

/** Centralized react-query keys so mutations can invalidate precisely. */
export const qk = {
  meta: ['meta'] as const,
  orgs: ['orgs'] as const,
  org: (orgId: string) => ['org', orgId] as const,
  members: (orgId: string) => ['org', orgId, 'members'] as const,
  projects: (orgId: string) => ['org', orgId, 'projects'] as const,
  orgSummary: (orgId: string, range: Range) =>
    ['org', orgId, 'analytics', 'summary', range] as const,
  orgTimeseries: (orgId: string, range: Range) =>
    ['org', orgId, 'analytics', 'timeseries', range] as const,
  orgBreakdown: (orgId: string, range: Range) =>
    ['org', orgId, 'analytics', 'breakdown', range] as const,

  project: (pid: string) => ['project', pid] as const,
  upstreams: (pid: string) => ['project', pid, 'upstreams'] as const,
  upstreamHistory: (pid: string, uid: string) =>
    ['project', pid, 'upstreams', uid, 'history'] as const,
  keys: (pid: string) => ['project', pid, 'keys'] as const,
  rateLimits: (pid: string) => ['project', pid, 'rate-limits'] as const,
  audit: (pid: string) => ['project', pid, 'audit'] as const,
  analytics: (pid: string) => ['project', pid, 'analytics'] as const,
  summary: (pid: string, range: Range) => ['project', pid, 'analytics', 'summary', range] as const,
  timeseries: (pid: string, range: Range) =>
    ['project', pid, 'analytics', 'timeseries', range] as const,
  breakdown: (pid: string, range: Range, dim: Dimension) =>
    ['project', pid, 'analytics', 'breakdown', range, dim] as const,
  upstreamHealth: (pid: string) => ['project', pid, 'analytics', 'upstream-health'] as const,
  requests: (pid: string, params: Record<string, unknown>) =>
    ['project', pid, 'requests', params] as const,
  request: (pid: string, id: string) => ['project', pid, 'request', id] as const,
};

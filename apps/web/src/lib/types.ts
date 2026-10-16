export type Role = 'owner' | 'admin' | 'member';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Meta {
  gatewayBaseUrl: string;
  registrationEnabled: boolean;
  allowPrivateUpstreams: boolean;
  environment: string;
}

export interface AuthResponse {
  user: User;
  csrfToken: string;
}

export interface MeResponse {
  user: User;
  organizations: { id: string; name: string; role: Role }[];
  csrfToken: string;
}

export interface OrgSummary {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
  projectCount: number;
}

export interface Org {
  id: string;
  name: string;
  createdAt: string;
  role: Role;
}

export interface Member {
  userId: string;
  email: string;
  name: string;
  role: Role;
  joinedAt: string;
}

export interface RateLimit {
  requests: number;
  windowSeconds: number;
}

export type ProjectStatus = 'active' | 'disabled';

export interface Project {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  status: ProjectStatus;
  rateLimit: RateLimit;
  gatewayUrl: string;
  configVersion: number;
  createdAt: string;
  updatedAt: string;
  role: Role;
  upstreamCount?: number;
  keyCount?: number;
}

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type UpstreamAuthType = 'none' | 'bearer' | 'header';

export interface TestResult {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error: string | null;
}

export interface Upstream {
  id: string;
  projectId: string;
  name: string;
  baseUrl: string;
  matchPrefix: string;
  stripMatchPrefix: boolean;
  allowedMethods: HttpMethod[];
  allowedPathPrefixes: string[];
  connectTimeoutMs: number;
  responseTimeoutMs: number;
  auth: { type: UpstreamAuthType; headerName: string | null; hasSecret: boolean };
  enabled: boolean;
  lastTest: (TestResult & { at: string }) | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpstreamInput {
  name: string;
  baseUrl: string;
  matchPrefix?: string;
  stripMatchPrefix?: boolean;
  allowedMethods?: HttpMethod[];
  allowedPathPrefixes?: string[];
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  auth?: { type: UpstreamAuthType; headerName?: string; secret?: string };
  enabled?: boolean;
}

export interface UpstreamTestResponse extends TestResult {
  testedAt: string;
}

export interface HistoryEntry {
  id: string;
  action: string;
  changes: unknown;
  createdAt: string;
  actorEmail: string | null;
}

export type ApiKeyStatus = 'active' | 'revoked' | 'expired';

export interface ApiKey {
  id: string;
  projectId: string;
  name: string;
  prefix: string;
  status: ApiKeyStatus;
  allowedMethods: HttpMethod[] | null;
  allowedPathPrefixes: string[] | null;
  rateLimit: RateLimit | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  rotatedFromId: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface ApiKeyInput {
  name?: string;
  allowedMethods?: HttpMethod[] | null;
  allowedPathPrefixes?: string[] | null;
  rateLimit?: RateLimit | null;
  expiresAt?: string;
}

export interface RawKeyResponse {
  key: string;
  apiKey: ApiKey;
}

export interface RateLimitRule {
  id: string;
  pathPrefix: string;
  method: HttpMethod | null;
  requests: number;
  windowSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface RateLimitsResponse {
  default: RateLimit;
  rules: RateLimitRule[];
  keyOverrides: {
    id: string;
    name: string;
    prefix: string;
    requests: number;
    windowSeconds: number;
  }[];
  algorithm: string;
}

export const RANGES = ['15m', '1h', '24h', '7d'] as const;
export type Range = (typeof RANGES)[number];

export interface Summary {
  range: Range;
  from: string;
  to: string;
  totalRequests: number;
  successRate: number | null;
  clientErrorRate: number | null;
  serverErrorRate: number | null;
  clientErrors: number;
  serverErrors: number;
  rateLimited: number;
  unauthorized: number;
  latency: { p50: number | null; p95: number | null; p99: number | null; avg: number | null };
  requestBytes: number;
  responseBytes: number;
  requestsPerMinute: number;
}

export interface TimeseriesPoint {
  t: string;
  total: number;
  success: number;
  clientErrors: number;
  serverErrors: number;
  rateLimited: number;
  p50: number | null;
  p95: number | null;
  avg: number | null;
}

export interface Timeseries {
  range: Range;
  bucket: string;
  points: TimeseriesPoint[];
}

export const DIMENSIONS = ['route', 'method', 'status', 'apiKey', 'upstream', 'outcome'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface BreakdownItem {
  key: string;
  label: string;
  total: number;
  errors: number;
  errorRate: number;
  serverErrors: number;
  rateLimited: number;
  p95: number | null;
  avg: number | null;
}

export interface Breakdown {
  items: BreakdownItem[];
}

export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown' | 'disabled';

export interface UpstreamHealth {
  upstreamId: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  status: HealthStatus;
  last15m: { requests: number; failures: number; errorRate: number | null; p95: number | null };
  lastFailureAt: string | null;
  lastTest: (TestResult & { at: string }) | null;
  failureTrend: { t: string; total: number; failures: number }[];
}

export const OUTCOMES = [
  'ok',
  'upstream_error',
  'upstream_unreachable',
  'upstream_timeout',
  'rate_limited',
  'unauthorized',
  'forbidden',
  'not_found',
  'bad_request',
  'payload_too_large',
  'unavailable',
  'client_aborted',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface RequestLog {
  id: string;
  createdAt: string;
  requestId: string;
  method: string;
  path: string;
  route: string | null;
  status: number;
  outcome: Outcome | string;
  latencyMs: number;
  upstreamLatencyMs: number | null;
  requestBytes: number;
  responseBytes: number;
  errorCode: string | null;
  apiKey: { id: string; name: string; prefix: string } | null;
  upstream: { id: string; name: string } | null;
}

export interface RequestDetail extends RequestLog {
  gatewayId: string | null;
  upstreamBaseUrl: string | null;
  timing: { totalMs: number; upstreamMs: number | null; gatewayOverheadMs: number | null };
  errorDescription: string | null;
}

export interface RequestPage {
  items: RequestLog[];
  nextCursor: string | null;
}

export interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  changes: unknown;
  createdAt: string;
  actorEmail: string | null;
}

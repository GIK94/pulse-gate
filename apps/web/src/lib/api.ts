import type {
  ApiKey,
  ApiKeyInput,
  AuditEntry,
  AuthResponse,
  Breakdown,
  Dimension,
  HistoryEntry,
  MeResponse,
  Member,
  Meta,
  Org,
  OrgSummary,
  Project,
  ProjectStatus,
  RateLimit,
  RateLimitRule,
  RateLimitsResponse,
  Range,
  RawKeyResponse,
  RequestDetail,
  RequestPage,
  Role,
  Summary,
  Timeseries,
  Upstream,
  UpstreamHealth,
  UpstreamInput,
  UpstreamTestResponse,
  HttpMethod,
} from './types';

/**
 * Thin fetch wrapper for the PulseGate API.
 *
 * - Always uses relative `/api/...` URLs (same origin in Docker, Vite proxy in dev).
 * - The session cookie is HttpOnly and managed by the browser (`credentials: 'include'`).
 * - The CSRF token lives only in memory and is attached to every mutating request.
 */

const BASE = '/api';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let csrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export class ApiError extends Error {
  readonly status: number;
  readonly messages: string[];
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(opts: {
    status: number;
    messages: string[];
    requestId: string | null;
    retryAfterSeconds: number | null;
  }) {
    super(opts.messages.join('; ') || `Request failed (${opts.status})`);
    this.name = 'ApiError';
    this.status = opts.status;
    this.messages = opts.messages;
    this.requestId = opts.requestId;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }

  /** Human-friendly message, with special handling for rate limiting. */
  get friendly(): string {
    if (this.status === 429) {
      return this.retryAfterSeconds != null
        ? `Too many requests, retry in ${this.retryAfterSeconds}s`
        : 'Too many requests, please retry shortly';
    }
    if (this.status === 0) return 'Network error: could not reach the PulseGate API';
    return this.message;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.friendly;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** Do not trigger the global 401 → /login redirect (used by login/register/me). */
  skipAuthRedirect?: boolean;
}

function buildUrl(path: string, query?: Query): string {
  let url = `${BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, Math.ceil(secs));
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const method = (opts.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (MUTATING.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  try {
    return await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError({ status: 0, messages: [], requestId: null, retryAfterSeconds: null });
  }
}

async function toError(res: Response): Promise<ApiError> {
  let messages: string[] = [];
  let bodyRequestId: string | null = null;
  try {
    const data = (await res.json()) as {
      message?: string | string[];
      error?: string;
      requestId?: string;
    };
    if (Array.isArray(data.message)) messages = data.message.map(String);
    else if (typeof data.message === 'string') messages = [data.message];
    else if (data.error) messages = [data.error];
    if (typeof data.requestId === 'string') bodyRequestId = data.requestId;
  } catch {
    messages = [res.statusText || `HTTP ${res.status}`];
  }
  return new ApiError({
    status: res.status,
    messages,
    requestId: res.headers.get('x-request-id') ?? bodyRequestId,
    retryAfterSeconds: parseRetryAfter(res.headers.get('retry-after')),
  });
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = (opts.method ?? 'GET').toUpperCase();
  let res = await send(path, opts);

  // The CSRF token is in memory only; after a reload it may be missing for a moment.
  // Refresh it from /auth/me once and retry the mutation.
  if (res.status === 403 && MUTATING.has(method)) {
    const err = await toError(res.clone());
    if (/csrf/i.test(err.message)) {
      const me = await send('/auth/me', { skipAuthRedirect: true });
      if (me.ok) {
        const data = (await me.json()) as MeResponse;
        setCsrfToken(data.csrfToken);
        res = await send(path, opts);
      }
    }
  }

  if (res.status === 401 && !opts.skipAuthRedirect) {
    setCsrfToken(null);
    unauthorizedHandler?.();
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const enc = encodeURIComponent;

export const api = {
  meta: () => request<Meta>('/meta', { skipAuthRedirect: true }),

  // Auth
  login: (body: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body, skipAuthRedirect: true }),
  register: (body: { email: string; password: string; name: string; organizationName?: string }) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body, skipAuthRedirect: true }),
  logout: () => request<void>('/auth/logout', { method: 'POST', skipAuthRedirect: true }),
  me: () => request<MeResponse>('/auth/me', { skipAuthRedirect: true }),

  // Orgs
  orgs: () => request<OrgSummary[]>('/orgs'),
  createOrg: (name: string) =>
    request<{ id: string; name: string; role: Role }>('/orgs', { method: 'POST', body: { name } }),
  org: (orgId: string) => request<Org>(`/orgs/${enc(orgId)}`),
  members: (orgId: string) => request<Member[]>(`/orgs/${enc(orgId)}/members`),
  addMember: (orgId: string, body: { email: string; role: Role }) =>
    request<Member>(`/orgs/${enc(orgId)}/members`, { method: 'POST', body }),
  updateMember: (orgId: string, userId: string, role: Role) =>
    request<Member>(`/orgs/${enc(orgId)}/members/${enc(userId)}`, {
      method: 'PATCH',
      body: { role },
    }),
  removeMember: (orgId: string, userId: string) =>
    request<void>(`/orgs/${enc(orgId)}/members/${enc(userId)}`, { method: 'DELETE' }),

  // Projects
  projects: (orgId: string) => request<Project[]>(`/orgs/${enc(orgId)}/projects`),
  createProject: (orgId: string, body: { name: string; slug?: string; rateLimit?: RateLimit }) =>
    request<Project>(`/orgs/${enc(orgId)}/projects`, { method: 'POST', body }),
  project: (pid: string) => request<Project>(`/projects/${enc(pid)}`),
  updateProject: (pid: string, body: { name?: string; status?: ProjectStatus }) =>
    request<Project>(`/projects/${enc(pid)}`, { method: 'PATCH', body }),
  deleteProject: (pid: string) => request<void>(`/projects/${enc(pid)}`, { method: 'DELETE' }),

  // Upstreams
  upstreams: (pid: string) => request<Upstream[]>(`/projects/${enc(pid)}/upstreams`),
  createUpstream: (pid: string, body: UpstreamInput) =>
    request<Upstream>(`/projects/${enc(pid)}/upstreams`, { method: 'POST', body }),
  updateUpstream: (pid: string, uid: string, body: Partial<UpstreamInput>) =>
    request<Upstream>(`/projects/${enc(pid)}/upstreams/${enc(uid)}`, { method: 'PATCH', body }),
  deleteUpstream: (pid: string, uid: string) =>
    request<void>(`/projects/${enc(pid)}/upstreams/${enc(uid)}`, { method: 'DELETE' }),
  testUpstream: (pid: string, uid: string, path?: string) =>
    request<UpstreamTestResponse>(`/projects/${enc(pid)}/upstreams/${enc(uid)}/test`, {
      method: 'POST',
      body: path ? { path } : {},
    }),
  upstreamHistory: (pid: string, uid: string) =>
    request<HistoryEntry[]>(`/projects/${enc(pid)}/upstreams/${enc(uid)}/history`),

  // API keys
  keys: (pid: string) => request<ApiKey[]>(`/projects/${enc(pid)}/keys`),
  createKey: (pid: string, body: ApiKeyInput & { name: string }) =>
    request<RawKeyResponse>(`/projects/${enc(pid)}/keys`, { method: 'POST', body }),
  updateKey: (pid: string, kid: string, body: Omit<ApiKeyInput, 'expiresAt'>) =>
    request<ApiKey>(`/projects/${enc(pid)}/keys/${enc(kid)}`, { method: 'PATCH', body }),
  revokeKey: (pid: string, kid: string) =>
    request<ApiKey>(`/projects/${enc(pid)}/keys/${enc(kid)}/revoke`, { method: 'POST' }),
  rotateKey: (pid: string, kid: string, gracePeriodSeconds?: number) =>
    request<RawKeyResponse>(`/projects/${enc(pid)}/keys/${enc(kid)}/rotate`, {
      method: 'POST',
      body: gracePeriodSeconds != null ? { gracePeriodSeconds } : {},
    }),

  // Rate limits
  rateLimits: (pid: string) => request<RateLimitsResponse>(`/projects/${enc(pid)}/rate-limits`),
  setDefaultRateLimit: (pid: string, body: RateLimit) =>
    request<RateLimit>(`/projects/${enc(pid)}/rate-limits/default`, { method: 'PUT', body }),
  createRule: (
    pid: string,
    body: {
      pathPrefix: string;
      method: HttpMethod | null;
      requests: number;
      windowSeconds: number;
    },
  ) => request<RateLimitRule>(`/projects/${enc(pid)}/rate-limits/rules`, { method: 'POST', body }),
  updateRule: (
    pid: string,
    ruleId: string,
    body: Partial<{
      pathPrefix: string;
      method: HttpMethod | null;
      requests: number;
      windowSeconds: number;
    }>,
  ) =>
    request<RateLimitRule>(`/projects/${enc(pid)}/rate-limits/rules/${enc(ruleId)}`, {
      method: 'PATCH',
      body,
    }),
  deleteRule: (pid: string, ruleId: string) =>
    request<void>(`/projects/${enc(pid)}/rate-limits/rules/${enc(ruleId)}`, { method: 'DELETE' }),

  // Analytics
  summary: (pid: string, range: Range) =>
    request<Summary>(`/projects/${enc(pid)}/analytics/summary`, { query: { range } }),
  timeseries: (pid: string, range: Range) =>
    request<Timeseries>(`/projects/${enc(pid)}/analytics/timeseries`, { query: { range } }),
  breakdown: (pid: string, range: Range, dimension: Dimension) =>
    request<Breakdown>(`/projects/${enc(pid)}/analytics/breakdown`, {
      query: { range, dimension },
    }),
  upstreamHealth: (pid: string) =>
    request<UpstreamHealth[]>(`/projects/${enc(pid)}/analytics/upstream-health`),
  requests: (pid: string, query: Query) =>
    request<RequestPage>(`/projects/${enc(pid)}/requests`, { query }),
  requestDetail: (pid: string, id: string) =>
    request<RequestDetail>(`/projects/${enc(pid)}/requests/${enc(id)}`),

  orgSummary: (orgId: string, range: Range) =>
    request<Summary>(`/orgs/${enc(orgId)}/analytics/summary`, { query: { range } }),
  orgTimeseries: (orgId: string, range: Range) =>
    request<Timeseries>(`/orgs/${enc(orgId)}/analytics/timeseries`, { query: { range } }),
  orgBreakdown: (orgId: string, range: Range) =>
    request<Breakdown>(`/orgs/${enc(orgId)}/analytics/breakdown`, {
      query: { range, dimension: 'project' },
    }),

  // Audit
  audit: (pid: string) => request<AuditEntry[]>(`/projects/${enc(pid)}/audit`),
};

/**
 * Split validation messages into per-field messages (messages that start with the field
 * name, e.g. "baseUrl rejected: …") and the remaining general messages.
 */
export function splitFieldErrors(
  err: unknown,
  fields: string[],
): { byField: Record<string, string>; general: ApiError | Error | null } {
  const byField: Record<string, string> = {};
  if (!(err instanceof ApiError) || err.status !== 400) {
    return { byField, general: err instanceof Error ? err : null };
  }
  const rest: string[] = [];
  for (const m of err.messages) {
    const field = fields.find(
      (f) => m === f || m.startsWith(`${f} `) || m.startsWith(`${f}:`) || m.startsWith(`${f}.`),
    );
    if (field && !byField[field]) byField[field] = m;
    else rest.push(m);
  }
  const general =
    rest.length > 0
      ? new ApiError({
          status: err.status,
          messages: rest,
          requestId: err.requestId,
          retryAfterSeconds: err.retryAfterSeconds,
        })
      : null;
  return { byField, general };
}

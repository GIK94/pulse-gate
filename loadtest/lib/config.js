// Shared configuration for PulseGate k6 scenarios.
// All values come from environment variables (k6 -e NAME=value or --env).
// Secrets: keys are only ever placed in request headers. Never run these
// scripts with --http-debug=full against real keys, as that prints headers.

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8787').replace(/\/+$/, '');
export const PROJECT_SLUG = __ENV.PROJECT_SLUG || 'demo-store';

// Defaults are the LOCAL-ONLY demo keys created by the development seed.
export const API_KEY = __ENV.API_KEY || 'pgk_000000000b_LoadTestKeyLocalOnlyHighLimit000';
export const RATE_LIMIT_KEY =
  __ENV.RATE_LIMIT_KEY || 'pgk_000000000a_RateLimitDemoKeyLocalOnly0000000';

export function num(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

export function str(name, fallback) {
  const raw = __ENV[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export function url(path) {
  return `${BASE_URL}/${PROJECT_SLUG}${path}`;
}

/** Request params with the PulseGate key header and k6 tags. */
export function params(tags, key = API_KEY, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (key) headers['X-PulseGate-Key'] = key;
  return { headers, tags };
}

export function json(res) {
  try {
    return res.json();
  } catch (_e) {
    return null;
  }
}

/** Identifies the key in output without revealing it (prefix only). */
export function keyLabel(key) {
  return key ? `${key.slice(0, 14)}_…` : '(none)';
}

export function hasRateLimitHeaders(res) {
  return (
    res.headers['Ratelimit-Limit'] !== undefined &&
    res.headers['Ratelimit-Remaining'] !== undefined &&
    res.headers['Ratelimit-Reset'] !== undefined
  );
}

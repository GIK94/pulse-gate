// Scenario 2 — Rate-limit verification.
// Uses the seeded "rate-limit demo key" (10 requests / 10 s by default).
//  - sequential: one client sends LIMIT * 3 requests; verifies the first LIMIT
//    succeed, the rest get 429 with Retry-After and RateLimit-* headers, then
//    waits Retry-After and verifies recovery.
//  - burst: many VUs fire at once (after the window has fully reset) to verify
//    the Redis check is atomic: total admitted requests must not exceed LIMIT.
// Reset counters first (see loadtest/README.md) so earlier runs don't skew results.
//
//   EXPECTED_LIMIT (default 10) WINDOW_SECONDS (default 10) BURST_VUS (default 20)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { RATE_LIMIT_KEY, keyLabel, json, num, params, url } from './lib/config.js';

const LIMIT = num('EXPECTED_LIMIT', 10);
const WINDOW = num('WINDOW_SECONDS', 10);
const BURST_VUS = num('BURST_VUS', 20);

const admitted = new Counter('burst_admitted');
const rejected = new Counter('rate_limited_responses');

export const options = {
  scenarios: {
    sequential: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      exec: 'sequential',
      maxDuration: `${WINDOW * 4}s`,
    },
    burst: {
      executor: 'per-vu-iterations',
      vus: BURST_VUS,
      iterations: 1,
      exec: 'burst',
      // Two full windows after the sequential phase so the sliding window is empty.
      startTime: `${WINDOW * 4 + 1}s`,
      maxDuration: '30s',
    },
  },
  thresholds: {
    checks: ['rate==1'],
    burst_admitted: [`count<=${LIMIT}`],
    rate_limited_responses: ['count>0'],
  },
};

// 429 is the expected outcome here, so it must not count as a failed request.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 429));

function validate429(res) {
  const body = json(res);
  return check(res, {
    '429: Retry-After >= 1': (r) => Number(r.headers['Retry-After']) >= 1,
    '429: RateLimit-Limit equals configured limit': (r) =>
      Number(r.headers['Ratelimit-Limit']) === LIMIT,
    '429: RateLimit-Remaining is 0': (r) => r.headers['Ratelimit-Remaining'] === '0',
    '429: RateLimit-Reset present': (r) => Number(r.headers['Ratelimit-Reset']) >= 1,
    '429: X-RateLimit-* mirrors present': (r) => r.headers['X-Ratelimit-Limit'] !== undefined,
    '429: error code rate_limited': () =>
      body !== null && body.error && body.error.code === 'rate_limited',
  });
}

export function setup() {
  console.log(
    `rate-limit test with key ${keyLabel(RATE_LIMIT_KEY)}; expecting ${LIMIT} requests per ${WINDOW}s`,
  );
}

export function sequential() {
  const statuses = [];
  let last429 = null;
  for (let i = 0; i < LIMIT * 3; i++) {
    const res = http.get(url('/products'), params({ phase: 'sequential' }, RATE_LIMIT_KEY));
    statuses.push(res.status);
    if (res.status === 429) {
      rejected.add(1);
      last429 = res;
    }
  }
  const firstBlocked = statuses.indexOf(429);
  check(statuses, {
    'first LIMIT requests succeed': (s) => s.slice(0, LIMIT).every((x) => x === 200),
    'request LIMIT+1 is rejected': (s) => s[LIMIT] === 429,
    'no unexpected statuses': (s) => s.every((x) => x === 200 || x === 429),
  });
  console.log(
    `sequential statuses: first 429 at request #${firstBlocked + 1} of ${statuses.length}`,
  );
  if (last429) {
    validate429(last429);
    const wait = Number(last429.headers['Retry-After']);
    sleep(wait + 0.5);
    const after = http.get(url('/products'), params({ phase: 'recovery' }, RATE_LIMIT_KEY));
    check(after, { 'recovers after Retry-After': (r) => r.status === 200 });
  }
}

export function burst() {
  const res = http.get(url('/products'), params({ phase: 'burst' }, RATE_LIMIT_KEY));
  if (res.status === 200) admitted.add(1);
  else if (res.status === 429) {
    rejected.add(1);
    validate429(res);
  }
  check(res, { 'burst: only 200 or 429': (r) => r.status === 200 || r.status === 429 });
}

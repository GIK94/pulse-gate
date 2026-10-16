// Scenario 3 — Mixed behaviour.
// Interleaves successful, slow, invalid, unauthorized and failing-upstream
// requests and checks that each produces the expected status and error shape.
// Every case is tagged (case:<name>) so results can be read per case.
//
//   VUS (default 10) DURATION (default 30s) SLOW_MS (default 300)
//   INCLUDE_TIMEOUTS=true adds requests that exceed the upstream timeout (504)
//   P95_SUCCESS_MS (default 250) MAX_FAILURE_RATE (default 0.01)
import http from 'k6/http';
import { check } from 'k6';
import { json, num, params, str, url } from './lib/config.js';

const SLOW_MS = num('SLOW_MS', 300);
const INCLUDE_TIMEOUTS = str('INCLUDE_TIMEOUTS', 'false') === 'true';

export const options = {
  scenarios: {
    mixed: { executor: 'constant-vus', vus: num('VUS', 10), duration: str('DURATION', '30s') },
  },
  thresholds: {
    // Only statuses outside the expected set below count as failures.
    http_req_failed: [`rate<${num('MAX_FAILURE_RATE', 0.01)}`],
    checks: ['rate>0.99'],
    'http_req_duration{case:success}': [`p(95)<${num('P95_SUCCESS_MS', 250)}`],
    'http_req_duration{case:slow}': [`p(95)<${SLOW_MS + num('SLOW_OVERHEAD_MS', 250)}`],
    'checks{case:unauthorized}': ['rate==1'],
    'checks{case:invalid_path}': ['rate==1'],
  },
};

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 400, 401, 502, 504));

function errorCode(res) {
  const body = json(res);
  return body && body.error ? body.error.code : undefined;
}

const CASES = [
  {
    name: 'success',
    weight: 40,
    run: () => {
      const res = http.get(url('/products'), params({ case: 'success' }));
      check(
        res,
        {
          'success: 200 with data': (r) => r.status === 200 && Array.isArray((json(r) || {}).data),
        },
        { case: 'success' },
      );
    },
  },
  {
    name: 'slow',
    weight: 15,
    run: () => {
      const res = http.get(url(`/slow?delay=${SLOW_MS}`), params({ case: 'slow' }));
      check(
        res,
        {
          'slow: 200': (r) => r.status === 200,
          'slow: took at least the injected delay': (r) => r.timings.duration >= SLOW_MS,
        },
        { case: 'slow' },
      );
    },
  },
  {
    name: 'invalid_path',
    weight: 10,
    run: () => {
      const res = http.get(url('/products/%2e%2e/%2e%2e/admin'), params({ case: 'invalid_path' }));
      check(
        res,
        {
          'invalid path: 400 invalid_path': (r) =>
            r.status === 400 && errorCode(r) === 'invalid_path',
        },
        { case: 'invalid_path' },
      );
    },
  },
  {
    name: 'invalid_body',
    weight: 5,
    run: () => {
      const res = http.post(
        url('/orders'),
        '{not-json',
        params({ case: 'invalid_body' }, undefined, { 'Content-Type': 'application/json' }),
      );
      check(
        res,
        { 'invalid body: upstream 400 passed through': (r) => r.status === 400 },
        { case: 'invalid_body' },
      );
    },
  },
  {
    name: 'unauthorized',
    weight: 15,
    run: () => {
      const missing = http.get(url('/products'), params({ case: 'unauthorized' }, null));
      const wrong = http.get(
        url('/products'),
        params({ case: 'unauthorized' }, 'pgk_ffffffffff_InvalidKeyForLoadTestingPurposes00'),
      );
      check(
        missing,
        {
          'no key: 401 missing_api_key': (r) =>
            r.status === 401 && errorCode(r) === 'missing_api_key',
        },
        { case: 'unauthorized' },
      );
      check(
        wrong,
        {
          'wrong key: 401 invalid_api_key': (r) =>
            r.status === 401 && errorCode(r) === 'invalid_api_key',
        },
        { case: 'unauthorized' },
      );
    },
  },
  {
    name: 'upstream_failure',
    weight: 15,
    run: () => {
      const res = http.get(url('/fail?status=502'), params({ case: 'upstream_failure' }));
      check(
        res,
        {
          'failing upstream: 502 passed through': (r) =>
            r.status === 502 && (json(r) || {}).error === 'simulated_failure',
        },
        { case: 'upstream_failure' },
      );
    },
  },
];

if (INCLUDE_TIMEOUTS) {
  CASES.push({
    name: 'timeout',
    weight: 2,
    run: () => {
      // The seeded demo upstream has a 5000 ms response timeout.
      const res = http.get(url('/slow?delay=6000'), params({ case: 'timeout' }));
      check(
        res,
        {
          'timeout: 504 upstream_timeout': (r) =>
            r.status === 504 && errorCode(r) === 'upstream_timeout',
        },
        { case: 'timeout' },
      );
    },
  });
}

const TOTAL = CASES.reduce((n, c) => n + c.weight, 0);

export default function () {
  let roll = Math.random() * TOTAL;
  for (const c of CASES) {
    roll -= c.weight;
    if (roll <= 0) return c.run();
  }
  return CASES[0].run();
}

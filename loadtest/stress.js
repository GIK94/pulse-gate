// Scenario 4 — Concurrency / stress.
// Ramps virtual users in stages up to TARGET_VUS, holds, then ramps down.
// Watch for rising latency, 503 gateway_overloaded (concurrency limit) and
// errors. Thresholds are LOCAL TEST TARGETS, not production capacity claims.
//
//   TARGET_VUS (default 100) RAMP_DURATION (default 30s) HOLD_DURATION (default 1m)
//   RAMP_DOWN_DURATION (default 15s) THINK_TIME_MS (default 0)
//   WRITE_RATIO (default 0): share of POST /orders. The seeded demo project limits
//   POST /orders to 1200/min per key, so writes above ~20 req/s are (correctly) 429'd.
//   P95_MS (default 500) P99_MS (default 1000) MAX_FAILURE_RATE (default 0.02)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { json, num, params, str, url } from './lib/config.js';

const TARGET = num('TARGET_VUS', 100);
const THINK = num('THINK_TIME_MS', 0) / 1000;
const WRITE_RATIO = num('WRITE_RATIO', 0);
const overloaded = new Counter('gateway_overloaded_503');
const rateLimited = new Counter('unexpected_429');

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: str('RAMP_DURATION', '30s'), target: Math.max(1, Math.floor(TARGET / 2)) },
        { duration: str('RAMP_DURATION', '30s'), target: TARGET },
        { duration: str('HOLD_DURATION', '1m'), target: TARGET },
        { duration: str('RAMP_DOWN_DURATION', '15s'), target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: [`rate<${num('MAX_FAILURE_RATE', 0.02)}`],
    http_req_duration: [`p(95)<${num('P95_MS', 500)}`, `p(99)<${num('P99_MS', 1000)}`],
    checks: ['rate>0.98'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const write = Math.random() < WRITE_RATIO;
  const res = write
    ? http.post(
        url('/orders'),
        JSON.stringify({ productId: 2, quantity: 1 }),
        params({ kind: 'create' }, undefined, { 'Content-Type': 'application/json' }),
      )
    : http.get(url('/products'), params({ kind: 'list' }));
  if (res.status === 503 && (json(res) || { error: {} }).error.code === 'gateway_overloaded')
    overloaded.add(1);
  if (res.status === 429) rateLimited.add(1);
  check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'has request id': (r) => !!r.headers['X-Request-Id'],
  });
  if (THINK > 0) sleep(THINK);
}

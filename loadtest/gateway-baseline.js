// Scenario 1 — Gateway baseline.
// Mixed successful GET and POST traffic through PulseGate to the local demo
// upstream at a constant arrival rate. Thresholds are LOCAL TEST TARGETS for a
// developer machine, not a statement of production capacity.
//
//   RATE (req/s, default 50) DURATION (default 30s) PRE_VUS MAX_VUS
//   P95_MS (default 250) P99_MS (default 500) MAX_FAILURE_RATE (default 0.01)
import http from 'k6/http';
import { check } from 'k6';
import {
  API_KEY,
  BASE_URL,
  PROJECT_SLUG,
  hasRateLimitHeaders,
  json,
  keyLabel,
  num,
  params,
  str,
  url,
} from './lib/config.js';

const P95 = num('P95_MS', 250);
const P99 = num('P99_MS', 500);

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-arrival-rate',
      rate: num('RATE', 50),
      timeUnit: '1s',
      duration: str('DURATION', '30s'),
      preAllocatedVUs: num('PRE_VUS', 20),
      maxVUs: num('MAX_VUS', 200),
    },
  },
  thresholds: {
    http_req_failed: [`rate<${num('MAX_FAILURE_RATE', 0.01)}`],
    http_req_duration: [`p(95)<${P95}`, `p(99)<${P99}`],
    'http_req_duration{kind:list}': [`p(95)<${P95}`],
    'http_req_duration{kind:create}': [`p(95)<${P95}`],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  console.log(`baseline -> ${BASE_URL}/${PROJECT_SLUG} using key ${keyLabel(API_KEY)}`);
  const res = http.get(url('/products'), params({ kind: 'setup' }));
  if (res.status !== 200)
    throw new Error(`gateway not ready: GET /products returned ${res.status}`);
}

export default function () {
  const roll = Math.random();
  if (roll < 0.6) {
    const res = http.get(url('/products?limit=10'), params({ kind: 'list' }));
    const body = json(res);
    check(res, {
      'list: status 200': (r) => r.status === 200,
      'list: has data array': () => body !== null && Array.isArray(body.data),
      'list: x-request-id header': (r) => !!r.headers['X-Request-Id'],
      'list: rate-limit headers': (r) => hasRateLimitHeaders(r),
    });
  } else if (roll < 0.85) {
    const id = 1 + Math.floor(Math.random() * 6);
    const res = http.get(url(`/products/${id}`), params({ kind: 'detail' }));
    const body = json(res);
    check(res, {
      'detail: status 200': (r) => r.status === 200,
      'detail: matching id': () => body !== null && body.data && body.data.id === id,
    });
  } else {
    const payload = JSON.stringify({
      productId: 1 + Math.floor(Math.random() * 6),
      quantity: 1 + Math.floor(Math.random() * 3),
    });
    const res = http.post(
      url('/orders'),
      payload,
      params({ kind: 'create' }, API_KEY, { 'Content-Type': 'application/json' }),
    );
    const body = json(res);
    check(res, {
      'create: status 201': (r) => r.status === 201,
      'create: order id returned': () =>
        body !== null && body.data && typeof body.data.id === 'string',
      'create: upstream credential not echoed': (r) => !r.body.includes('demo-upstream-token'),
    });
  }
}

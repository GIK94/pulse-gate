# PulseGate k6 load and behaviour tests

Four [k6](https://k6.io) scenarios exercise the gateway through the same request path that
user-registered upstreams use. They target the seeded `demo-store` project, which proxies to the
local demo upstream.

| Script                | What it verifies                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway-baseline.js` | Mixed GET/POST traffic at a constant arrival rate; status codes, response shape, `X-Request-Id` and rate-limit headers; latency thresholds                                                                       |
| `rate-limit.js`       | Sends more than the configured limit; checks `429`, `Retry-After`, `RateLimit-*`/`X-RateLimit-*` headers, recovery after `Retry-After`, and that a concurrent burst never admits more than the limit (atomicity) |
| `mixed-behavior.js`   | Successful, slow, invalid (path traversal, bad JSON), unauthorized (missing/wrong key), failing-upstream (502) and optionally timed-out (504) requests, each with its expected status and error code             |
| `stress.js`           | Ramping virtual users in stages up to a target, then hold and ramp down                                                                                                                                          |

> **Threshold values are local test targets for a developer machine.** They are not a statement of
> production capacity. Results depend on hardware, Docker resources and what else is running.

## Keys used (local development only)

The development seed (`docker compose run --rm migrate`) creates these keys. They are published in
this repository and must never exist in a production database.

| Env var          | Default                                           | Limit                                                        |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `API_KEY`        | `pgk_000000000b_LoadTestKeyLocalOnlyHighLimit000` | 1,000,000 req / 60 s (so throughput tests are not throttled) |
| `RATE_LIMIT_KEY` | `pgk_000000000a_RateLimitDemoKeyLocalOnly0000000` | 10 req / 10 s                                                |

The scripts only place keys in request headers and print a key's non-secret prefix at most. Do not
run them with `--http-debug=full` against real keys: that prints request headers.

## Running against Docker Compose (recommended)

The `k6` service (Compose profile `loadtest`, image `grafana/k6:1.8.1`) runs inside the Compose
network and targets `http://gateway:8787`. No local k6 install is needed.

```bash
# 1. Start the stack (builds images, migrates and seeds)
docker compose up -d --build

# 2. Reset rate-limit counters so earlier runs don't skew results
docker compose exec redis sh -c "redis-cli --scan --pattern 'pg:rl:*' | xargs -r redis-cli del"

# 3. Run the scenarios
docker compose --profile loadtest run --rm k6 run /scripts/gateway-baseline.js
docker compose --profile loadtest run --rm k6 run /scripts/rate-limit.js
docker compose --profile loadtest run --rm k6 run /scripts/mixed-behavior.js
docker compose --profile loadtest run --rm k6 run /scripts/stress.js

# Optional: export a JSON summary for the results template
docker compose --profile loadtest run --rm k6 run --summary-export=/results/baseline.json /scripts/gateway-baseline.js
```

Pass parameters with `-e`:

```bash
docker compose --profile loadtest run --rm -e RATE=200 -e DURATION=1m k6 run /scripts/gateway-baseline.js
docker compose --profile loadtest run --rm -e TARGET_VUS=300 -e HOLD_DURATION=2m k6 run /scripts/stress.js
docker compose --profile loadtest run --rm -e INCLUDE_TIMEOUTS=true k6 run /scripts/mixed-behavior.js
```

### With a local k6 binary

```bash
k6 run -e BASE_URL=http://localhost:8787 loadtest/gateway-baseline.js
k6 run -e BASE_URL=http://localhost:8787 loadtest/rate-limit.js
```

### With Docker but without Compose networking

```bash
docker run --rm -v "$PWD/loadtest:/scripts" -e BASE_URL=http://host.docker.internal:8787 \
  grafana/k6:1.8.1 run /scripts/gateway-baseline.js
```

## Parameters

| Variable                                                                                             | Scripts                 | Default                                                    | Meaning                               |
| ---------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------- | ------------------------------------- |
| `BASE_URL`                                                                                           | all                     | `http://localhost:8787` (`http://gateway:8787` in Compose) | Gateway origin                        |
| `PROJECT_SLUG`                                                                                       | all                     | `demo-store`                                               | Project path segment                  |
| `API_KEY`                                                                                            | baseline, mixed, stress | load-test key                                              | Client key for successful traffic     |
| `RATE_LIMIT_KEY`                                                                                     | rate-limit              | rate-limit demo key                                        | Key with a small limit                |
| `RATE`, `DURATION`, `PRE_VUS`, `MAX_VUS`                                                             | baseline                | 50/s, 30s, 20, 200                                         | Constant arrival rate settings        |
| `P95_MS`, `P99_MS`, `MAX_FAILURE_RATE`                                                               | baseline, stress        | 250/500/0.01 (baseline), 500/1000/0.02 (stress)            | Thresholds                            |
| `EXPECTED_LIMIT`, `WINDOW_SECONDS`, `BURST_VUS`                                                      | rate-limit              | 10, 10, 20                                                 | Must match the key's configured limit |
| `VUS`, `DURATION`, `SLOW_MS`, `INCLUDE_TIMEOUTS`, `P95_SUCCESS_MS`                                   | mixed                   | 10, 30s, 300, false, 250                                   | Mixed-scenario settings               |
| `TARGET_VUS`, `RAMP_DURATION`, `HOLD_DURATION`, `RAMP_DOWN_DURATION`, `THINK_TIME_MS`, `WRITE_RATIO` | stress                  | 100, 30s, 1m, 15s, 0, 0                                    | Stage settings                        |

## Resetting state between scenarios

```bash
# Rate-limit counters (all projects)
docker compose exec redis sh -c "redis-cli --scan --pattern 'pg:rl:*' | xargs -r redis-cli del"
# ...or from the host with Node: REDIS_URL=redis://localhost:56379 npm run loadtest:reset [-- <projectId>]

# Analytics rows produced by load tests
docker compose exec postgres psql -U pulsegate -c "TRUNCATE request_logs"

# Re-apply the demo seed (restores demo keys if you revoked or rotated them)
docker compose run --rm migrate
```

The rate-limit scenario assumes the rate-limit key starts with an empty window; reset counters (or
wait two windows, 20 s by default) before running it.

## Recording results

Copy `results/TEMPLATE.md`, fill it in from an actual run, and keep the raw `--summary-export`
JSON next to it. Only record numbers produced by running k6; do not estimate or extrapolate.

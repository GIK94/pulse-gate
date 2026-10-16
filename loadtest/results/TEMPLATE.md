# PulseGate k6 results — <scenario> — <YYYY-MM-DD>

> Fill this in only from an actual k6 run. Leave a field blank rather than estimating.
> These are local measurements, not production capacity claims.

## Environment

| Item                             | Value                                                                |
| -------------------------------- | -------------------------------------------------------------------- |
| Git commit                       |                                                                      |
| Host (CPU / RAM / OS)            |                                                                      |
| Docker resources (CPUs / memory) |                                                                      |
| Topology                         | e.g. Docker Compose, 1 gateway, 1 worker, demo upstream on same host |
| k6 version / image               |                                                                      |
| Command                          |                                                                      |
| Parameters (`-e ...`)            |                                                                      |

## Results

| Metric                                 | Value | Threshold | Pass? |
| -------------------------------------- | ----- | --------- | ----- |
| Requests (total)                       |       |           |       |
| Throughput (req/s)                     |       |           |       |
| `http_req_failed` rate                 |       |           |       |
| `http_req_duration` p50                |       |           |       |
| `http_req_duration` p95                |       |           |       |
| `http_req_duration` p99                |       |           |       |
| Checks passed                          |       |           |       |
| 429 responses (rate-limit scenario)    |       |           |       |
| `burst_admitted` (rate-limit scenario) |       |           |       |
| `gateway_overloaded_503` (stress)      |       |           |       |

## Gateway-side observations

- Gateway metrics (`http://localhost:9464/metrics`) before/after:
- Analytics events dropped (`pulsegate_analytics_dropped_events_total`):
- Dashboard totals for the run window match k6 request count? (expect equal once the worker drains):

## Notes / anomalies

Raw summary: `results/<file>.json`

import type { RequestOutcome } from '@pulsegate/shared';

/** Tiny Prometheus-text metrics registry (no dependency, gateway-local). */
export class GatewayMetrics {
  private readonly outcomes = new Map<RequestOutcome, number>();
  private readonly latencyBuckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  private readonly latencyCounts = new Array<number>(this.latencyBuckets.length + 1).fill(0);
  private latencySum = 0;
  private latencyCount = 0;

  record(outcome: RequestOutcome, latencyMs: number): void {
    this.outcomes.set(outcome, (this.outcomes.get(outcome) ?? 0) + 1);
    let i = this.latencyBuckets.findIndex((b) => latencyMs <= b);
    if (i === -1) i = this.latencyBuckets.length;
    this.latencyCounts[i]++;
    this.latencySum += latencyMs;
    this.latencyCount++;
  }

  render(gauges: Record<string, number>): string {
    const lines: string[] = [];
    lines.push('# TYPE pulsegate_gateway_requests_total counter');
    for (const [outcome, n] of this.outcomes) {
      lines.push(`pulsegate_gateway_requests_total{outcome="${outcome}"} ${n}`);
    }
    lines.push('# TYPE pulsegate_gateway_request_duration_ms histogram');
    let cumulative = 0;
    this.latencyBuckets.forEach((b, i) => {
      cumulative += this.latencyCounts[i];
      lines.push(`pulsegate_gateway_request_duration_ms_bucket{le="${b}"} ${cumulative}`);
    });
    cumulative += this.latencyCounts[this.latencyBuckets.length];
    lines.push(`pulsegate_gateway_request_duration_ms_bucket{le="+Inf"} ${cumulative}`);
    lines.push(`pulsegate_gateway_request_duration_ms_sum ${this.latencySum}`);
    lines.push(`pulsegate_gateway_request_duration_ms_count ${this.latencyCount}`);
    for (const [name, value] of Object.entries(gauges)) {
      lines.push(`# TYPE ${name} gauge`, `${name} ${value}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

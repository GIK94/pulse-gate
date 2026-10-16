import type { Summary } from '../lib/types';
import { fmtCompact, fmtInt, fmtMs, fmtPct } from '../lib/format';
import { KpiTile } from './KpiTile';

const RANGE_LABEL: Record<string, string> = {
  '15m': 'last 15 minutes',
  '1h': 'last hour',
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
};

export function rangeLabel(range: string): string {
  return RANGE_LABEL[range] ?? range;
}

/** The standard KPI row shared by the org and project overviews. */
export function SummaryTiles({
  summary,
  loading,
  detailed = true,
}: {
  summary: Summary | undefined;
  loading: boolean;
  detailed?: boolean;
}) {
  const s = summary;
  const l = s?.latency;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiTile
        loading={loading}
        label="Total requests"
        value={fmtCompact(s?.totalRequests)}
        sub={
          s ? `${s.requestsPerMinute.toFixed(s.requestsPerMinute < 10 ? 2 : 0)} req/min` : undefined
        }
      />
      <KpiTile
        loading={loading}
        label="Success rate"
        value={fmtPct(s?.successRate)}
        sub={s && s.totalRequests === 0 ? 'No traffic' : 'Non-error responses'}
      />
      <KpiTile
        loading={loading}
        label="4xx rate"
        value={fmtPct(s?.clientErrorRate)}
        sub={
          s
            ? `${fmtInt(s.clientErrors)} client errors · ${fmtInt(s.unauthorized)} unauthorized`
            : undefined
        }
      />
      <KpiTile
        loading={loading}
        label="5xx rate"
        value={fmtPct(s?.serverErrorRate)}
        sub={s ? `${fmtInt(s.serverErrors)} server errors` : undefined}
      />
      {detailed && (
        <>
          <KpiTile
            loading={loading}
            label="p50 latency"
            value={fmtMs(l?.p50)}
            sub={l ? `avg ${fmtMs(l.avg)}` : undefined}
          />
          <KpiTile loading={loading} label="p95 latency" value={fmtMs(l?.p95)} />
          <KpiTile loading={loading} label="p99 latency" value={fmtMs(l?.p99)} />
          <KpiTile
            loading={loading}
            label="Rate limited"
            value={fmtCompact(s?.rateLimited)}
            sub={
              s && s.totalRequests > 0
                ? `${fmtPct(s.rateLimited / s.totalRequests)} of requests (429)`
                : '429 responses'
            }
          />
        </>
      )}
    </div>
  );
}

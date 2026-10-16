import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { useLiveQuery, useRefreshInterval } from '../../lib/live';
import { useRangeParam } from '../../lib/useRange';
import { fmtMs, fmtPct, fmtRelative, fmtInt, humanize } from '../../lib/format';
import { DIMENSIONS, type Dimension, type Project, type UpstreamHealth } from '../../lib/types';
import { Card, CardHeader, Segmented, Skeleton } from '../../components/ui';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/states';
import { AnalyticsToolbar } from '../../components/RangeControls';
import { SummaryTiles, rangeLabel } from '../../components/SummaryTiles';
import { FailureSparkline, LatencyChart, VolumeChart } from '../../components/charts';
import { BreakdownTable } from '../../components/BreakdownTable';
import { HealthBadge } from '../../components/badges';
import { CopyBlock } from '../../components/CopyButton';
import { useProject } from './ProjectLayout';

const DIMENSION_LABELS: Record<Dimension, string> = {
  route: 'Route',
  method: 'Method',
  status: 'Status',
  apiKey: 'API key',
  upstream: 'Upstream',
  outcome: 'Outcome',
};

export function OverviewTab() {
  const { project } = useProject();
  const pid = project.id;
  const [range, setRange] = useRangeParam('24h');
  const [refresh, setRefresh] = useRefreshInterval();
  const [dimension, setDimension] = useState<Dimension>('route');
  const live = { intervalMs: refresh };

  const summary = useLiveQuery(qk.summary(pid, range), () => api.summary(pid, range), live);
  const timeseries = useLiveQuery(
    qk.timeseries(pid, range),
    () => api.timeseries(pid, range),
    live,
  );
  const breakdown = useLiveQuery(
    qk.breakdown(pid, range, dimension),
    () => api.breakdown(pid, range, dimension),
    live,
  );
  const health = useLiveQuery(qk.upstreamHealth(pid), () => api.upstreamHealth(pid), live);

  const noTraffic = summary.data?.totalRequests === 0;

  return (
    <div className="space-y-6">
      <AnalyticsToolbar
        range={range}
        onRangeChange={setRange}
        refresh={refresh}
        onRefreshChange={setRefresh}
        updatedAt={summary.dataUpdatedAt}
        fetching={summary.isFetching || timeseries.isFetching}
      />

      {noTraffic && <GettingStarted project={project} range={range} />}

      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <div className={summary.isPlaceholderData ? 'opacity-60 transition-opacity' : ''}>
          <SummaryTiles summary={summary.data} loading={summary.isPending} />
        </div>
      )}

      {timeseries.isError ? (
        <ErrorState error={timeseries.error} onRetry={() => void timeseries.refetch()} />
      ) : timeseries.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <div
          className={
            'grid gap-4 lg:grid-cols-2 ' +
            (timeseries.isPlaceholderData ? 'opacity-60 transition-opacity' : '')
          }
        >
          <VolumeChart
            points={timeseries.data.points}
            range={range}
            description={`${rangeLabel(range)} · ${timeseries.data.bucket} buckets`}
          />
          <LatencyChart points={timeseries.data.points} range={range} />
        </div>
      )}

      <Card>
        <CardHeader
          title={`Breakdown by ${DIMENSION_LABELS[dimension].toLowerCase()}`}
          description={rangeLabel(range)}
          actions={
            <Segmented
              size="sm"
              label="Breakdown dimension"
              value={dimension}
              onChange={setDimension}
              options={DIMENSIONS.map((d) => ({ label: DIMENSION_LABELS[d], value: d }))}
            />
          }
        />
        {breakdown.isError ? (
          <div className="p-4">
            <ErrorState error={breakdown.error} onRetry={() => void breakdown.refetch()} />
          </div>
        ) : breakdown.isPending ? (
          <TableSkeleton rows={4} cols={5} />
        ) : breakdown.data.items.length === 0 ? (
          <EmptyState title="No requests in this range" />
        ) : (
          <div className={breakdown.isPlaceholderData ? 'opacity-60 transition-opacity' : ''}>
            <BreakdownTable
              items={breakdown.data.items}
              labelHeader={DIMENSION_LABELS[dimension]}
              renderLabel={
                dimension === 'outcome'
                  ? (i) => humanize(i.label)
                  : dimension === 'route' || dimension === 'method' || dimension === 'status'
                    ? (i) => <span className="font-mono text-xs">{i.label}</span>
                    : undefined
              }
            />
          </div>
        )}
      </Card>

      <section>
        <div className="mb-3 flex items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Upstream health</h2>
            <p className="text-xs text-slate-500">
              Status from the last 15 minutes of traffic · 24h failure trend
            </p>
          </div>
          <Link to="upstreams" className="text-xs font-medium text-blue-600 hover:text-blue-700">
            Manage upstreams →
          </Link>
        </div>
        {health.isError ? (
          <ErrorState error={health.error} onRetry={() => void health.refetch()} />
        ) : health.isPending ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        ) : health.data.length === 0 ? (
          <Card>
            <EmptyState
              title="No upstreams configured"
              description="Add an upstream to route gateway traffic to your API."
              action={
                <Link to="upstreams" className="text-sm font-medium text-blue-600">
                  Add an upstream
                </Link>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {health.data.map((h) => (
              <HealthCard key={h.upstreamId} health={h} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function HealthCard({ health: h }: { health: UpstreamHealth }) {
  const failures24h = h.failureTrend.reduce((a, p) => a + p.failures, 0);
  return (
    <Card as="article" className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{h.name}</p>
          <p className="truncate font-mono text-xs text-slate-500" title={h.baseUrl}>
            {h.baseUrl}
          </p>
        </div>
        <HealthBadge status={h.status} />
      </div>
      <dl className="tabular mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">Error rate 15m</dt>
          <dd className="mt-0.5 text-sm font-semibold text-slate-900">
            {h.last15m.requests > 0 ? fmtPct(h.last15m.errorRate) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Requests 15m</dt>
          <dd className="mt-0.5 text-sm font-semibold text-slate-900">
            {fmtInt(h.last15m.requests)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">p95 15m</dt>
          <dd className="mt-0.5 text-sm font-semibold text-slate-900">{fmtMs(h.last15m.p95)}</dd>
        </div>
      </dl>
      <div className="mt-3">
        <div className="flex justify-between text-xs text-slate-500">
          <span>Failures, last 24h</span>
          <span className="tabular text-slate-700">{fmtInt(failures24h)}</span>
        </div>
        <div className="mt-1 border-b border-slate-200">
          <FailureSparkline points={h.failureTrend} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
        <span>Last failure: {h.lastFailureAt ? fmtRelative(h.lastFailureAt) : 'none'}</span>
        {h.lastTest && (
          <span>
            Last test: {h.lastTest.ok ? 'passed' : 'failed'} {fmtRelative(h.lastTest.at)}
          </span>
        )}
      </div>
    </Card>
  );
}

function GettingStarted({ project, range }: { project: Project; range: string }) {
  const curl = `curl -H "X-PulseGate-Key: <your-api-key>" ${project.gatewayUrl}/`;
  return (
    <Card className="border-blue-200 bg-blue-50/40">
      <CardHeader
        title="Getting started"
        description={`No requests in the ${rangeLabel(range)}. Send traffic through the gateway to see analytics.`}
      />
      <ol className="list-inside list-decimal space-y-3 px-4 py-4 text-sm text-slate-700">
        <li>
          <Link to="upstreams" className="font-medium text-blue-700 hover:underline">
            Add an upstream
          </Link>{' '}
          (your API&apos;s base URL), test the connection and enable it.
        </li>
        <li>
          <Link to="keys" className="font-medium text-blue-700 hover:underline">
            Create an API key
          </Link>{' '}
          — the raw key is shown once.
        </li>
        <li>
          Call your API through the gateway:
          <div className="mt-2">
            <CopyBlock text={curl} />
          </div>
        </li>
      </ol>
    </Card>
  );
}

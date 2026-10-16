import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { useLiveQuery, useRefreshInterval } from '../../lib/live';
import { useRangeParam } from '../../lib/useRange';
import { fmtBytes, fmtDateTime, fmtMs, fmtRelative, humanize } from '../../lib/format';
import { HTTP_METHODS, OUTCOMES, type RequestDetail } from '../../lib/types';
import {
  Button,
  Card,
  Code,
  Field,
  Input,
  Select,
  Skeleton,
  cx,
  td,
  th,
} from '../../components/ui';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/states';
import { Modal } from '../../components/Modal';
import { AnalyticsToolbar } from '../../components/RangeControls';
import { MethodBadge, OutcomeBadge, StatusBadge } from '../../components/badges';
import { CopyButton } from '../../components/CopyButton';
import { COLORS } from '../../components/charts';
import { useProject } from './ProjectLayout';

const PAGE_SIZE = 50;
const STATUS_OPTIONS = [
  '2xx',
  '3xx',
  '4xx',
  '5xx',
  '200',
  '400',
  '401',
  '403',
  '404',
  '413',
  '429',
  '500',
  '502',
  '503',
  '504',
];

interface Filters {
  status: string;
  method: string;
  outcome: string;
  apiKeyId: string;
  upstreamId: string;
  path: string;
}

const EMPTY_FILTERS: Filters = {
  status: '',
  method: '',
  outcome: '',
  apiKeyId: '',
  upstreamId: '',
  path: '',
};

export function RequestsTab() {
  const { project } = useProject();
  const pid = project.id;
  const [range, setRange] = useRangeParam('24h');
  const [refresh, setRefresh] = useRefreshInterval();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [pathInput, setPathInput] = useState('');
  // Cursor stack for Prev/Next: cursors[i] is the cursor that loads page i (null = first page).
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [selected, setSelected] = useState<string | null>(null);

  const keys = useQuery({ queryKey: qk.keys(pid), queryFn: () => api.keys(pid) });
  const upstreams = useQuery({ queryKey: qk.upstreams(pid), queryFn: () => api.upstreams(pid) });

  // Debounce the free-text path filter.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.path === pathInput.trim() ? f : { ...f, path: pathInput.trim() }));
      setCursors([null]);
    }, 400);
    return () => clearTimeout(t);
  }, [pathInput]);

  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setCursors([null]);
  };

  const pageIndex = cursors.length - 1;
  const cursor = cursors[pageIndex];
  const params = useMemo(
    () => ({ range, ...filters, cursor: cursor ?? undefined, limit: PAGE_SIZE }),
    [range, filters, cursor],
  );

  // Only the first page auto-refreshes; deeper pages stay stable while you read them.
  const page = useLiveQuery(qk.requests(pid, params), () => api.requests(pid, params), {
    intervalMs: pageIndex === 0 ? refresh : 0,
  });

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-4">
      <AnalyticsToolbar
        range={range}
        onRangeChange={(r) => {
          setRange(r);
          setCursors([null]);
        }}
        refresh={refresh}
        onRefreshChange={setRefresh}
        updatedAt={page.dataUpdatedAt}
        fetching={page.isFetching}
      />

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Field label="Status" htmlFor="f-status">
            <Select
              id="f-status"
              value={filters.status}
              onChange={(e) => update({ status: e.target.value })}
            >
              <option value="">Any</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Method" htmlFor="f-method">
            <Select
              id="f-method"
              value={filters.method}
              onChange={(e) => update({ method: e.target.value })}
            >
              <option value="">Any</option>
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Outcome" htmlFor="f-outcome">
            <Select
              id="f-outcome"
              value={filters.outcome}
              onChange={(e) => update({ outcome: e.target.value })}
            >
              <option value="">Any</option>
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {humanize(o)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="API key" htmlFor="f-key">
            <Select
              id="f-key"
              value={filters.apiKeyId}
              onChange={(e) => update({ apiKeyId: e.target.value })}
            >
              <option value="">Any</option>
              {keys.data?.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} ({k.prefix})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Upstream" htmlFor="f-upstream">
            <Select
              id="f-upstream"
              value={filters.upstreamId}
              onChange={(e) => update({ upstreamId: e.target.value })}
            >
              <option value="">Any</option>
              {upstreams.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Path prefix" htmlFor="f-path">
            <Input
              id="f-path"
              placeholder="/orders"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
            />
          </Field>
        </div>
        {hasFilters && (
          <div className="mt-3">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setPathInput('');
                setCursors([null]);
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
      </Card>

      <Card>
        {page.isError ? (
          <div className="p-4">
            <ErrorState error={page.error} onRetry={() => void page.refetch()} />
          </div>
        ) : page.isPending ? (
          <TableSkeleton rows={8} cols={6} />
        ) : page.data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No requests match these filters' : 'No requests in this range'}
            description={
              hasFilters
                ? 'Try widening the time range or clearing filters.'
                : 'Requests sent through the gateway will appear here within a few seconds.'
            }
          />
        ) : (
          <div className={cx('overflow-x-auto', page.isPlaceholderData && 'opacity-60')}>
            <table className="min-w-full divide-y divide-slate-200">
              <thead>
                <tr>
                  <th className={th}>Time</th>
                  <th className={th}>Request</th>
                  <th className={th}>Status</th>
                  <th className={cx(th, 'hidden md:table-cell')}>Outcome</th>
                  <th className={cx(th, 'text-right')}>Latency</th>
                  <th className={cx(th, 'hidden lg:table-cell')}>API key</th>
                  <th className={cx(th, 'hidden xl:table-cell')}>Upstream</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {page.data.items.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    className="cursor-pointer hover:bg-slate-50 focus:bg-blue-50 focus:outline-none"
                    onClick={() => setSelected(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(r.id);
                      }
                    }}
                  >
                    <td className={cx(td, 'tabular text-xs whitespace-nowrap text-slate-500')}>
                      <span title={fmtDateTime(r.createdAt)}>{fmtRelative(r.createdAt)}</span>
                    </td>
                    <td className={cx(td, 'max-w-[18rem]')}>
                      <div className="flex items-center gap-2">
                        <MethodBadge method={r.method} />
                        <span className="truncate font-mono text-xs text-slate-800" title={r.path}>
                          {r.path}
                        </span>
                      </div>
                    </td>
                    <td className={td}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className={cx(td, 'hidden md:table-cell')}>
                      <OutcomeBadge outcome={r.outcome} />
                    </td>
                    <td className={cx(td, 'tabular text-right whitespace-nowrap')}>
                      {fmtMs(r.latencyMs)}
                    </td>
                    <td className={cx(td, 'hidden max-w-[12rem] truncate text-xs lg:table-cell')}>
                      {r.apiKey ? (
                        <span title={r.apiKey.prefix}>{r.apiKey.name}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className={cx(td, 'hidden max-w-[12rem] truncate text-xs xl:table-cell')}>
                      {r.upstream?.name ?? <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          <span>
            Page {pageIndex + 1}
            {page.data && ` · ${page.data.items.length} rows`}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pageIndex === 0}
              onClick={() => setCursors((c) => c.slice(0, -1))}
            >
              ← Prev
            </Button>
            <Button
              size="sm"
              disabled={!page.data?.nextCursor || page.isPlaceholderData}
              onClick={() => {
                const next = page.data?.nextCursor;
                if (next) setCursors((c) => [...c, next]);
              }}
            >
              Next →
            </Button>
          </div>
        </div>
      </Card>

      <RequestDrawer pid={pid} requestId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function RequestDrawer({
  pid,
  requestId,
  onClose,
}: {
  pid: string;
  requestId: string | null;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: qk.request(pid, requestId ?? ''),
    queryFn: () => api.requestDetail(pid, requestId!),
    enabled: !!requestId,
  });
  return (
    <Modal open={!!requestId} onClose={onClose} title="Request details" variant="drawer">
      {detail.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      ) : detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        <RequestDetailView r={detail.data} />
      )}
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="col-span-2 min-w-0 break-words text-slate-900">{children}</dd>
    </div>
  );
}

function RequestDetailView({ r }: { r: RequestDetail }) {
  const total = Math.max(1, r.timing.totalMs);
  const upstream = r.timing.upstreamMs ?? 0;
  const overhead = r.timing.gatewayOverheadMs ?? Math.max(0, r.timing.totalMs - upstream);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <MethodBadge method={r.method} />
        <span className="font-mono text-sm break-all text-slate-900">{r.path}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={r.status} />
        <OutcomeBadge outcome={r.outcome} />
        {r.errorCode && <Code>{r.errorCode}</Code>}
      </div>
      {r.errorDescription && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {r.errorDescription}
        </p>
      )}

      <section>
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Timing</h3>
        <p className="mt-1 text-2xl font-semibold text-slate-900">{fmtMs(r.timing.totalMs)}</p>
        <div
          className="mt-2 flex h-3 w-full gap-0.5 overflow-hidden rounded-sm bg-slate-100"
          role="img"
          aria-label={`Gateway overhead ${fmtMs(overhead)}, upstream ${fmtMs(r.timing.upstreamMs)}`}
        >
          {overhead > 0 && (
            <div style={{ width: `${(overhead / total) * 100}%`, background: COLORS.series1 }} />
          )}
          {upstream > 0 && (
            <div style={{ width: `${(upstream / total) * 100}%`, background: COLORS.series2 }} />
          )}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          <li className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: COLORS.series1 }} />
            Gateway overhead{' '}
            <span className="tabular font-medium text-slate-900">{fmtMs(overhead)}</span>
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: COLORS.series2 }} />
            Upstream{' '}
            <span className="tabular font-medium text-slate-900">{fmtMs(r.timing.upstreamMs)}</span>
          </li>
        </ul>
      </section>

      <section>
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Metadata</h3>
        <dl className="mt-1 divide-y divide-slate-100">
          <Row label="Time">{fmtDateTime(r.createdAt)}</Row>
          <Row label="Request ID">
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs break-all">{r.requestId}</span>
              <CopyButton text={r.requestId} />
            </span>
          </Row>
          <Row label="Route">
            <span className="font-mono text-xs">{r.route ?? '—'}</span>
          </Row>
          <Row label="API key">
            {r.apiKey ? (
              <>
                {r.apiKey.name}{' '}
                <span className="font-mono text-xs text-slate-500">{r.apiKey.prefix}</span>
              </>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Upstream">{r.upstream?.name ?? '—'}</Row>
          <Row label="Upstream base URL">
            <span className="font-mono text-xs break-all">{r.upstreamBaseUrl ?? '—'}</span>
          </Row>
          <Row label="Request size">{fmtBytes(r.requestBytes)}</Row>
          <Row label="Response size">{fmtBytes(r.responseBytes)}</Row>
          <Row label="Gateway instance">
            <span className="font-mono text-xs">{r.gatewayId ?? '—'}</span>
          </Row>
        </dl>
      </section>
    </div>
  );
}

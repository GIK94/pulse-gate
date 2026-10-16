import { useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TimeseriesPoint } from '../lib/types';
import { fmtCompact, fmtInt, fmtMs, fmtTick } from '../lib/format';
import { Card, CardHeader, Segmented, cx, td, th } from './ui';

/*
 * Chart colors follow the dataviz reference palette.
 * - Request outcome classes carry MEANING, so they use the reserved status palette
 *   (good / warning / serious / critical), always with a text legend.
 * - Plain identity series (latency percentiles) use categorical slots in fixed order.
 */
export const COLORS = {
  surface: '#ffffff',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  muted: '#898781',
  series1: '#2a78d6',
  series2: '#eb6834',
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

const axisTick = { fill: COLORS.muted, fontSize: 11 };

interface SeriesDef<K extends string> {
  key: K;
  label: string;
  color: string;
  format: (v: number | null) => string;
}

function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />
          <span>{i.label}</span>
          {i.value && <span className="tabular font-medium text-slate-900">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

function TooltipBox({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; color: string; value: string }[];
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-slate-900">{title}</p>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="pr-3">
                <span className="inline-flex items-center gap-1.5 text-slate-600">
                  <span className="size-2 rounded-sm" style={{ background: r.color }} aria-hidden />
                  {r.label}
                </span>
              </td>
              <td className="tabular text-right font-medium text-slate-900">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtTooltipTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Card wrapper giving every chart a legend slot and a table-view twin. */
export function ChartCard({
  title,
  description,
  legend,
  chart,
  table,
  className,
}: {
  title: string;
  description?: ReactNode;
  legend?: ReactNode;
  chart: ReactNode;
  table: { columns: string[]; rows: (string | number)[][] };
  className?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <Card className={cx('flex min-w-0 flex-col', className)}>
      <CardHeader
        title={title}
        description={description}
        actions={
          <Segmented
            size="sm"
            label={`${title} view`}
            value={view}
            onChange={setView}
            options={[
              { label: 'Chart', value: 'chart' },
              { label: 'Table', value: 'table' },
            ]}
          />
        }
      />
      <div className="flex-1 px-4 py-3">
        {view === 'chart' ? (
          <>
            {legend && <div className="mb-3">{legend}</div>}
            {chart}
          </>
        ) : (
          <div className="max-h-72 overflow-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="sticky top-0 bg-white">
                <tr>
                  {table.columns.map((c) => (
                    <th key={c} className={th}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-slate-100">
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className={cx(td, 'py-1.5 text-xs whitespace-nowrap')}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

type VolumeKey = 'success' | 'otherClient' | 'rateLimited' | 'serverErrors';
type VolumeRow = { t: string } & Record<VolumeKey, number>;

const VOLUME_SERIES: SeriesDef<VolumeKey>[] = [
  { key: 'success', label: 'Success', color: COLORS.good, format: (v) => fmtInt(v) },
  { key: 'otherClient', label: '4xx', color: COLORS.warning, format: (v) => fmtInt(v) },
  {
    key: 'rateLimited',
    label: 'Rate limited (429)',
    color: COLORS.serious,
    format: (v) => fmtInt(v),
  },
  { key: 'serverErrors', label: '5xx', color: COLORS.critical, format: (v) => fmtInt(v) },
];

function toVolumeRows(points: TimeseriesPoint[]): VolumeRow[] {
  // clientErrors includes 429s; split them so the stack sums to the total.
  return points.map((p) => ({
    t: p.t,
    success: p.success,
    otherClient: Math.max(0, p.clientErrors - p.rateLimited),
    rateLimited: p.rateLimited,
    serverErrors: p.serverErrors,
  }));
}

export function VolumeChart({
  points,
  range,
  height = 240,
  title = 'Request volume',
  description,
}: {
  points: TimeseriesPoint[];
  range: string;
  height?: number;
  title?: string;
  description?: ReactNode;
}) {
  const rows = toVolumeRows(points);
  const totals = VOLUME_SERIES.map((s) => rows.reduce((acc, r) => acc + r[s.key], 0));
  return (
    <ChartCard
      title={title}
      description={description}
      legend={
        <Legend
          items={VOLUME_SERIES.map((s, i) => ({
            label: s.label,
            color: s.color,
            value: fmtCompact(totals[i]),
          }))}
        />
      }
      table={{
        columns: ['Time', ...VOLUME_SERIES.map((s) => s.label), 'Total'],
        rows: rows.map((r) => [
          fmtTooltipTime(r.t),
          ...VOLUME_SERIES.map((s) => r[s.key]),
          VOLUME_SERIES.reduce((a, s) => a + r[s.key], 0),
        ]),
      }}
      chart={
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
              barCategoryGap={1}
            >
              <CartesianGrid vertical={false} stroke={COLORS.grid} />
              <XAxis
                dataKey="t"
                tickFormatter={(v: string) => fmtTick(v, range)}
                tick={axisTick}
                tickLine={false}
                axisLine={{ stroke: COLORS.axis }}
                minTickGap={28}
              />
              <YAxis
                tickFormatter={(v: number) => fmtCompact(v)}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={40}
              />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.05)' }}
                content={({ active, payload }) => {
                  const row = active && payload?.[0] ? (payload[0].payload as VolumeRow) : null;
                  if (!row) return null;
                  const total = VOLUME_SERIES.reduce((a, s) => a + row[s.key], 0);
                  return (
                    <TooltipBox
                      title={`${fmtTooltipTime(row.t)} · ${fmtInt(total)} requests`}
                      rows={[...VOLUME_SERIES].reverse().map((s) => ({
                        label: s.label,
                        color: s.color,
                        value: fmtInt(row[s.key]),
                      }))}
                    />
                  );
                }}
              />
              {VOLUME_SERIES.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="v"
                  fill={s.color}
                  maxBarSize={24}
                  stroke={COLORS.surface}
                  strokeWidth={1}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      }
    />
  );
}

const LATENCY_SERIES: SeriesDef<'p50' | 'p95'>[] = [
  { key: 'p50', label: 'p50', color: COLORS.series1, format: fmtMs },
  { key: 'p95', label: 'p95', color: COLORS.series2, format: fmtMs },
];

export function LatencyChart({
  points,
  range,
  height = 240,
}: {
  points: TimeseriesPoint[];
  range: string;
  height?: number;
}) {
  const last = [...points].reverse().find((p) => p.p50 != null || p.p95 != null);
  return (
    <ChartCard
      title="Latency"
      description="End-to-end gateway latency percentiles per bucket"
      legend={
        <Legend
          items={LATENCY_SERIES.map((s) => ({
            label: s.label,
            color: s.color,
            value: last ? `latest ${fmtMs(last[s.key])}` : undefined,
          }))}
        />
      }
      table={{
        columns: ['Time', 'p50', 'p95', 'avg'],
        rows: points.map((p) => [fmtTooltipTime(p.t), fmtMs(p.p50), fmtMs(p.p95), fmtMs(p.avg)]),
      }}
      chart={
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={COLORS.grid} />
              <XAxis
                dataKey="t"
                tickFormatter={(v: string) => fmtTick(v, range)}
                tick={axisTick}
                tickLine={false}
                axisLine={{ stroke: COLORS.axis }}
                minTickGap={28}
              />
              <YAxis
                tickFormatter={(v: number) => `${fmtCompact(v)} ms`}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={60}
              />
              <Tooltip
                cursor={{ stroke: COLORS.axis, strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const row =
                    active && payload?.[0] ? (payload[0].payload as TimeseriesPoint) : null;
                  if (!row) return null;
                  return (
                    <TooltipBox
                      title={fmtTooltipTime(row.t)}
                      rows={[
                        ...LATENCY_SERIES.map((s) => ({
                          label: s.label,
                          color: s.color,
                          value: fmtMs(row[s.key]),
                        })),
                        { label: 'avg', color: 'transparent', value: fmtMs(row.avg) },
                      ]}
                    />
                  );
                }}
              />
              {LATENCY_SERIES.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  activeDot={{ r: 4, fill: s.color, stroke: COLORS.surface, strokeWidth: 2 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      }
    />
  );
}

/** 24h failure sparkline for upstream health cards. */
export function FailureSparkline({
  points,
}: {
  points: { t: string; total: number; failures: number }[];
}) {
  const max = Math.max(1, ...points.map((p) => p.failures));
  return (
    <div className="h-10 w-full" aria-label="Failures over the last 24 hours">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={points}
          margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
          barCategoryGap={1}
        >
          <YAxis hide domain={[0, max]} />
          <XAxis dataKey="t" hide />
          <Tooltip
            cursor={{ fill: 'rgba(15,23,42,0.06)' }}
            allowEscapeViewBox={{ x: false, y: true }}
            content={({ active, payload }) => {
              const p =
                active && payload?.[0]
                  ? (payload[0].payload as { t: string; total: number; failures: number })
                  : null;
              if (!p) return null;
              return (
                <TooltipBox
                  title={fmtTooltipTime(p.t)}
                  rows={[
                    { label: 'Failures', color: COLORS.critical, value: fmtInt(p.failures) },
                    { label: 'Requests', color: 'transparent', value: fmtInt(p.total) },
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey="failures"
            fill={COLORS.critical}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { REFRESH_OPTIONS, type RefreshInterval } from '../lib/live';
import { RANGES, type Range } from '../lib/types';
import { fmtRelative } from '../lib/format';
import { Segmented, Spinner } from './ui';

const RANGE_OPTIONS = RANGES.map((r) => ({ label: r, value: r }));

export function RangeSelector({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return <Segmented label="Time range" options={RANGE_OPTIONS} value={value} onChange={onChange} />;
}

export function RefreshSelector({
  value,
  onChange,
}: {
  value: RefreshInterval;
  onChange: (v: RefreshInterval) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500">Refresh</span>
      <Segmented
        label="Auto refresh interval"
        options={REFRESH_OPTIONS}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

/** Small "Updated 5s ago" indicator for live dashboards. */
export function LastUpdated({ at, fetching }: { at: number; fetching: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  if (!at) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500" aria-live="off">
      {fetching ? (
        <Spinner className="size-3" />
      ) : (
        <span className="size-1.5 rounded-full bg-green-500" aria-hidden="true" />
      )}
      Updated {fmtRelative(new Date(at).toISOString())}
    </span>
  );
}

/** One filter row above everything it scopes: range + refresh + freshness. */
export function AnalyticsToolbar({
  range,
  onRangeChange,
  refresh,
  onRefreshChange,
  updatedAt,
  fetching,
}: {
  range: Range;
  onRangeChange: (r: Range) => void;
  refresh: RefreshInterval;
  onRefreshChange: (v: RefreshInterval) => void;
  updatedAt: number;
  fetching: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <RangeSelector value={range} onChange={onRangeChange} />
      <RefreshSelector value={refresh} onChange={onRefreshChange} />
      <LastUpdated at={updatedAt} fetching={fetching} />
    </div>
  );
}

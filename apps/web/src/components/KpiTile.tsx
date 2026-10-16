import type { ReactNode } from 'react';
import { Skeleton, cx } from './ui';

/**
 * Stat tile: label (sentence case) · value (semibold, auto-compact) · optional context.
 * Values use proportional figures; text never wears series colors.
 */
export function KpiTile({
  label,
  value,
  sub,
  loading,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'min-w-0 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xs',
        className,
      )}
    >
      <p className="truncate text-xs font-medium text-slate-500">{label}</p>
      {loading ? (
        <>
          <Skeleton className="mt-2 h-7 w-20" />
          <Skeleton className="mt-2 h-3 w-24" />
        </>
      ) : (
        <>
          <p className="mt-1 truncate text-2xl font-semibold text-slate-900">{value}</p>
          {sub && <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>}
        </>
      )}
    </div>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">{children}</div>;
}

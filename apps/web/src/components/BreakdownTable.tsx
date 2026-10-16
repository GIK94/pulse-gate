import type { ReactNode } from 'react';
import type { BreakdownItem } from '../lib/types';
import { fmtCompact, fmtInt, fmtMs, fmtPct } from '../lib/format';
import { COLORS } from './charts';
import { cx, td, th } from './ui';

/**
 * Breakdown as a table with an inline magnitude bar (single series → one color).
 * Values are always printed, so the bar is never the only way to read them.
 */
export function BreakdownTable({
  items,
  labelHeader,
  renderLabel,
  limit = 12,
}: {
  items: BreakdownItem[];
  labelHeader: string;
  renderLabel?: (item: BreakdownItem) => ReactNode;
  limit?: number;
}) {
  const sorted = [...items].sort((a, b) => b.total - a.total);
  const shown = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const max = Math.max(1, ...shown.map((i) => i.total));
  const restTotal = rest.reduce((a, i) => a + i.total, 0);
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200">
        <thead>
          <tr>
            <th className={th}>{labelHeader}</th>
            <th className={cx(th, 'w-2/5 min-w-[9rem]')}>Requests</th>
            <th className={cx(th, 'text-right')}>Error rate</th>
            <th className={cx(th, 'text-right')}>5xx</th>
            <th className={cx(th, 'text-right')}>429</th>
            <th className={cx(th, 'text-right')}>p95</th>
          </tr>
        </thead>
        <tbody className="tabular divide-y divide-slate-100">
          {shown.map((item) => (
            <tr key={item.key} className="hover:bg-slate-50">
              <td className={cx(td, 'max-w-[16rem] truncate font-medium text-slate-900')}>
                {renderLabel ? renderLabel(item) : <span title={item.label}>{item.label}</span>}
              </td>
              <td className={td}>
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 rounded-sm bg-slate-100">
                    <div
                      className="h-2 rounded-sm"
                      style={{
                        width: `${Math.max(1, (item.total / max) * 100)}%`,
                        background: COLORS.series1,
                      }}
                    />
                  </div>
                  <span className="w-12 text-right text-xs text-slate-900">
                    {fmtCompact(item.total)}
                  </span>
                </div>
              </td>
              <td className={cx(td, 'text-right')}>{fmtPct(item.errorRate)}</td>
              <td className={cx(td, 'text-right')}>{fmtInt(item.serverErrors)}</td>
              <td className={cx(td, 'text-right')}>{fmtInt(item.rateLimited)}</td>
              <td className={cx(td, 'text-right whitespace-nowrap')}>{fmtMs(item.p95)}</td>
            </tr>
          ))}
          {rest.length > 0 && (
            <tr>
              <td className={cx(td, 'text-slate-500')} colSpan={6}>
                + {rest.length} more ({fmtInt(restTotal)} requests)
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

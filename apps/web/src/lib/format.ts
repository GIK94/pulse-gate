const compactFmt = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const intFmt = new Intl.NumberFormat('en-US');

export function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return intFmt.format(Math.round(n));
}

/** 1,284 / 12.9K / 4.2M */
export function fmtCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Math.abs(n) < 10_000 ? intFmt.format(Math.round(n)) : compactFmt.format(n);
}

export function fmtPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || Number.isNaN(ratio)) return '—';
  const pct = ratio * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct.toFixed(pct === 100 || pct === 0 ? 0 : digits)}%`;
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.round(ms)} ms`;
}

export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  const s = Math.round(abs / 1000);
  let out: string;
  if (s < 45) out = `${s}s`;
  else if (s < 3600) out = `${Math.round(s / 60)}m`;
  else if (s < 86_400) out = `${Math.round(s / 3600)}h`;
  else out = `${Math.round(s / 86_400)}d`;
  return future ? `in ${out}` : `${out} ago`;
}

export function fmtWindow(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function fmtRateLimit(rl: { requests: number; windowSeconds: number } | null): string {
  if (!rl) return '—';
  return `${fmtInt(rl.requests)} req / ${fmtWindow(rl.windowSeconds)}`;
}

/** Axis tick label for a timeseries bucket, depending on range. */
export function fmtTick(iso: string, range: string): string {
  const d = new Date(iso);
  if (range === '7d') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function humanize(s: string): string {
  return s.replace(/_/g, ' ');
}

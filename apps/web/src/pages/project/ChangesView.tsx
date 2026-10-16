function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function isFromTo(v: unknown): v is { from: unknown; to: unknown } {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    'from' in v &&
    'to' in v &&
    Object.keys(v).length === 2
  );
}

/** Renders an audit `changes` JSON diff: `{field: {from, to}}` or a plain snapshot. */
export function ChangesView({ changes }: { changes: unknown }) {
  if (changes == null || typeof changes !== 'object' || Array.isArray(changes)) {
    return changes == null ? null : (
      <pre className="mt-1 text-xs whitespace-pre-wrap text-slate-600">{fmtValue(changes)}</pre>
    );
  }
  const entries = Object.entries(changes as Record<string, unknown>);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-1.5 space-y-0.5 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="flex flex-wrap gap-x-2">
          <dt className="font-mono text-slate-500">{k}</dt>
          <dd className="min-w-0 font-mono break-all text-slate-800">
            {isFromTo(v) ? (
              <>
                <span className="text-slate-500 line-through decoration-slate-300">
                  {fmtValue(v.from)}
                </span>{' '}
                → {fmtValue(v.to)}
              </>
            ) : (
              fmtValue(v)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

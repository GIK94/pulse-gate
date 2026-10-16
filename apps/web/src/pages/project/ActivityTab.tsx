import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { fmtDateTime, fmtRelative, humanize } from '../../lib/format';
import { Badge, Button, Card, CardHeader, Select, type Tone } from '../../components/ui';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/states';
import { useProject } from './ProjectLayout';
import { ChangesView } from './ChangesView';

function actionTone(action: string): Tone {
  if (/delete|revoke|remove|disable/.test(action)) return 'red';
  if (/create|add|enable/.test(action)) return 'green';
  if (/rotate/.test(action)) return 'violet';
  return 'blue';
}

export function ActivityTab() {
  const { project } = useProject();
  const pid = project.id;
  const audit = useQuery({ queryKey: qk.audit(pid), queryFn: () => api.audit(pid) });
  const [entity, setEntity] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const entityTypes = [...new Set((audit.data ?? []).map((a) => a.entityType))].sort();
  const items = (audit.data ?? []).filter((a) => !entity || a.entityType === entity);

  return (
    <Card>
      <CardHeader
        title="Activity"
        description="Audit log of configuration changes in this project. Secrets are redacted."
        actions={
          <div className="flex items-center gap-2">
            <Select
              aria-label="Filter by entity type"
              className="w-40 py-1 text-xs"
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
            >
              <option value="">All changes</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={() => void audit.refetch()} loading={audit.isFetching}>
              Refresh
            </Button>
          </div>
        }
      />
      {audit.isError ? (
        <div className="p-4">
          <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
        </div>
      ) : audit.isPending ? (
        <TableSkeleton rows={6} cols={3} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Changes to upstreams, API keys, rate limits and settings will be listed here."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((a) => {
            const open = expanded.has(a.id);
            const hasChanges =
              a.changes != null &&
              typeof a.changes === 'object' &&
              Object.keys(a.changes as object).length > 0;
            return (
              <li key={a.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Badge tone="gray">{humanize(a.entityType)}</Badge>
                  <Badge tone={actionTone(a.action)}>{humanize(a.action)}</Badge>
                  <span className="text-slate-700">{a.actorEmail ?? 'system'}</span>
                  <span className="text-xs text-slate-500" title={fmtDateTime(a.createdAt)}>
                    {fmtRelative(a.createdAt)}
                  </span>
                  {hasChanges && (
                    <button
                      type="button"
                      className="ml-auto text-xs font-medium text-blue-600 hover:text-blue-700"
                      aria-expanded={open}
                      onClick={() =>
                        setExpanded((s) => {
                          const n = new Set(s);
                          if (n.has(a.id)) n.delete(a.id);
                          else n.add(a.id);
                          return n;
                        })
                      }
                    >
                      {open ? 'Hide changes' : 'Show changes'}
                    </button>
                  )}
                </div>
                <p className="mt-0.5 font-mono text-[11px] break-all text-slate-400">
                  {a.entityId}
                </p>
                {open && <ChangesView changes={a.changes} />}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

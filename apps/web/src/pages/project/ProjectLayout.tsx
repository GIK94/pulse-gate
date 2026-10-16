import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { canManage } from '../../lib/roles';
import type { Project } from '../../lib/types';
import { Badge, Code, cx } from '../../components/ui';
import { EmptyState, ErrorState, PageSkeleton } from '../../components/states';
import { CopyButton } from '../../components/CopyButton';
import { RoleBadge } from '../../components/badges';

export interface ProjectContext {
  project: Project;
  canManage: boolean;
}

export function useProject(): ProjectContext {
  return useOutletContext<ProjectContext>();
}

const TABS = [
  { to: '', label: 'Overview', end: true },
  { to: 'requests', label: 'Requests' },
  { to: 'upstreams', label: 'Upstreams' },
  { to: 'keys', label: 'API keys' },
  { to: 'rate-limits', label: 'Rate limits' },
  { to: 'activity', label: 'Activity' },
  { to: 'settings', label: 'Settings' },
];

export function ProjectLayout() {
  const { projectId = '' } = useParams();
  const project = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.project(projectId),
  });

  if (project.isPending) return <PageSkeleton />;
  if (project.isError) {
    if (project.error instanceof ApiError && project.error.status === 404) {
      return (
        <EmptyState
          className="mt-16"
          title="Project not found"
          description="It may have been deleted, or you may not have access to it."
          action={
            <Link to="/" className="text-sm font-medium text-blue-600">
              Back to dashboard
            </Link>
          }
        />
      );
    }
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }

  const p = project.data;
  const ctx: ProjectContext = { project: p, canManage: canManage(p.role) };

  return (
    <div>
      <div className="mb-4">
        <Link
          to={`/orgs/${p.orgId}`}
          className="text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          ← Organization overview
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="truncate text-xl font-semibold text-slate-900 sm:text-2xl">{p.name}</h1>
          <Badge tone={p.status === 'active' ? 'green' : 'gray'} dot>
            {p.status}
          </Badge>
          <RoleBadge role={p.role} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span className="text-xs text-slate-500">Gateway URL</span>
          <Code className="text-xs">{p.gatewayUrl}</Code>
          <CopyButton text={p.gatewayUrl} />
        </div>
        {p.status === 'disabled' && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            This project is disabled — the gateway rejects all traffic for it.
          </p>
        )}
      </div>

      <nav
        className="-mx-4 mb-6 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0"
        aria-label="Project sections"
      >
        <ul className="flex min-w-max gap-1">
          {TABS.map((t) => (
            <li key={t.label}>
              <NavLink
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cx(
                    '-mb-px inline-block border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
                    isActive
                      ? 'border-blue-600 text-blue-700'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
                  )
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <Outlet context={ctx} />
    </div>
  );
}

export function ReadOnlyNotice() {
  return (
    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      You have the <strong>member</strong> role in this organization: configuration is read-only.
    </p>
  );
}

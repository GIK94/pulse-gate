import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { useLiveQuery, useRefreshInterval } from '../lib/live';
import { useRangeParam } from '../lib/useRange';
import { canManage } from '../lib/roles';
import { fmtRateLimit, fmtRelative } from '../lib/format';
import type { Project } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Skeleton,
} from '../components/ui';
import {
  EmptyState,
  ErrorState,
  FormError,
  PageSkeleton,
  TableSkeleton,
} from '../components/states';
import { Modal } from '../components/Modal';
import { AnalyticsToolbar } from '../components/RangeControls';
import { SummaryTiles, rangeLabel } from '../components/SummaryTiles';
import { VolumeChart } from '../components/charts';
import { BreakdownTable } from '../components/BreakdownTable';
import { RoleBadge } from '../components/badges';

export function OrgOverviewPage() {
  const { orgId = '' } = useParams();
  const [range, setRange] = useRangeParam('24h');
  const [refresh, setRefresh] = useRefreshInterval();
  const [creating, setCreating] = useState(false);

  const org = useQuery({ queryKey: qk.org(orgId), queryFn: () => api.org(orgId) });
  const projects = useQuery({ queryKey: qk.projects(orgId), queryFn: () => api.projects(orgId) });
  const summary = useLiveQuery(qk.orgSummary(orgId, range), () => api.orgSummary(orgId, range), {
    intervalMs: refresh,
  });
  const timeseries = useLiveQuery(
    qk.orgTimeseries(orgId, range),
    () => api.orgTimeseries(orgId, range),
    { intervalMs: refresh },
  );
  const breakdown = useLiveQuery(
    qk.orgBreakdown(orgId, range),
    () => api.orgBreakdown(orgId, range),
    { intervalMs: refresh },
  );

  if (org.isPending) return <PageSkeleton />;
  if (org.isError) return <ErrorState error={org.error} onRetry={() => void org.refetch()} />;

  const manage = canManage(org.data.role);
  const projectById = new Map((projects.data ?? []).map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <PageHeader
        title={org.data.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            Organization overview · your role <RoleBadge role={org.data.role} />
            <Link to={`/orgs/${orgId}/members`} className="text-blue-600 hover:text-blue-700">
              Manage members →
            </Link>
          </span>
        }
        actions={
          manage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create project
            </Button>
          )
        }
      />

      <AnalyticsToolbar
        range={range}
        onRangeChange={setRange}
        refresh={refresh}
        onRefreshChange={setRefresh}
        updatedAt={summary.dataUpdatedAt}
        fetching={summary.isFetching || timeseries.isFetching}
      />

      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <SummaryTiles summary={summary.data} loading={summary.isPending} detailed={false} />
      )}

      {timeseries.isError ? (
        <ErrorState error={timeseries.error} onRetry={() => void timeseries.refetch()} />
      ) : timeseries.isPending ? (
        <Skeleton className="h-80" />
      ) : (
        <div className={timeseries.isPlaceholderData ? 'opacity-60 transition-opacity' : ''}>
          <VolumeChart
            points={timeseries.data.points}
            range={range}
            description={`All projects, ${rangeLabel(range)} · ${timeseries.data.bucket} buckets`}
          />
        </div>
      )}

      <Card>
        <CardHeader title="Traffic by project" description={rangeLabel(range)} />
        {breakdown.isError ? (
          <div className="p-4">
            <ErrorState error={breakdown.error} onRetry={() => void breakdown.refetch()} />
          </div>
        ) : breakdown.isPending ? (
          <TableSkeleton rows={3} cols={5} />
        ) : breakdown.data.items.length === 0 ? (
          <EmptyState
            title="No traffic in this range"
            description="Requests through the gateway will appear here, grouped by project."
          />
        ) : (
          <BreakdownTable
            items={breakdown.data.items}
            labelHeader="Project"
            renderLabel={(item) => {
              const p = projectById.get(item.key);
              return p ? (
                <Link to={`/projects/${p.id}`} className="text-blue-700 hover:underline">
                  {p.name}
                </Link>
              ) : (
                item.label
              );
            }}
          />
        )}
      </Card>

      <Card>
        <CardHeader
          title="Projects"
          description="Each project gets its own gateway URL, upstreams, API keys and rate limits."
        />
        {projects.isError ? (
          <div className="p-4">
            <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
          </div>
        ) : projects.isPending ? (
          <TableSkeleton rows={3} cols={3} />
        ) : projects.data.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description={
              manage
                ? 'Create a project to get a gateway URL, then add an upstream and an API key.'
                : 'Ask an admin or owner to create a project.'
            }
            action={
              manage && (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Create project
                </Button>
              )
            }
          />
        ) : (
          <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.data.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </ul>
        )}
      </Card>

      <CreateProjectModal orgId={orgId} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ProjectCard({ project: p }: { project: Project }) {
  return (
    <li>
      <Link
        to={`/projects/${p.id}`}
        className="block h-full rounded-lg border border-slate-200 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/30"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{p.name}</p>
            <p className="truncate font-mono text-xs text-slate-500">{p.slug}</p>
          </div>
          <Badge tone={p.status === 'active' ? 'green' : 'gray'} dot>
            {p.status}
          </Badge>
        </div>
        <p className="mt-3 truncate font-mono text-xs text-slate-600" title={p.gatewayUrl}>
          {p.gatewayUrl}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>{p.upstreamCount ?? '—'} upstreams</span>
          <span>{p.keyCount ?? '—'} keys</span>
          <span>{fmtRateLimit(p.rateLimit)}</span>
          <span>updated {fmtRelative(p.updatedAt)}</span>
        </div>
      </Link>
    </li>
  );
}

function CreateProjectModal({
  orgId,
  open,
  onClose,
}: {
  orgId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [requests, setRequests] = useState('');
  const [windowSeconds, setWindowSeconds] = useState('60');
  const qc = useQueryClient();
  const navigate = useNavigate();

  const m = useMutation({
    mutationFn: () =>
      api.createProject(orgId, {
        name: name.trim(),
        slug: slug.trim() || undefined,
        rateLimit: requests
          ? { requests: Number(requests), windowSeconds: Number(windowSeconds) || 60 }
          : undefined,
      }),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: qk.projects(orgId) });
      void qc.invalidateQueries({ queryKey: qk.orgs });
      close();
      navigate(`/projects/${p.id}/upstreams`);
    },
  });

  function close() {
    setName('');
    setSlug('');
    setRequests('');
    setWindowSeconds('60');
    m.reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Create project"
      description="A project is one API behind the gateway, with its own URL, keys and limits."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="create-project-form"
            loading={m.isPending}
            disabled={!name.trim()}
          >
            Create project
          </Button>
        </>
      }
    >
      <form
        id="create-project-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) m.mutate();
        }}
      >
        <Field label="Name" htmlFor="project-name">
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            autoFocus
          />
        </Field>
        <Field
          label="Slug (optional)"
          htmlFor="project-slug"
          hint="Used in the gateway URL, e.g. /my-api. 3-48 lowercase letters, digits or dashes. Cannot be changed later; generated from the name if empty."
        >
          <Input
            id="project-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            pattern="[a-z0-9][a-z0-9\-]{1,46}[a-z0-9]"
            maxLength={48}
            placeholder="my-api"
          />
        </Field>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">
            Default rate limit per key (optional)
          </legend>
          <div className="mt-1 flex items-center gap-2 text-sm text-slate-600">
            <Input
              aria-label="Requests"
              type="number"
              min={1}
              max={1000000}
              className="w-28"
              placeholder="600"
              value={requests}
              onChange={(e) => setRequests(e.target.value)}
            />
            <span>requests per</span>
            <Input
              aria-label="Window seconds"
              type="number"
              min={1}
              max={86400}
              className="w-24"
              value={windowSeconds}
              onChange={(e) => setWindowSeconds(e.target.value)}
            />
            <span>seconds</span>
          </div>
        </fieldset>
        <FormError error={m.error} />
      </form>
    </Modal>
  );
}

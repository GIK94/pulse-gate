import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, splitFieldErrors } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { fmtDateTime, fmtMs, fmtRelative } from '../../lib/format';
import {
  HTTP_METHODS,
  type HttpMethod,
  type Upstream,
  type UpstreamAuthType,
  type UpstreamInput,
  type UpstreamTestResponse,
} from '../../lib/types';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  Field,
  Input,
  Select,
  Toggle,
} from '../../components/ui';
import { EmptyState, ErrorState, FormError, TableSkeleton } from '../../components/states';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { ReadOnlyNotice, useProject } from './ProjectLayout';
import { ChangesView } from './ChangesView';

export function UpstreamsTab() {
  const { project, canManage } = useProject();
  const pid = project.id;
  const upstreams = useQuery({ queryKey: qk.upstreams(pid), queryFn: () => api.upstreams(pid) });
  const [editing, setEditing] = useState<Upstream | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Upstream | null>(null);
  const [history, setHistory] = useState<Upstream | null>(null);
  const qc = useQueryClient();

  const del = useMutation({
    mutationFn: (u: Upstream) => api.deleteUpstream(pid, u.id),
    onSuccess: async () => {
      setDeleting(null);
      await qc.invalidateQueries({ queryKey: qk.upstreams(pid) });
      void qc.invalidateQueries({ queryKey: qk.project(pid) });
      void qc.invalidateQueries({ queryKey: qk.upstreamHealth(pid) });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl text-sm text-slate-600">
          Upstreams are the services the gateway forwards to. The gateway path prefix routes traffic
          to an upstream; the longest matching prefix wins. New upstreams start{' '}
          <strong>disabled</strong> — test the connection, then enable.
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setEditing('new')}>
            Add upstream
          </Button>
        )}
      </div>
      {!canManage && <ReadOnlyNotice />}

      {upstreams.isError ? (
        <ErrorState error={upstreams.error} onRetry={() => void upstreams.refetch()} />
      ) : upstreams.isPending ? (
        <Card>
          <TableSkeleton rows={3} cols={4} />
        </Card>
      ) : upstreams.data.length === 0 ? (
        <Card>
          <EmptyState
            title="No upstreams yet"
            description="Add your API's base URL so the gateway knows where to send traffic."
            action={
              canManage && (
                <Button variant="primary" onClick={() => setEditing('new')}>
                  Add upstream
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {[...upstreams.data]
            .sort((a, b) => b.matchPrefix.length - a.matchPrefix.length)
            .map((u) => (
              <UpstreamCard
                key={u.id}
                pid={pid}
                upstream={u}
                gatewayUrl={project.gatewayUrl}
                canManage={canManage}
                onEdit={() => setEditing(u)}
                onDelete={() => {
                  del.reset();
                  setDeleting(u);
                }}
                onHistory={() => setHistory(u)}
              />
            ))}
        </div>
      )}

      {editing && (
        <UpstreamFormModal
          pid={pid}
          upstream={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting)}
        loading={del.isPending}
        error={del.error}
        title="Delete upstream?"
        confirmLabel="Delete upstream"
        body={
          <>
            Traffic matching <Code>{deleting?.matchPrefix}</Code> will no longer be routed to{' '}
            <strong>{deleting?.name}</strong>. This cannot be undone.
          </>
        }
      />

      {history && <HistoryModal pid={pid} upstream={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function TestResultLine({
  result,
}: {
  result: UpstreamTestResponse | NonNullable<Upstream['lastTest']>;
}) {
  const at = 'testedAt' in result ? result.testedAt : result.at;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge tone={result.ok ? 'green' : 'red'} dot>
        {result.ok ? 'Reachable' : 'Failed'}
      </Badge>
      {result.status != null && <span className="text-slate-600">HTTP {result.status}</span>}
      <span className="text-slate-600">{fmtMs(result.latencyMs)}</span>
      {result.error && <span className="break-all text-red-700">{result.error}</span>}
      <span className="text-slate-400" title={fmtDateTime(at)}>
        {fmtRelative(at)}
      </span>
    </div>
  );
}

function UpstreamCard({
  pid,
  upstream: u,
  gatewayUrl,
  canManage,
  onEdit,
  onDelete,
  onHistory,
}: {
  pid: string;
  upstream: Upstream;
  gatewayUrl: string;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onHistory: () => void;
}) {
  const qc = useQueryClient();
  const [testPath, setTestPath] = useState('');
  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: qk.upstreams(pid) });
    void qc.invalidateQueries({ queryKey: qk.upstreamHealth(pid) });
  };
  const test = useMutation({
    mutationFn: () => api.testUpstream(pid, u.id, testPath.trim() || undefined),
    onSuccess: invalidate,
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.updateUpstream(pid, u.id, { enabled }),
    onSuccess: invalidate,
  });

  const lastResult = test.data ?? u.lastTest;
  const exampleUrl = `${gatewayUrl}${u.matchPrefix === '/' ? '/' : u.matchPrefix}`;

  return (
    <Card as="article" className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-slate-900">{u.name}</h3>
            <Badge tone={u.enabled ? 'green' : 'gray'} dot>
              {u.enabled ? 'enabled' : 'disabled'}
            </Badge>
          </div>
          <p className="mt-0.5 font-mono text-xs break-all text-slate-600">{u.baseUrl}</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Toggle
              label={u.enabled ? 'Disable upstream' : 'Enable upstream'}
              checked={u.enabled}
              disabled={toggle.isPending}
              onChange={(v) => toggle.mutate(v)}
            />
          )}
        </div>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-slate-500">Gateway prefix</dt>
          <dd className="mt-0.5">
            <Code>{u.matchPrefix}</Code>{' '}
            <span className="text-slate-500">
              {u.stripMatchPrefix ? '(stripped)' : '(forwarded as-is)'}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Allowed methods</dt>
          <dd className="mt-0.5 text-slate-800">
            {u.allowedMethods.length === HTTP_METHODS.length ? 'All' : u.allowedMethods.join(', ')}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Allowed paths</dt>
          <dd className="mt-0.5 font-mono break-all text-slate-800">
            {u.allowedPathPrefixes.join(', ') || '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Timeouts</dt>
          <dd className="mt-0.5 text-slate-800">
            connect {fmtMs(u.connectTimeoutMs)} · response {fmtMs(u.responseTimeoutMs)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Upstream auth</dt>
          <dd className="mt-0.5 text-slate-800">
            {u.auth.type === 'none' ? (
              'None'
            ) : (
              <>
                {u.auth.type === 'bearer' ? 'Bearer token' : `Header ${u.auth.headerName ?? ''}`}
                {u.auth.hasSecret ? (
                  <span className="ml-1 text-slate-500">(•••••• saved)</span>
                ) : (
                  <span className="ml-1 text-amber-700">(no secret set)</span>
                )}
              </>
            )}
          </dd>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <dt className="text-slate-500">Example gateway URL</dt>
          <dd className="mt-0.5 font-mono break-all text-slate-800">{exampleUrl}</dd>
        </div>
      </dl>

      <div className="mt-4 rounded-md bg-slate-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-700">Connection test</span>
          {canManage && (
            <>
              <Input
                aria-label="Test path"
                placeholder="/ (optional path)"
                className="w-40 py-1 text-xs"
                value={testPath}
                onChange={(e) => setTestPath(e.target.value)}
              />
              <Button size="sm" loading={test.isPending} onClick={() => test.mutate()}>
                Test connection
              </Button>
            </>
          )}
        </div>
        <div className="mt-2">
          {test.error ? (
            <FormError error={test.error} />
          ) : lastResult ? (
            <TestResultLine result={lastResult} />
          ) : (
            <p className="text-xs text-slate-500">Not tested yet.</p>
          )}
        </div>
        {canManage && !u.enabled && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 text-xs text-slate-600">
            <span>
              {lastResult?.ok
                ? 'Connection test passed. Enable this upstream to start routing traffic.'
                : 'This upstream is disabled and receives no traffic. Test the connection, then enable it.'}
            </span>
            <Button
              size="sm"
              variant="primary"
              loading={toggle.isPending}
              onClick={() => toggle.mutate(true)}
            >
              Enable
            </Button>
          </div>
        )}
        {toggle.error != null && (
          <div className="mt-2">
            <FormError error={toggle.error} />
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {canManage && (
          <Button size="sm" onClick={onEdit}>
            Edit
          </Button>
        )}
        <Button size="sm" onClick={onHistory}>
          History
        </Button>
        {canManage && (
          <Button size="sm" variant="dangerGhost" onClick={onDelete}>
            Delete
          </Button>
        )}
      </div>
    </Card>
  );
}

interface FormState {
  name: string;
  baseUrl: string;
  matchPrefix: string;
  stripMatchPrefix: boolean;
  allowedMethods: HttpMethod[];
  allowedPathPrefixes: string;
  connectTimeoutMs: string;
  responseTimeoutMs: string;
  authType: UpstreamAuthType;
  headerName: string;
  secret: string;
  enabled: boolean;
}

function initialForm(u: Upstream | null): FormState {
  return {
    name: u?.name ?? '',
    baseUrl: u?.baseUrl ?? '',
    matchPrefix: u?.matchPrefix ?? '/',
    stripMatchPrefix: u?.stripMatchPrefix ?? true,
    allowedMethods: u?.allowedMethods ?? [...HTTP_METHODS],
    allowedPathPrefixes: (u?.allowedPathPrefixes ?? ['/']).join('\n'),
    connectTimeoutMs: String(u?.connectTimeoutMs ?? 3000),
    responseTimeoutMs: String(u?.responseTimeoutMs ?? 15000),
    authType: u?.auth.type ?? 'none',
    headerName: u?.auth.headerName ?? '',
    secret: '',
    enabled: u?.enabled ?? false,
  };
}

function parseList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const FIELDS = [
  'name',
  'baseUrl',
  'matchPrefix',
  'stripMatchPrefix',
  'allowedMethods',
  'allowedPathPrefixes',
  'connectTimeoutMs',
  'responseTimeoutMs',
  'auth',
  'enabled',
];

function UpstreamFormModal({
  pid,
  upstream,
  onClose,
}: {
  pid: string;
  upstream: Upstream | null;
  onClose: () => void;
}) {
  const [f, setF] = useState<FormState>(() => initialForm(upstream));
  const [localError, setLocalError] = useState<string | null>(null);
  const qc = useQueryClient();
  const isEdit = !!upstream;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: UpstreamInput = {
        name: f.name.trim(),
        baseUrl: f.baseUrl.trim(),
        matchPrefix: f.matchPrefix.trim() || '/',
        stripMatchPrefix: f.stripMatchPrefix,
        allowedMethods: f.allowedMethods,
        allowedPathPrefixes: parseList(f.allowedPathPrefixes),
        connectTimeoutMs: Number(f.connectTimeoutMs),
        responseTimeoutMs: Number(f.responseTimeoutMs),
        auth: {
          type: f.authType,
          ...(f.authType === 'header' ? { headerName: f.headerName.trim() } : {}),
          // Secrets are write-only: omit when blank so the existing secret is kept.
          ...(f.authType !== 'none' && f.secret ? { secret: f.secret } : {}),
        },
      };
      if (!isEdit) body.enabled = f.enabled;
      return isEdit ? api.updateUpstream(pid, upstream.id, body) : api.createUpstream(pid, body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.upstreams(pid) });
      void qc.invalidateQueries({ queryKey: qk.project(pid) });
      void qc.invalidateQueries({ queryKey: qk.upstreamHealth(pid) });
      if (upstream) void qc.invalidateQueries({ queryKey: qk.upstreamHistory(pid, upstream.id) });
      onClose();
    },
  });

  const { byField, general } = splitFieldErrors(save.error, FIELDS);
  const authChangedToSecretType =
    f.authType !== 'none' && (!upstream || upstream.auth.type === 'none');
  const hasSavedSecret = !!upstream?.auth.hasSecret && upstream.auth.type !== 'none';

  const submit = () => {
    setLocalError(null);
    if (f.allowedMethods.length === 0) return setLocalError('Select at least one allowed method.');
    if (authChangedToSecretType && !f.secret && !hasSavedSecret)
      return setLocalError('Enter the secret for the selected upstream auth type.');
    save.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? `Edit upstream: ${upstream.name}` : 'Add upstream'}
      description={
        isEdit
          ? 'Changes are applied to the gateway within seconds and recorded in the history.'
          : 'New upstreams default to disabled so you can test before routing traffic.'
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="upstream-form" loading={save.isPending}>
            {isEdit ? 'Save changes' : 'Add upstream'}
          </Button>
        </>
      }
    >
      <form
        id="upstream-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="u-name" error={byField.name}>
            <Input
              id="u-name"
              required
              maxLength={100}
              value={f.name}
              onChange={(e) => set('name', e.target.value)}
              autoFocus
            />
          </Field>
          <Field
            label="Base URL"
            htmlFor="u-base"
            error={byField.baseUrl}
            hint="http(s) URL of your service. Private/internal addresses may be blocked (SSRF protection)."
          >
            <Input
              id="u-base"
              required
              type="url"
              maxLength={2048}
              placeholder="https://api.example.com"
              value={f.baseUrl}
              onChange={(e) => set('baseUrl', e.target.value)}
            />
          </Field>
          <Field
            label="Gateway path prefix"
            htmlFor="u-prefix"
            error={byField.matchPrefix}
            hint="Requests under this prefix go to this upstream; longest prefix wins."
          >
            <Input
              id="u-prefix"
              value={f.matchPrefix}
              placeholder="/"
              onChange={(e) => set('matchPrefix', e.target.value)}
            />
          </Field>
          <div className="flex items-end pb-1">
            <Checkbox
              label="Strip prefix before forwarding"
              description="e.g. /v1/users → /users at the upstream"
              checked={f.stripMatchPrefix}
              onChange={(v) => set('stripMatchPrefix', v)}
            />
          </div>
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Allowed methods</legend>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
            {HTTP_METHODS.map((m) => (
              <Checkbox
                key={m}
                label={<span className="font-mono text-xs">{m}</span>}
                checked={f.allowedMethods.includes(m)}
                onChange={(v) =>
                  set(
                    'allowedMethods',
                    v
                      ? HTTP_METHODS.filter((x) => x === m || f.allowedMethods.includes(x))
                      : f.allowedMethods.filter((x) => x !== m),
                  )
                }
              />
            ))}
          </div>
          {byField.allowedMethods && (
            <p className="mt-1 text-xs text-red-700">{byField.allowedMethods}</p>
          )}
        </fieldset>

        <Field
          label="Allowed upstream path prefixes"
          htmlFor="u-paths"
          error={byField.allowedPathPrefixes}
          hint="One per line, each starting with /. Requests outside these paths are rejected."
        >
          <textarea
            id="u-paths"
            rows={3}
            className="block w-full rounded-md border-0 px-2.5 py-1.5 font-mono text-sm text-slate-900 shadow-xs ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-blue-600 focus:outline-none"
            value={f.allowedPathPrefixes}
            onChange={(e) => set('allowedPathPrefixes', e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Connect timeout (ms)"
            htmlFor="u-ct"
            error={byField.connectTimeoutMs}
            hint="100 – 30,000"
          >
            <Input
              id="u-ct"
              type="number"
              min={100}
              max={30000}
              required
              value={f.connectTimeoutMs}
              onChange={(e) => set('connectTimeoutMs', e.target.value)}
            />
          </Field>
          <Field
            label="Response timeout (ms)"
            htmlFor="u-rt"
            error={byField.responseTimeoutMs}
            hint="100 – 300,000"
          >
            <Input
              id="u-rt"
              type="number"
              min={100}
              max={300000}
              required
              value={f.responseTimeoutMs}
              onChange={(e) => set('responseTimeoutMs', e.target.value)}
            />
          </Field>
        </div>

        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">
            Upstream authentication
          </legend>
          <p className="text-xs text-slate-500">
            Credential the gateway adds when calling your upstream. Encrypted at rest and never
            shown again.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="u-auth">
              <Select
                id="u-auth"
                value={f.authType}
                onChange={(e) => set('authType', e.target.value as UpstreamAuthType)}
              >
                <option value="none">None</option>
                <option value="bearer">Bearer token (Authorization header)</option>
                <option value="header">Custom header</option>
              </Select>
            </Field>
            {f.authType === 'header' && (
              <Field label="Header name" htmlFor="u-hname">
                <Input
                  id="u-hname"
                  required
                  maxLength={100}
                  placeholder="x-api-key"
                  value={f.headerName}
                  onChange={(e) => set('headerName', e.target.value)}
                />
              </Field>
            )}
            {f.authType !== 'none' && (
              <Field
                label="Secret"
                htmlFor="u-secret"
                className="sm:col-span-2"
                hint={
                  hasSavedSecret
                    ? '•••••• saved — leave blank to keep the existing secret.'
                    : 'Write-only: it will never be displayed after saving.'
                }
              >
                <Input
                  id="u-secret"
                  type="password"
                  autoComplete="new-password"
                  maxLength={4096}
                  placeholder={hasSavedSecret ? '•••••• saved — leave blank to keep' : ''}
                  value={f.secret}
                  onChange={(e) => set('secret', e.target.value)}
                />
              </Field>
            )}
          </div>
          {byField.auth && <p className="mt-2 text-xs text-red-700">{byField.auth}</p>}
        </fieldset>

        {!isEdit && (
          <Checkbox
            label="Enable immediately"
            description="Recommended: leave off, test the connection, then enable."
            checked={f.enabled}
            onChange={(v) => set('enabled', v)}
          />
        )}

        {localError && (
          <p role="alert" className="text-sm text-red-700">
            {localError}
          </p>
        )}
        <FormError error={general} />
      </form>
    </Modal>
  );
}

function HistoryModal({
  pid,
  upstream,
  onClose,
}: {
  pid: string;
  upstream: Upstream;
  onClose: () => void;
}) {
  const history = useQuery({
    queryKey: qk.upstreamHistory(pid, upstream.id),
    queryFn: () => api.upstreamHistory(pid, upstream.id),
  });
  return (
    <Modal
      open
      onClose={onClose}
      variant="drawer"
      title={`History: ${upstream.name}`}
      description="Configuration changes (secrets are redacted)."
    >
      {history.isError ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : history.isPending ? (
        <TableSkeleton rows={4} cols={2} />
      ) : history.data.length === 0 ? (
        <EmptyState title="No changes recorded" />
      ) : (
        <ol className="space-y-4">
          {history.data.map((h) => (
            <li key={h.id} className="border-l-2 border-slate-200 pl-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="blue">{h.action}</Badge>
                <span className="text-slate-700">{h.actorEmail ?? 'system'}</span>
                <span className="text-xs text-slate-500" title={fmtDateTime(h.createdAt)}>
                  {fmtRelative(h.createdAt)}
                </span>
              </div>
              <ChangesView changes={h.changes} />
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

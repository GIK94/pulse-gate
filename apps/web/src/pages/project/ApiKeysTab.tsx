import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { fmtDateTime, fmtRateLimit, fmtRelative } from '../../lib/format';
import { HTTP_METHODS, type ApiKey, type HttpMethod, type RawKeyResponse } from '../../lib/types';
import {
  Button,
  Card,
  Checkbox,
  Code,
  Field,
  Input,
  Select,
  cx,
  td,
  th,
} from '../../components/ui';
import { EmptyState, ErrorState, FormError, TableSkeleton } from '../../components/states';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { KeyStatusBadge } from '../../components/badges';
import { CopyBlock } from '../../components/CopyButton';
import { ReadOnlyNotice, useProject } from './ProjectLayout';

export function ApiKeysTab() {
  const { project, canManage } = useProject();
  const pid = project.id;
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: qk.keys(pid), queryFn: () => api.keys(pid) });
  const [form, setForm] = useState<ApiKey | 'new' | null>(null);
  const [raw, setRaw] = useState<RawKeyResponse | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [rotating, setRotating] = useState<ApiKey | null>(null);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: qk.keys(pid) });
    void qc.invalidateQueries({ queryKey: qk.project(pid) });
    void qc.invalidateQueries({ queryKey: qk.rateLimits(pid) });
  };

  const revoke = useMutation({
    mutationFn: (k: ApiKey) => api.revokeKey(pid, k.id),
    onSuccess: async () => {
      setRevoking(null);
      await invalidate();
    },
  });

  const [showInactive, setShowInactive] = useState(false);
  const all = keys.data ?? [];
  const inactiveCount = all.filter((k) => k.status !== 'active').length;
  const visible = showInactive ? all : all.filter((k) => k.status === 'active');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">
          Clients authenticate to the gateway with the <Code>X-PulseGate-Key</Code> header. Keys are
          stored hashed — the raw key is shown only once, at creation or rotation.
        </p>
        {canManage && (
          <Button variant="primary" onClick={() => setForm('new')}>
            Create API key
          </Button>
        )}
      </div>
      {!canManage && <ReadOnlyNotice />}

      <Card>
        {keys.isError ? (
          <div className="p-4">
            <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />
          </div>
        ) : keys.isPending ? (
          <TableSkeleton rows={4} cols={5} />
        ) : all.length === 0 ? (
          <EmptyState
            title="No API keys yet"
            description="Create a key to let clients call this project through the gateway."
            action={
              canManage && (
                <Button variant="primary" onClick={() => setForm('new')}>
                  Create API key
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead>
                  <tr>
                    <th className={th}>Key</th>
                    <th className={th}>Status</th>
                    <th className={cx(th, 'hidden md:table-cell')}>Policies</th>
                    <th className={cx(th, 'hidden sm:table-cell')}>Last used</th>
                    <th className={cx(th, 'hidden lg:table-cell')}>Created</th>
                    <th className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((k) => (
                    <tr key={k.id} className={k.status !== 'active' ? 'bg-slate-50/60' : ''}>
                      <td className={td}>
                        <p className="font-medium text-slate-900">{k.name}</p>
                        <p className="font-mono text-xs text-slate-500">{k.prefix}…</p>
                        {k.rotatedFromId && <p className="text-xs text-slate-400">rotated key</p>}
                      </td>
                      <td className={td}>
                        <KeyStatusBadge status={k.status} />
                        {k.expiresAt && (
                          <p
                            className="mt-1 text-xs whitespace-nowrap text-slate-500"
                            title={fmtDateTime(k.expiresAt)}
                          >
                            {k.status === 'expired' ? 'expired' : 'expires'}{' '}
                            {fmtRelative(k.expiresAt)}
                          </p>
                        )}
                      </td>
                      <td className={cx(td, 'hidden text-xs md:table-cell')}>
                        <PolicySummary k={k} />
                      </td>
                      <td className={cx(td, 'hidden text-xs whitespace-nowrap sm:table-cell')}>
                        <span title={fmtDateTime(k.lastUsedAt)}>{fmtRelative(k.lastUsedAt)}</span>
                      </td>
                      <td className={cx(td, 'hidden text-xs whitespace-nowrap lg:table-cell')}>
                        {fmtDateTime(k.createdAt)}
                      </td>
                      <td className={cx(td, 'text-right')}>
                        {canManage && k.status === 'active' && (
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setForm(k)}>
                              Edit
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRotating(k)}>
                              Rotate
                            </Button>
                            <Button
                              size="sm"
                              variant="dangerGhost"
                              onClick={() => {
                                revoke.reset();
                                setRevoking(k);
                              }}
                            >
                              Revoke
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {inactiveCount > 0 && (
              <div className="border-t border-slate-100 px-4 py-2">
                <Button size="sm" variant="ghost" onClick={() => setShowInactive((v) => !v)}>
                  {showInactive
                    ? 'Hide revoked and expired keys'
                    : `Show ${inactiveCount} revoked/expired key${inactiveCount === 1 ? '' : 's'}`}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      {form && (
        <KeyFormModal
          pid={pid}
          apiKey={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onCreated={(r) => {
            setForm(null);
            setRaw(r);
            void invalidate();
          }}
          onSaved={() => {
            setForm(null);
            void invalidate();
          }}
        />
      )}

      {rotating && (
        <RotateModal
          pid={pid}
          apiKey={rotating}
          onClose={() => setRotating(null)}
          onRotated={(r) => {
            setRotating(null);
            setRaw(r);
            void invalidate();
          }}
        />
      )}

      {raw && (
        <RawKeyModal raw={raw} gatewayUrl={project.gatewayUrl} onClose={() => setRaw(null)} />
      )}

      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && revoke.mutate(revoking)}
        loading={revoke.isPending}
        error={revoke.error}
        title="Revoke API key?"
        confirmLabel="Revoke key"
        body={
          <>
            Requests using <strong>{revoking?.name}</strong>{' '}
            <span className="font-mono text-xs">({revoking?.prefix}…)</span> will be rejected with
            401 immediately. This cannot be undone.
          </>
        }
      />
    </div>
  );
}

function PolicySummary({ k }: { k: ApiKey }) {
  return (
    <ul className="space-y-0.5 text-slate-600">
      <li>
        <span className="text-slate-400">Methods:</span>{' '}
        {k.allowedMethods ? k.allowedMethods.join(', ') : 'all'}
      </li>
      <li className="break-all">
        <span className="text-slate-400">Paths:</span>{' '}
        {k.allowedPathPrefixes ? (
          <span className="font-mono">{k.allowedPathPrefixes.join(', ')}</span>
        ) : (
          'all'
        )}
      </li>
      <li>
        <span className="text-slate-400">Rate limit:</span>{' '}
        {k.rateLimit ? fmtRateLimit(k.rateLimit) : 'project default'}
      </li>
    </ul>
  );
}

function KeyFormModal({
  pid,
  apiKey,
  onClose,
  onCreated,
  onSaved,
}: {
  pid: string;
  apiKey: ApiKey | null;
  onClose: () => void;
  onCreated: (r: RawKeyResponse) => void;
  onSaved: () => void;
}) {
  const isEdit = !!apiKey;
  const [name, setName] = useState(apiKey?.name ?? '');
  const [allMethods, setAllMethods] = useState(!apiKey?.allowedMethods);
  const [methods, setMethods] = useState<HttpMethod[]>(apiKey?.allowedMethods ?? ['GET']);
  const [paths, setPaths] = useState((apiKey?.allowedPathPrefixes ?? []).join('\n'));
  const [override, setOverride] = useState(!!apiKey?.rateLimit);
  const [requests, setRequests] = useState(String(apiKey?.rateLimit?.requests ?? 100));
  const [windowSeconds, setWindowSeconds] = useState(
    String(apiKey?.rateLimit?.windowSeconds ?? 60),
  );
  const [expiresAt, setExpiresAt] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const pathList = paths
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const body = {
        name: name.trim(),
        allowedMethods: allMethods ? null : methods,
        allowedPathPrefixes: pathList.length ? pathList : null,
        rateLimit: override
          ? { requests: Number(requests), windowSeconds: Number(windowSeconds) }
          : null,
      };
      if (isEdit) {
        await api.updateKey(pid, apiKey.id, body);
        return null;
      }
      return api.createKey(pid, {
        ...body,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
    },
    onSuccess: (r) => (r ? onCreated(r) : onSaved()),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? `Edit key: ${apiKey.name}` : 'Create API key'}
      description={
        isEdit
          ? 'Policy changes apply to the gateway within seconds. The key value does not change.'
          : 'Restrict what this key can do. Leave fields open to allow everything.'
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="key-form" loading={save.isPending}>
            {isEdit ? 'Save changes' : 'Create key'}
          </Button>
        </>
      }
    >
      <form
        id="key-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setLocalError(null);
          if (!allMethods && methods.length === 0) {
            setLocalError('Select at least one method, or allow all methods.');
            return;
          }
          save.mutate();
        }}
      >
        <Field label="Name" htmlFor="k-name" hint="e.g. the client or environment using it">
          <Input
            id="k-name"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>

        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Allowed methods</legend>
          <div className="mt-1.5 space-y-2">
            <Checkbox label="All methods" checked={allMethods} onChange={setAllMethods} />
            {!allMethods && (
              <div className="flex flex-wrap gap-x-4 gap-y-2 pl-6">
                {HTTP_METHODS.map((m) => (
                  <Checkbox
                    key={m}
                    label={<span className="font-mono text-xs">{m}</span>}
                    checked={methods.includes(m)}
                    onChange={(v) =>
                      setMethods(
                        v
                          ? HTTP_METHODS.filter((x) => x === m || methods.includes(x))
                          : methods.filter((x) => x !== m),
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </fieldset>

        <Field
          label="Allowed path prefixes"
          htmlFor="k-paths"
          hint="One per line, each starting with /. Leave empty to allow all routes."
        >
          <textarea
            id="k-paths"
            rows={3}
            placeholder="/products"
            className="block w-full rounded-md border-0 px-2.5 py-1.5 font-mono text-sm text-slate-900 shadow-xs ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-blue-600 focus:outline-none"
            value={paths}
            onChange={(e) => setPaths(e.target.value)}
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">Rate limit</legend>
          <Checkbox
            label="Override the project default for this key"
            checked={override}
            onChange={setOverride}
          />
          {override && (
            <div className="flex flex-wrap items-center gap-2 pl-6 text-sm text-slate-600">
              <Input
                aria-label="Requests"
                type="number"
                min={1}
                max={1000000}
                required
                className="w-28"
                value={requests}
                onChange={(e) => setRequests(e.target.value)}
              />
              <span>requests per</span>
              <Input
                aria-label="Window (seconds)"
                type="number"
                min={1}
                max={86400}
                required
                className="w-24"
                value={windowSeconds}
                onChange={(e) => setWindowSeconds(e.target.value)}
              />
              <span>seconds</span>
            </div>
          )}
        </fieldset>

        {!isEdit && (
          <Field label="Expires at (optional)" htmlFor="k-exp" hint="Leave empty for no expiry.">
            <Input
              id="k-exp"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </Field>
        )}

        {localError && (
          <p role="alert" className="text-sm text-red-700">
            {localError}
          </p>
        )}
        <FormError error={save.error} />
      </form>
    </Modal>
  );
}

const GRACE_PRESETS = [
  { label: 'None (revoke old key now)', value: 0 },
  { label: '5 minutes', value: 300 },
  { label: '1 hour', value: 3600 },
  { label: '24 hours', value: 86_400 },
  { label: '7 days', value: 604_800 },
];

function RotateModal({
  pid,
  apiKey,
  onClose,
  onRotated,
}: {
  pid: string;
  apiKey: ApiKey;
  onClose: () => void;
  onRotated: (r: RawKeyResponse) => void;
}) {
  const [grace, setGrace] = useState('3600');
  const rotate = useMutation({
    mutationFn: () => api.rotateKey(pid, apiKey.id, Number(grace)),
    onSuccess: onRotated,
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Rotate key: ${apiKey.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="rotate-form" loading={rotate.isPending}>
            Rotate key
          </Button>
        </>
      }
    >
      <form
        id="rotate-form"
        className="space-y-4 text-sm text-slate-600"
        onSubmit={(e) => {
          e.preventDefault();
          rotate.mutate();
        }}
      >
        <p>
          A new key with the same policies is created. The old key{' '}
          <span className="font-mono text-xs">({apiKey.prefix}…)</span> keeps working during the
          grace period, then stops.
        </p>
        <Field label="Grace period" htmlFor="grace-preset">
          <Select
            id="grace-preset"
            value={GRACE_PRESETS.some((p) => String(p.value) === grace) ? grace : 'custom'}
            onChange={(e) => e.target.value !== 'custom' && setGrace(e.target.value)}
          >
            {GRACE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </Select>
        </Field>
        <Field label="Grace period (seconds)" htmlFor="grace" hint="0 – 604,800 (7 days)">
          <Input
            id="grace"
            type="number"
            min={0}
            max={604800}
            required
            value={grace}
            onChange={(e) => setGrace(e.target.value)}
          />
        </Field>
        <FormError error={rotate.error} />
      </form>
    </Modal>
  );
}

function RawKeyModal({
  raw,
  gatewayUrl,
  onClose,
}: {
  raw: RawKeyResponse;
  gatewayUrl: string;
  onClose: () => void;
}) {
  const curl = `curl -H "X-PulseGate-Key: ${raw.key}" ${gatewayUrl}/<path>`;
  return (
    <Modal
      open
      onClose={onClose}
      dismissable={false}
      title="Copy your new API key"
      description={
        <>
          Key <strong>{raw.apiKey.name}</strong> ({raw.apiKey.prefix}…)
        </>
      }
      footer={
        <Button variant="primary" onClick={onClose}>
          I have copied the key
        </Button>
      }
    >
      <div className="space-y-4">
        <p
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <strong>This key will not be shown again.</strong> Store it in a secret manager now. If
          you lose it, rotate the key to get a new one.
        </p>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">API key</p>
          <CopyBlock text={raw.key} label="Copy key" />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Example request</p>
          <CopyBlock text={curl} label="Copy curl" />
        </div>
      </div>
    </Modal>
  );
}

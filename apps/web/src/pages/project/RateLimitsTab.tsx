import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { fmtRateLimit, humanize } from '../../lib/format';
import { HTTP_METHODS, type HttpMethod, type RateLimit, type RateLimitRule } from '../../lib/types';
import {
  Button,
  Card,
  CardHeader,
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
import { ReadOnlyNotice, useProject } from './ProjectLayout';

function LimitInputs({
  requests,
  windowSeconds,
  onRequests,
  onWindow,
  idPrefix,
}: {
  requests: string;
  windowSeconds: string;
  onRequests: (v: string) => void;
  onWindow: (v: string) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
      <Input
        id={`${idPrefix}-req`}
        aria-label="Requests"
        type="number"
        min={1}
        max={1000000}
        required
        className="w-28"
        value={requests}
        onChange={(e) => onRequests(e.target.value)}
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
        onChange={(e) => onWindow(e.target.value)}
      />
      <span>seconds</span>
    </div>
  );
}

export function RateLimitsTab() {
  const { project, canManage } = useProject();
  const pid = project.id;
  const qc = useQueryClient();
  const limits = useQuery({ queryKey: qk.rateLimits(pid), queryFn: () => api.rateLimits(pid) });
  const [ruleForm, setRuleForm] = useState<RateLimitRule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RateLimitRule | null>(null);

  const del = useMutation({
    mutationFn: (r: RateLimitRule) => api.deleteRule(pid, r.id),
    onSuccess: async () => {
      setDeleting(null);
      await qc.invalidateQueries({ queryKey: qk.rateLimits(pid) });
    },
  });

  return (
    <div className="space-y-4">
      <Card className="p-4 text-sm text-slate-600">
        <h2 className="text-sm font-semibold text-slate-900">How rate limiting works</h2>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            The <strong>project default</strong> is a per-key limit applied to every API key that
            has no override.
          </li>
          <li>
            A <strong>key override</strong> (set on the API key) replaces the project default for
            that key.
          </li>
          <li>
            <strong>Route rules</strong> are additional per-key limits for requests whose path
            matches the prefix (and method, if set). A request must pass every limit that applies.
          </li>
          <li>
            Algorithm:{' '}
            <strong>
              {limits.data
                ? humanize(limits.data.algorithm).replace(/-/g, ' ')
                : 'sliding window counter'}
            </strong>{' '}
            in Redis. Throttled requests get <Code>429</Code> with <Code>Retry-After</Code> and{' '}
            <Code>RateLimit-*</Code> headers.
          </li>
        </ul>
      </Card>
      {!canManage && <ReadOnlyNotice />}

      {limits.isError ? (
        <ErrorState error={limits.error} onRetry={() => void limits.refetch()} />
      ) : limits.isPending ? (
        <Card>
          <TableSkeleton rows={4} cols={3} />
        </Card>
      ) : (
        <>
          <DefaultLimitCard pid={pid} value={limits.data.default} canManage={canManage} />

          <Card>
            <CardHeader
              title="Route rules"
              description="Extra per-key limits for specific paths. Applied in addition to the key's limit."
              actions={
                canManage && (
                  <Button size="sm" variant="primary" onClick={() => setRuleForm('new')}>
                    Add rule
                  </Button>
                )
              }
            />
            {limits.data.rules.length === 0 ? (
              <EmptyState
                title="No route rules"
                description="Add a rule to protect expensive endpoints, e.g. POST /orders at 30 req/min."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead>
                    <tr>
                      <th className={th}>Path prefix</th>
                      <th className={th}>Method</th>
                      <th className={th}>Limit</th>
                      <th className={th}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {limits.data.rules.map((r) => (
                      <tr key={r.id}>
                        <td className={cx(td, 'font-mono text-xs break-all')}>{r.pathPrefix}</td>
                        <td className={cx(td, 'font-mono text-xs')}>{r.method ?? 'any'}</td>
                        <td className={cx(td, 'whitespace-nowrap')}>{fmtRateLimit(r)}</td>
                        <td className={cx(td, 'text-right')}>
                          {canManage && (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setRuleForm(r)}>
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="dangerGhost"
                                onClick={() => {
                                  del.reset();
                                  setDeleting(r);
                                }}
                              >
                                Delete
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Key overrides"
              description={
                <>
                  Keys with their own limit instead of the project default. Edit them on the{' '}
                  <Link to="../keys" relative="path" className="text-blue-600 hover:underline">
                    API keys
                  </Link>{' '}
                  tab.
                </>
              }
            />
            {limits.data.keyOverrides.length === 0 ? (
              <EmptyState
                title="No key overrides"
                description="All keys use the project default."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead>
                    <tr>
                      <th className={th}>Key</th>
                      <th className={th}>Limit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {limits.data.keyOverrides.map((k) => (
                      <tr key={k.id}>
                        <td className={td}>
                          <p className="font-medium text-slate-900">{k.name}</p>
                          <p className="font-mono text-xs text-slate-500">{k.prefix}…</p>
                        </td>
                        <td className={cx(td, 'whitespace-nowrap')}>{fmtRateLimit(k)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {ruleForm && (
        <RuleFormModal
          pid={pid}
          rule={ruleForm === 'new' ? null : ruleForm}
          onClose={() => setRuleForm(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting)}
        loading={del.isPending}
        error={del.error}
        title="Delete route rule?"
        confirmLabel="Delete rule"
        body={
          <>
            The limit for <Code>{deleting?.method ?? 'any method'}</Code>{' '}
            <Code>{deleting?.pathPrefix}</Code> will be removed.
          </>
        }
      />
    </div>
  );
}

function DefaultLimitCard({
  pid,
  value,
  canManage,
}: {
  pid: string;
  value: RateLimit;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [requests, setRequests] = useState(String(value.requests));
  const [windowSeconds, setWindowSeconds] = useState(String(value.windowSeconds));
  const save = useMutation({
    mutationFn: () =>
      api.setDefaultRateLimit(pid, {
        requests: Number(requests),
        windowSeconds: Number(windowSeconds),
      }),
    onSuccess: async () => {
      setEditing(false);
      await qc.invalidateQueries({ queryKey: qk.rateLimits(pid) });
      void qc.invalidateQueries({ queryKey: qk.project(pid) });
    },
  });
  return (
    <Card>
      <CardHeader
        title="Project default"
        description="Per-key limit for keys without an override."
        actions={
          canManage &&
          !editing && (
            <Button
              size="sm"
              onClick={() => {
                setRequests(String(value.requests));
                setWindowSeconds(String(value.windowSeconds));
                save.reset();
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )
        }
      />
      <div className="px-4 py-4">
        {editing ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <LimitInputs
              idPrefix="default"
              requests={requests}
              windowSeconds={windowSeconds}
              onRequests={setRequests}
              onWindow={setWindowSeconds}
            />
            <FormError error={save.error} />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" size="sm" loading={save.isPending}>
                Save
              </Button>
              <Button size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-2xl font-semibold text-slate-900">{fmtRateLimit(value)}</p>
        )}
      </div>
    </Card>
  );
}

function RuleFormModal({
  pid,
  rule,
  onClose,
}: {
  pid: string;
  rule: RateLimitRule | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [pathPrefix, setPathPrefix] = useState(rule?.pathPrefix ?? '/');
  const [method, setMethod] = useState<HttpMethod | ''>(rule?.method ?? '');
  const [requests, setRequests] = useState(String(rule?.requests ?? 60));
  const [windowSeconds, setWindowSeconds] = useState(String(rule?.windowSeconds ?? 60));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        pathPrefix: pathPrefix.trim(),
        method: method || null,
        requests: Number(requests),
        windowSeconds: Number(windowSeconds),
      };
      return rule ? api.updateRule(pid, rule.id, body) : api.createRule(pid, body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.rateLimits(pid) });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={rule ? 'Edit route rule' : 'Add route rule'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="rule-form" loading={save.isPending}>
            {rule ? 'Save' : 'Add rule'}
          </Button>
        </>
      }
    >
      <form
        id="rule-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Path prefix"
            htmlFor="rule-path"
            className="sm:col-span-2"
            hint="Gateway path, must start with /"
          >
            <Input
              id="rule-path"
              required
              maxLength={256}
              pattern="/.*"
              value={pathPrefix}
              onChange={(e) => setPathPrefix(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Method" htmlFor="rule-method">
            <Select
              id="rule-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as HttpMethod | '')}
            >
              <option value="">Any</option>
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Limit (per key)" htmlFor="rule-req">
          <LimitInputs
            idPrefix="rule"
            requests={requests}
            windowSeconds={windowSeconds}
            onRequests={setRequests}
            onWindow={setWindowSeconds}
          />
        </Field>
        <FormError error={save.error} />
      </form>
    </Modal>
  );
}

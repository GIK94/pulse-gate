import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { fmtDateTime } from '../../lib/format';
import type { Project } from '../../lib/types';
import { Button, Card, CardHeader, Code, Field, Input, Toggle } from '../../components/ui';
import { FormError } from '../../components/states';
import { ConfirmDialog } from '../../components/Modal';
import { CopyButton } from '../../components/CopyButton';
import { ReadOnlyNotice, useProject } from './ProjectLayout';

export function SettingsTab() {
  const { project, canManage } = useProject();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(project.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const onUpdated = async (p: Project) => {
    qc.setQueryData(qk.project(project.id), (old: Project | undefined) => ({ ...old, ...p }));
    await qc.invalidateQueries({ queryKey: qk.project(project.id) });
    void qc.invalidateQueries({ queryKey: qk.projects(project.orgId) });
  };

  const rename = useMutation({
    mutationFn: () => api.updateProject(project.id, { name: name.trim() }),
    onSuccess: onUpdated,
  });
  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'disabled') => api.updateProject(project.id, { status }),
    onSuccess: onUpdated,
  });
  const del = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: async () => {
      setConfirmDelete(false);
      qc.removeQueries({ queryKey: ['project', project.id] });
      await qc.invalidateQueries({ queryKey: qk.projects(project.orgId) });
      navigate(`/orgs/${project.orgId}`, { replace: true });
    },
  });

  return (
    <div className="max-w-3xl space-y-4">
      {!canManage && <ReadOnlyNotice />}

      <Card>
        <CardHeader title="General" />
        <div className="space-y-4 p-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              rename.mutate();
            }}
          >
            <Field label="Project name" htmlFor="p-name" className="min-w-0 flex-1 basis-60">
              <Input
                id="p-name"
                value={name}
                required
                maxLength={100}
                disabled={!canManage}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            {canManage && (
              <Button
                type="submit"
                variant="primary"
                loading={rename.isPending}
                disabled={!name.trim() || name.trim() === project.name}
              >
                Save
              </Button>
            )}
          </form>
          <FormError error={rename.error} />
          {rename.isSuccess && name.trim() === project.name && (
            <p className="text-sm text-green-700" role="status">
              Saved.
            </p>
          )}

          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Slug (immutable)</dt>
              <dd className="mt-1">
                <Code>{project.slug}</Code>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Config version</dt>
              <dd className="mt-1 text-slate-900">{project.configVersion}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Gateway URL</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <Code>{project.gatewayUrl}</Code>
                <CopyButton text={project.gatewayUrl} />
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Created</dt>
              <dd className="mt-1 text-slate-900">{fmtDateTime(project.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Updated</dt>
              <dd className="mt-1 text-slate-900">{fmtDateTime(project.updatedAt)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Status"
          description="A disabled project rejects all gateway traffic; configuration is kept."
        />
        <div className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <Toggle
            label={project.status === 'active' ? 'Disable project' : 'Enable project'}
            checked={project.status === 'active'}
            disabled={!canManage || setStatus.isPending}
            onChange={(v) => setStatus.mutate(v ? 'active' : 'disabled')}
          />
          <span className="text-slate-700">
            Project is <strong>{project.status === 'active' ? 'active' : 'disabled'}</strong>
          </span>
        </div>
        {setStatus.error != null && (
          <div className="px-4 pb-4">
            <FormError error={setStatus.error} />
          </div>
        )}
      </Card>

      {canManage && (
        <Card className="border-red-200">
          <CardHeader
            title="Danger zone"
            description="Deleting a project removes its configuration: upstreams, API keys and rate limits."
          />
          <div className="p-4">
            <Button
              variant="danger"
              onClick={() => {
                del.reset();
                setConfirmDelete(true);
              }}
            >
              Delete project
            </Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => del.mutate()}
        loading={del.isPending}
        error={del.error}
        title="Delete project?"
        confirmLabel="Delete project"
        confirmText={project.slug}
        body={
          <>
            This permanently deletes <strong>{project.name}</strong>. Clients calling{' '}
            <Code>{project.gatewayUrl}</Code> will start receiving errors.
          </>
        }
      />
    </div>
  );
}

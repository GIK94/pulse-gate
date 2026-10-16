import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ME_KEY, useAuth } from '../lib/auth';
import { lastOrg } from '../components/AppShell';
import { Button, Card, Field, Input } from '../components/ui';
import { FormError } from '../components/states';

/** Sends the user to their last-used (or first) organization, or offers to create one. */
export function HomeRedirect() {
  const { me } = useAuth();
  const orgs = me?.organizations ?? [];
  const remembered = lastOrg();
  const target = orgs.find((o) => o.id === remembered) ?? orgs[0];
  if (target) return <Navigate to={`/orgs/${target.id}`} replace />;
  return <CreateFirstOrg />;
}

function CreateFirstOrg() {
  const [name, setName] = useState('');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const m = useMutation({
    mutationFn: () => api.createOrg(name.trim()),
    onSuccess: async (org) => {
      await qc.refetchQueries({ queryKey: ME_KEY });
      navigate(`/orgs/${org.id}`, { replace: true });
    },
  });
  return (
    <Card className="mx-auto mt-10 max-w-md p-6">
      <h1 className="text-lg font-semibold text-slate-900">Create your first organization</h1>
      <p className="mt-1 text-sm text-slate-500">
        Organizations group projects and members. You are not a member of any organization yet.
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Organization name" htmlFor="first-org">
          <Input
            id="first-org"
            value={name}
            required
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <FormError error={m.error} />
        <Button type="submit" variant="primary" loading={m.isPending} disabled={!name.trim()}>
          Create organization
        </Button>
      </form>
    </Card>
  );
}

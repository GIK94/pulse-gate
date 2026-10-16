import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ME_KEY, useAuth } from '../lib/auth';
import { qk } from '../lib/queryKeys';
import { canManage, isOwner } from '../lib/roles';
import { fmtDateTime } from '../lib/format';
import type { Member, Role } from '../lib/types';
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Select,
  cx,
  td,
  th,
} from '../components/ui';
import {
  EmptyState,
  ErrorState,
  FormError,
  PageSkeleton,
  TableSkeleton,
} from '../components/states';
import { ConfirmDialog } from '../components/Modal';
import { RoleBadge } from '../components/badges';

const ROLES: Role[] = ['member', 'admin', 'owner'];

export function OrgMembersPage() {
  const { orgId = '' } = useParams();
  const { me } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const org = useQuery({ queryKey: qk.org(orgId), queryFn: () => api.org(orgId) });
  const members = useQuery({ queryKey: qk.members(orgId), queryFn: () => api.members(orgId) });
  const [removing, setRemoving] = useState<Member | null>(null);

  const remove = useMutation({
    mutationFn: (m: Member) => api.removeMember(orgId, m.userId),
    onSuccess: async (_d, m) => {
      setRemoving(null);
      if (m.userId === me?.user.id) {
        await qc.refetchQueries({ queryKey: ME_KEY });
        navigate('/', { replace: true });
        return;
      }
      await qc.invalidateQueries({ queryKey: qk.members(orgId) });
    },
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      api.updateMember(orgId, userId, role),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.members(orgId) });
      void qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });

  if (org.isPending) return <PageSkeleton />;
  if (org.isError) return <ErrorState error={org.error} onRetry={() => void org.refetch()} />;

  const myRole = org.data.role;
  const manage = canManage(myRole);
  const owner = isOwner(myRole);

  const canRemove = (m: Member) => {
    if (m.userId === me?.user.id) return true; // leaving
    if (!manage) return false;
    return owner || m.role === 'member';
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description={
          <>
            <Link to={`/orgs/${orgId}`} className="text-blue-600 hover:text-blue-700">
              {org.data.name}
            </Link>{' '}
            · Owners manage roles; admins can add and remove members.
          </>
        }
      />

      {manage && <AddMemberForm orgId={orgId} owner={owner} />}

      <Card>
        <CardHeader title="Organization members" />
        {members.isError ? (
          <div className="p-4">
            <ErrorState error={members.error} onRetry={() => void members.refetch()} />
          </div>
        ) : members.isPending ? (
          <TableSkeleton rows={3} cols={4} />
        ) : members.data.length === 0 ? (
          <EmptyState title="No members" />
        ) : (
          <>
            {changeRole.error != null && (
              <div className="px-4 pt-3">
                <FormError error={changeRole.error} />
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead>
                  <tr>
                    <th className={th}>Member</th>
                    <th className={th}>Role</th>
                    <th className={cx(th, 'hidden sm:table-cell')}>Joined</th>
                    <th className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {members.data.map((m) => (
                    <tr key={m.userId}>
                      <td className={td}>
                        <p className="font-medium text-slate-900">
                          {m.name}
                          {m.userId === me?.user.id && (
                            <span className="ml-1 text-xs font-normal text-slate-500">(you)</span>
                          )}
                        </p>
                        <p className="text-xs break-all text-slate-500">{m.email}</p>
                      </td>
                      <td className={td}>
                        {owner ? (
                          <Select
                            aria-label={`Role for ${m.email}`}
                            className="w-28"
                            value={m.role}
                            disabled={changeRole.isPending}
                            onChange={(e) =>
                              changeRole.mutate({ userId: m.userId, role: e.target.value as Role })
                            }
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <RoleBadge role={m.role} />
                        )}
                      </td>
                      <td className={cx(td, 'hidden whitespace-nowrap sm:table-cell')}>
                        {fmtDateTime(m.joinedAt)}
                      </td>
                      <td className={cx(td, 'text-right')}>
                        {canRemove(m) && (
                          <Button
                            size="sm"
                            variant="dangerGhost"
                            onClick={() => {
                              remove.reset();
                              setRemoving(m);
                            }}
                          >
                            {m.userId === me?.user.id ? 'Leave' : 'Remove'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        loading={remove.isPending}
        error={remove.error}
        title={removing?.userId === me?.user.id ? 'Leave organization?' : 'Remove member?'}
        confirmLabel={removing?.userId === me?.user.id ? 'Leave' : 'Remove'}
        body={
          removing?.userId === me?.user.id ? (
            <>You will lose access to {org.data.name} and its projects.</>
          ) : (
            <>
              <strong>{removing?.email}</strong> will lose access to {org.data.name} and all of its
              projects.
            </>
          )
        }
      />
    </div>
  );
}

function AddMemberForm({ orgId, owner }: { orgId: string; owner: boolean }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: () => api.addMember(orgId, { email: email.trim(), role }),
    onSuccess: async () => {
      setEmail('');
      setRole('member');
      await qc.invalidateQueries({ queryKey: qk.members(orgId) });
    },
  });
  const roles: Role[] = owner ? ROLES : ['member'];
  return (
    <Card>
      <CardHeader
        title="Add member"
        description="The person must already have a PulseGate account."
      />
      <form
        className="flex flex-wrap items-end gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Email" htmlFor="member-email" className="min-w-0 flex-1 basis-60">
          <Input
            id="member-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
          />
        </Field>
        <Field label="Role" htmlFor="member-role" className="w-32">
          <Select
            id="member-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={!owner}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="primary" loading={add.isPending}>
          Add member
        </Button>
        {add.error != null && (
          <div className="basis-full">
            <FormError error={add.error} />
          </div>
        )}
        {add.isSuccess && (
          <p className="basis-full text-sm text-green-700" role="status">
            Member added.
          </p>
        )}
      </form>
    </Card>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth, ME_KEY } from '../lib/auth';
import { qk } from '../lib/queryKeys';
import { Button, Field, Input, Select, cx } from './ui';
import { Modal } from './Modal';
import { FormError } from './states';
import { RoleBadge } from './badges';

const LAST_ORG_KEY = 'pulsegate.lastOrg';

export function rememberOrg(orgId: string) {
  try {
    localStorage.setItem(LAST_ORG_KEY, orgId);
  } catch {
    // ignore
  }
}

export function lastOrg(): string | null {
  try {
    return localStorage.getItem(LAST_ORG_KEY);
  } catch {
    return null;
  }
}

/** Resolves the org currently in context from the URL (org page or project page). */
function useCurrentOrgId(): string | null {
  const orgMatch = useMatch('/orgs/:orgId/*');
  const projectMatch = useMatch('/projects/:projectId/*');
  const projectId = projectMatch?.params.projectId;
  const project = useQuery({
    queryKey: qk.project(projectId ?? ''),
    queryFn: () => api.project(projectId!),
    enabled: !!projectId,
  });
  return orgMatch?.params.orgId ?? project.data?.orgId ?? null;
}

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#2a78d6" />
        <path
          d="M5 17h6l3-7 4 13 3-6h6"
          fill="none"
          stroke="#fff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>PulseGate</span>
    </Link>
  );
}

function NavItem({ to, children, end }: { to: string; children: ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          'flex items-center gap-2 truncate rounded-md px-2.5 py-1.5 text-sm',
          isActive
            ? 'bg-blue-50 font-medium text-blue-700'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        )
      }
    >
      {children}
    </NavLink>
  );
}

function CreateOrgModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const m = useMutation({
    mutationFn: () => api.createOrg(name.trim()),
    onSuccess: async (org) => {
      await qc.invalidateQueries({ queryKey: ME_KEY });
      await qc.invalidateQueries({ queryKey: qk.orgs });
      setName('');
      onClose();
      navigate(`/orgs/${org.id}`);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New organization"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="create-org-form"
            loading={m.isPending}
            disabled={!name.trim()}
          >
            Create
          </Button>
        </>
      }
    >
      <form
        id="create-org-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) m.mutate();
        }}
      >
        <Field label="Name" htmlFor="org-name">
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            autoFocus
          />
        </Field>
        <FormError error={m.error} />
      </form>
    </Modal>
  );
}

function SidebarContent({ orgId, onNavigate }: { orgId: string | null; onNavigate?: () => void }) {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [creatingOrg, setCreatingOrg] = useState(false);
  const orgs = me?.organizations ?? [];
  const currentOrg = orgs.find((o) => o.id === orgId) ?? null;
  const projects = useQuery({
    queryKey: qk.projects(orgId ?? ''),
    queryFn: () => api.projects(orgId!),
    enabled: !!orgId,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 px-3 pt-4">
        <div className="hidden px-1 lg:block">
          <Logo />
        </div>
        <div>
          <label
            htmlFor="org-switcher"
            className="mb-1 block px-1 text-xs font-medium text-slate-500"
          >
            Organization
          </label>
          <Select
            id="org-switcher"
            value={orgId ?? ''}
            onChange={(e) => {
              if (e.target.value === '__new') {
                setCreatingOrg(true);
                return;
              }
              rememberOrg(e.target.value);
              navigate(`/orgs/${e.target.value}`);
              onNavigate?.();
            }}
          >
            {!orgId && <option value="">Select…</option>}
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
            <option value="__new">+ New organization…</option>
          </Select>
          {currentOrg && (
            <div className="mt-1.5 px-1 text-xs text-slate-500">
              Your role: <RoleBadge role={currentOrg.role} />
            </div>
          )}
        </div>
      </div>

      <nav className="mt-4 flex-1 space-y-5 overflow-y-auto px-3 pb-4" onClick={onNavigate}>
        {orgId && (
          <div className="space-y-0.5">
            <NavItem to={`/orgs/${orgId}`} end>
              Overview
            </NavItem>
            <NavItem to={`/orgs/${orgId}/members`}>Members</NavItem>
          </div>
        )}
        {orgId && (
          <div>
            <p className="mb-1 px-2.5 text-xs font-medium tracking-wide text-slate-400 uppercase">
              Projects
            </p>
            <div className="space-y-0.5">
              {projects.isPending && <p className="px-2.5 py-1 text-xs text-slate-400">Loading…</p>}
              {projects.isError && (
                <p className="px-2.5 py-1 text-xs text-red-600">Could not load projects</p>
              )}
              {projects.data?.map((p) => (
                <NavItem key={p.id} to={`/projects/${p.id}`}>
                  <span
                    className={cx(
                      'size-1.5 shrink-0 rounded-full',
                      p.status === 'active' ? 'bg-green-500' : 'bg-slate-300',
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{p.name}</span>
                </NavItem>
              ))}
              {projects.data?.length === 0 && (
                <p className="px-2.5 py-1 text-xs text-slate-400">No projects yet</p>
              )}
            </div>
          </div>
        )}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700 uppercase">
            {(me?.user.name || me?.user.email || '?').slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{me?.user.name}</p>
            <p className="truncate text-xs text-slate-500">{me?.user.email}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void logout()}>
            Log out
          </Button>
        </div>
      </div>
      <CreateOrgModal open={creatingOrg} onClose={() => setCreatingOrg(false)} />
    </div>
  );
}

export function AppShell() {
  const orgId = useCurrentOrgId();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (orgId) rememberOrg(orgId);
  }, [orgId]);

  // Close the mobile drawer on navigation (state adjusted during render, not in an effect).
  const [drawerPath, setDrawerPath] = useState(location.pathname);
  if (drawerPath !== location.pathname) {
    setDrawerPath(location.pathname);
    setDrawerOpen(false);
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:fixed lg:inset-y-0 lg:block">
        <SidebarContent orgId={orgId} />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden">
        <Logo />
        <button
          type="button"
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <svg
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <Logo />
              <button
                type="button"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Close navigation"
                onClick={() => setDrawerOpen(false)}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <SidebarContent orgId={orgId} />
            </div>
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

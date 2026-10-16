import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { ErrorState } from './components/states';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { HomeRedirect } from './pages/HomeRedirect';
import { OrgOverviewPage } from './pages/OrgOverviewPage';
import { OrgMembersPage } from './pages/OrgMembersPage';
import { ProjectLayout } from './pages/project/ProjectLayout';
import { OverviewTab } from './pages/project/OverviewTab';
import { RequestsTab } from './pages/project/RequestsTab';
import { UpstreamsTab } from './pages/project/UpstreamsTab';
import { ApiKeysTab } from './pages/project/ApiKeysTab';
import { RateLimitsTab } from './pages/project/RateLimitsTab';
import { ActivityTab } from './pages/project/ActivityTab';
import { SettingsTab } from './pages/project/SettingsTab';
import { NotFoundPage } from './pages/NotFoundPage';

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500">
      <Spinner className="size-6" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading, error, refresh } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (error && !me) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState
          error={error}
          onRetry={() => void refresh()}
          title="Could not reach PulseGate"
        />
      </div>
    );
  }
  if (!me) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (me) {
    const from = (location.state as { from?: string } | null)?.from;
    return (
      <Navigate to={from && from.startsWith('/') && !from.startsWith('//') ? from : '/'} replace />
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnly>
            <RegisterPage />
          </PublicOnly>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<HomeRedirect />} />
        <Route path="orgs/:orgId" element={<OrgOverviewPage />} />
        <Route path="orgs/:orgId/members" element={<OrgMembersPage />} />
        <Route path="projects/:projectId" element={<ProjectLayout />}>
          <Route index element={<OverviewTab />} />
          <Route path="requests" element={<RequestsTab />} />
          <Route path="upstreams" element={<UpstreamsTab />} />
          <Route path="keys" element={<ApiKeysTab />} />
          <Route path="rate-limits" element={<RateLimitsTab />} />
          <Route path="activity" element={<ActivityTab />} />
          <Route path="settings" element={<SettingsTab />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

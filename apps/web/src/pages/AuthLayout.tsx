import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { Logo } from '../components/AppShell';

export function useMeta() {
  return useQuery({ queryKey: qk.meta, queryFn: api.meta, staleTime: 5 * 60_000 });
}

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const meta = useMeta();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {meta.data?.environment === 'development' && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-center text-xs text-blue-900">
            Local demo: <span className="font-mono">demo@pulsegate.local</span> /{' '}
            <span className="font-mono">pulsegate-demo-123</span>
          </div>
        )}
        {footer && <div className="mt-4 text-center text-sm text-slate-600">{footer}</div>}
      </div>
    </div>
  );
}

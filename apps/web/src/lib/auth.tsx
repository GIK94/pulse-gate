import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, onUnauthorized, setCsrfToken, ApiError } from './api';
import type { MeResponse } from './types';

interface AuthContextValue {
  me: MeResponse | null;
  loading: boolean;
  error: unknown;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const ME_KEY = ['auth', 'me'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const meQuery = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        const me = await api.me();
        setCsrfToken(me.csrfToken);
        return me;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Global 401 handling: any API call that returns 401 sends the user to /login.
  useEffect(() => {
    onUnauthorized(() => {
      qc.setQueryData(ME_KEY, null);
      const path = window.location.pathname;
      if (path !== '/login' && path !== '/register') {
        qc.removeQueries({
          predicate: (q) => q.queryKey[0] !== 'auth' && q.queryKey[0] !== 'meta',
        });
        navigate('/login', { replace: true, state: { from: path + window.location.search } });
      }
    });
    return () => onUnauthorized(null);
  }, [qc, navigate]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setCsrfToken(null);
      qc.clear();
      qc.setQueryData(ME_KEY, null);
      navigate('/login', { replace: true });
    }
  }, [qc, navigate]);

  const value = useMemo<AuthContextValue>(
    () => ({
      me: meQuery.data ?? null,
      loading: meQuery.isPending,
      error: meQuery.error,
      refresh: () => meQuery.refetch(),
      logout,
    }),
    [meQuery, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

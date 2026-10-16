import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, type QueryKey } from '@tanstack/react-query';

/**
 * Live data for dashboards.
 *
 * This module is the ONLY place that decides how dashboard data is kept fresh.
 * Today it polls via react-query's `refetchInterval`, paused while the document is
 * hidden. It can later be swapped for Server-Sent Events (e.g. an EventSource that
 * calls `queryClient.setQueryData` / `invalidateQueries` on each message) without
 * touching any page: pages only call `useLiveQuery` and render a `RefreshSelector`.
 */

export const REFRESH_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '5s', value: 5_000 },
  { label: '15s', value: 15_000 },
  { label: '60s', value: 60_000 },
] as const;

export type RefreshInterval = (typeof REFRESH_OPTIONS)[number]['value'];

export const DEFAULT_REFRESH: RefreshInterval = 15_000;

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

export interface LiveQueryOptions {
  /** Polling interval in ms; 0 disables live refresh. */
  intervalMs: number;
  enabled?: boolean;
}

export function useLiveQuery<T>(
  key: QueryKey,
  fetcher: () => Promise<T>,
  { intervalMs, enabled = true }: LiveQueryOptions,
) {
  const visible = useDocumentVisible();
  return useQuery({
    queryKey: key,
    queryFn: fetcher,
    enabled,
    refetchInterval: intervalMs > 0 && visible ? intervalMs : false,
    refetchIntervalInBackground: false,
    // Keep the previous render while a new range/filter loads: no skeleton flash.
    placeholderData: keepPreviousData,
  });
}

/** Shared state hook for the refresh selector, persisted per browser for convenience. */
export function useRefreshInterval(): [RefreshInterval, (v: RefreshInterval) => void] {
  const [value, setValue] = useState<RefreshInterval>(() => {
    try {
      const raw = localStorage.getItem('pulsegate.refresh');
      if (raw === null) return DEFAULT_REFRESH;
      const match = REFRESH_OPTIONS.find((o) => o.value === Number(raw));
      return match ? match.value : DEFAULT_REFRESH;
    } catch {
      return DEFAULT_REFRESH;
    }
  });
  const update = (v: RefreshInterval) => {
    setValue(v);
    try {
      localStorage.setItem('pulsegate.refresh', String(v));
    } catch {
      // storage unavailable; keep in memory only
    }
  };
  return [value, update];
}

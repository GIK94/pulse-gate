import type { ReactNode } from 'react';
import { ApiError, errorMessage } from '../lib/api';
import { Button, Skeleton, cx } from './ui';

/** Full error panel: API message(s), request id (if any) and a retry button. */
export function ErrorState({
  error,
  onRetry,
  title = 'Could not load data',
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  const apiErr = error instanceof ApiError ? error : null;
  const messages =
    apiErr && apiErr.status !== 429 && apiErr.messages.length > 1
      ? apiErr.messages
      : [errorMessage(error)];
  return (
    <div
      role="alert"
      className={cx('rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-red-900">
            {title}
            {apiErr && apiErr.status > 0 && (
              <span className="ml-1 font-normal text-red-700">(HTTP {apiErr.status})</span>
            )}
          </p>
          <ul className="mt-1 list-inside text-red-800">
            {messages.map((m, i) => (
              <li key={i} className="break-words">
                {m}
              </li>
            ))}
          </ul>
          {apiErr?.requestId && (
            <p className="mt-1 font-mono text-xs break-all text-red-700">
              Request ID: {apiErr.requestId}
            </p>
          )}
        </div>
        {onRetry && (
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

/** Compact inline form error, used inside forms and modals. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const apiErr = error instanceof ApiError ? error : null;
  const messages =
    apiErr && apiErr.status !== 429 && apiErr.messages.length > 0
      ? apiErr.messages
      : [errorMessage(error)];
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {messages.length === 1 ? (
        <p className="break-words">{messages[0]}</p>
      ) : (
        <ul className="list-inside list-disc">
          {messages.map((m, i) => (
            <li key={i} className="break-words">
              {m}
            </li>
          ))}
        </ul>
      )}
      {apiErr?.requestId && (
        <p className="mt-1 font-mono text-[11px] break-all text-red-700">
          Request ID: {apiErr.requestId}
        </p>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center px-4 py-10 text-center text-sm',
        className,
      )}
    >
      {icon && <div className="mb-3 text-slate-400">{icon}</div>}
      <p className="font-medium text-slate-900">{title}</p>
      {description && <div className="mt-1 max-w-md text-slate-500">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cx('h-4', c === 0 ? 'w-1/3' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

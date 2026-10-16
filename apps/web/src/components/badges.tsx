import type { ApiKeyStatus, HealthStatus } from '../lib/types';
import { humanize } from '../lib/format';
import { Badge, type Tone } from './ui';

const healthTone: Record<HealthStatus, Tone> = {
  healthy: 'green',
  degraded: 'yellow',
  down: 'red',
  unknown: 'gray',
  disabled: 'gray',
};

export function HealthBadge({ status }: { status: HealthStatus }) {
  return (
    <Badge tone={healthTone[status]} dot>
      {status[0].toUpperCase() + status.slice(1)}
    </Badge>
  );
}

const keyTone: Record<ApiKeyStatus, Tone> = { active: 'green', revoked: 'red', expired: 'gray' };

export function KeyStatusBadge({ status }: { status: ApiKeyStatus }) {
  return (
    <Badge tone={keyTone[status]} dot>
      {status}
    </Badge>
  );
}

export function statusTone(status: number): Tone {
  if (status === 429) return 'orange';
  if (status >= 500) return 'red';
  if (status >= 400) return 'yellow';
  if (status >= 300) return 'blue';
  if (status >= 200) return 'green';
  return 'gray';
}

export function StatusBadge({ status }: { status: number }) {
  return (
    <Badge tone={statusTone(status)} className="tabular font-mono">
      {status}
    </Badge>
  );
}

export function outcomeTone(outcome: string): Tone {
  if (outcome === 'ok') return 'green';
  if (outcome === 'rate_limited') return 'orange';
  if (outcome.startsWith('upstream_') || outcome === 'unavailable') return 'red';
  if (outcome === 'client_aborted') return 'gray';
  return 'yellow';
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  return <Badge tone={outcomeTone(outcome)}>{humanize(outcome)}</Badge>;
}

export function MethodBadge({ method }: { method: string }) {
  return (
    <span className="inline-block min-w-[3.5rem] rounded bg-slate-100 px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold text-slate-700">
      {method}
    </span>
  );
}

export function RoleBadge({ role }: { role: string }) {
  const tone: Tone = role === 'owner' ? 'violet' : role === 'admin' ? 'blue' : 'gray';
  return <Badge tone={tone}>{role}</Badge>;
}

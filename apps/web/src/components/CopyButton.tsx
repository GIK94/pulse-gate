import { useEffect, useState } from 'react';
import { Button } from './ui';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  text,
  label = 'Copy',
  size = 'sm',
  variant = 'secondary',
}: {
  text: string;
  label?: string;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary';
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <Button
      size={size}
      variant={variant}
      onClick={async () => setState((await copyText(text)) ? 'copied' : 'failed')}
      aria-live="polite"
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </Button>
  );
}

/** A monospace block with a copy button. */
export function CopyBlock({ text, label }: { text: string; label?: string }) {
  return (
    <div className="relative rounded-md bg-slate-900 text-slate-100">
      <pre className="overflow-x-auto px-3 py-2.5 pr-20 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
        {text}
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <CopyButton text={text} label={label ?? 'Copy'} />
      </div>
    </div>
  );
}

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'dangerGhost';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-blue-600 shadow-sm',
  secondary:
    'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-blue-600 shadow-sm',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600 shadow-sm',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-blue-600',
  dangerGhost: 'text-red-600 hover:bg-red-50 hover:text-red-700 focus-visible:outline-red-600',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, disabled, className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        buttonVariants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cx('animate-spin', className ?? 'size-4')}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Card({
  className,
  children,
  as: Tag = 'section',
}: {
  className?: string;
  children: ReactNode;
  as?: 'section' | 'div' | 'article';
}) {
  return (
    <Tag className={cx('rounded-lg border border-slate-200 bg-white shadow-xs', className)}>
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {actions && (
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {description && <div className="mt-1 text-sm text-slate-500">{description}</div>}
      </div>
      {actions && (
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export type Tone = 'gray' | 'green' | 'yellow' | 'orange' | 'red' | 'blue' | 'violet';

const toneClasses: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  green: 'bg-green-50 text-green-800 ring-green-600/20',
  yellow: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  orange: 'bg-orange-50 text-orange-800 ring-orange-600/25',
  red: 'bg-red-50 text-red-800 ring-red-600/20',
  blue: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  violet: 'bg-violet-50 text-violet-800 ring-violet-600/20',
};

export function Badge({
  tone = 'gray',
  children,
  className,
  dot,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        toneClasses[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error ? (
        <p className="mt-1 text-xs text-red-700">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

const inputBase =
  'block rounded-md border-0 bg-white px-2.5 text-slate-900 shadow-xs ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500';

/** Applies default width/padding/size only when the caller does not override them. */
function inputClass(className?: string, extra?: string): string {
  const c = className ?? '';
  return cx(
    inputBase,
    !/(^|\s)w-/.test(c) && 'w-full',
    !/(^|\s)py-/.test(c) && 'py-1.5',
    !/(^|\s)text-(xs|sm|base)/.test(c) && 'text-sm',
    extra,
    className,
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={inputClass(className)} {...rest} />;
  },
);

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={inputClass(className, 'pr-8')} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  description,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  description?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        className="mt-0.5 size-4 rounded border-slate-300 accent-blue-600"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-blue-600' : 'bg-slate-300',
      )}
    >
      <span
        className={cx(
          'pointer-events-none inline-block size-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4.5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded bg-slate-200/70', className)} />;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: {
  options: readonly { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full overflow-x-auto rounded-md bg-slate-100 p-0.5 ring-1 ring-slate-200 ring-inset"
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded px-2.5 font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-blue-600',
            size === 'sm' ? 'py-0.5 text-xs' : 'py-1 text-xs sm:text-sm',
            o.value === value
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code
      className={cx(
        'rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.8em] break-all text-slate-800',
        className,
      )}
    >
      {children}
    </code>
  );
}

export const th =
  'px-3 py-2 text-left text-xs font-medium tracking-wide whitespace-nowrap text-slate-500 uppercase';
export const td = 'px-3 py-2 text-sm text-slate-700 align-top';

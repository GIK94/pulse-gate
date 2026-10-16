import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input, cx } from './ui';
import { FormError } from './states';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  variant = 'dialog',
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** `drawer` slides in from the right (full screen on mobile). */
  variant?: 'dialog' | 'drawer';
  /** When false, Escape/backdrop clicks do not close (e.g. show-once secrets). */
  dismissable?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const prevFocus = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open, dismissable]);

  if (!open) return null;

  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div
        className="fixed inset-0 bg-slate-900/40"
        aria-hidden="true"
        onClick={() => dismissable && onClose()}
      />
      <div
        className={cx(
          'relative flex w-full',
          variant === 'drawer'
            ? 'justify-end'
            : 'items-end justify-center p-0 sm:items-center sm:p-4',
        )}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={cx(
            'relative flex w-full flex-col bg-white shadow-xl focus:outline-none',
            variant === 'drawer'
              ? cx('h-full', size === 'xl' ? 'sm:max-w-3xl' : 'sm:max-w-xl')
              : cx('max-h-[92vh] rounded-t-xl sm:rounded-xl', widths[size]),
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-slate-900">
                {title}
              </h2>
              {description && <div className="mt-1 text-sm text-slate-500">{description}</div>}
            </div>
            {dismissable && (
              <button
                type="button"
                onClick={onClose}
                className="-m-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden="true">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation dialog. Pass `confirmText` to require typing a value (e.g. a slug). */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Confirm',
  danger = true,
  loading,
  error,
  confirmText,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  error?: unknown;
  confirmText?: string;
  children?: ReactNode;
}) {
  const [typed, setTyped] = useState('');
  const inputId = useId();
  const blocked = confirmText != null && typed !== confirmText;
  const close = () => {
    setTyped('');
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={close} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
            disabled={blocked}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3 text-sm text-slate-600"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked && !loading) onConfirm();
        }}
      >
        <div>{body}</div>
        {children}
        {confirmText != null && (
          <div>
            <label htmlFor={inputId} className="block text-sm text-slate-700">
              Type <span className="font-mono font-semibold">{confirmText}</span> to confirm
            </label>
            <Input
              id={inputId}
              className="mt-1"
              value={typed}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        )}
        <FormError error={error} />
      </form>
    </Modal>
  );
}

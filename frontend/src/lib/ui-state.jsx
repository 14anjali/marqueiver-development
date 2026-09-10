import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast as toastVariants, withReducedMotion, usePrefersReducedMotion } from './motion';

/**
 * Async screen states and toasts.
 *
 * Every export here keeps the signature it had — `useToast().push(msg, type)`,
 * `<LoadingBlock label>`, `<ErrorBlock error onRetry>`, `<EmptyBlock title sub
 * action>`, `<Spinner className>` — because 27 files call them. What changed is
 * what they look like and what they announce; no page needed editing.
 */

const ToastCtx = createContext(null);

const TOAST_MS = 4500;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const reduced = usePrefersReducedMotion();

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [
      // Three at a time. A stack that grows without limit covers the page it is
      // reporting on, and nobody reads the fourth toast anyway.
      ...t.slice(-2),
      { id, msg, type },
    ]);
    timers.current.set(id, setTimeout(() => dismiss(id), TOAST_MS));
    return id;
  }, [dismiss]);

  // Any toast still pending when the provider unmounts would otherwise fire
  // setState on a dead component.
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  return (
    <ToastCtx.Provider value={{ push, dismiss }}>
      {children}
      {/*
        `aria-live="polite"` rather than assertive: a toast is a confirmation,
        not an interruption. Errors are already surfaced inline where the action
        happened, so the toast is the second telling, not the only one.
      */}
      <div
        className="fixed bottom-6 right-4 left-4 sm:left-auto z-[60] flex flex-col items-stretch sm:items-end gap-2 pointer-events-none"
        role="status"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              variants={withReducedMotion(toastVariants, reduced)}
              initial="hidden" animate="visible" exit="exit"
              className="pointer-events-auto"
            >
              <ToastRow toast={t} onDismiss={() => dismiss(t.id)} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/**
 * One toast.
 *
 * Icon plus colour rather than colour alone — roughly one in twelve men cannot
 * reliably separate the red from the green, and "it went wrong" is not
 * something to encode in hue only.
 */
function ToastRow({ toast: t, onDismiss }) {
  const tone = {
    error: { cls: 'border-rose-200 text-rose-700', bg: 'bg-rose-50', icon: '!' },
    success: { cls: 'border-jade-100 text-jade-700', bg: 'bg-jade-50', icon: '✓' },
    money: { cls: 'border-money-100 text-money-700', bg: 'bg-money-50', icon: '₹' },
    info: { cls: 'border-line text-ink', bg: 'bg-white', icon: 'i' },
  }[t.type] ?? { cls: 'border-line text-ink', bg: 'bg-white', icon: 'i' };

  return (
    <div className={`surface-over ${tone.cls} flex items-start gap-3 pl-3 pr-2 py-2.5 min-w-[260px] sm:max-w-sm`}>
      <span className={`${tone.bg} w-5 h-5 rounded-full grid place-items-center text-[11px] font-bold shrink-0 mt-px`}>
        {tone.icon}
      </span>
      <span className="text-sm font-medium leading-snug flex-1">{t.msg}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="focusable text-muted hover:text-ink w-6 h-6 grid place-items-center shrink-0 transition-colors"
      >
        <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  return ctx || { push: () => {}, dismiss: () => {} };
}

/* ─────────────────────────── async screen states ──────────────────────────── */

export function Spinner({ className = 'w-5 h-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The default loading state.
 *
 * Kept as a spinner rather than switched to skeletons wholesale: this is called
 * from 27 places whose layouts differ, and a card skeleton in a page that is
 * about to render a table is a worse lie than a spinner. Pages that know their
 * own shape should use `SkeletonList` / `SkeletonCard` from components/feedback
 * instead — that is the upgrade path, page by page.
 */
export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-20 text-muted gap-3"
      role="status"
      aria-live="polite"
    >
      <Spinner className="w-7 h-7 text-brand-600" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/**
 * A failure the user can act on.
 *
 * The message comes from the server where there is one — a generic "something
 * went wrong" in front of a real explanation is how a fixable problem becomes a
 * support ticket.
 */
export function ErrorBlock({ error, onRetry }) {
  const offline = error?.status === 0;

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3" role="alert">
      <span className="w-12 h-12 rounded-full bg-rose-50 text-rose-500 grid place-items-center" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </span>
      <p className="text-sm text-ink font-medium max-w-sm">
        {error?.message || 'Something went wrong'}
      </p>
      {offline && (
        <p className="text-xs text-muted max-w-sm">
          We couldn’t reach the server. Check your connection and try again.
        </p>
      )}
      {onRetry && <button onClick={onRetry} className="btn-outline mt-1">Try again</button>}
    </div>
  );
}

/**
 * Nothing here — yet.
 *
 * An empty state should say what to do next, not just report absence. The
 * `action` slot is where that lives, and pages that pass nothing get a state
 * that at least explains itself.
 */
export function EmptyBlock({ title = 'Nothing here yet', sub, action, icon }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <span
        className="w-14 h-14 rounded-2xl wash text-brand-400 grid place-items-center"
        aria-hidden="true"
      >
        {icon ?? (
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.75">
            <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
            <path d="M3.5 10h17" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        {sub && <p className="text-xs text-muted max-w-sm mt-1 leading-relaxed">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

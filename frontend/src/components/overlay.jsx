import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { dialog, scrim, drawerRight, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * Modals and drawers.
 *
 * These exist because the product needed them and had none: irreversible
 * actions — funding escrow, declining additional terms, rejecting a campaign —
 * were confirmed with `window.confirm` or with nothing at all. A browser
 * confirm cannot show what is being agreed to, cannot be styled, and cannot
 * carry the amount.
 *
 * Both surfaces share the same three obligations, which is why they share a
 * file rather than being written twice:
 *
 *   1. **Focus goes in and comes back.** Opening moves focus into the panel;
 *      closing returns it to whatever opened it. Without that, a keyboard user
 *      is dropped at the top of the document every time a dialog closes.
 *   2. **Tab stays inside.** A dialog you can tab out of, into a page you
 *      cannot see, is worse than no dialog.
 *   3. **Escape closes, and the scrim closes.** Unless the caller says
 *      otherwise — a half-finished payment should not vanish on a stray key.
 */

/** Everything focusable, in document order, excluding anything disabled. */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Trap Tab within `ref`, restore focus on unmount, and close on Escape.
 *
 * Shared by both surfaces below. Kept as a hook rather than a wrapper component
 * so the panel markup stays legible.
 */
function useDialogBehaviour(ref, { open, onClose, dismissible }) {
  const returnTo = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    returnTo.current = document.activeElement;

    // Move focus in. Prefer whatever the panel marks as the first stop, so a
    // confirm dialog can put focus on Cancel rather than the destructive button.
    const panel = ref.current;
    const first = panel?.querySelector('[data-autofocus]')
      ?? panel?.querySelector(FOCUSABLE)
      ?? panel;
    first?.focus?.({ preventScroll: true });

    // The page behind must not scroll under the dialog.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = [...(panel?.querySelectorAll(FOCUSABLE) ?? [])];
      if (!items.length) return;

      const firstItem = items[0];
      const lastItem = items[items.length - 1];

      // Wrap at both ends, so Tab and Shift+Tab both stay inside.
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      // Give focus back to whatever opened this.
      returnTo.current?.focus?.({ preventScroll: true });
    };
  }, [open, onClose, dismissible, ref]);
}

/**
 * A centred dialog.
 *
 * `dismissible: false` for anything mid-flight — a payment handoff, a submitted
 * form — where a stray Escape would lose work or leave the user unsure whether
 * something happened.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
}) {
  const panelRef = useRef(null);
  const reduced = usePrefersReducedMotion();
  useDialogBehaviour(panelRef, { open, onClose, dismissible });

  const onScrimClick = useCallback((e) => {
    // Only a click that both started and ended on the scrim closes — a drag
    // that begins inside the panel and releases outside must not.
    if (e.target === e.currentTarget && dismissible) onClose?.();
  }, [onClose, dismissible]);

  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size] ?? 'max-w-lg';

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="scrim flex items-end sm:items-center justify-center p-0 sm:p-6"
          variants={withReducedMotion(scrim, reduced)}
          initial="hidden" animate="visible" exit="exit"
          onMouseDown={onScrimClick}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            tabIndex={-1}
            variants={withReducedMotion(dialog, reduced)}
            initial="hidden" animate="visible" exit="exit"
            className={`w-full ${width} card-lifted p-6 sm:p-7 rounded-t-xl3 sm:rounded-xl3
                        max-h-[92vh] overflow-y-auto focus:outline-none`}
          >
            {title && <h2 className="font-display font-extrabold text-xl text-ink">{title}</h2>}
            {description && <p className="text-sm text-muted mt-1.5 leading-relaxed">{description}</p>}
            {/*
              Only rendered when there is something to render. An always-present
              wrapper carrying `mt-5` puts a 20px gap above the footer of every
              dialog that has no body — which is most confirmations.
            */}
            {children && (
              <div className={title || description ? 'mt-5' : ''}>{children}</div>
            )}
            {footer && <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * A right-hand drawer, for detail that belongs beside the list rather than
 * replacing it — an applicant's profile while comparing applicants, a deal's
 * timeline while reading the thread.
 *
 * Full width below `sm`, because a 420px panel on a 375px screen is a modal
 * wearing a costume.
 */
export function Drawer({ open, onClose, title, children, footer, dismissible = true }) {
  const panelRef = useRef(null);
  const reduced = usePrefersReducedMotion();
  useDialogBehaviour(panelRef, { open, onClose, dismissible });

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="scrim flex justify-end"
          variants={withReducedMotion(scrim, reduced)}
          initial="hidden" animate="visible" exit="exit"
          onMouseDown={(e) => { if (e.target === e.currentTarget && dismissible) onClose?.(); }}
        >
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            tabIndex={-1}
            variants={withReducedMotion(drawerRight, reduced)}
            initial="hidden" animate="visible" exit="exit"
            className="w-full sm:w-[440px] h-full bg-white border-l border-line shadow-lifted
                       flex flex-col focus:outline-none"
          >
            <header className="px-5 py-4 border-b border-line flex items-center justify-between gap-3 shrink-0">
              <h2 className="font-display font-bold text-ink">{title}</h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="focusable w-8 h-8 grid place-items-center text-muted hover:text-ink hover:bg-bg transition-colors"
              >
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-5">{children}</div>
            {footer && <footer className="px-5 py-4 border-t border-line shrink-0">{footer}</footer>}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * Confirm before something irreversible.
 *
 * `tone="danger"` for anything that destroys or refuses; `tone="money"` for
 * anything that moves rupees, so funding escrow never looks like an ordinary
 * submit. Focus lands on Cancel, not on the action — a dialog that opens with
 * the destructive button focused turns a stray Enter into a mistake.
 */
export function ConfirmDialog({
  open, onClose, onConfirm, title, description,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  tone = 'brand', busy = false, children,
}) {
  const confirmClass = {
    brand: 'btn-brand',
    danger: 'btn bg-rose-500 text-white hover:bg-rose-600',
    money: 'btn-money',
  }[tone] ?? 'btn-brand';

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title={title}
      description={description}
      size="sm"
      dismissible={!busy}
      footer={(
        <>
          <button data-autofocus onClick={onClose} disabled={busy} className="btn-ghost">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} disabled={busy} className={confirmClass}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      )}
    >
      {/*
        Optional extra input — a reason, a checkbox to acknowledge something.
        Some confirmations need one piece of information alongside the yes/no,
        and forcing those into a separate bespoke Modal is how two dialogs that
        should look identical stop looking identical.
      */}
      {children}
    </Modal>
  );
}

import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { Spinner, useToast } from '../../lib/ui-state';
import { rupee } from '../../lib/normalize';
import { X, Lock, ShieldCheck } from '../icons';

/**
 * Cancellation — Policy 7.1, 7.2 and especially Policy 28:
 * "Never make the user confirm a cancellation without showing the applicable
 * consequence first."
 *
 * The dialog therefore loads a server-computed preview before it will let the
 * user proceed, and the confirm button stays disabled until that preview has
 * arrived. The amounts are never computed here — the stage decides them and
 * the server owns the rule.
 *
 * The second gate is deliberate friction: an irreversible settlement gets a
 * typed confirmation, not just a click, because the money moves immediately.
 */
export default function CancellationDialog({ deal, role, onClose, onCancelled }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let live = true;
    api.previewCancellation(deal._id)
      .then(({ data }) => { if (live) setPreview(data); })
      .catch((e) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [deal._id]);

  // Escape closes, focus is trapped to the dialog by the browser's inert-like
  // behaviour of the overlay. Keyboard users must be able to back out.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const settles = preview?.escrowFunded && (preview?.creatorReceives > 0 || preview?.brandRefund > 0);
  const ready = preview?.allowed && (!settles || confirmText.trim().toUpperCase() === 'CANCEL');

  async function confirm() {
    setBusy(true);
    try {
      const { data } = await api.cancelDeal(deal._id, reason);
      toast.push('Collaboration cancelled', 'success');
      onCancelled?.(data);
      onClose();
    } catch (e) {
      toast.push(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-5
                 bg-ink/40 backdrop-blur-sm animate-[fadein_.18s_ease-out]"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-title"
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-xl3 sm:rounded-xl3 shadow-lifted
                      max-h-[92vh] overflow-y-auto animate-[sheetin_.24s_cubic-bezier(.2,.7,.3,1)]">
        <div className="flex items-start justify-between gap-4 p-6 pb-4">
          <div>
            <h2 id="cancel-title" className="h-display text-display-sm">Cancel this collaboration?</h2>
            <p className="text-sm text-muted mt-1">{deal.title}</p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close"
            className="p-2 -m-2 text-muted hover:text-ink rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6">
          {loading ? (
            /* Skeleton rather than a spinner: the shape tells the user a
               financial breakdown is coming. */
            <div className="space-y-3" aria-busy="true" aria-label="Calculating outcome">
              <div className="h-4 w-2/3 bg-bg rounded animate-pulse" />
              <div className="h-24 bg-bg rounded-xl2 animate-pulse" />
              <div className="h-4 w-1/2 bg-bg rounded animate-pulse" />
            </div>
          ) : error ? (
            <div className="rounded-xl2 border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {error}
            </div>
          ) : !preview.allowed ? (
            /* Policy 7.2 — cancellation is simply unavailable at some stages. */
            <div className="rounded-xl2 border border-line bg-bg p-5">
              <span className="inline-flex w-10 h-10 rounded-full bg-white border border-line items-center justify-center mb-3">
                <Lock className="w-5 h-5 text-muted" />
              </span>
              <h3 className="font-display font-bold text-ink">Cancellation isn&apos;t available</h3>
              <p className="text-sm text-muted mt-1.5 leading-relaxed">{preview.reason}</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-ink-soft leading-relaxed">{preview.summary}</p>

              {preview.escrowFunded ? (
                <div className="wash mt-5 p-5">
                  <div className="text-xs font-semibold text-brand-700 mb-4">What happens to the money</div>

                  <Line label="Agreed value" value={rupee(preview.agreedValue)} />
                  <div className="h-px bg-brand-100 my-3" />

                  <Line
                    label={role === 'brand' ? 'Creator receives' : 'You receive'}
                    value={rupee(preview.creatorReceives)}
                    emphasis={preview.creatorReceives > 0}
                  />
                  {preview.commission > 0 && (
                    <Line
                      label={`Platform commission (${preview.commissionPct}%)`}
                      value={`− ${rupee(preview.commission)}`}
                      muted
                    />
                  )}
                  <Line
                    label={role === 'brand' ? 'Refunded to you' : 'Refunded to the Brand'}
                    value={rupee(preview.brandRefund)}
                    emphasis={preview.brandRefund > 0}
                  />
                </div>
              ) : (
                <div className="rounded-xl2 border border-line bg-bg mt-5 p-4 flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-jade-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-ink-soft">No payment has been made yet, so nothing will be charged or refunded.</p>
                </div>
              )}

              <label className="block mt-5">
                <span className="field-label">Reason <span className="text-muted font-normal">(optional, shared with the other party)</span></span>
                <textarea
                  rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                  className="field" placeholder="Why are you cancelling?"
                />
              </label>

              {settles && (
                /* Money moves the instant this is confirmed, so the action gets
                   deliberate friction rather than a single click. */
                <label className="block mt-4">
                  <span className="field-label">Type <strong>CANCEL</strong> to confirm</span>
                  <input
                    value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                    className="field tracking-widest font-semibold" placeholder="CANCEL"
                    autoComplete="off"
                  />
                  <span className="block text-xs text-muted mt-1.5">
                    This settles the escrow immediately and cannot be undone.
                  </span>
                </label>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-line bg-bg/60 sticky bottom-0">
          <button onClick={onClose} disabled={busy} className="btn-ghost flex-1">
            {preview?.allowed ? 'Keep collaboration' : 'Close'}
          </button>
          {preview?.allowed && (
            <button
              onClick={confirm}
              disabled={!ready || busy}
              className="btn flex-1 text-white bg-rose-600 hover:bg-rose-700
                         focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
            >
              {busy ? <Spinner className="w-4 h-4" /> : 'Cancel collaboration'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Line({ label, value, emphasis, muted }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className={`text-sm ${muted ? 'text-muted' : 'text-ink-soft'}`}>{label}</span>
      <span className={emphasis ? 'money text-lg' : `tnum text-sm ${muted ? 'text-muted' : 'text-ink'}`}>
        {value}
      </span>
    </div>
  );
}

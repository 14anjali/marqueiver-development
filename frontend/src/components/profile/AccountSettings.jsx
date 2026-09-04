import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { Spinner, useToast } from '../../lib/ui-state';
import { useAuth } from '../../lib/auth';
import { Check, X, ShieldCheck, Lock } from '../icons';

/**
 * Account settings — Policy 3.3 (profile visibility) and account deletion.
 *
 * Deletion is deactivation with anonymisation rather than a hard delete,
 * because Policy 24 requires money, escrow, payout and dispute records to be
 * retained. The dialog says so explicitly instead of implying the data
 * vanishes — a promise the platform cannot legally keep.
 */
export default function AccountSettings({ profile, isCreator, onProfileChange }) {
  const [published, setPublished] = useState(profile?.isPublished !== false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const toast = useToast();

  async function toggleVisibility(next) {
    setSavingVisibility(true);
    const previous = published;
    setPublished(next); // optimistic — reverted below if the call fails
    try {
      const { data } = await api.setProfileVisibility(next);
      setPublished(data.isPublished);
      onProfileChange?.({ ...profile, isPublished: data.isPublished });
      toast.push(next ? 'Your profile is visible in discovery' : 'Your profile is hidden from discovery', 'success');
    } catch (e) {
      setPublished(previous);
      toast.push(e.message, 'error');
    } finally { setSavingVisibility(false); }
  }

  return (
    <div className="space-y-5">
      {isCreator && (
        <section className="card p-6">
          <h3 className="font-display font-bold text-ink">Profile visibility</h3>
          <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-prose">
            Unpublishing removes you from brand discovery. Your profile, portfolio and any
            collaborations already under way are unaffected, and you can publish again at any time.
          </p>

          <div className="mt-5 flex items-center justify-between gap-4 rounded-xl2 border border-line bg-bg p-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors
                                ${published ? 'bg-jade-50 text-jade-600' : 'bg-white border border-line text-muted'}`}>
                {published ? <Check className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink">
                  {published ? 'Visible in discovery' : 'Hidden from discovery'}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {published ? 'Brands can find and invite you' : 'Brands cannot find you in search'}
                </div>
              </div>
            </div>

            <button
              role="switch"
              aria-checked={published}
              aria-label="Profile visible in discovery"
              disabled={savingVisibility}
              onClick={() => toggleVisibility(!published)}
              className={`relative w-12 h-7 rounded-full shrink-0 transition-colors disabled:opacity-60
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
                          ${published ? 'bg-brand-600' : 'bg-line'}`}
            >
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-flat transition-all
                                ${published ? 'left-6' : 'left-1'}`} />
            </button>
          </div>
        </section>
      )}

      <section className="card p-6 border-rose-200">
        <h3 className="font-display font-bold text-ink">Delete account</h3>
        <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-prose">
          Permanently closes your Marqueiver account. You will be signed out and will not be able to
          sign in again with these details.
        </p>
        <button
          onClick={() => setConfirmingDelete(true)}
          className="btn-ghost mt-5 text-rose-600 border-rose-200 hover:bg-rose-50"
        >
          Delete my account
        </button>
      </section>

      {confirmingDelete && (
        <DeleteAccountDialog onClose={() => setConfirmingDelete(false)} />
      )}
    </div>
  );
}

function DeleteAccountDialog({ onClose }) {
  const [confirmText, setConfirmText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocking, setBlocking] = useState(null);
  const { logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  async function remove() {
    setBusy(true);
    setBlocking(null);
    try {
      await api.deleteAccount(reason);
      // Session must not survive deletion.
      logout();
      nav('/', { replace: true });
      toast.push('Your account has been deleted', 'success');
    } catch (e) {
      // The backend refuses while money is at stake and names the deals.
      if (e.detail?.collaborations) setBlocking(e.detail.collaborations);
      else toast.push(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-5
                    bg-ink/50 backdrop-blur-sm animate-[fadein_.18s_ease-out]"
         onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
         role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <div className="w-full sm:max-w-lg bg-white rounded-t-xl3 sm:rounded-xl3 shadow-lifted
                      max-h-[92vh] overflow-y-auto animate-[sheetin_.24s_cubic-bezier(.2,.7,.3,1)]">
        <div className="flex items-start justify-between gap-4 p-6 pb-4">
          <h2 id="delete-title" className="h-display text-display-sm">Delete your account?</h2>
          <button onClick={onClose} disabled={busy} aria-label="Close"
            className="p-2 -m-2 text-muted hover:text-ink rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6">
          {blocking ? (
            <div className="rounded-xl2 border border-money-100 bg-money-50 p-5">
              <h3 className="font-display font-bold text-ink text-sm">Finish these first</h3>
              <p className="text-sm text-money-700 mt-1.5 leading-relaxed">
                You have collaborations in progress. They must be completed, cancelled or resolved
                before your account can be deleted — otherwise the other party is left with a deal
                against a closed account.
              </p>
              <ul className="mt-4 space-y-2">
                {blocking.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink truncate">{c.title}</span>
                    <span className="pill-quiet shrink-0">{c.state.replace('_', ' ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <ul className="space-y-3">
                {[
                  'Your profile is removed from discovery immediately.',
                  'You will be signed out and cannot sign in again with these details.',
                  'Any wallet balance must be withdrawn before deleting — it cannot be recovered afterwards.',
                ].map((line) => (
                  <li key={line} className="flex gap-3 text-sm text-ink-soft">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0 mt-2" />
                    <span className="leading-relaxed">{line}</span>
                  </li>
                ))}
              </ul>

              {/* Honest about retention rather than promising erasure the
                  platform is not permitted to perform (Policy 24). */}
              <div className="mt-5 rounded-xl2 border border-line bg-bg p-4 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-muted shrink-0 mt-0.5" />
                <p className="text-sm text-muted leading-relaxed">
                  Records of payments, escrow, payouts and disputes are kept in anonymised form, because
                  Marqueiver is required to retain them. Your personal details are removed.
                </p>
              </div>

              <label className="block mt-5">
                <span className="field-label">Reason <span className="text-muted font-normal">(optional)</span></span>
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                  className="field" placeholder="Anything we could have done better?" />
              </label>

              <label className="block mt-4">
                <span className="field-label">Type <strong>DELETE</strong> to confirm</span>
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                  className="field tracking-widest font-semibold" placeholder="DELETE" autoComplete="off" />
              </label>
            </>
          )}
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-line bg-bg/60">
          <button onClick={onClose} disabled={busy} className="btn-ghost flex-1">
            {blocking ? 'Close' : 'Keep my account'}
          </button>
          {!blocking && (
            <button
              onClick={remove}
              disabled={busy || confirmText.trim().toUpperCase() !== 'DELETE'}
              className="btn flex-1 text-white bg-rose-600 hover:bg-rose-700
                         focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
            >
              {busy ? <Spinner className="w-4 h-4" /> : 'Delete account'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import AdminPage from '../../components/AdminPage';
import { ConfirmDialog } from '../../components/overlay';
import { ShieldCheck, Lock } from '../../components/icons';
import { api } from '../../lib/api';
import { Spinner, useToast } from '../../lib/ui-state';
import { useAuth } from '../../lib/auth';

/**
 * Inviting another admin.
 *
 * The levels are picked from cards rather than a `<select>`, because the
 * difference between them is what each one can do to money and to accounts —
 * and a dropdown shows one line of that at a time, only while it is open.
 *
 * Granting `super` is confirmed separately. It is the only level that can
 * invite further admins, so it is the one that can hand the platform to someone
 * else; a mis-click in a dropdown should not be able to do that.
 */

const LEVELS = [
  {
    id: 'support',
    name: 'Support',
    blurb: 'Moderate reviews, suspend accounts, work the verification queue.',
    can: 'Cannot move money.',
  },
  {
    id: 'finance',
    name: 'Finance',
    blurb: 'Resolve disputes, release and refund escrow, export ledgers.',
    can: 'Can move money.',
  },
  {
    id: 'super',
    name: 'Super',
    blurb: 'Everything above, plus inviting and approving other admins.',
    can: 'Can grant this level to others.',
  },
];

export default function AdminTeam() {
  const { user } = useAuth();
  const [phone, setPhone] = useState('');
  const [level, setLevel] = useState('support');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();
  const isSuper = user?.adminLevel === 'super';

  // Validated before the request so the error appears under the field rather
  // than as a toast over an otherwise unchanged form.
  const trimmed = phone.trim();
  const phoneValid = /^\+?[0-9\s-]{8,20}$/.test(trimmed);
  const showPhoneError = trimmed.length > 0 && !phoneValid;

  async function invite() {
    setBusy(true);
    try {
      await api.adminInviteTeam(trimmed, level);
      toast.push(`Invited as ${level}`, 'success');
      setPhone('');
      setLevel('support');
      setConfirming(false);
    } catch (e) { toast.push(e.message, 'error'); }
    finally { setBusy(false); }
  }

  function submit() {
    if (!phoneValid) return;
    if (level === 'super') { setConfirming(true); return; }
    invite();
  }

  return (
    <>
      <AdminPage
        title="Team"
        description="Invite another admin and choose what they can reach. Levels can only be changed by a super admin."
        loading={false}
        error={null}
        isEmpty={false}
        width="max-w-[640px]"
      >
        {!isSuper ? (
          <div className="card p-6 flex items-start gap-3.5">
            <span className="w-10 h-10 rounded-xl2 wash text-brand-500 grid place-items-center shrink-0">
              <Lock className="w-4.5 h-4.5" />
            </span>
            <div>
              <p className="font-semibold text-ink text-sm">Super admins only</p>
              <p className="text-sm text-muted mt-1 leading-relaxed">
                Your account is <span className="font-medium text-ink">{user?.adminLevel ?? 'admin'}</span>.
                Ask a super admin to invite someone, or to raise your level.
              </p>
            </div>
          </div>
        ) : (
          <form
            className="card p-5 sm:p-6"
            onSubmit={(e) => { e.preventDefault(); submit(); }}
          >
            <div className="mb-5">
              <label htmlFor="admin-phone" className="field-label">Phone number</label>
              <input
                id="admin-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 90000 00000"
                inputMode="tel"
                autoComplete="tel"
                aria-invalid={showPhoneError}
                aria-describedby={showPhoneError ? 'admin-phone-error' : 'admin-phone-hint'}
                className={`field ${showPhoneError ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : ''}`}
              />
              {showPhoneError ? (
                <p id="admin-phone-error" className="text-xs text-rose-600 mt-1.5">
                  That does not look like a phone number. Include the country code.
                </p>
              ) : (
                <p id="admin-phone-hint" className="text-xs text-muted mt-1.5">
                  They sign in with this number — it must be one they can receive WhatsApp on.
                </p>
              )}
            </div>

            <fieldset className="mb-6">
              <legend className="field-label mb-2">Permission level</legend>
              <div className="grid gap-2.5">
                {LEVELS.map((l) => {
                  const selected = level === l.id;
                  return (
                    <label
                      key={l.id}
                      className={`flex gap-3 p-3.5 rounded-xl2 border cursor-pointer transition-all duration-200
                        ${selected
                          ? 'border-brand-300 bg-brand-50/60 shadow-flat'
                          : 'border-line hover:border-brand-200 hover:bg-bg'}`}
                    >
                      <input
                        type="radio"
                        name="adminLevel"
                        value={l.id}
                        checked={selected}
                        onChange={() => setLevel(l.id)}
                        className="mt-1 accent-brand-600 focusable"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-sm text-ink">{l.name}</span>
                          {l.id === 'super' && (
                            <span className="pill-warn">
                              <ShieldCheck className="w-3 h-3" /> Full access
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-muted mt-1 leading-relaxed">{l.blurb}</span>
                        <span className={`block text-xs mt-1 font-medium ${l.id === 'support' ? 'text-muted' : 'text-money-700'}`}>
                          {l.can}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <button type="submit" disabled={busy || !phoneValid} className="btn-cta w-full">
              {busy ? <><Spinner className="w-4 h-4" /> Sending…</> : 'Send invite'}
            </button>
          </form>
        )}
      </AdminPage>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={invite}
        busy={busy}
        tone="danger"
        title="Grant super admin?"
        description={`${trimmed} will be able to release and refund escrow, resolve disputes, suspend any account, and invite further admins — including other super admins.`}
        confirmLabel="Grant super admin"
      />
    </>
  );
}

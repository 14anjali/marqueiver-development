import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { useToast } from '../../../lib/ui-state';
import { Money, Skeleton } from '../../feedback';
import { Wallet, Check } from '../../icons';
import { SectionCard, SaveButton, Field, PrivateNotice } from '../shared';

/**
 * Where payouts go.
 *
 * The existing backend is unchanged: `POST /api/wallet/payout-method` with
 * `{ type, accountHolderName, bankAccount, ifsc }` or `{ type, accountHolderName, vpa }`,
 * which is what `withdraw` then reads. This screen is a front end for that
 * endpoint and nothing more.
 *
 * ── Why the stored value is only ever shown masked ─────────────────────────
 *
 * `GET /me/profile` returns the creator profile including `payoutMethod`, so
 * the full account number is available to this component. It is deliberately
 * never rendered: a payout destination on screen is a shoulder-surfing target
 * and appears in screen shares and screenshots, and there is no task on this
 * page that needs the digits. Changing it means entering the new number, which
 * is also the only way to be sure the person knows what they are changing it
 * to. Discovery already strips `payoutMethod` from anything a brand can read
 * (`PRIVATE_CREATOR_FIELDS`), so this is about the creator's own screen.
 */

const EMPTY = { type: 'upi', accountHolderName: '', bankAccount: '', ifsc: '', vpa: '' };

/** Last four digits only, which is enough to recognise an account. */
const maskAccount = (value) => {
  const s = String(value ?? '');
  return s.length > 4 ? `••••••${s.slice(-4)}` : '••••';
};

/** `name@bank` → `n•••@bank`: enough to recognise, not enough to copy. */
const maskVpa = (value) => {
  const [handle = '', domain = ''] = String(value ?? '').split('@');
  if (!domain) return '••••';
  return `${handle.slice(0, 1)}${'•'.repeat(Math.max(3, handle.length - 1))}@${domain}`;
};

export default function BankPayments({ profile, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);

  const [wallet, setWallet] = useState(null);
  const [walletFailed, setWalletFailed] = useState(false);

  const toast = useToast();
  const existing = profile.payoutMethod?.type ? profile.payoutMethod : null;

  /* The balance, for context. Its absence is not an error worth showing here —
     the section's job is the payout destination, and Earnings owns the money. */
  useEffect(() => {
    let alive = true;
    api.getWallet()
      .then(({ data }) => { if (alive) setWallet(data); })
      .catch(() => { if (alive) setWalletFailed(true); });
    return () => { alive = false; };
  }, []);

  const errors = useMemo(() => {
    const e = {};
    if (!form.accountHolderName?.trim()) {
      e.accountHolderName = 'Required — it must match the name on the account.';
    }
    if (form.type === 'bank') {
      if (!/^\d{9,18}$/.test(String(form.bankAccount ?? '').trim())) {
        e.bankAccount = 'An Indian account number is 9 to 18 digits.';
      }
      // The RBI format: four letters, a zero, then the six-character branch code.
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(form.ifsc ?? '').trim().toUpperCase())) {
        e.ifsc = 'That is not a valid IFSC — for example HDFC0001234.';
      }
    } else if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(String(form.vpa ?? '').trim())) {
      e.vpa = 'A UPI ID looks like yourname@bank.';
    }
    return e;
  }, [form]);

  function startEditing() {
    // Never pre-filled with the stored value: the point of re-entering it is
    // that the person confirms the destination they are changing to.
    setForm({ ...EMPTY, type: existing?.type ?? 'upi' });
    setTouched(false);
    setEditing(true);
    setSaved(false);
  }

  async function save() {
    setTouched(true);
    if (Object.keys(errors).length) return;

    setSaving(true);
    try {
      const payload = form.type === 'bank'
        ? {
          type: 'bank',
          accountHolderName: form.accountHolderName.trim(),
          bankAccount: form.bankAccount.trim(),
          ifsc: form.ifsc.trim().toUpperCase(),
        }
        : {
          type: 'upi',
          accountHolderName: form.accountHolderName.trim(),
          vpa: form.vpa.trim(),
        };

      const { data } = await api.setPayoutMethod(payload);
      onSaved({ ...profile, payoutMethod: data });
      setEditing(false);
      setSaved(true);
      setForm(EMPTY);
      toast.push('Payout details saved', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const show = (key) => (touched ? errors[key] : undefined);

  return (
    <div className="space-y-5">
      <SectionCard
        title="Payout details"
        description="Where Marqueiver sends money when you withdraw from your wallet."
      >
        <PrivateNotice>
          These details are private. Brands never see them — not on your profile, not on a
          collaboration, not in search. They are used only to send you money.
        </PrivateNotice>

        {!editing ? (
          <div className="mt-5">
            {existing ? (
              <div className="rounded-xl2 border border-line bg-bg/60 p-4 flex flex-col sm:flex-row
                              sm:items-center gap-4">
                <span className="w-11 h-11 rounded-xl2 bg-gradient-to-br from-brand-500 to-pink-500
                                 text-white grid place-items-center shrink-0">
                  <Wallet className="w-5 h-5" />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">
                    {existing.type === 'bank' ? 'Bank account' : 'UPI'}
                    {saved && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-jade-700">
                        <Check className="w-3.5 h-3.5" /> updated
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted tnum mt-0.5">
                    {existing.type === 'bank'
                      ? <>{maskAccount(existing.bankAccount)} · {existing.ifsc}</>
                      : maskVpa(existing.vpa)}
                  </p>
                  <p className="text-xs text-muted mt-1 truncate">{existing.accountHolderName}</p>
                </div>

                <button onClick={startEditing} className="btn-outline text-sm shrink-0 justify-center">
                  Change
                </button>
              </div>
            ) : (
              <div className="rounded-xl2 border border-dashed border-line bg-bg/60 p-8 text-center">
                <p className="font-display font-bold text-ink">No payout method yet</p>
                <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-sm mx-auto">
                  You can earn without one, but you will not be able to withdraw until it is set.
                </p>
                <button onClick={startEditing} className="btn-brand mt-5 mx-auto justify-center">
                  Add payout details
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-5">
            <fieldset>
              <legend className="field-label">How would you like to be paid?</legend>
              <div className="grid sm:grid-cols-2 gap-3 mt-2">
                {[
                  { id: 'upi', label: 'UPI', blurb: 'Usually instant. Just your UPI ID.' },
                  { id: 'bank', label: 'Bank transfer', blurb: 'Account number and IFSC.' },
                ].map((opt) => (
                  <label
                    key={opt.id}
                    className={`rounded-xl2 border p-4 cursor-pointer transition-colors
                                ${form.type === opt.id
                                  ? 'border-brand-300 bg-brand-50/60'
                                  : 'border-line hover:border-brand-200'}`}
                  >
                    <input
                      type="radio"
                      name="payout-type"
                      className="sr-only"
                      checked={form.type === opt.id}
                      onChange={() => setForm((f) => ({ ...f, type: opt.id }))}
                    />
                    <span className="flex items-center gap-2">
                      <span
                        className={`w-4 h-4 rounded-full border-2 grid place-items-center shrink-0
                                    ${form.type === opt.id ? 'border-brand-600' : 'border-line'}`}
                        aria-hidden="true"
                      >
                        {form.type === opt.id && <span className="w-2 h-2 rounded-full bg-brand-600" />}
                      </span>
                      <span className="text-sm font-semibold text-ink">{opt.label}</span>
                    </span>
                    <span className="block text-xs text-muted mt-1.5 ml-6">{opt.blurb}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="space-y-5 mt-5">
              <Field
                id="pay-name"
                label="Account holder name"
                value={form.accountHolderName}
                onChange={(v) => setForm((f) => ({ ...f, accountHolderName: v }))}
                error={show('accountHolderName')}
                hint="Exactly as it appears on the account. A mismatch is the most common reason a payout is rejected."
              />

              {form.type === 'bank' ? (
                <div className="grid sm:grid-cols-2 gap-5">
                  <Field
                    id="pay-account"
                    label="Account number"
                    inputMode="numeric"
                    value={form.bankAccount}
                    onChange={(v) => setForm((f) => ({ ...f, bankAccount: v.replace(/\D/g, '') }))}
                    error={show('bankAccount')}
                  />
                  <Field
                    id="pay-ifsc"
                    label="IFSC"
                    value={form.ifsc}
                    onChange={(v) => setForm((f) => ({ ...f, ifsc: v.toUpperCase() }))}
                    error={show('ifsc')}
                    placeholder="HDFC0001234"
                  />
                </div>
              ) : (
                <Field
                  id="pay-vpa"
                  label="UPI ID"
                  value={form.vpa}
                  onChange={(v) => setForm((f) => ({ ...f, vpa: v }))}
                  error={show('vpa')}
                  placeholder="yourname@bank"
                />
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
              <button onClick={() => setEditing(false)} disabled={saving} className="btn-ghost">
                Cancel
              </button>
              <SaveButton onClick={save} busy={saving} label="Save payout details" />
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Your wallet"
        description="Earnings land here when a collaboration is approved, and you withdraw to the account above."
      >
        {walletFailed ? (
          <p className="text-sm text-muted">
            Your balance could not be loaded right now. Payout details above are unaffected.
          </p>
        ) : !wallet ? (
          <div aria-busy="true" aria-live="polite" aria-label="Loading your balance">
            <Skeleton className="h-8 w-32 rounded-lg" />
            <Skeleton className="h-3 w-48 rounded mt-2" />
          </div>
        ) : (
          <div className="panel-money rounded-xl2 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-money-700">
                Available to withdraw
              </p>
              <p className="font-display font-extrabold text-2xl text-ink mt-1">
                <Money amount={wallet.balance ?? 0} animate />
              </p>
            </div>
            <Link to="/earnings" className="btn-outline text-sm shrink-0 justify-center">
              Go to Earnings
            </Link>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
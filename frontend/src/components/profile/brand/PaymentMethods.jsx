import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../../lib/api';
import { ErrorBlock, useToast } from '../../../lib/ui-state';
import { Skeleton, StatusPill } from '../../feedback';
import { Wallet, Check, Lock } from '../../icons';
import { SectionCard, Field, PrivateNotice } from '../shared';

/**
 * The brand's payment account records.
 *
 * ── What these are, and what they are not ──────────────────────────────────
 *
 * Marqueiver's Cashfree integration is the Payment Gateway *Orders* API: every
 * escrow funding creates a fresh order and opens Cashfree's hosted checkout,
 * where the brand picks the instrument on Cashfree's own page. There is no
 * vault and no saved-instrument token anywhere in the backend.
 *
 * So a row here is a reference record — "campaign spend goes out of the HDFC
 * current account" — and it is never charged. The panel says that in the first
 * line, because a list that looks like saved cards and silently is not is worse
 * than no list at all. Marking one as default records a preference for the
 * brand's own finance team; it changes nothing about how a payment is taken.
 *
 * ── What is stored ─────────────────────────────────────────────────────────
 *
 * Nothing sensitive. Card details are not accepted at all — there is no card
 * option — and the account number a brand types is truncated to its last four
 * digits by the server before the document is written. A UPI id is kept whole,
 * being a public payment address. None of it is readable by creators: these
 * rows live in their own collection and no discovery endpoint touches it.
 */

const TYPES = [
  { id: 'bank', label: 'Bank transfer / NEFT', blurb: 'A current or business account' },
  { id: 'upi', label: 'UPI', blurb: 'A VPA you pay from' },
  { id: 'netbanking', label: 'Netbanking', blurb: 'Your bank, chosen at checkout' },
];

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const VPA = /^[\w.\-]{2,64}@[a-zA-Z]{2,64}$/;

const EMPTY = {
  type: 'bank', label: '', bankName: '', accountHolderName: '',
  accountNumber: '', ifsc: '', vpa: '',
};

export default function PaymentMethods() {
  const [methods, setMethods] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const [form, setForm] = useState(null);      // null = the form is closed
  const [editingId, setEditingId] = useState(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState('');

  const toast = useToast();

  useEffect(() => {
    let alive = true;
    setError(null);
    api.brandPaymentMethods()
      .then(({ data }) => { if (alive) setMethods(data ?? []); })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [nonce]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const errors = useMemo(() => {
    if (!form) return {};
    const e = {};
    if (form.type === 'upi') {
      if (!form.vpa?.trim()) e.vpa = 'A UPI id is needed.';
      else if (!VPA.test(form.vpa.trim())) e.vpa = 'That does not look like a UPI id — for example name@okhdfcbank.';
    } else {
      // On an edit the stored row has no account number to resend; four digits
      // are already on record, so the field is only required when adding.
      if (!editingId && !form.accountNumber?.trim()) e.accountNumber = 'An account number is needed.';
      else if (form.accountNumber?.trim() && !/^[0-9]{6,20}$/.test(form.accountNumber.trim())) {
        e.accountNumber = 'Digits only, between 6 and 20 of them.';
      }
      if (!form.ifsc?.trim()) e.ifsc = 'An IFSC is needed.';
      else if (!IFSC.test(form.ifsc.trim().toUpperCase())) e.ifsc = 'An IFSC is 11 characters, for example HDFC0001234.';
    }
    return e;
  }, [form, editingId]);

  function openAdd() {
    setForm({ ...EMPTY });
    setEditingId(null);
    setTouched(false);
  }

  function openEdit(m) {
    setForm({
      type: m.type,
      label: m.label ?? '',
      bankName: m.bankName ?? '',
      accountHolderName: m.accountHolderName ?? '',
      accountNumber: '',
      ifsc: m.ifsc ?? '',
      vpa: m.vpa ?? '',
    });
    setEditingId(m._id);
    setTouched(false);
  }

  async function save() {
    setTouched(true);
    if (Object.keys(errors).length) {
      toast.push('Some fields still need attention', 'error');
      return;
    }

    setBusy('save');
    try {
      const payload = {
        type: form.type,
        label: form.label?.trim() || '',
        ...(form.type === 'upi'
          ? { vpa: form.vpa.trim().toLowerCase() }
          : {
            bankName: form.bankName?.trim() || '',
            accountHolderName: form.accountHolderName?.trim() || '',
            ifsc: form.ifsc.trim().toUpperCase(),
            // Omitted on an edit that does not re-enter it, so the stored four
            // digits survive rather than being cleared.
            ...(form.accountNumber?.trim() ? { accountNumber: form.accountNumber.trim() } : {}),
          }),
      };

      if (editingId) await api.updateBrandPaymentMethod(editingId, payload);
      else await api.addBrandPaymentMethod(payload);

      setForm(null);
      setEditingId(null);
      setNonce((n) => n + 1);
      toast.push(editingId ? 'Payment method updated' : 'Payment method added', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function makeDefault(id) {
    setBusy(id);
    try {
      await api.setDefaultBrandPaymentMethod(id);
      setNonce((n) => n + 1);
      toast.push('Default updated', 'success');
    } catch (e) { toast.push(e.message, 'error'); }
    finally { setBusy(''); }
  }

  async function remove(id) {
    setBusy(id);
    try {
      await api.removeBrandPaymentMethod(id);
      if (editingId === id) { setForm(null); setEditingId(null); }
      setNonce((n) => n + 1);
      toast.push('Payment method removed', 'success');
    } catch (e) { toast.push(e.message, 'error'); }
    finally { setBusy(''); }
  }

  const show = (key) => (touched ? errors[key] : undefined);

  return (
    <SectionCard
      title="Payment accounts"
      description="The accounts your campaign spend comes from, kept for your own records."
      actions={
        !form && methods?.length ? (
          <button onClick={openAdd} className="btn-outline text-sm">Add account</button>
        ) : null
      }
    >
      <PrivateNotice>
        These are reference records, not saved cards. Every campaign payment is taken on
        Cashfree&apos;s secure checkout, where you choose how to pay at the time — Marqueiver never
        stores a card, and only ever keeps the last four digits of an account number. Creators
        cannot see any of this.
      </PrivateNotice>

      <div className="mt-5">
        {error ? (
          <ErrorBlock error={error} onRetry={() => setNonce((n) => n + 1)} />
        ) : !methods ? (
          <div aria-busy="true" aria-live="polite" aria-label="Loading payment accounts" className="space-y-3">
            {[0, 1].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl2" />)}
          </div>
        ) : (
          <>
            {methods.length > 0 && (
              <ul className="space-y-3">
                {methods.map((m) => (
                  <MethodRow
                    key={m._id}
                    method={m}
                    busy={busy === m._id}
                    onEdit={() => openEdit(m)}
                    onDefault={() => makeDefault(m._id)}
                    onRemove={() => remove(m._id)}
                  />
                ))}
              </ul>
            )}

            {!methods.length && !form && (
              <div className="rounded-xl2 border border-dashed border-line bg-bg/60 p-8 text-center">
                <span className="w-12 h-12 rounded-xl2 bg-white border border-line grid place-items-center mx-auto">
                  <Wallet className="w-5 h-5 text-brand-400" />
                </span>
                <p className="font-display font-bold text-ink mt-4">No payment account on record</p>
                <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-sm mx-auto">
                  Add the account your campaign spend comes from, so your finance team can match
                  Marqueiver invoices against it. You can still pay without one.
                </p>
                <button onClick={openAdd} className="btn-brand text-sm mt-5">Add account</button>
              </div>
            )}

            <AnimatePresence>
              {form && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.24, ease: [0.2, 0.7, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className={`rounded-xl2 border border-brand-100 bg-gradient-to-br from-brand-50/60 to-pink-50/40
                                   p-4 sm:p-5 ${methods.length ? 'mt-4' : ''}`}
                  >
                    <p className="font-display font-bold text-ink">
                      {editingId ? 'Edit payment account' : 'Add a payment account'}
                    </p>

                    <div className="mt-4 space-y-5">
                      <Field id="pm-type" label="How you pay">
                        <div className="grid sm:grid-cols-3 gap-2.5">
                          {TYPES.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => set('type', t.id)}
                              aria-pressed={form.type === t.id}
                              className={`rounded-xl2 border p-3 text-left transition-colors focusable
                                          ${form.type === t.id
                                            ? 'border-brand-400 bg-white shadow-flat'
                                            : 'border-line bg-white/60 hover:border-brand-200'}`}
                            >
                              <span className="block text-sm font-semibold text-ink">{t.label}</span>
                              <span className="block text-[11px] text-muted mt-0.5">{t.blurb}</span>
                            </button>
                          ))}
                        </div>
                      </Field>

                      <Field
                        id="pm-label"
                        label="Name it (optional)"
                        value={form.label}
                        onChange={(v) => set('label', v)}
                        placeholder="Marketing current account"
                        maxLength={60}
                      />

                      {form.type === 'upi' ? (
                        <Field
                          id="pm-vpa"
                          label="UPI id"
                          value={form.vpa}
                          onChange={(v) => set('vpa', v)}
                          error={show('vpa')}
                          placeholder="brandname@okhdfcbank"
                        />
                      ) : (
                        <>
                          <div className="grid sm:grid-cols-2 gap-5">
                            <Field
                              id="pm-bank"
                              label="Bank"
                              value={form.bankName}
                              onChange={(v) => set('bankName', v)}
                              placeholder="HDFC Bank"
                            />
                            <Field
                              id="pm-holder"
                              label="Account holder"
                              value={form.accountHolderName}
                              onChange={(v) => set('accountHolderName', v)}
                              placeholder="As it appears on the account"
                            />
                          </div>

                          <div className="grid sm:grid-cols-2 gap-5">
                            <Field
                              id="pm-acct"
                              label="Account number"
                              inputMode="numeric"
                              value={form.accountNumber}
                              onChange={(v) => set('accountNumber', v.replace(/\D/g, ''))}
                              error={show('accountNumber')}
                              placeholder={editingId ? 'Leave blank to keep the one on record' : '000123456789'}
                              hint="Only the last four digits are stored."
                            />
                            <Field
                              id="pm-ifsc"
                              label="IFSC"
                              value={form.ifsc}
                              onChange={(v) => set('ifsc', v.toUpperCase())}
                              error={show('ifsc')}
                              placeholder="HDFC0001234"
                              maxLength={11}
                            />
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 mt-5">
                      <button onClick={save} disabled={busy === 'save'} className="btn-brand text-sm">
                        {busy === 'save' ? 'Saving…' : editingId ? 'Save changes' : 'Add account'}
                      </button>
                      <button
                        onClick={() => { setForm(null); setEditingId(null); }}
                        className="btn-ghost text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </SectionCard>
  );
}

function MethodRow({ method: m, busy, onEdit, onDefault, onRemove }) {
  const detail = m.type === 'upi'
    ? m.vpa
    : [m.bankName, m.accountLast4 ? `•••• ${m.accountLast4}` : null, m.ifsc].filter(Boolean).join(' · ');

  const typeLabel = TYPES.find((t) => t.id === m.type)?.label ?? m.type;

  return (
    <li className="rounded-xl2 border border-line bg-white p-4 hover:border-brand-200 transition-colors">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl2 bg-gradient-to-br from-brand-500 to-pink-500 text-white
                         grid place-items-center shrink-0"
        >
          <Wallet className="w-4 h-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink truncate">{m.label || typeLabel}</p>
            {m.isDefault && (
              <span className="pill-live text-[11px] inline-flex items-center gap-1">
                <Check className="w-3 h-3" /> Default
              </span>
            )}
          </div>
          <p className="text-xs text-muted mt-0.5 break-words">{detail || typeLabel}</p>

          {/*
            Honest about the status field: nothing in the backend verifies a
            brand payment account — there is no penny-drop check and no review
            queue — so this must not read as a pending verification that is
            being worked on somewhere.
          */}
          {m.status !== 'verified' && (
            <p className="text-[11px] text-muted mt-1.5 flex items-start gap-1.5">
              <Lock className="w-3 h-3 shrink-0 mt-0.5" />
              Kept for your records. Marqueiver does not verify or charge this account.
            </p>
          )}
          {m.status === 'verified' && <StatusPill status="completed" label="Verified" className="mt-2" />}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3.5 pt-3.5 border-t border-line">
        {!m.isDefault && (
          <button onClick={onDefault} disabled={busy} className="btn-outline text-xs">
            Make default
          </button>
        )}
        <button onClick={onEdit} disabled={busy} className="btn-ghost text-xs">Edit</button>
        <button
          onClick={onRemove}
          disabled={busy}
          className="btn-ghost text-xs !text-rose-600 hover:!bg-rose-50 ml-auto"
        >
          Remove
        </button>
      </div>
    </li>
  );
}
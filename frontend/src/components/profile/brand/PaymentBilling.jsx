import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { ErrorBlock, useToast } from '../../../lib/ui-state';
import { Money, Skeleton, StatusPill } from '../../feedback';
import { Wallet } from '../../icons';
import { SectionCard, SaveButton, Field, PrivateNotice } from '../shared';

/**
 * Invoicing details, and what has actually been paid.
 *
 * ── Scope, and what is deliberately absent ─────────────────────────────────
 *
 * Two things only: the legal name and address that belong on an invoice
 * (Policy 4.1 — "accurate company details, and GSTIN where applicable, for
 * invoicing"), and the real transaction history from
 * `GET /api/payments/transactions`.
 *
 * No card or bank detail is stored. Brands fund escrow through Cashfree at the
 * point of payment and the gateway holds the instrument; storing one here would
 * be inventing a payment feature that does not exist.
 *
 * No Credits balance either. Policy 4.3 and Policy 6 define prepaid Credits for
 * revealing creator information, and the backend implements none of it — no
 * model, no purchase, no consumption. A balance here would be a number with
 * nothing behind it, so the section says nothing about Credits at all rather
 * than showing a zero that looks like a real balance.
 */

/** What each transaction type means to a brand, in its own words. */
const TYPE_LABEL = {
  escrow_fund: 'Funded into escrow',
  escrow_release: 'Released to creator',
  refund: 'Refunded to you',
  payout: 'Payout',
  fee: 'Platform fee',
};

/** Transaction status → the shared status vocabulary. */
const TXN_STATUS = {
  success: { status: 'completed', label: 'Paid' },
  pending: { status: 'escrow_pending', label: 'Pending' },
  failed: { status: 'disputed', label: 'Failed' },
  reversed: { status: 'cancelled', label: 'Reversed' },
};

export default function PaymentBilling({ profile, onSaved }) {
  const [billing, setBilling] = useState(() => ({ ...(profile.billing ?? {}) }));
  const [gstin, setGstin] = useState(profile.gstin ?? '');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const [txns, setTxns] = useState(null);
  const [txnError, setTxnError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const toast = useToast();

  useEffect(() => {
    let alive = true;
    setTxnError(null);
    api.transactions()
      .then(({ data }) => { if (alive) setTxns(data ?? []); })
      .catch((e) => { if (alive) setTxnError(e); });
    return () => { alive = false; };
  }, [nonce]);

  const set = (k, v) => setBilling((b) => ({ ...b, [k]: v }));

  const gstError = useMemo(() => {
    if (!gstin.trim()) return undefined;
    return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin.trim().toUpperCase())
      ? undefined
      : 'A GSTIN is 15 characters, for example 27AAPFU0939F1ZV.';
  }, [gstin]);

  const dirty = useMemo(
    () => JSON.stringify(billing) !== JSON.stringify(profile.billing ?? {})
      || gstin !== (profile.gstin ?? ''),
    [billing, gstin, profile],
  );

  const totals = useMemo(() => {
    if (!txns) return null;
    const paid = txns.filter((t) => t.status === 'success');
    return {
      funded: paid.filter((t) => t.type === 'escrow_fund').reduce((s, t) => s + (t.amount || 0), 0),
      released: paid.filter((t) => t.type === 'escrow_release').reduce((s, t) => s + (t.amount || 0), 0),
      refunded: paid.filter((t) => t.type === 'refund').reduce((s, t) => s + (t.amount || 0), 0),
    };
  }, [txns]);

  async function save() {
    setTouched(true);
    if (gstError) return;

    setSaving(true);
    try {
      // `billing` is sent whole — the server sets the path, so a partial object
      // would silently drop the keys it omits.
      const { data } = await api.updateBrand({
        billing: { ...billing, country: billing.country || 'India' },
        gstin: gstin ? gstin.trim().toUpperCase() : '',
      });
      onSaved(data);
      setBilling({ ...(data.billing ?? {}) });
      setGstin(data.gstin ?? '');
      setTouched(false);
      toast.push('Billing details saved', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Invoicing details"
        description="What appears on invoices for your campaign spend."
        footer={<SaveButton onClick={save} busy={saving} dirty={dirty} label="Save billing details" />}
      >
        <PrivateNotice>
          Your invoicing details and GSTIN are private. Creators never see them — they are used for
          billing and verification only.
        </PrivateNotice>

        <div className="space-y-5 mt-5">
          <Field
            id="bl-legal"
            label="Registered legal name"
            value={billing.legalName}
            onChange={(v) => set('legalName', v)}
            placeholder="As registered, if different from your brand name"
          />

          <Field
            id="bl-gstin"
            label="GSTIN"
            value={gstin}
            onChange={(v) => setGstin(v.toUpperCase())}
            error={touched ? gstError : undefined}
            placeholder="27AAPFU0939F1ZV"
            maxLength={15}
            hint="Where applicable. The same field as in Business Information."
          />

          <Field
            id="bl-addr1"
            label="Address"
            value={billing.addressLine1}
            onChange={(v) => set('addressLine1', v)}
          />
          <Field
            id="bl-addr2"
            label="Address line 2"
            value={billing.addressLine2}
            onChange={(v) => set('addressLine2', v)}
          />

          <div className="grid sm:grid-cols-3 gap-5">
            <Field id="bl-city" label="City" value={billing.city} onChange={(v) => set('city', v)} />
            <Field id="bl-state" label="State" value={billing.state} onChange={(v) => set('state', v)} />
            <Field
              id="bl-pin"
              label="PIN code"
              inputMode="numeric"
              value={billing.postalCode}
              onChange={(v) => set('postalCode', v)}
            />
          </div>

          <Field
            id="bl-country"
            label="Country"
            value={billing.country || 'India'}
            onChange={(v) => set('country', v)}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Payment history"
        description="Every escrow funding, release and refund on your account."
      >
        {txnError ? (
          <ErrorBlock error={txnError} onRetry={() => setNonce((n) => n + 1)} />
        ) : !txns ? (
          <div aria-busy="true" aria-live="polite" aria-label="Loading payment history" className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <Skeleton className="h-4 w-40 max-w-full rounded" />
                <Skeleton className="h-4 w-20 rounded ml-auto" />
              </div>
            ))}
          </div>
        ) : !txns.length ? (
          <div className="rounded-xl2 border border-dashed border-line bg-bg/60 p-8 text-center">
            <span className="w-12 h-12 rounded-xl2 bg-white border border-line grid place-items-center mx-auto">
              <Wallet className="w-5 h-5 text-brand-400" />
            </span>
            <p className="font-display font-bold text-ink mt-4">No payments yet</p>
            <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-sm mx-auto">
              When you fund your first collaboration into escrow it appears here, with every
              release and refund that follows.
            </p>
          </div>
        ) : (
          <>
            {totals && (
              <div className="grid grid-cols-3 gap-3 mb-5">
                <Total label="Funded" amount={totals.funded} />
                <Total label="Released" amount={totals.released} />
                <Total label="Refunded" amount={totals.refunded} />
              </div>
            )}

            <ul className="divide-y divide-line">
              {txns.slice(0, 50).map((t) => {
                const s = TXN_STATUS[t.status] ?? { status: 'pending_review', label: t.status };
                return (
                  <li key={t._id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-ink truncate">
                        {TYPE_LABEL[t.type] ?? t.type}
                      </p>
                      <p className="text-xs text-muted">
                        {t.createdAt && new Date(t.createdAt).toLocaleDateString('en-IN', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                        {t.gateway && t.gateway !== 'mock' && ` · ${t.gateway}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Money amount={t.amount} className="!text-sm" />
                      <StatusPill status={s.status} label={s.label} />
                    </div>
                  </li>
                );
              })}
            </ul>

            {txns.length > 50 && (
              <p className="text-xs text-muted mt-3">Showing the 50 most recent of {txns.length}.</p>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}

function Total({ label, amount }) {
  return (
    <div className="panel-money rounded-xl2 p-4 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-money-700">{label}</p>
      <p className="font-display font-extrabold text-lg text-ink mt-1">
        <Money amount={amount} className="!text-lg" />
      </p>
    </div>
  );
}
import { useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../lib/ui-state';
import { SectionCard, SaveButton, Field, PrivateNotice } from '../shared';
import PaymentMethods from './PaymentMethods';
import CampaignPayments from './CampaignPayments';

/**
 * Payment & Billing — three panels, in the order a brand needs them.
 *
 *  1. **Invoicing details** (below) — the legal name and address that belong on
 *     an invoice, Policy 4.1: "accurate company details, and GSTIN where
 *     applicable, for invoicing".
 *  2. **Payment accounts** (`PaymentMethods`) — reference records of how the
 *     brand pays. Read that file's header before assuming they are chargeable;
 *     they are not, and cannot be under the current Cashfree integration.
 *  3. **Campaign payments** (`CampaignPayments`) — what is due, what is in
 *     escrow, what has settled, and the full ledger with gateway references.
 *
 * The three are separate files because each owns its own loading, error and
 * empty states against a different endpoint; one component would mean one
 * spinner for three independent requests.
 *
 * ── Still deliberately absent ──────────────────────────────────────────────
 *
 * No Credits balance. Policy 4.3 and Policy 6 define prepaid Credits for
 * revealing creator information, and the backend implements none of it — no
 * model, no purchase, no consumption. A balance here would be a number with
 * nothing behind it, so the section says nothing about Credits at all rather
 * than showing a zero that looks like a real balance.
 */

export default function PaymentBilling({ profile, onSaved }) {
  const [billing, setBilling] = useState(() => ({ ...(profile.billing ?? {}) }));
  const [gstin, setGstin] = useState(profile.gstin ?? '');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const toast = useToast();

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

      {/* Reference records of how this brand pays. Never charged — see the file. */}
      <PaymentMethods />

      {/* Due / in escrow / settled, plus the full ledger. */}
      <CampaignPayments />
    </div>
  );
}
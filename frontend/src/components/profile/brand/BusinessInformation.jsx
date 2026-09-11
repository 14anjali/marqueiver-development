import { useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../lib/ui-state';
import { Check, X } from '../../icons';
import { SectionCard, SaveButton, Field, ChipGroup, PrivateNotice } from '../shared';

/**
 * The company behind the brand.
 *
 * Everything here goes through the existing `PATCH /api/users/me/brand`. The
 * payload is built explicitly rather than by spreading the loaded profile, so a
 * routine "save my industry" never carries the GSTIN and invoicing address back
 * over the wire.
 *
 * ── What is private ────────────────────────────────────────────────────────
 *
 * `contactEmail`, `contactPhone`, `contactPerson`, `gstin` and `billing` are
 * stripped from everything a creator can read — `discovery.controller.js`
 * projects them out of both the brand directory and the single-brand lookup.
 * That projection did not exist before this section did: `getBrandProfile`
 * returned the whole document to any authenticated user, so a creator could
 * read a brand's direct contact details, which Policy 4.2 exists to prevent.
 */

const BUSINESS_TYPES = [
  'Private limited company',
  'Limited liability partnership',
  'Partnership firm',
  'Sole proprietorship',
  'Agency',
  'Public limited company',
  'Non-profit / trust',
  'Other',
];

const COMPANY_SIZES = ['1–10', '11–50', '51–200', '201–500', '500+'];

const CATEGORIES = [
  'Fashion', 'Beauty & Personal Care', 'Fitness', 'Food & Beverage', 'Travel',
  'Technology', 'Gaming', 'Finance', 'Education', 'Lifestyle', 'Parenting',
  'Healthcare', 'Automotive', 'Home & Living', 'Sports',
];

export default function BusinessInformation({ profile, onSaved }) {
  const [form, setForm] = useState(() => ({
    ...profile,
    billing: { ...(profile.billing ?? {}) },
  }));
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const toast = useToast();

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setLocation = (k, v) => setForm((f) => ({ ...f, location: { ...(f.location ?? {}), [k]: v } }));

  const toggleCategory = (c) => setForm((f) => {
    const list = f.categories ?? [];
    return { ...f, categories: list.includes(c) ? list.filter((x) => x !== c) : [...list, c] };
  });

  const errors = useMemo(() => {
    const e = {};
    if (!form.companyName?.trim()) e.companyName = 'Creators see this name on every brief.';
    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.contactEmail)) {
      e.contactEmail = 'That does not look like an email address.';
    }
    if (form.website && !/^https?:\/\/.+\..+/i.test(form.website.trim())) {
      e.website = 'Include the full address, starting with https://';
    }
    // The same format the server enforces, so the message arrives before the
    // round trip rather than as a generic "Validation failed".
    if (form.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(form.gstin.trim().toUpperCase())) {
      e.gstin = 'A GSTIN is 15 characters, for example 27AAPFU0939F1ZV.';
    }
    if (form.foundedYear) {
      const y = Number(form.foundedYear);
      const now = new Date().getFullYear();
      if (!Number.isInteger(y) || y < 1800 || y > now) e.foundedYear = `Enter a year between 1800 and ${now}.`;
    }
    return e;
  }, [form]);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify({ ...profile, billing: { ...(profile.billing ?? {}) } }),
    [form, profile],
  );

  /**
   * Is the work email on a business domain?
   *
   * Policy 13.1 lists "work email on a business domain" as part of Brand
   * verification. Shown as guidance, never as a pass: the server derives the
   * real answer, and an admin decides.
   */
  const domainHint = useMemo(() => {
    const email = form.contactEmail?.trim();
    if (!email || !email.includes('@')) return null;
    const domain = email.split('@').pop().toLowerCase();
    const consumer = [
      'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com',
      'hotmail.com', 'live.com', 'icloud.com', 'aol.com', 'rediffmail.com',
      'proton.me', 'protonmail.com',
    ];
    return { domain, business: !consumer.includes(domain) };
  }, [form.contactEmail]);

  async function save() {
    setTouched(true);
    if (Object.keys(errors).length) {
      toast.push('Some fields still need attention', 'error');
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.updateBrand({
        companyName: form.companyName?.trim(),
        businessType: form.businessType ?? '',
        industry: form.industry ?? '',
        categories: form.categories ?? [],
        companySize: form.companySize ?? '',
        // The schema types this as a number; an empty input is omitted rather
        // than sent as NaN, which serialises to null and fails validation.
        ...(form.foundedYear ? { foundedYear: Number(form.foundedYear) } : {}),
        about: form.about ?? '',
        website: form.website?.trim() ?? '',
        contactPerson: form.contactPerson ?? '',
        contactEmail: form.contactEmail?.trim() ?? '',
        contactPhone: form.contactPhone ?? '',
        gstin: form.gstin ? form.gstin.trim().toUpperCase() : '',
        location: {
          city: form.location?.city ?? '',
          country: form.location?.country || 'India',
        },
      });
      onSaved(data);
      setForm({ ...data, billing: { ...(data.billing ?? {}) } });
      setTouched(false);
      toast.push('Business information saved', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const show = (key) => (touched ? errors[key] : undefined);
  const footer = <SaveButton onClick={save} busy={saving} dirty={dirty} />;

  return (
    <div className="space-y-5">
      <SectionCard
        title="The business"
        description="How creators identify the company behind a brief."
        footer={footer}
      >
        <div className="space-y-5">
          <Field
            id="bi-name"
            label="Business name"
            value={form.companyName}
            onChange={(v) => set('companyName', v)}
            error={show('companyName')}
            maxLength={120}
          />

          <div className="grid sm:grid-cols-2 gap-5">
            <Field id="bi-type" label="Business type">
              <select
                id="bi-type"
                value={form.businessType ?? ''}
                onChange={(e) => set('businessType', e.target.value)}
                className="w-full rounded-xl2 border border-line bg-white px-3.5 py-2.5 text-sm
                           focus:border-brand-400 transition-colors focusable"
              >
                <option value="">Not specified</option>
                {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>

            <Field id="bi-size" label="Company size">
              <select
                id="bi-size"
                value={form.companySize ?? ''}
                onChange={(e) => set('companySize', e.target.value)}
                className="w-full rounded-xl2 border border-line bg-white px-3.5 py-2.5 text-sm
                           focus:border-brand-400 transition-colors focusable"
              >
                <option value="">Not specified</option>
                {COMPANY_SIZES.map((t) => <option key={t} value={t}>{t} people</option>)}
              </select>
            </Field>

            <Field
              id="bi-industry"
              label="Primary industry"
              value={form.industry}
              onChange={(v) => set('industry', v)}
              placeholder="e.g. Beauty & Personal Care"
              hint="The single industry you are best known for."
            />

            <Field
              id="bi-founded"
              label="Founded"
              type="number"
              inputMode="numeric"
              value={form.foundedYear ?? ''}
              onChange={(v) => set('foundedYear', v)}
              error={show('foundedYear')}
              placeholder="2019"
            />
          </div>

          <ChipGroup
            label="Business categories"
            hint="Everything you operate in. Creators use these to judge whether your brand fits their audience."
            options={CATEGORIES}
            selected={form.categories ?? []}
            onToggle={toggleCategory}
            capitalize={false}
          />

          <Field
            id="bi-about"
            label="About the business"
            textarea
            rows={5}
            value={form.about}
            onChange={(v) => set('about', v)}
            placeholder="What you sell, who you sell to, and what you are trying to achieve with creator campaigns."
            maxLength={1500}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Web and location"
        description="Your website is the quickest way for a creator to confirm you are a real business — it is also part of brand verification."
        footer={footer}
      >
        <div className="space-y-5">
          <Field
            id="bi-website"
            label="Website"
            type="url"
            value={form.website}
            onChange={(v) => set('website', v)}
            error={show('website')}
            placeholder="https://yourbrand.com"
          />

          <div className="grid sm:grid-cols-2 gap-5">
            <Field
              id="bi-city"
              label="City"
              value={form.location?.city}
              onChange={(v) => setLocation('city', v)}
              placeholder="e.g. Bengaluru"
            />
            <Field
              id="bi-country"
              label="Country"
              value={form.location?.country || 'India'}
              onChange={(v) => setLocation('country', v)}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Contact and tax"
        description="Used by the Marqueiver team and for invoicing."
        footer={footer}
      >
        <PrivateNotice>
          Contact details and your GSTIN are private. Creators never see them — they reach you
          through the campaign chat, which is also what keeps a collaboration on the record.
        </PrivateNotice>

        <div className="space-y-5 mt-5">
          <div className="grid sm:grid-cols-2 gap-5">
            <Field
              id="bi-person"
              label="Contact person"
              value={form.contactPerson}
              onChange={(v) => set('contactPerson', v)}
              placeholder="Who handles creator campaigns"
            />
            <Field
              id="bi-phone"
              label="Contact phone"
              type="tel"
              value={form.contactPhone}
              onChange={(v) => set('contactPhone', v)}
              placeholder="+91 90000 00000"
            />
          </div>

          <div>
            <Field
              id="bi-email"
              label="Work email"
              type="email"
              value={form.contactEmail}
              onChange={(v) => set('contactEmail', v)}
              error={show('contactEmail')}
              placeholder="you@yourbrand.com"
            />

            {/*
              Policy 13.1 asks for a work email on a business domain as part of
              brand verification. Stated as a signal, not a verdict — the
              server derives the real answer and an admin approves it.
            */}
            {domainHint && !show('contactEmail') && (
              <p className={`mt-2 text-xs flex items-start gap-1.5 ${
                domainHint.business ? 'text-jade-700' : 'text-money-700'}`}
              >
                {domainHint.business
                  ? <><Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span><span className="font-medium">{domainHint.domain}</span> looks like a business domain.</span></>
                  : <><X className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        <span className="font-medium">{domainHint.domain}</span> is a personal mailbox.
                        Brand verification asks for an address on your own domain.
                      </span></>}
              </p>
            )}
          </div>

          <Field
            id="bi-gstin"
            label="GSTIN"
            value={form.gstin}
            onChange={(v) => set('gstin', v.toUpperCase())}
            error={show('gstin')}
            placeholder="27AAPFU0939F1ZV"
            maxLength={15}
            hint="Where applicable, for invoicing. Leave blank if you are not GST-registered."
          />
        </div>
      </SectionCard>
    </div>
  );
}
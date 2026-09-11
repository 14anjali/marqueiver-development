import { useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../lib/ui-state';
import {
  SectionCard, SaveButton, Field, ChipGroup, ImageUpload, ListField,
} from '../shared';

/**
 * Everything about who the creator is.
 *
 * The fields here are exactly the ones `updateCreatorSchema` accepts, and the
 * payload is built explicitly rather than by spreading the form. That matters:
 * spreading sends back every key the profile arrived with — `_id`, `user`,
 * `creatorScore`, `totalAudience`, `payoutMethod` — and while the server strips
 * unknown keys, sending a creator's own payout details back on every profile
 * save is a needless round trip for data that should not leave the Bank section.
 */

const CATEGORIES = [
  'Fashion', 'Beauty & Personal Care', 'Fitness', 'Food & Beverage', 'Travel',
  'Technology', 'Gaming', 'Finance', 'Education', 'Lifestyle', 'Parenting',
  'Comedy', 'Music', 'Art & Design', 'Sports',
];

const MIN_CATEGORIES = 3;

export default function PersonalInfo({ profile, onSaved }) {
  const [form, setForm] = useState(() => ({ ...profile }));
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
    if (!form.displayName?.trim()) e.displayName = 'Your name is how brands find you.';
    if ((form.categories?.length ?? 0) < MIN_CATEGORIES) {
      e.categories = `Choose at least ${MIN_CATEGORIES} — brands filter by category.`;
    }
    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.contactEmail)) {
      e.contactEmail = 'That does not look like an email address.';
    }
    return e;
  }, [form]);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(profile),
    [form, profile],
  );

  async function save() {
    setTouched(true);
    if (Object.keys(errors).length) {
      toast.push('Some fields still need attention', 'error');
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.updateCreator({
        displayName: form.displayName?.trim(),
        headline: form.headline ?? '',
        bio: form.bio ?? '',
        avatarUrl: form.avatarUrl ?? '',
        coverUrl: form.coverUrl ?? '',
        categories: form.categories ?? [],
        languages: form.languages ?? [],
        contactEmail: form.contactEmail ?? '',
        contactPhone: form.contactPhone ?? '',
        ...(form.gender ? { gender: form.gender } : {}),
        // The API takes a date string; an empty picker must not send `""`,
        // which `new Date("")` turns into Invalid Date on the server.
        ...(form.dob ? { dob: String(form.dob).slice(0, 10) } : {}),
        location: {
          city: form.location?.city ?? '',
          country: form.location?.country || 'India',
        },
      });
      onSaved(data);
      setForm({ ...data });
      setTouched(false);
      toast.push('Profile saved', 'success');
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
        title="Photos"
        description="Your picture is the first thing a brand sees in search results."
      >
        <ImageUpload
          shape="banner"
          purpose="banner"
          label="Banner"
          hint="Shown across the top of your public profile. Wide images work best — around 1600×400."
          value={form.coverUrl}
          onChange={(v) => set('coverUrl', v)}
        />

        <div className="mt-6 pt-6 border-t border-line">
          <ImageUpload
            shape="avatar"
            purpose="avatar"
            label="Profile picture"
            hint="A clear photo of your face, or your logo. Square, at least 400×400."
            value={form.avatarUrl}
            onChange={(v) => set('avatarUrl', v)}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="About you"
        description="This is what appears on your profile and on every brief you receive."
        footer={<SaveButton onClick={save} busy={saving} dirty={dirty} />}
      >
        <div className="space-y-5">
          <Field
            id="pi-name"
            label="Display name"
            value={form.displayName}
            onChange={(v) => set('displayName', v)}
            error={show('displayName')}
            maxLength={60}
          />

          <Field
            id="pi-headline"
            label="Headline"
            value={form.headline}
            onChange={(v) => set('headline', v)}
            placeholder="e.g. Fitness & lifestyle creator, Mumbai"
            hint="One line, shown under your name everywhere on the platform."
            maxLength={120}
          />

          <Field
            id="pi-bio"
            label="Bio"
            textarea
            rows={5}
            value={form.bio}
            onChange={(v) => set('bio', v)}
            placeholder="What you make, who you make it for, and what a brand can expect working with you."
            maxLength={1000}
          />

          <div>
            <ChipGroup
              label="Categories"
              hint={`Pick at least ${MIN_CATEGORIES}. These are the main filter brands search with.`}
              options={CATEGORIES}
              selected={form.categories ?? []}
              onToggle={toggleCategory}
              capitalize={false}
            />
            {show('categories') && <p className="field-error">{errors.categories}</p>}
          </div>

          <ListField
            id="pi-languages"
            label="Languages you create in"
            values={form.languages}
            onChange={(v) => set('languages', v)}
            placeholder="Hindi, English, Marathi"
            hint="Separate with commas. Brands running regional campaigns filter on this."
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Location and details"
        description="Many campaigns are regional, so city is one of the more used filters."
        footer={<SaveButton onClick={save} busy={saving} dirty={dirty} />}
      >
        <div className="grid sm:grid-cols-2 gap-5">
          <Field
            id="pi-city"
            label="City"
            value={form.location?.city}
            onChange={(v) => setLocation('city', v)}
            placeholder="e.g. Mumbai"
          />
          <Field
            id="pi-country"
            label="Country"
            value={form.location?.country || 'India'}
            onChange={(v) => setLocation('country', v)}
          />

          <Field id="pi-gender" label="Gender">
            <select
              id="pi-gender"
              value={form.gender ?? ''}
              onChange={(e) => set('gender', e.target.value)}
              className="w-full rounded-xl2 border border-line bg-white px-3.5 py-2.5 text-sm
                         focus:border-brand-400 transition-colors focusable"
            >
              <option value="">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </Field>

          <Field
            id="pi-dob"
            label="Date of birth"
            type="date"
            value={form.dob ? String(form.dob).slice(0, 10) : ''}
            onChange={(v) => set('dob', v)}
            hint="Not shown on your profile."
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Contact"
        description="How brands and the Marqueiver team reach you about a collaboration."
        footer={<SaveButton onClick={save} busy={saving} dirty={dirty} />}
      >
        <div className="grid sm:grid-cols-2 gap-5">
          <Field
            id="pi-email"
            label="Contact email"
            type="email"
            value={form.contactEmail}
            onChange={(v) => set('contactEmail', v)}
            error={show('contactEmail')}
            placeholder="you@example.com"
          />
          <Field
            id="pi-phone"
            label="Contact phone"
            type="tel"
            value={form.contactPhone}
            onChange={(v) => set('contactPhone', v)}
            placeholder="+91 90000 00000"
          />
        </div>

        {/*
          These are profile fields, not sign-in identifiers, and the difference
          is worth stating. Writing an unverified value onto the account's login
          identity would let someone occupy a number they do not control.
        */}
        <p className="text-xs text-muted mt-4 leading-relaxed">
          These are contact details for your profile. They do not change how you sign in — to add a
          new sign-in method, verify it from Settings.
        </p>
      </SectionCard>
    </div>
  );
}
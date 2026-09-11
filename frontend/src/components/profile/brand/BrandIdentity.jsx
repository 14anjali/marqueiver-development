import { useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../lib/ui-state';
import { SectionCard, SaveButton, Field, ImageUpload } from '../shared';

/**
 * How the brand looks and what it says about itself.
 *
 * Logo and banner use the existing presigned-upload endpoint — `logo` has been
 * on `BrandProfile` since the model was written and is what onboarding already
 * sets; `coverUrl` is new and matches the creator profile's field name rather
 * than inventing `bannerUrl` for the identical concept.
 *
 * Both upload through the shared `ImageUpload`, which checks the storage
 * response. The onboarding version did not: a 403 from an expired signed URL
 * resolves normally with `ok: false`, so the brand saw "Logo attached" and
 * stored a URL pointing at an object that was never written.
 */
export default function BrandIdentity({ profile, onSaved }) {
  const [form, setForm] = useState(() => ({ ...profile }));
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const dirty = useMemo(
    () => ['logo', 'coverUrl', 'tagline', 'about'].some((k) => (form[k] ?? '') !== (profile[k] ?? '')),
    [form, profile],
  );

  async function save() {
    setSaving(true);
    try {
      const { data } = await api.updateBrand({
        logo: form.logo ?? '',
        coverUrl: form.coverUrl ?? '',
        tagline: form.tagline ?? '',
        about: form.about ?? '',
      });
      onSaved(data);
      setForm({ ...data });
      toast.push('Brand identity saved', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const footer = <SaveButton onClick={save} busy={saving} dirty={dirty} />;

  return (
    <div className="space-y-5">
      <SectionCard
        title="Logo and banner"
        description="Your logo appears on every brief a creator receives, and at the top of your public brand profile."
        footer={footer}
      >
        <ImageUpload
          shape="banner"
          purpose="banner"
          label="Banner"
          hint="Shown across the top of your brand profile. Wide images work best — around 1600×400."
          value={form.coverUrl}
          onChange={(v) => set('coverUrl', v)}
        />

        <div className="mt-6 pt-6 border-t border-line">
          <ImageUpload
            shape="avatar"
            purpose="brand-logo"
            label="Logo"
            hint="Square, at least 400×400. A transparent PNG sits best on the profile header."
            value={form.logo}
            onChange={(v) => set('logo', v)}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="What you say about yourself"
        description="The tagline sits under your name everywhere your brand appears on the platform."
        footer={footer}
      >
        <div className="space-y-5">
          <Field
            id="id-tagline"
            label="Tagline"
            value={form.tagline}
            onChange={(v) => set('tagline', v)}
            placeholder="e.g. Clean skincare, made in India"
            maxLength={160}
            hint="One line. It is the only thing many creators will read before deciding to look further."
          />

          <Field
            id="id-about"
            label="About the brand"
            textarea
            rows={6}
            value={form.about}
            onChange={(v) => set('about', v)}
            placeholder="What you make, who it is for, and what you want from creator collaborations."
            maxLength={1500}
            hint="This is the same description shown in Business Information — editing it here updates the same field."
          />
        </div>
      </SectionCard>
    </div>
  );
}
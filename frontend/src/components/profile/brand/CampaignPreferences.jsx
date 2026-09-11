import { useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../lib/ui-state';
import { SectionCard, SaveButton, Field, ChipGroup } from '../shared';

/**
 * What this brand is looking for in a collaboration.
 *
 * ── Descriptive, not binding ───────────────────────────────────────────────
 *
 * Nothing here constrains a real campaign. Policy V2 defines no rule that ties
 * a brand's stated preferences to what it may brief, budget or negotiate, so
 * inventing one would be inventing business logic. These values are read by
 * creators deciding whether to apply, and by nothing else — campaign creation,
 * applications, negotiation and escrow are untouched.
 *
 * That is stated on the screen too, because a field labelled "preferred
 * content types" in a settings page reasonably looks like a filter, and a brand
 * that believes it has restricted something it has not is worse off than one
 * who never set it.
 */

const CREATOR_CATEGORIES = [
  'Fashion', 'Beauty & Personal Care', 'Fitness', 'Food & Beverage', 'Travel',
  'Technology', 'Gaming', 'Finance', 'Education', 'Lifestyle', 'Parenting',
  'Comedy', 'Music', 'Art & Design', 'Sports',
];

// The same vocabulary a creator picks from in Work Preferences, so the two
// sides of the marketplace describe content with one set of words.
const CONTENT_TYPES = ['reel', 'post', 'story', 'video', 'short', 'ugc', 'blog', 'live'];

const COLLABORATION_TYPES = [
  { id: 'paid', label: 'Paid' },
  { id: 'barter', label: 'Barter / gifting' },
];

export default function CampaignPreferences({ profile, onSaved }) {
  const initial = () => ({
    creatorCategories: profile.campaignPreferences?.creatorCategories ?? [],
    contentTypes: profile.campaignPreferences?.contentTypes ?? [],
    collaborationTypes: profile.campaignPreferences?.collaborationTypes ?? [],
    targetAudience: profile.campaignPreferences?.targetAudience ?? '',
  });

  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const toggle = (key, value) => setForm((f) => {
    const list = f[key] ?? [];
    return { ...f, [key]: list.includes(value) ? list.filter((x) => x !== value) : [...list, value] };
  });

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, profile.campaignPreferences],
  );

  async function save() {
    setSaving(true);
    try {
      // Sent whole: the server sets the `campaignPreferences` path, so a
      // partial object would drop the keys it omits.
      const { data } = await api.updateBrand({ campaignPreferences: { ...form } });
      onSaved(data);
      toast.push('Campaign preferences saved', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const footer = <SaveButton onClick={save} busy={saving} dirty={dirty} label="Save preferences" />;

  return (
    <div className="space-y-5">
      <SectionCard
        title="Who you want to work with"
        description="Creators see this on your profile and use it to judge fit before applying, so you get fewer irrelevant applications."
        footer={footer}
      >
        <div className="rounded-xl2 border border-brand-100 bg-gradient-to-r from-brand-50/70 to-pink-50/50 p-4 mb-5">
          <p className="text-sm text-ink leading-relaxed">
            These are preferences, not rules. They do not restrict what you can brief, budget or
            agree on a campaign — every collaboration is still negotiated on its own terms.
          </p>
        </div>

        <div className="space-y-6">
          <ChipGroup
            label="Creator categories"
            hint="The niches you usually work with."
            options={CREATOR_CATEGORIES}
            selected={form.creatorCategories}
            onToggle={(t) => toggle('creatorCategories', t)}
            capitalize={false}
          />

          <ChipGroup
            label="Content types"
            hint="What you typically commission."
            options={CONTENT_TYPES}
            selected={form.contentTypes}
            onToggle={(t) => toggle('contentTypes', t)}
          />

          <ChipGroup
            label="Collaboration types"
            hint="Barter means product or service in exchange for content, with no fee."
            options={COLLABORATION_TYPES}
            selected={form.collaborationTypes}
            onToggle={(t) => toggle('collaborationTypes', t)}
            capitalize={false}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Your audience"
        description="Who you are trying to reach. A creator can tell at a glance whether their following overlaps."
        footer={footer}
      >
        <Field
          id="cp-audience"
          label="Target audience"
          textarea
          rows={4}
          value={form.targetAudience}
          onChange={(v) => setForm((f) => ({ ...f, targetAudience: v }))}
          placeholder="e.g. Women aged 24–35 in metros, interested in clean beauty and sustainable brands."
          maxLength={500}
        />
      </SectionCard>
    </div>
  );
}
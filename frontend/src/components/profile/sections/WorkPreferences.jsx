import { useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { useToast } from '../../../lib/ui-state';
import { SectionCard, SaveButton, ChipGroup, Toggle } from '../shared';
import { CATEGORIES, AUDIENCE_AGE_RANGES, GENDERS, LOCATIONS } from '../../campaign/vocab';

/**
 * What work this creator takes, and whether they are taking it now.
 *
 * `availability` is the one setting on this screen with an immediate effect on
 * discovery — it is an indexed field brands filter on — so it is stated as a
 * consequence rather than as a label. "Available for new campaigns" does not
 * tell you that turning it off removes you from a filter.
 */

export const CONTENT_TYPES = ['reel', 'post', 'story', 'video', 'short', 'ugc', 'blog', 'live'];

const COLLABORATION_TYPES = [
  { id: 'paid', label: 'Paid' },
  { id: 'barter', label: 'Barter / gifting' },
];

/**
 * The four audience facets, and where each one's options come from.
 *
 * All four are the same lists the campaign brief uses, because a brand filters
 * discovery with exactly these words — an audience declared in different words
 * than the filter offers is an audience no search can find.
 */
const AUDIENCE_FACETS = [
  ['locations', 'Where they are', LOCATIONS, false],
  ['ageRanges', 'How old they are', AUDIENCE_AGE_RANGES, false],
  ['genders', 'Mostly', GENDERS, true],
  ['interests', 'What they are into', CATEGORIES, false],
];

const EMPTY_AUDIENCE = { locations: [], ageRanges: [], genders: [], interests: [] };

/** Only the four list fields — `declaredAt` is the server's, not the form's. */
const audienceOf = (profile) => ({
  ...EMPTY_AUDIENCE,
  ...Object.fromEntries(
    Object.entries(profile.audience ?? {}).filter(([k]) => k in EMPTY_AUDIENCE),
  ),
});

export default function WorkPreferences({ profile, onSaved }) {
  const [form, setForm] = useState(() => ({
    availability: profile.availability !== false,
    collaborationTypes: profile.collaborationTypes ?? ['paid'],
    contentTypes: profile.contentTypes ?? [],
    audience: audienceOf(profile),
  }));
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const toggle = (key, value) => setForm((f) => {
    const list = f[key] ?? [];
    return { ...f, [key]: list.includes(value) ? list.filter((x) => x !== value) : [...list, value] };
  });

  const toggleAudience = (facet, value) => setForm((f) => {
    const list = f.audience[facet] ?? [];
    return {
      ...f,
      audience: {
        ...f.audience,
        [facet]: list.includes(value) ? list.filter((x) => x !== value) : [...list, value],
      },
    };
  });

  const dirty = useMemo(() => (
    form.availability !== (profile.availability !== false)
    || JSON.stringify(form.collaborationTypes) !== JSON.stringify(profile.collaborationTypes ?? ['paid'])
    || JSON.stringify(form.contentTypes) !== JSON.stringify(profile.contentTypes ?? [])
    || JSON.stringify(form.audience) !== JSON.stringify(audienceOf(profile))
  ), [form, profile]);

  async function save() {
    if (!form.collaborationTypes.length) {
      toast.push('Choose at least one collaboration type', 'error');
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.updateCreator({
        availability: form.availability,
        collaborationTypes: form.collaborationTypes,
        contentTypes: form.contentTypes,
        audience: form.audience,
      });
      onSaved(data);
      toast.push('Preferences saved', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Availability"
        description="Whether you are open to new work right now."
        footer={<SaveButton onClick={save} busy={saving} dirty={dirty} label="Save preferences" />}
      >
        <div
          className={`flex items-center justify-between gap-4 rounded-xl2 border p-4 transition-colors
                      ${form.availability
                        ? 'border-jade-200 bg-jade-50/50'
                        : 'border-line bg-bg'}`}
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              {form.availability ? 'Open to new campaigns' : 'Not taking new work'}
            </p>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              {form.availability
                ? 'You appear in brand searches and can receive new invitations.'
                : 'You are filtered out of brand searches. Collaborations already under way carry on as normal.'}
            </p>
          </div>
          <Toggle
            checked={form.availability}
            onChange={(v) => setForm((f) => ({ ...f, availability: v }))}
            label="Open to new campaigns"
          />
        </div>
      </SectionCard>

      <SectionCard
        title="What you take on"
        description="Brands see this before they send a brief, so a mismatch is filtered out early."
        footer={<SaveButton onClick={save} busy={saving} dirty={dirty} label="Save preferences" />}
      >
        <div className="space-y-6">
          <ChipGroup
            label="Collaboration types"
            hint="Barter means product or service in exchange for content, with no fee."
            options={COLLABORATION_TYPES}
            selected={form.collaborationTypes}
            onToggle={(t) => toggle('collaborationTypes', t)}
            capitalize={false}
          />

          <ChipGroup
            label="Content you create"
            hint="What you are willing to produce. This is matched against what a campaign asks for."
            options={CONTENT_TYPES}
            selected={form.contentTypes}
            onToggle={(t) => toggle('contentTypes', t)}
          />
        </div>
      </SectionCard>

      {/*
        ── Who watches you ──────────────────────────────────────────────────
        Brands filter discovery on this, and nothing on the platform can
        measure it: Instagram's account insights return reach and engagement,
        not demographics. So it is the creator's own description, it is labelled
        that way everywhere it is shown, and it is kept well apart from the
        follower counts synced from connected accounts (Policy 3.2 / 13.2).

        Leaving it blank is a real choice, not an incomplete profile — so the
        copy says what it costs rather than nagging.
      */}
      <SectionCard
        title="Who watches you"
        description="Brands search on this when they are looking for a creator directly. It is shown as your description, never as a measured figure."
        footer={<SaveButton onClick={save} busy={saving} dirty={dirty} label="Save preferences" />}
      >
        <div className="space-y-6">
          {AUDIENCE_FACETS.map(([facet, label, options, capitalize]) => (
            <ChipGroup
              key={facet}
              label={label}
              options={options}
              selected={form.audience[facet] ?? []}
              onToggle={(v) => toggleAudience(facet, v)}
              capitalize={capitalize}
            />
          ))}
          <p className="text-xs text-muted leading-relaxed">
            Optional. Left blank, you simply do not appear when a brand filters by audience —
            everything else about your profile is unaffected.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
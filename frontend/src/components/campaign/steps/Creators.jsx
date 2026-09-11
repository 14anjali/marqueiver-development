import { SectionCard, ChipGroup, ListField, Toggle } from '../../profile/shared';
import { NumberField, SelectField, SubGroup, StepIssues } from '../wizard';
import {
  CATEGORIES, GENDERS, LANGUAGES, AUDIENCE_AGE_RANGES, EXPERIENCE_LEVELS,
} from '../vocab';

/**
 * Section C — who the campaign is open to.
 *
 * ── Two different people ───────────────────────────────────────────────────
 *
 * "The creator" and "the creator's audience" are separate blocks because they
 * are separate things and briefs routinely confuse them: a 45-year-old creator
 * can have an audience of 20-year-olds, and a brand that wanted the second and
 * filtered on the first gets nobody.
 *
 * ── Deliberately light on requirements ─────────────────────────────────────
 *
 * Only a creator category is required to publish. Everything else is a filter
 * the brand may or may not want — a campaign open to everyone is a valid
 * campaign, and demanding a follower floor to publish would push brands into
 * inventing one.
 *
 * Verification asks for existing Policy 13.1 states. Nothing here verifies
 * anyone; it says which badges a creator must already hold to apply.
 */
export default function Creators({ value, patch }) {
  const r = value.creatorRequirements ?? {};
  const audience = r.audience ?? {};

  const set = (changes) => patch({ creatorRequirements: { ...r, ...changes } });
  const setAudience = (changes) => set({ audience: { ...audience, ...changes } });

  const toggleIn = (key, list, item) => set({
    [key]: (list ?? []).includes(item) ? list.filter((x) => x !== item) : [...(list ?? []), item],
  });

  const issues = [
    r.ageMin != null && r.ageMax != null && r.ageMin > r.ageMax
      ? 'Minimum creator age cannot be above the maximum.' : null,
    r.followerMin != null && r.followerMax != null && r.followerMin > r.followerMax
      ? 'Minimum followers cannot be above the maximum.' : null,
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <StepIssues issues={issues} />

      <SectionCard
        title="The creator"
        description="Who can apply. Leave anything blank to keep it open."
      >
        <div className="space-y-6">
          <ChipGroup
            label="Creator categories"
            hint="Required to publish — this is how your campaign reaches the right creators."
            options={CATEGORIES}
            selected={r.categories ?? []}
            onToggle={(c) => toggleIn('categories', r.categories, c)}
            capitalize={false}
          />

          <ListField
            id="cw-cr-loc"
            label="Creator location"
            values={r.locations ?? []}
            onChange={(locations) => set({ locations })}
            placeholder="Mumbai"
            hint="Comma separated. Cities or states — leave empty for anywhere."
          />

          <SubGroup title="Age and gender" hint="Only set these where the campaign genuinely needs them.">
            <div className="grid sm:grid-cols-2 gap-5">
              <NumberField
                id="cw-cr-agemin" label="Minimum age" min={13} max={100}
                value={r.ageMin} onChange={(ageMin) => set({ ageMin })} placeholder="18"
              />
              <NumberField
                id="cw-cr-agemax" label="Maximum age" min={13} max={100}
                value={r.ageMax} onChange={(ageMax) => set({ ageMax })} placeholder="45"
              />
            </div>
            <ChipGroup
              label="Gender"
              options={GENDERS}
              selected={r.genders ?? []}
              onToggle={(g) => toggleIn('genders', r.genders, g)}
            />
          </SubGroup>

          <SubGroup title="Reach" hint="Matched against the creator's connected accounts, not numbers they type in.">
            <div className="grid sm:grid-cols-3 gap-5">
              <NumberField
                id="cw-cr-fmin" label="Minimum followers" min={0}
                value={r.followerMin} onChange={(followerMin) => set({ followerMin })} placeholder="10000"
              />
              <NumberField
                id="cw-cr-fmax" label="Maximum followers" min={0}
                value={r.followerMax} onChange={(followerMax) => set({ followerMax })} placeholder="500000"
              />
              <NumberField
                id="cw-cr-eng" label="Minimum engagement" min={0} max={100} suffix="%"
                value={r.minEngagement} onChange={(minEngagement) => set({ minEngagement })} placeholder="2.5"
              />
            </div>
          </SubGroup>

          <ChipGroup
            label="Languages"
            hint="The languages the content should be in."
            options={LANGUAGES}
            selected={r.languages ?? []}
            onToggle={(l) => toggleIn('languages', r.languages, l)}
            capitalize={false}
          />

          <SelectField
            id="cw-cr-exp"
            label="Experience"
            value={r.experience}
            onChange={(experience) => set({ experience })}
            options={EXPERIENCE_LEVELS}
            placeholder="Any experience"
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Their audience"
        description="Who you want the content to reach — which is not always who makes it."
      >
        <div className="space-y-6">
          <ListField
            id="cw-aud-loc"
            label="Audience location"
            values={audience.locations ?? []}
            onChange={(locations) => setAudience({ locations })}
            placeholder="Metros, tier-2 cities"
          />

          <ChipGroup
            label="Audience age"
            options={AUDIENCE_AGE_RANGES}
            selected={audience.ageRanges ?? []}
            onToggle={(a) => setAudience({
              ageRanges: (audience.ageRanges ?? []).includes(a)
                ? audience.ageRanges.filter((x) => x !== a)
                : [...(audience.ageRanges ?? []), a],
            })}
            capitalize={false}
          />

          <ChipGroup
            label="Audience gender"
            options={GENDERS}
            selected={audience.genders ?? []}
            onToggle={(g) => setAudience({
              genders: (audience.genders ?? []).includes(g)
                ? audience.genders.filter((x) => x !== g)
                : [...(audience.genders ?? []), g],
            })}
          />

          <ListField
            id="cw-aud-int"
            label="Audience interests"
            values={audience.interests ?? []}
            onChange={(interests) => setAudience({ interests })}
            placeholder="Clean beauty"
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Verification"
        description="Which Marqueiver verification a creator must already hold to apply."
      >
        <div className="space-y-4">
          <Toggle
            checked={Boolean(r.requireVerifiedIdentity)}
            onChange={(requireVerifiedIdentity) => set({ requireVerifiedIdentity })}
            label="Identity verified"
          />
          <Toggle
            checked={Boolean(r.requireVerifiedSocial)}
            onChange={(requireVerifiedSocial) => set({ requireVerifiedSocial })}
            label="Social accounts verified"
          />
          <p className="text-xs text-muted leading-relaxed">
            These narrow who can apply. Verification itself is done by Marqueiver — a campaign
            never verifies anyone, and a creator&apos;s documents are never shown to you.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
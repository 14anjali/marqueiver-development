import { SectionCard, Field, ChipGroup, Toggle } from '../../profile/shared';
import { NumberField, SubGroup, StepIssues } from '../wizard';
import { USAGE_CHANNELS } from '../vocab';

/**
 * Section F — what the brand may do with the content afterwards.
 *
 * ── Why this is its own step ───────────────────────────────────────────────
 *
 * Usage rights are the term creators most often find out about late, and the
 * one that changes what a fee is worth: the same reel is a different job if the
 * brand can run it as a paid ad for a year. Putting it in its own section, with
 * the exclusivity question next to it, means a creator applying has been shown
 * it rather than discovering it in negotiation.
 *
 * Nothing here is enforced by the platform — these are the terms of the brief,
 * which the collaboration then carries. The wizard does not pretend otherwise.
 */
export default function Usage({ value, patch, errors = {} }) {
  const u = value.usageRights ?? {};
  const set = (changes) => patch({ usageRights: { ...u, ...changes } });
  const setBlock = (key, changes) => set({ [key]: { ...(u[key] ?? {}), ...changes } });

  const toggleChannel = (ch) => set({
    channels: (u.channels ?? []).includes(ch)
      ? u.channels.filter((x) => x !== ch)
      : [...(u.channels ?? []), ch],
  });

  const issues = [
    !u.perpetual && u.durationMonths != null && u.paidAds?.allowed
      && u.paidAds.durationMonths != null && u.paidAds.durationMonths > u.durationMonths
      ? 'Paid advertising usage cannot run longer than the overall usage period.' : null,
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <StepIssues issues={issues} />

      <SectionCard
        title="Usage duration"
        description="How long you can keep using the content after it is delivered."
      >
        <div className="space-y-5">
          <Toggle
            checked={Boolean(u.perpetual)}
            onChange={(perpetual) => set({ perpetual })}
            label="Perpetual — no end date"
          />

          {!u.perpetual && (
            <NumberField
              id="cw-usage-months"
              label="Usage period"
              min={1}
              max={120}
              suffix="months"
              value={u.durationMonths ?? null}
              onChange={(durationMonths) => set({ durationMonths })}
              error={errors.durationMonths}
              placeholder="12"
              hint="Required to publish, unless usage is perpetual."
            />
          )}

          <p className="text-xs text-muted leading-relaxed">
            Perpetual rights are a bigger ask than they look, and creators price them accordingly.
            A defined period is usually the easier campaign to fill.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Where you can use it"
        description="The channels this content may appear on. Required to publish."
      >
        <ChipGroup
          label="Usage channels"
          options={USAGE_CHANNELS}
          selected={u.channels ?? []}
          onToggle={toggleChannel}
          capitalize={false}
          hint={errors.channels}
        />
      </SectionCard>

      <SectionCard
        title="Paid advertising"
        description="Running the creator's content as an ad is a separate permission from posting it."
      >
        <div className="space-y-5">
          <Toggle
            checked={Boolean(u.paidAds?.allowed)}
            onChange={(allowed) => setBlock('paidAds', { allowed })}
            label="We may run this content as paid advertising"
          />
          {u.paidAds?.allowed && (
            <NumberField
              id="cw-ads-months"
              label="Paid advertising period"
              min={1}
              max={120}
              suffix="months"
              value={u.paidAds?.durationMonths ?? null}
              onChange={(durationMonths) => setBlock('paidAds', { durationMonths })}
              placeholder="6"
              hint="Cannot be longer than the overall usage period."
            />
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Exclusivity"
        description="Whether the creator is asked not to work with competitors for a period."
      >
        <div className="space-y-5">
          <Toggle
            checked={Boolean(u.exclusivity?.required)}
            onChange={(required) => setBlock('exclusivity', { required })}
            label="This campaign asks for category exclusivity"
          />

          {u.exclusivity?.required && (
            <SubGroup title="What it covers" hint="Be specific — a vague exclusivity clause is the one creators decline.">
              <Field
                id="cw-excl-cat"
                label="Category"
                value={u.exclusivity?.category}
                onChange={(category) => setBlock('exclusivity', { category })}
                maxLength={80}
                placeholder="Hair care"
              />
              <NumberField
                id="cw-excl-months"
                label="Exclusivity period"
                min={1}
                max={120}
                suffix="months"
                value={u.exclusivity?.durationMonths ?? null}
                onChange={(durationMonths) => setBlock('exclusivity', { durationMonths })}
                placeholder="3"
              />
            </SubGroup>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
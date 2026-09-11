import { SectionCard, Field, ChipGroup, ListField } from '../../profile/shared';
import { NumberField, SelectField, SubGroup, StepIssues, LineListField } from '../wizard';
import { X, Plus } from '../../icons';
import {
  PLATFORMS, PLATFORM_LABEL, CONTENT_TYPES, TIMED_CONTENT_TYPES,
} from '../vocab';

/**
 * Section B — what gets made, and the rules for making it.
 *
 * ── Deliverables are rows, not prose ───────────────────────────────────────
 *
 * "3 reels and a story" typed into a textarea cannot be counted, matched or
 * priced. Each row is a platform, a content type, a quantity and — where the
 * format has a length — a duration, which is what lets the rest of the product
 * answer "how much work is this" without a person reading the brief.
 *
 * The content-type list is driven by the platform on that row, so a YouTube
 * Carousel cannot be chosen. Deselecting a platform strips the deliverables
 * that belonged to it rather than leaving orphans the server would refuse.
 */
export default function Content({ value, patch, errors = {} }) {
  const platforms = value.platforms ?? [];
  const deliverables = value.deliverables ?? [];
  const guidelines = value.guidelines ?? {};

  function togglePlatform(p) {
    const next = platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p];
    patch({
      platforms: next,
      // Turning a platform off takes its deliverables with it — the server
      // refuses a deliverable on an unselected platform, and leaving them
      // would fail the save from a step the brand is no longer looking at.
      deliverables: deliverables.filter((d) => next.includes(d.platform)),
    });
  }

  const setDeliverable = (i, changes) => patch({
    deliverables: deliverables.map((d, idx) => (idx === i ? { ...d, ...changes } : d)),
  });

  function addDeliverable() {
    const platform = platforms[0] ?? 'instagram';
    patch({
      deliverables: [...deliverables, {
        platform,
        contentType: CONTENT_TYPES[platform][0],
        quantity: 1,
        durationSeconds: null,
        format: '',
        notes: '',
      }],
    });
  }

  const setGuidelines = (changes) => patch({ guidelines: { ...guidelines, ...changes } });

  /** Duplicates, named here so the brand fixes them before the save refuses. */
  const duplicates = deliverables
    .map((d, i) => ({ key: `${d.platform}:${d.contentType}`, i }))
    .filter((e, i, all) => all.findIndex((o) => o.key === e.key) !== i)
    .map((e) => {
      const d = deliverables[e.i];
      return `${d.contentType} on ${PLATFORM_LABEL[d.platform] ?? d.platform} is listed twice — combine them into one quantity.`;
    });

  return (
    <div className="space-y-5">
      <SectionCard
        title="Platforms"
        description="Where this campaign runs. Only the platforms Marqueiver connects to are offered — a creator has to be able to attach the account."
      >
        <ChipGroup
          label="Platforms"
          options={PLATFORMS.map((p) => ({ id: p, label: PLATFORM_LABEL[p] }))}
          selected={platforms}
          onToggle={togglePlatform}
          capitalize={false}
          hint={errors.platforms}
        />
      </SectionCard>

      <SectionCard
        title="Deliverables"
        description="Exactly what the creator produces. One row per format — a quantity, not a paragraph."
        actions={
          <button
            type="button"
            onClick={addDeliverable}
            disabled={!platforms.length}
            className="btn-outline text-sm disabled:opacity-40"
          >
            <Plus className="w-4 h-4" /> Add deliverable
          </button>
        }
      >
        {!platforms.length ? (
          <p className="text-sm text-muted rounded-xl2 border border-dashed border-line bg-bg/60 px-4 py-6 text-center">
            Pick a platform first — the content types on offer depend on it.
          </p>
        ) : !deliverables.length ? (
          <div className="rounded-xl2 border border-dashed border-line bg-bg/60 p-8 text-center">
            <p className="font-display font-bold text-ink">No deliverables yet</p>
            <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-sm mx-auto">
              A campaign needs at least one before it can be published. Creators price their
              applications from this list.
            </p>
            <button type="button" onClick={addDeliverable} className="btn-brand text-sm mt-5">
              Add the first one
            </button>
          </div>
        ) : (
          <>
            <StepIssues issues={duplicates} />

            <ul className={`space-y-3 ${duplicates.length ? 'mt-4' : ''}`}>
              {deliverables.map((d, i) => {
                const types = CONTENT_TYPES[d.platform] ?? [];
                const timed = TIMED_CONTENT_TYPES.includes(d.contentType);

                return (
                  <li key={i} className="rounded-xl2 border border-line bg-white p-4">
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <p className="text-sm font-semibold text-ink">Deliverable {i + 1}</p>
                      <button
                        type="button"
                        onClick={() => patch({ deliverables: deliverables.filter((_, idx) => idx !== i) })}
                        aria-label={`Remove deliverable ${i + 1}`}
                        className="text-muted hover:text-rose-600 transition-colors focusable rounded p-1 -m-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <SelectField
                        id={`cw-d${i}-platform`}
                        label="Platform"
                        value={d.platform}
                        placeholder=""
                        options={platforms.map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))}
                        onChange={(platform) => setDeliverable(i, {
                          platform,
                          // The old content type may not exist on the new
                          // platform, and an invalid pair fails the save.
                          contentType: CONTENT_TYPES[platform]?.includes(d.contentType)
                            ? d.contentType
                            : CONTENT_TYPES[platform][0],
                        })}
                      />

                      <SelectField
                        id={`cw-d${i}-type`}
                        label="Content type"
                        value={d.contentType}
                        placeholder=""
                        options={types}
                        onChange={(contentType) => setDeliverable(i, {
                          contentType,
                          // A duration on a carousel means nothing.
                          durationSeconds: TIMED_CONTENT_TYPES.includes(contentType) ? d.durationSeconds : null,
                        })}
                      />

                      <NumberField
                        id={`cw-d${i}-qty`}
                        label="Quantity"
                        min={1}
                        max={100}
                        value={d.quantity}
                        onChange={(quantity) => setDeliverable(i, { quantity })}
                        error={!(d.quantity >= 1) ? 'At least one.' : undefined}
                      />

                      {timed ? (
                        <NumberField
                          id={`cw-d${i}-dur`}
                          label="Duration"
                          min={1}
                          max={7200}
                          suffix="sec"
                          value={d.durationSeconds}
                          onChange={(durationSeconds) => setDeliverable(i, { durationSeconds })}
                          placeholder="30"
                        />
                      ) : (
                        <Field
                          id={`cw-d${i}-format`}
                          label="Format"
                          value={d.format}
                          onChange={(format) => setDeliverable(i, { format })}
                          placeholder="5 slides, 4:5"
                        />
                      )}
                    </div>

                    <div className="mt-4">
                      <Field
                        id={`cw-d${i}-notes`}
                        label="Notes for this deliverable"
                        value={d.notes}
                        onChange={(notes) => setDeliverable(i, { notes })}
                        placeholder="Product in frame for the first three seconds"
                        maxLength={300}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Content guidelines"
        description="The rules a creator works to. Specific guidance here is what prevents a revision round later."
      >
        <div className="space-y-6">
          <SubGroup title="Do's and don'ts" hint="Creators see these exactly as written.">
            <LineListField
              id="cw-dos"
              label="Do"
              values={guidelines.dos ?? []}
              onChange={(dos) => setGuidelines({ dos })}
              placeholder={'Show the product being used, not just held\nMention the monsoon range by name'}
            />
            <LineListField
              id="cw-donts"
              label="Don't"
              values={guidelines.donts ?? []}
              onChange={(donts) => setGuidelines({ donts })}
              placeholder={'No competitor products in frame\nNo filters that change the hair colour'}
            />
          </SubGroup>

          <SubGroup title="Tags and mentions" hint="Comma separated. Added to the caption — Policy 15 disclosure tags are handled separately by the creator.">
            <ListField
              id="cw-hashtags"
              label="Required hashtags"
              values={guidelines.hashtags ?? []}
              onChange={(hashtags) => setGuidelines({ hashtags })}
              placeholder="#monsoonready"
            />
            <ListField
              id="cw-mentions"
              label="Required mentions"
              values={guidelines.mentions ?? []}
              onChange={(mentions) => setGuidelines({ mentions })}
              placeholder="@yourbrand"
            />
          </SubGroup>

          <SubGroup title="Call to action">
            <Field
              id="cw-cta"
              label="What should the audience do?"
              value={guidelines.cta}
              onChange={(cta) => setGuidelines({ cta })}
              placeholder="Link in bio to shop the monsoon range"
              maxLength={200}
            />
            <Field
              id="cw-gnotes"
              label="Anything else about the content"
              textarea
              rows={4}
              value={guidelines.notes}
              onChange={(notes) => setGuidelines({ notes })}
              maxLength={2000}
              placeholder="Tone, references, things that have worked before."
            />
          </SubGroup>
        </div>
      </SectionCard>
    </div>
  );
}
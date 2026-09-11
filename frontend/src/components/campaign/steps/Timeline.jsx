import { useMemo } from 'react';
import { SectionCard } from '../../profile/shared';
import { DateField, NumberField, StepIssues } from '../wizard';
import { Check } from '../../icons';

/**
 * Section E — when everything happens.
 *
 * ── The order is the validation ────────────────────────────────────────────
 *
 * Six dates that have to fall in sequence. They are shown as a vertical track
 * rather than a grid of inputs because the sequence is the point: a brand
 * reading six unrelated date boxes has to hold the order in their head, and the
 * one thing this step must not allow is a timeline that cannot happen.
 *
 * The rules here mirror `campaignBrief.schema.js`, which enforces the same
 * ordering at the API boundary. This copy exists so the brand sees the problem
 * as they type rather than when they press save; the server is the authority,
 * and a test asserts it refuses what this warns about.
 *
 * Only dates that are actually filled in are compared, so a half-finished
 * timeline is not told it is broken.
 */

const STEPS = [
  {
    key: 'campaignStart',
    label: 'Campaign start',
    hint: 'When the campaign opens for applications.',
  },
  {
    key: 'applicationDeadline',
    label: 'Application deadline',
    hint: 'Last day a creator can apply. Required to publish.',
  },
  {
    key: 'selectionDeadline',
    label: 'Selection deadline',
    hint: 'When you will have chosen who you are working with.',
  },
  {
    key: 'collaborationStart',
    label: 'Collaboration start',
    hint: 'When the selected creators begin.',
  },
  {
    key: 'deadline',
    label: 'Deliverable deadline',
    core: true,
    hint: 'When the content is due. Required to publish — the collaboration inherits this date.',
  },
  {
    key: 'campaignEnd',
    label: 'Campaign end',
    hint: 'When everything is wrapped up, including your review time.',
  },
];

export default function Timeline({ value, patch, errors = {} }) {
  const s = value.schedule ?? {};
  const setSchedule = (changes) => patch({ schedule: { ...s, ...changes } });

  /** `deadline` lives at the top level; the other five live under `schedule`. */
  const read = (key) => (key === 'deadline' ? value.deadline : s[key]);
  const write = (key, v) => (key === 'deadline' ? patch({ deadline: v }) : setSchedule({ [key]: v }));

  const issues = useMemo(() => {
    const out = [];
    const present = STEPS
      .map((step) => ({ ...step, date: read(step.key) ? new Date(read(step.key)) : null }))
      .filter((e) => e.date && !Number.isNaN(e.date.getTime()));

    for (let i = 1; i < present.length; i += 1) {
      if (present[i].date < present[i - 1].date) {
        out.push(`${present[i].label} cannot be before ${present[i - 1].label.toLowerCase()}.`);
      }
    }

    const deliverable = value.deadline ? new Date(value.deadline) : null;
    const end = s.campaignEnd ? new Date(s.campaignEnd) : null;
    if (deliverable && end && s.reviewWindowDays) {
      const earliest = new Date(deliverable.getTime() + s.reviewWindowDays * 86400000);
      if (end < earliest) {
        out.push(`Campaign end leaves less than the ${s.reviewWindowDays}-day review window after the deliverable deadline.`);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.deadline, s.campaignStart, s.applicationDeadline, s.selectionDeadline,
    s.collaborationStart, s.campaignEnd, s.reviewWindowDays]);

  /** The earliest a given step may be: whatever the step above it is set to. */
  const minFor = (index) => {
    for (let i = index - 1; i >= 0; i -= 1) {
      const v = read(STEPS[i].key);
      if (v) return String(v).slice(0, 10);
    }
    return undefined;
  };

  return (
    <div className="space-y-5">
      <StepIssues issues={issues} />

      <SectionCard
        title="Timeline"
        description="Each date has to come after the one above it. Fill in what you know — the rest can wait until you publish."
      >
        <ol className="relative">
          {STEPS.map((step, i) => {
            const filled = Boolean(read(step.key));
            const last = i === STEPS.length - 1;

            return (
              <li key={step.key} className="relative flex gap-4 pb-6 last:pb-0">
                {/* The track. Drawn behind the marker, stopping at the last one. */}
                {!last && (
                  <span
                    aria-hidden="true"
                    className={`absolute left-[15px] top-8 bottom-0 w-px ${filled ? 'bg-jade-200' : 'bg-line'}`}
                  />
                )}

                <span
                  className={`relative z-10 w-8 h-8 rounded-full grid place-items-center shrink-0 text-xs font-bold
                              transition-colors
                              ${filled
                                ? 'bg-jade-500 text-white'
                                : 'bg-white border border-line text-muted'}`}
                >
                  {filled ? <Check className="w-4 h-4" /> : i + 1}
                </span>

                <div className="min-w-0 flex-1 pt-0.5">
                  <DateField
                    id={`cw-date-${step.key}`}
                    label={step.label}
                    value={read(step.key)}
                    min={minFor(i)}
                    onChange={(v) => write(step.key, v)}
                    hint={step.hint}
                    error={errors[step.key]}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      </SectionCard>

      <SectionCard
        title="Your review window"
        description="How long you get to approve the work or ask for a revision once it is submitted."
      >
        <NumberField
          id="cw-review-window"
          label="Review window"
          min={1}
          max={60}
          suffix="days"
          value={s.reviewWindowDays ?? null}
          onChange={(reviewWindowDays) => setSchedule({ reviewWindowDays })}
          placeholder="5"
          hint="Has to fit between the deliverable deadline and the campaign end."
        />
      </SectionCard>
    </div>
  );
}
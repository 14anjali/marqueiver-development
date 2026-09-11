import { SectionCard, Field, ListField, Toggle } from '../../profile/shared';
import { SelectField, StepIssues } from '../wizard';
import { X, Plus } from '../../icons';
import { QUESTION_TYPES, QUESTION_TYPE_LABEL } from '../vocab';

/**
 * Section G — anything the standard sections do not cover.
 *
 * ── The questions are captured, not yet asked ──────────────────────────────
 *
 * Custom questions are stored on the campaign and nothing reads them yet:
 * creator applications are explicitly outside this feature. They are collected
 * now because they are part of the brief — a brand writing a campaign decides
 * what it wants to ask at the same time as it decides everything else — and
 * because adding them later would mean editing campaigns that are already live,
 * which the platform does not allow.
 *
 * `key` is generated once and kept. When answers do exist, they will be matched
 * to a question by key, so rewording a prompt does not orphan the answers
 * already given.
 */

const CHOICE_TYPES = new Set(['single_choice', 'multi_choice']);

/** Short, stable, and readable in a payload. */
const newKey = () => `q_${Math.random().toString(36).slice(2, 8)}`;

export default function Extras({ value, patch }) {
  const extras = value.extras ?? {};
  const questions = extras.questions ?? [];

  const set = (changes) => patch({ extras: { ...extras, ...changes } });
  const setQuestion = (i, changes) => set({
    questions: questions.map((q, idx) => (idx === i ? { ...q, ...changes } : q)),
  });

  const addQuestion = () => set({
    questions: [...questions, {
      key: newKey(), prompt: '', type: 'short_text', required: false, options: [],
    }],
  });

  const issues = questions
    .map((q, i) => (CHOICE_TYPES.has(q.type) && (q.options?.length ?? 0) < 2
      ? `Question ${i + 1} lets creators pick from a list, so it needs at least two options.`
      : null))
    .filter(Boolean);

  return (
    <div className="space-y-5">
      <SectionCard
        title="Special instructions"
        description="Anything a creator should know that did not fit elsewhere."
      >
        <Field
          id="cw-special"
          label="Special instructions"
          textarea
          rows={6}
          value={extras.specialInstructions}
          onChange={(specialInstructions) => set({ specialInstructions })}
          maxLength={2000}
          placeholder="Shoot location and dates, product handling, anything about approvals on your side."
        />
      </SectionCard>

      <SectionCard
        title="Questions for applicants"
        description="Asked when a creator applies. Optional — but a good question saves a round of messages."
        actions={
          questions.length < 10 ? (
            <button type="button" onClick={addQuestion} className="btn-outline text-sm">
              <Plus className="w-4 h-4" /> Add question
            </button>
          ) : null
        }
      >
        <StepIssues issues={issues} />

        {!questions.length ? (
          <div className="rounded-xl2 border border-dashed border-line bg-bg/60 p-8 text-center">
            <p className="font-display font-bold text-ink">No questions yet</p>
            <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-sm mx-auto">
              Ask what you would otherwise have to message every applicant about — availability
              on your shoot dates, past work in this category, whether they have used the product.
            </p>
            <button type="button" onClick={addQuestion} className="btn-brand text-sm mt-5">
              Add a question
            </button>
          </div>
        ) : (
          <ul className={`space-y-3 ${issues.length ? 'mt-4' : ''}`}>
            {questions.map((q, i) => (
              <li key={q.key} className="rounded-xl2 border border-line bg-white p-4">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <p className="text-sm font-semibold text-ink">Question {i + 1}</p>
                  <button
                    type="button"
                    onClick={() => set({ questions: questions.filter((_, idx) => idx !== i) })}
                    aria-label={`Remove question ${i + 1}`}
                    className="text-muted hover:text-rose-600 transition-colors focusable rounded p-1 -m-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-5">
                  <Field
                    id={`cw-q${i}-prompt`}
                    label="What are you asking?"
                    value={q.prompt}
                    onChange={(prompt) => setQuestion(i, { prompt })}
                    maxLength={300}
                    placeholder="Are you available for a shoot in Mumbai on the 14th?"
                  />

                  <div className="grid sm:grid-cols-2 gap-5">
                    <SelectField
                      id={`cw-q${i}-type`}
                      label="Answer type"
                      value={q.type}
                      placeholder=""
                      options={QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_LABEL[t] }))}
                      onChange={(type) => setQuestion(i, {
                        type,
                        // Options only mean something on the choice types;
                        // leaving them behind would save a list nobody sees.
                        options: CHOICE_TYPES.has(type) ? (q.options ?? []) : [],
                      })}
                    />

                    <div className="flex items-end pb-1">
                      <Toggle
                        checked={Boolean(q.required)}
                        onChange={(required) => setQuestion(i, { required })}
                        label="Required to apply"
                      />
                    </div>
                  </div>

                  {CHOICE_TYPES.has(q.type) && (
                    <ListField
                      id={`cw-q${i}-options`}
                      label="Options"
                      values={q.options ?? []}
                      onChange={(options) => setQuestion(i, { options })}
                      placeholder="Yes, I am available"
                      hint="At least two."
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted mt-4 leading-relaxed">
          Questions are saved with the campaign. They will be asked when creator applications
          are switched on — a live campaign cannot be edited, so it is worth writing them now.
        </p>
      </SectionCard>
    </div>
  );
}
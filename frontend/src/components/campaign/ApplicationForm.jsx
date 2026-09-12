import { useMemo, useRef, useState } from 'react';
import { Field, ListField, SectionCard } from '../profile/shared';
import { NumberField, SelectField, StepIssues } from './wizard';
import { Money } from '../feedback';
import { X, Plus, FileText } from '../icons';
import { api } from '../../lib/api';
import { Spinner } from '../../lib/ui-state';
import { uploadFile } from '../profile/shared';

/**
 * The application a creator sends.
 *
 * ── Validated twice, on purpose ────────────────────────────────────────────
 *
 * Everything here is checked again on the server, against the campaign itself —
 * which questions are required, which options a choice question offers, whether
 * this campaign takes a proposed price. This copy exists so the creator is told
 * before they press the button, not after; the server's copy exists because a
 * browser is not a place to enforce anything.
 *
 * ── Why the questions are rendered from the campaign ───────────────────────
 *
 * The brand wrote them in the wizard's Additional Requirements step and they
 * are stored on the campaign with a stable `key`. The form reads that list, so
 * a brand that adds a question gets it asked without anyone touching this file,
 * and the answers come back keyed rather than positional.
 *
 * ── What this is not ───────────────────────────────────────────────────────
 *
 * Not a negotiation. The proposed price is a number the brand reads; it never
 * becomes the deal's amount, which comes from the campaign fee. Pricing is
 * settled in negotiation, which is a separate piece of work.
 */

const MAX_PITCH = 2000;
const MIN_PITCH = 40;
const MAX_LINKS = 8;
const MAX_ATTACHMENTS = 6;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const isHttpUrl = (u) => /^https?:\/\/\S+$/i.test(String(u ?? '').trim());

/** An empty answer, in whichever shape the question type uses. */
const blankAnswer = (q) => ({ key: q.key, value: '', values: [] });

export default function ApplicationForm({ campaign, onSubmitted, onCancel }) {
  const questions = campaign?.extras?.questions ?? [];
  const allowPrice = campaign?.commercials?.allowProposedPrice !== false;

  const [form, setForm] = useState(() => ({
    pitch: '',
    proposedPrice: null,
    portfolioLinks: [],
    attachments: [],
    answers: questions.map(blankAnswer),
  }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverProblems, setServerProblems] = useState([]);
  const [confirming, setConfirming] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setAnswer = (key, changes) => setForm((f) => ({
    ...f,
    answers: f.answers.map((a) => (a.key === key ? { ...a, ...changes } : a)),
  }));

  const answerFor = (key) => form.answers.find((a) => a.key === key) ?? { value: '', values: [] };

  const errors = useMemo(() => {
    const e = {};

    const pitch = form.pitch.trim();
    if (!pitch) e.pitch = 'The brand reads this first — tell them why you.';
    else if (pitch.length < MIN_PITCH) e.pitch = `A little more, please — at least ${MIN_PITCH} characters.`;

    const badLink = (form.portfolioLinks ?? []).find((l) => !isHttpUrl(l));
    if (badLink) e.portfolioLinks = `"${badLink}" is not a link. Start with https://`;

    for (const q of questions) {
      const a = answerFor(q.key);
      const multi = q.type === 'multi_choice';
      const given = multi ? (a.values ?? []).filter(Boolean) : String(a.value ?? '').trim();
      const empty = multi ? given.length === 0 : given.length === 0;

      if (q.required && empty) { e[q.key] = 'This one is required.'; continue; }
      if (empty) continue;

      if (q.type === 'link' && !isHttpUrl(given)) e[q.key] = 'Needs a link starting with https://';
      if (q.type === 'number' && !/^-?\d+(\.\d+)?$/.test(given)) e[q.key] = 'Needs a number.';
    }

    return e;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, questions]);

  const show = (key) => (touched ? errors[key] : undefined);
  const ready = Object.keys(errors).length === 0;

  async function submit() {
    setTouched(true);
    setServerProblems([]);
    if (!ready) {
      setConfirming(false);
      return;
    }

    setBusy(true);
    try {
      const payload = {
        pitch: form.pitch.trim(),
        ...(allowPrice && form.proposedPrice != null ? { proposedPrice: form.proposedPrice } : {}),
        portfolioLinks: (form.portfolioLinks ?? []).map((l) => l.trim()).filter(Boolean),
        attachments: form.attachments ?? [],
        // Only the questions this campaign actually asks, and only the shape
        // that question uses — a stray `values` on a text answer is noise the
        // brand would have to read past.
        answers: questions.map((q) => {
          const a = answerFor(q.key);
          return q.type === 'multi_choice'
            ? { key: q.key, values: (a.values ?? []).filter(Boolean) }
            : { key: q.key, value: String(a.value ?? '').trim() };
        }),
      };

      const { data } = await api.applyToCampaign(campaign._id, payload);
      onSubmitted(data.application);
    } catch (e) {
      // The server answers with every problem it found, not just the first.
      const problems = e?.detail?.details?.problems;
      setServerProblems(problems?.length ? problems : [e.message]);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Your application"
        description={`For "${campaign.title}". The brand sees this alongside your profile.`}
      >
        <div className="space-y-5">
          <Field
            id="ap-pitch"
            label="Why are you the right creator?"
            textarea
            rows={7}
            value={form.pitch}
            onChange={(v) => set('pitch', v)}
            error={show('pitch')}
            maxLength={MAX_PITCH}
            placeholder="What you would make, why this brand fits your audience, and anything you have done that is close to this brief."
            hint="Specific beats enthusiastic. Brands read a lot of these."
          />

          {allowPrice && (
            <NumberField
              id="ap-price"
              label="Your price (optional)"
              prefix="₹"
              min={0}
              value={form.proposedPrice}
              onChange={(proposedPrice) => set('proposedPrice', proposedPrice)}
              placeholder={String(campaign.budget ?? '')}
              hint={campaign.budget > 0
                ? `The campaign offers ₹${Number(campaign.budget).toLocaleString('en-IN')} per creator. Leave this blank to apply at that fee — anything you enter is a starting point for the conversation, not an agreed amount.`
                : 'A starting point for the conversation, not an agreed amount.'}
            />
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Relevant work"
        description="The fastest way for a brand to say yes is to see something like this that you have already made."
      >
        <div className="space-y-5">
          <ListField
            id="ap-links"
            label="Links to your work"
            values={form.portfolioLinks ?? []}
            onChange={(portfolioLinks) => set('portfolioLinks', portfolioLinks)}
            placeholder="https://instagram.com/p/..."
            hint={`Comma separated, up to ${MAX_LINKS}. Public links only — the brand will not be signed in as you.`}
          />
          {/* `ListField` renders a hint, not an error, so the problem is said
              once here rather than twice by passing it as both. */}
          {show('portfolioLinks') && (
            <p className="text-xs text-rose-600 -mt-3">{show('portfolioLinks')}</p>
          )}

          <Attachments
            value={form.attachments ?? []}
            onChange={(attachments) => set('attachments', attachments)}
          />
        </div>
      </SectionCard>

      {questions.length > 0 && (
        <SectionCard
          title="The brand's questions"
          description="Asked by this brand, for this campaign."
        >
          <div className="space-y-5">
            {questions.map((q) => (
              <QuestionField
                key={q.key}
                question={q}
                answer={answerFor(q.key)}
                onChange={(changes) => setAnswer(q.key, changes)}
                error={show(q.key)}
              />
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Send it">
        <StepIssues issues={serverProblems} />

        {touched && !ready && (
          <div className={serverProblems.length ? 'mt-4' : ''}>
            <StepIssues issues={Object.values(errors)} />
          </div>
        )}

        {confirming ? (
          <div className="rounded-xl2 border border-brand-100 bg-gradient-to-br from-brand-50/70 to-pink-50/50 p-5 mt-4">
            <p className="font-display font-bold text-ink">Send this application?</p>
            <p className="text-sm text-ink-soft mt-1.5 leading-relaxed">
              The brand sees it straight away. You can withdraw it while it is still
              undecided, but an application cannot be edited once sent.
            </p>
            {form.proposedPrice != null && (
              <p className="text-sm text-ink-soft mt-2.5">
                You are proposing <Money amount={form.proposedPrice} className="!text-sm" /> rather
                than the campaign fee.
              </p>
            )}
            <div className="flex flex-wrap gap-2.5 mt-4">
              <button onClick={submit} disabled={busy} className="btn-cta text-sm">
                {busy ? <Spinner className="w-4 h-4" /> : 'Yes, send it'}
              </button>
              <button onClick={() => setConfirming(false)} disabled={busy} className="btn-ghost text-sm">
                Not yet
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2.5 mt-4">
            <button
              onClick={() => { setTouched(true); if (ready) setConfirming(true); }}
              className="btn-cta text-sm"
            >
              Review and send
            </button>
            {onCancel && (
              <button onClick={onCancel} className="btn-ghost text-sm">Cancel</button>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/**
 * Files, through the same signed-upload flow as every other upload here.
 *
 * `uploadFile` is the shared helper — it signs, PUTs and checks the response,
 * which is the part three earlier call sites each got wrong in their own way.
 * Only the purpose differs.
 */
function Attachments({ value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  async function pick(e) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;

    const room = MAX_ATTACHMENTS - value.length;
    if (room <= 0) return;

    setError(null);
    setBusy(true);
    const added = [];
    try {
      for (const file of files.slice(0, room)) {
        if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 25MB.`);
        const url = await uploadFile(file, api.applicationUploadUrl);
        added.push({ url, name: file.name, kind: file.type });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      // Whatever uploaded is kept — discarding a finished upload because a
      // later file failed makes the creator do it twice.
      if (added.length) onChange([...value, ...added]);
      setBusy(false);
    }
  }

  return (
    <div>
      <span className="field-label">Files</span>

      {value.length > 0 && (
        <ul className="space-y-2 mt-2">
          {value.map((f) => (
            <li
              key={f.url}
              className="flex items-center gap-2.5 rounded-xl2 border border-line bg-white px-3.5 py-2.5"
            >
              {f.kind?.startsWith('image/') ? (
                <img src={f.url} alt="" className="w-9 h-9 rounded-lg object-cover border border-line shrink-0" />
              ) : (
                <span className="w-9 h-9 rounded-lg bg-bg grid place-items-center shrink-0">
                  <FileText className="w-4 h-4 text-muted" />
                </span>
              )}
              <span className="text-sm text-ink truncate min-w-0 flex-1">{f.name || f.url}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.url !== f.url))}
                aria-label={`Remove ${f.name || 'attachment'}`}
                className="text-muted hover:text-rose-600 transition-colors focusable rounded p-1 -m-1 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {value.length < MAX_ATTACHMENTS && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="btn-outline text-sm mt-2.5"
        >
          {busy ? <Spinner className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          Add a file
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*,.pdf"
        multiple
        onChange={pick}
        className="sr-only"
      />

      <p className="text-xs text-muted mt-2">
        {value.length}/{MAX_ATTACHMENTS} · images, video or PDF, up to 25MB each.
      </p>
      {error && <p className="text-xs text-rose-600 mt-1.5">{error}</p>}
    </div>
  );
}

/** One of the brand's questions, in whichever control its type calls for. */
function QuestionField({ question: q, answer, onChange, error }) {
  const id = `ap-q-${q.key}`;
  const label = q.required ? `${q.prompt} *` : q.prompt;

  if (q.type === 'single_choice') {
    return (
      <SelectField
        id={id}
        label={label}
        value={answer.value}
        onChange={(value) => onChange({ value })}
        options={q.options ?? []}
        error={error}
        placeholder="Choose one"
      />
    );
  }

  if (q.type === 'multi_choice') {
    const chosen = answer.values ?? [];
    return (
      <fieldset>
        <legend className="field-label">{label}</legend>
        <div className="flex flex-wrap gap-2 mt-2.5">
          {(q.options ?? []).map((opt) => {
            const on = chosen.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({
                  values: on ? chosen.filter((x) => x !== opt) : [...chosen, opt],
                })}
                className={`pill transition-all duration-200 focusable ${
                  on
                    ? 'bg-gradient-to-r from-brand-600 to-pink-600 text-white shadow-flat'
                    : 'bg-white text-muted border border-line hover:border-brand-300 hover:text-ink'}`}
              >
                {opt}
              </button>
            );
          })}
        </div>
        {error && <p className="text-xs text-rose-600 mt-1.5">{error}</p>}
      </fieldset>
    );
  }

  return (
    <Field
      id={id}
      label={label}
      textarea={q.type === 'long_text'}
      rows={q.type === 'long_text' ? 5 : undefined}
      type={q.type === 'link' ? 'url' : 'text'}
      inputMode={q.type === 'number' ? 'numeric' : undefined}
      value={answer.value}
      onChange={(value) => onChange({ value })}
      error={error}
      maxLength={1000}
      placeholder={q.type === 'link' ? 'https://…' : undefined}
    />
  );
}
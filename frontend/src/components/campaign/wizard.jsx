import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../lib/api';
import { uploadFile } from '../profile/shared';
import { Spinner } from '../../lib/ui-state';
import { Check, Lock, X, Image as ImageIcon, ChevDown } from '../icons';
import { usePrefersReducedMotion } from '../../lib/motion';

/**
 * Shared parts of the campaign wizard.
 *
 * ── What is reused rather than rebuilt ─────────────────────────────────────
 *
 * `SectionCard`, `Field`, `ChipGroup`, `ListField`, `Toggle` and `uploadFile`
 * all come from `components/profile/shared.jsx`. They are generic form
 * primitives that happen to live under `profile/` because that is where they
 * were first needed; importing them across is a slightly odd path but it is the
 * alternative to a second set of inputs that would drift from the first. The
 * design system lives in those components, and this wizard has to look like the
 * rest of Marqueiver, not like a form.
 *
 * What is here is only what the wizard needs and the profile did not: a step
 * rail with completion marks, numeric and date inputs that round-trip an empty
 * value as `null` rather than `NaN`, and a multi-image uploader.
 */

/* ──────────────────────────────── the rail ───────────────────────────────── */

/**
 * The eight sections, with a tick on each finished one.
 *
 * Desktop gets a sticky rail; phone gets a collapsible current-step button, the
 * same shape as `ProfileNav` — a wizard whose eight steps stack above the form
 * is most of a phone screen before any field appears. The completion marks come
 * from the server's readiness response, so "complete" here and "publishable"
 * there cannot mean different things.
 */
export function StepRail({ steps, active, onSelect, readiness }) {
  const [open, setOpen] = useState(false);
  const completeOf = (id) => readiness?.sections?.find((s) => s.id === id)?.complete ?? false;
  const current = steps.find((s) => s.id === active) ?? steps[0];
  const index = steps.findIndex((s) => s.id === active);

  const items = steps.map((s, i) => (
    <button
      key={s.id}
      onClick={() => { onSelect(s.id); setOpen(false); }}
      aria-current={s.id === active ? 'step' : undefined}
      className={`relative w-full flex items-center gap-3 rounded-xl2 px-3 py-2.5 text-left
                  transition-colors duration-200 focusable
                  ${s.id === active ? 'text-ink' : 'text-muted hover:text-ink hover:bg-bg'}`}
    >
      {s.id === active && (
        <motion.span
          layoutId="campaign-step-active"
          className="absolute inset-0 rounded-xl2 bg-gradient-to-r from-brand-50 to-pink-50 border border-brand-100"
          transition={{ duration: 0.22, ease: [0.2, 0.7, 0.3, 1] }}
        />
      )}

      <span
        className={`relative w-7 h-7 rounded-lg grid place-items-center shrink-0 text-xs font-bold
                    transition-colors
                    ${completeOf(s.id)
                      ? 'bg-jade-500 text-white'
                      : s.id === active
                        ? 'bg-gradient-to-br from-brand-600 to-pink-600 text-white shadow-flat'
                        : 'bg-bg text-muted'}`}
      >
        {completeOf(s.id) ? <Check className="w-3.5 h-3.5" /> : i + 1}
      </span>

      <span className="relative min-w-0 flex-1">
        <span className={`block text-sm truncate ${s.id === active ? 'font-semibold' : 'font-medium'}`}>
          {s.label}
        </span>
        <span className="block text-[11px] text-muted truncate">{s.blurb}</span>
      </span>
    </button>
  ));

  return (
    <>
      {/* phone */}
      <div className="lg:hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center gap-3 rounded-xl2 border border-line bg-white px-4 py-3
                     shadow-flat focusable"
        >
          <span className="w-9 h-9 rounded-xl2 bg-gradient-to-br from-brand-500 to-pink-500 text-white
                           grid place-items-center shrink-0 text-sm font-bold"
          >
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-sm font-semibold text-ink truncate">{current.label}</span>
            <span className="block text-[11px] text-muted truncate">
              Step {index + 1} of {steps.length}
            </span>
          </span>
          <ChevDown className={`w-4 h-4 text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.2, 0.7, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="rounded-xl2 border border-line bg-white shadow-flat p-2 mt-2">{items}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* desktop */}
      <nav aria-label="Campaign sections" className="hidden lg:block sticky top-6 self-start w-[260px] shrink-0">
        <div className="rounded-xl3 border border-line bg-white shadow-flat p-2.5">{items}</div>
      </nav>
    </>
  );
}

/* ───────────────────────────────── inputs ────────────────────────────────── */

/**
 * A number that stays a number, or becomes `null`.
 *
 * An emptied numeric input gives `''`; `Number('')` is 0 and `parseInt('')` is
 * NaN, and both then serialise into a payload that either means "zero followers
 * minimum" or fails validation with a message about the wrong field. Clearing
 * a field has to mean "unset", so that is what this sends.
 */
export function NumberField({
  id, label, value, onChange, hint, error, placeholder, min, max, suffix, prefix, disabled,
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <div className="mt-1.5 relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          disabled={disabled}
          value={value ?? ''}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === '' ? null : Number(raw));
          }}
          className={`w-full rounded-xl2 border bg-white px-3.5 py-2.5 text-sm tnum transition-colors focusable
                      disabled:bg-bg disabled:text-muted
                      ${error ? 'border-rose-300' : 'border-line focus:border-brand-400'}
                      ${prefix ? 'pl-8' : ''} ${suffix ? 'pr-12' : ''}`}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      {error
        ? <p id={`${id}-error`} className="text-xs text-rose-600 mt-1.5">{error}</p>
        : hint ? <p id={`${id}-hint`} className="text-xs text-muted mt-1.5">{hint}</p> : null}
    </div>
  );
}

/**
 * A date, as `YYYY-MM-DD`.
 *
 * That is what `<input type="date">` produces and what the API's date schema
 * accepts, so nothing converts on the way out. Clearing it sends `null`, same
 * reasoning as `NumberField`.
 */
export function DateField({ id, label, value, onChange, hint, error, min, disabled }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <input
        id={id}
        type="date"
        min={min}
        disabled={disabled}
        value={value ? String(value).slice(0, 10) : ''}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value || null)}
        className={`w-full mt-1.5 rounded-xl2 border bg-white px-3.5 py-2.5 text-sm transition-colors focusable
                    disabled:bg-bg disabled:text-muted
                    ${error ? 'border-rose-300' : 'border-line focus:border-brand-400'}`}
      />
      {error
        ? <p id={`${id}-error`} className="text-xs text-rose-600 mt-1.5">{error}</p>
        : hint ? <p id={`${id}-hint`} className="text-xs text-muted mt-1.5">{hint}</p> : null}
    </div>
  );
}

/** A labelled select, styled like the rest of the fields. */
export function SelectField({ id, label, value, onChange, options, hint, error, placeholder = 'Not specified' }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        className={`w-full mt-1.5 rounded-xl2 border bg-white px-3.5 py-2.5 text-sm transition-colors focusable
                    ${error ? 'border-rose-300' : 'border-line focus:border-brand-400'}`}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => {
          const val = typeof o === 'string' ? o : o.value;
          const text = typeof o === 'string' ? o : o.label;
          return <option key={val} value={val}>{text}</option>;
        })}
      </select>
      {error
        ? <p className="text-xs text-rose-600 mt-1.5">{error}</p>
        : hint ? <p className="text-xs text-muted mt-1.5">{hint}</p> : null}
    </div>
  );
}

/**
 * A list whose items are sentences — one per line.
 *
 * `ListField` in `profile/shared.jsx` is comma-separated, which is right for
 * hashtags, mentions and languages and silently wrong here: "Show the product
 * being used, not just held" is one instruction, and a comma-split turns it
 * into two, each of which reads as a separate rule the creator must follow.
 * Do's and don'ts are written as sentences, so they are split on newlines.
 */
export function LineListField({ id, label, values, onChange, placeholder, hint, rows = 4 }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <textarea
        id={id}
        rows={rows}
        value={(values ?? []).join('\n')}
        placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
        // Split on save rather than on every keystroke, so pressing Enter for a
        // new line does not immediately drop the empty line being typed into.
        onChange={(e) => onChange(e.target.value.split('\n').map((s) => s.trimStart()))}
        onBlur={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
        className="w-full mt-1.5 rounded-xl2 border border-line bg-white px-3.5 py-2.5 text-sm
                   leading-relaxed transition-colors focus:border-brand-400 focusable"
      />
      <p id={`${id}-hint`} className="text-xs text-muted mt-1.5">
        {hint ?? 'One per line.'}
      </p>
    </div>
  );
}

/* ───────────────────────────────── images ───────────────────────────────── */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Campaign and product imagery — several, not one.
 *
 * `ImageUpload` in `profile/shared.jsx` is a single-value control bound to the
 * avatar and banner purposes, so it does not fit a gallery. The upload itself
 * is not reimplemented: `uploadFile` is the same helper, pointed at the
 * campaign purpose, so signing, the PUT and the mock-storage branch all behave
 * exactly as they do everywhere else.
 */
export function CampaignImages({ value = [], onChange, max = 8 }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  async function pick(e) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;

    const room = max - value.length;
    if (room <= 0) return;

    setError(null);
    setBusy(true);
    const added = [];
    try {
      for (const file of files.slice(0, room)) {
        if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image.`);
        if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} is larger than 5MB.`);
        added.push(await uploadFile(file, api.campaignUploadUrl));
      }
      onChange([...value, ...added]);
    } catch (err) {
      setError(err.message);
      // Whatever did upload is kept — throwing away a successful upload
      // because a later file failed would make the brand redo it.
      if (added.length) onChange([...value, ...added]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {value.map((url, i) => (
          <div key={url} className="relative w-24 h-24 rounded-xl2 overflow-hidden border border-line bg-bg group">
            <img src={url} alt={`Campaign image ${i + 1}`} className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(value.filter((u) => u !== url))}
              aria-label={`Remove image ${i + 1}`}
              className="absolute top-1 right-1 w-6 h-6 rounded-lg bg-ink/70 text-white grid place-items-center
                         opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focusable"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {value.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="w-24 h-24 rounded-xl2 border border-dashed border-line bg-bg/60 grid place-items-center
                       text-muted hover:border-brand-300 hover:text-brand-600 transition-colors focusable"
          >
            {busy ? <Spinner className="w-5 h-5" /> : <ImageIcon className="w-5 h-5" />}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={pick}
        className="sr-only"
      />

      <p className="text-xs text-muted mt-2.5">
        {value.length}/{max} · JPG or PNG, up to 5MB each. Creators see these on the campaign.
      </p>
      {error && <p className="text-xs text-rose-600 mt-1.5">{error}</p>}
    </div>
  );
}

/* ─────────────────────────────── small parts ─────────────────────────────── */

/** A block of fields under a quiet heading, inside a SectionCard. */
export function SubGroup({ title, hint, children }) {
  return (
    <div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="text-xs text-muted mt-0.5 leading-relaxed">{hint}</p>}
      <div className="mt-3.5 space-y-5">{children}</div>
    </div>
  );
}

/** What this step still needs, phrased as a nudge rather than a failure. */
export function StepIssues({ issues, tone = 'warn' }) {
  const reduced = usePrefersReducedMotion();
  if (!issues?.length) return null;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl2 border p-4 ${
        tone === 'warn' ? 'border-rose-100 bg-rose-50/70' : 'border-brand-100 bg-brand-50/60'}`}
    >
      <p className={`text-sm font-semibold ${tone === 'warn' ? 'text-rose-700' : 'text-brand-700'}`}>
        {tone === 'warn' ? 'This needs fixing before you can publish' : 'Still to fill in'}
      </p>
      <ul className={`mt-2 space-y-1.5 text-xs leading-relaxed ${tone === 'warn' ? 'text-rose-700' : 'text-ink-soft'}`}>
        {issues.map((i) => <li key={i} className="flex gap-2"><span aria-hidden="true">•</span><span>{i}</span></li>)}
      </ul>
    </motion.div>
  );
}

/** The private-to-you note, matching the profile's. */
export function DraftNotice({ children }) {
  return (
    <div className="rounded-xl2 border border-brand-100 bg-brand-50/50 p-3.5 flex items-start gap-2.5">
      <Lock className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
      <p className="text-xs text-brand-800 leading-relaxed">{children}</p>
    </div>
  );
}
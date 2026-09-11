import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../../lib/api';
import { Spinner } from '../../lib/ui-state';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../../lib/motion';
import { Image as ImageIcon, X, Check } from '../icons';

/**
 * The parts every section of the Account Center is built from.
 *
 * Nine sections that each hand-rolled a card, a heading, a field and a save
 * button is how nine sections end up looking like nine different products. The
 * page is a marketplace profile, not a settings console, so the shared pieces
 * carry the weight: one card treatment, one field, one save row.
 */

/* ─────────────────────────────── section frame ─────────────────────────────── */

/**
 * One section of the Account Center.
 *
 * `footer` is where the save button goes. It is pinned to the bottom of the
 * card with a tinted rule above it rather than floating after the last field,
 * because on a long form — Personal Information has nine — a save button that
 * scrolls away with the content is a save button people do not press.
 */
export function SectionCard({ title, description, actions, children, footer, className = '' }) {
  const reduced = usePrefersReducedMotion();

  return (
    <motion.section
      variants={withReducedMotion(rise, reduced)}
      initial="hidden"
      animate="visible"
      className={`bg-white rounded-xl3 border border-line shadow-flat overflow-hidden ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3
                           px-5 sm:px-7 pt-5 sm:pt-6 pb-4">
          <div className="min-w-0">
            <h2 className="font-display font-extrabold text-lg text-ink">{title}</h2>
            {description && (
              <p className="text-sm text-muted mt-1 leading-relaxed max-w-prose">{description}</p>
            )}
          </div>
          {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
        </header>
      )}

      <div className="px-5 sm:px-7 pb-5 sm:pb-6">{children}</div>

      {footer && (
        <footer className="px-5 sm:px-7 py-4 border-t border-line bg-gradient-to-r from-brand-50/40 to-pink-50/30
                           flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          {footer}
        </footer>
      )}
    </motion.section>
  );
}

/** The save button every editable section ends with. */
export function SaveButton({ onClick, busy, dirty = true, label = 'Save changes' }) {
  return (
    <button onClick={onClick} disabled={busy || !dirty} className="btn-brand justify-center">
      {busy ? <><Spinner className="w-4 h-4" /> Saving…</> : label}
    </button>
  );
}

/* ───────────────────────────────── fields ──────────────────────────────────── */

/**
 * A labelled field.
 *
 * `htmlFor`/`id` are paired here rather than left to each caller — the version
 * this replaces had labels attached to nothing across three screens, so tapping
 * a label did nothing and a screen reader announced an unnamed textbox.
 */
export function Field({
  id, label, value, onChange, textarea, placeholder, type = 'text',
  hint, error, maxLength, rows = 3, disabled, prefix, children,
  inputMode, autoComplete,
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const count = maxLength && typeof value === 'string' ? value.length : null;

  const common = {
    id,
    value: value ?? '',
    placeholder,
    disabled,
    maxLength,
    inputMode,
    autoComplete,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    onChange: (e) => onChange(e.target.value),
    className: `w-full rounded-xl2 border bg-white px-3.5 py-2.5 text-sm transition-colors focusable
                disabled:bg-bg disabled:text-muted
                ${error ? 'border-rose-300' : 'border-line focus:border-brand-400'}
                ${prefix ? 'pl-9' : ''}`,
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="field-label">{label}</label>
        {count !== null && (
          <span className={`text-[11px] tnum ${count >= maxLength ? 'text-rose-500' : 'text-muted'}`}>
            {count}/{maxLength}
          </span>
        )}
      </div>

      <div className="mt-1.5 relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none">
            {prefix}
          </span>
        )}
        {children ?? (textarea
          ? <textarea rows={rows} {...common} />
          : <input type={type} {...common} />)}
      </div>

      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
      {!error && hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** A set of choices, announced as choices rather than as a row of buttons. */
export function ChipGroup({ label, hint, options, selected, onToggle, capitalize = true }) {
  return (
    <fieldset>
      <legend className="field-label">{label}</legend>
      {hint && <p className="text-xs text-muted mt-1 mb-2.5">{hint}</p>}
      <div className={`flex flex-wrap gap-2 ${hint ? '' : 'mt-2.5'}`}>
        {options.map((opt) => {
          const id = typeof opt === 'string' ? opt : opt.id;
          const text = typeof opt === 'string' ? opt : opt.label;
          const on = selected.includes(id);
          return (
            <button
              key={id}
              type="button"
              // `aria-pressed` is the difference between "a row of buttons" and
              // "a set of choices, and these are the ones you have made".
              aria-pressed={on}
              onClick={() => onToggle(id)}
              className={`pill transition-all duration-200 focusable ${capitalize ? 'capitalize' : ''} ${
                on
                  ? 'bg-gradient-to-r from-brand-600 to-pink-600 text-white shadow-flat'
                  : 'bg-white text-muted border border-line hover:border-brand-300 hover:text-ink'}`}
            >
              {on && <Check className="w-3 h-3" />}
              {text}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** An on/off control that announces itself as a switch. */
export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-12 h-7 rounded-full shrink-0 transition-colors disabled:opacity-60 focusable
                  ${checked ? 'bg-gradient-to-r from-brand-600 to-pink-600' : 'bg-line'}`}
    >
      <span
        className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-flat transition-all duration-200
                    ${checked ? 'left-6' : 'left-1'}`}
      />
    </button>
  );
}

/** A list of comma-separated values, edited as text but stored as an array. */
export function ListField({ id, label, values, onChange, placeholder, hint }) {
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      placeholder={placeholder}
      value={(values ?? []).join(', ')}
      onChange={(v) => onChange(
        v.split(',').map((s) => s.trim()).filter(Boolean),
      )}
    />
  );
}

/* ───────────────────────────────── uploads ─────────────────────────────────── */

/**
 * Upload a file and return the URL it will be served from.
 *
 * Shared because the three callers that needed it — avatar, banner, portfolio —
 * each wrote their own, and all three had the same defect: `fetch(uploadUrl,
 * { method: 'PUT' })` with the response never examined. `fetch` rejects only on
 * a network failure, so a 403 from an expired signed URL resolves normally with
 * `ok: false`, and the caller went on to save a `publicUrl` pointing at an
 * object that was never stored. The user saw "Saved", and their avatar was a
 * broken image.
 */
export async function uploadFile(file, getUrl) {
  const { data: urls } = await getUrl(file.name, file.type);
  if (!urls?.publicUrl) throw new Error('The server did not return an upload URL.');

  // Mock storage serves the public URL immediately; a real provider needs the
  // PUT first.
  if (urls.uploadUrl && !urls.uploadUrl.includes('mock-storage')) {
    const res = await fetch(urls.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    });
    if (!res.ok) {
      throw new Error(`The upload was refused by storage (${res.status}). Please try again.`);
    }
  }

  return urls.publicUrl;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * An image with a replace/remove control over it.
 *
 * `shape="banner"` for the cover, `"avatar"` for the round one. The size and
 * type checks happen here rather than server-side only, because a 20MB photo
 * from a phone camera is the common case and failing after the upload wastes
 * the wait.
 */
export function ImageUpload({
  value, onChange, purpose, shape = 'avatar', label, hint, disabled,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const getUrl = purpose === 'banner' ? api.bannerUploadUrl : api.avatarUploadUrl;
  const isBanner = shape === 'banner';

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);

    if (!file.type.startsWith('image/')) {
      setError('That is not an image file.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 5MB.`);
      return;
    }

    setBusy(true);
    try {
      onChange(await uploadFile(file, getUrl));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {label && <p className="field-label">{label}</p>}

      <div className={`mt-1.5 relative group ${isBanner ? '' : 'inline-block'}`}>
        <div
          className={`relative overflow-hidden border border-line bg-gradient-to-br from-brand-50 to-pink-50
                      ${isBanner ? 'h-32 sm:h-40 w-full rounded-xl3' : 'w-24 h-24 rounded-full'}`}
        >
          {value ? (
            <img src={value} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="w-full h-full grid place-items-center text-brand-300">
              <ImageIcon className={isBanner ? 'w-8 h-8' : 'w-7 h-7'} />
            </span>
          )}

          {busy && (
            <span
              className="absolute inset-0 grid place-items-center bg-ink/40 backdrop-blur-sm"
              aria-live="polite"
            >
              <Spinner className="w-6 h-6 text-white" />
            </span>
          )}
        </div>

        <div className={`flex gap-2 ${isBanner ? 'mt-3' : 'mt-3 justify-center'}`}>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy || disabled}
            className="btn-outline text-xs py-1.5"
          >
            {value ? 'Replace' : 'Upload'}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => { onChange(''); setError(null); }}
              disabled={busy || disabled}
              className="btn-ghost text-xs py-1.5 text-muted hover:text-rose-600"
            >
              <X className="w-3.5 h-3.5" /> Remove
            </button>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={pick}
        />
      </div>

      {error && <p className="field-error" role="alert">{error}</p>}
      {!error && hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/* ──────────────────────────────── formatting ───────────────────────────────── */

/** Indian-format audience counts. Whole numbers below 1,000; never "0.8K". */
export const followerCount = (n) => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000) return `${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
};

/** A private-data notice. Used wherever a brand must never see the contents. */
export function PrivateNotice({ children }) {
  return (
    <div className="flex items-start gap-3 rounded-xl2 border border-brand-100 bg-brand-50/60 p-3.5">
      <svg
        viewBox="0 0 24 24" className="w-4 h-4 text-brand-600 shrink-0 mt-0.5"
        fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
      >
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
      <p className="text-xs text-brand-800 leading-relaxed">{children}</p>
    </div>
  );
}
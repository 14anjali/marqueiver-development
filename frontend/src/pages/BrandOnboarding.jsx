import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Logo } from '../components/ui';
import { Check, X } from '../components/icons';
import { Skeleton, SkeletonText, Steps, SuccessMark } from '../components/feedback';
import { Spinner, useToast, ErrorBlock } from '../lib/ui-state';
import { rise, stagger, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * Brand onboarding.
 *
 * What a brand has to give up before it can search creators: who the company is,
 * how to reach it, and what it sells. Nothing else — a brand does not need a
 * connected social account, so unlike creator onboarding this is one step.
 *
 * ── What this pass fixed ────────────────────────────────────────────────────
 *
 * The previous version had four defects, and two of them were not cosmetic.
 *
 *  1. **It saved a `blob:` URL as the company logo.** When the presigned-upload
 *     call failed it fell back to `URL.createObjectURL(file)` and put that in
 *     `form.logo` — and `finish()` sends `form.logo` straight to
 *     `PATCH /users/me/brand`. A `blob:` URL is valid only inside the tab that
 *     created it, so the brand's logo was persisted as a string that is dead the
 *     moment the page closes, and every creator who ever looked at that brand
 *     got a broken image. The toast said "(local preview)", which described the
 *     intent and not the behaviour. A failed upload is now a failed upload: the
 *     preview is held separately from the value that is saved, and only a real
 *     `publicUrl` is ever sent.
 *  2. **It re-asked for everything signup already had.** The company name is
 *     collected at signup and `GET /users/me/onboarding` returns it, along with
 *     the city, and which of email/phone is already verified. This page asked
 *     for all of them again and overwrote the answers with whatever was typed
 *     the second time. It now prefills from the server and only asks for the
 *     contact channel signup did *not* verify — the same rule creator
 *     onboarding follows.
 *  3. **`grid grid-cols-2` with no breakpoint.** Three rows of paired fields
 *     stayed two-up at 320px, so every label wrapped and the inputs were about
 *     130px wide. This is a form people fill in on a phone.
 *  4. **No label was associated with its input.** `<label>` with no `htmlFor`
 *     and `<input>` with no `id` is a label in appearance only: tapping it does
 *     not focus the field and a screen reader announces an unlabelled textbox.
 *
 * It also had no loading state, no error state, and no way back from a failure
 * except a toast that disappears.
 */

/**
 * Business categories.
 *
 * `BrandProfile.industry` is a free-string field server-side, so this list is
 * the UI's own vocabulary rather than an enum being mirrored. Kept alphabetical
 * after the "most common first" pair, and with an explicit "Other" so a brand
 * that does not fit is not forced to misfile itself.
 */
const CATEGORIES = [
  'Beauty & Personal Care', 'Fashion', 'Food & Beverage', 'Fitness',
  'Technology', 'Travel', 'Finance', 'Sportswear', 'Home & Living',
  'Health & Wellness', 'Education', 'Automotive', 'Gaming', 'Other',
];

const ABOUT_MAX = 600;

export default function BrandOnboarding() {
  const nav = useNavigate();
  const toast = useToast();
  const { refresh } = useAuth();
  const reduced = usePrefersReducedMotion();

  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const [form, setForm] = useState({
    companyName: '', contactPerson: '', contact: '',
    industry: '', city: '', about: '', website: '',
  });

  /**
   * The logo is two values, not one.
   *
   * `logoUrl` is what gets saved and must be a URL the server handed back.
   * `preview` is a local object URL used only to draw the thumbnail. Collapsing
   * them into one field is what put a `blob:` URL in the database.
   */
  const [logoUrl, setLogoUrl] = useState('');
  const [preview, setPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);

  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [done, setDone] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  /* ── what the server already knows ───────────────────────────────────────── */

  const load = useCallback(async () => {
    setLoadError(null);
    setState(null);
    try {
      const { data } = await api.onboardingState();
      if (data.onboardingComplete) { nav('/dashboard', { replace: true }); return; }
      setState(data);
      setForm((f) => ({
        ...f,
        // The server returns the brand's name under `displayName` (it coalesces
        // displayName and companyName), so that is the field to read.
        companyName: f.companyName || data.known.displayName || '',
        city: f.city || data.known.city || '',
        about: f.about || data.known.bio || '',
      }));
      setLogoUrl((v) => v || data.known.avatarUrl || '');
    } catch (err) {
      setLoadError(err);
    }
  }, [nav]);

  useEffect(() => { load(); }, [load, nonce]);

  /**
   * Object URLs are a real allocation and have to be released, but releasing
   * them by hand at the call site revokes the URL that is still on screen for
   * the frame before React re-renders — which flashes a broken image. The
   * effect cleanup runs with the *previous* value after the new one has
   * rendered, which is exactly the right moment.
   */
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  /**
   * Which contact detail is still worth asking for — precisely the one signup
   * did not verify. A brand that signed up with email is asked for a phone; one
   * that signed up on WhatsApp is asked for an email. Neither is asked twice.
   */
  const asking = useMemo(() => {
    if (!state) return null;
    if (state.needs.phone) return 'phone';
    if (state.needs.email) return 'email';
    return null;
  }, [state]);

  const contactValid = useMemo(() => {
    if (!asking) return true;
    if (!form.contact.trim()) return false;
    return asking === 'phone'
      ? form.contact.replace(/\D/g, '').length >= 10
      : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.contact);
  }, [asking, form.contact]);

  const websiteValid = !form.website.trim() || /^https?:\/\/.+\..+/.test(form.website.trim());
  const canSubmit = form.companyName.trim().length >= 2 && Boolean(form.industry)
    && contactValid && websiteValid && !busy;

  /* ── logo ────────────────────────────────────────────────────────────────── */

  async function onLogoPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.push('That file is not an image', 'error');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.push('Logos need to be under 4 MB', 'error');
      return;
    }

    setPreview(URL.createObjectURL(file));
    setUploading(true);
    setUploadFailed(false);

    try {
      const { data } = await api.logoUploadUrl(file.name, file.type);
      if (!data?.publicUrl) throw new Error('The upload service did not return a URL');
      setLogoUrl(data.publicUrl);
      toast.push('Logo attached', 'success');
    } catch {
      /*
        The old code put the object URL into the saved value here. It never
        works: a `blob:` URL resolves only in the tab that minted it, so the
        brand's logo would be broken for every creator and for the brand itself
        on the next page load. The thumbnail stays as a preview; nothing is
        saved, and the failure is stated rather than dressed up as success.
      */
      setLogoUrl('');
      setUploadFailed(true);
      toast.push('We could not upload that logo — you can add one later from Profile', 'error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  function clearLogo() {
    setPreview('');
    setLogoUrl('');
    setUploadFailed(false);
  }

  /* ── finish ──────────────────────────────────────────────────────────────── */

  async function finish() {
    if (!canSubmit) return;
    setBusy(true);
    setSaveError(null);
    try {
      await api.updateBrand({
        companyName: form.companyName.trim(),
        industry: form.industry,
        about: form.about.trim() || undefined,
        website: form.website.trim() || undefined,
        // Only ever a URL the server gave us.
        logo: logoUrl || undefined,
        contactPerson: form.contactPerson.trim() || undefined,
        ...(asking === 'email' ? { contactEmail: form.contact.trim() } : {}),
        ...(asking === 'phone' ? { contactPhone: form.contact.trim() } : {}),
        location: { city: form.city.trim(), country: 'India' },
      });
      await api.completeOnboarding();
      await refresh();

      // A beat on the confirmation, then through. Finishing onboarding is the
      // moment the product opens up; it earns the one tick.
      setDone(true);
      setTimeout(() => nav('/dashboard', { replace: true }), 900);
    } catch (err) {
      setSaveError(err);
      setBusy(false);
    }
  }

  /* ── render ──────────────────────────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="mb-7"><Logo /></div>

        {done ? (
          <motion.div
            variants={withReducedMotion(rise, reduced)}
            initial="hidden"
            animate="visible"
            className="card-edge p-8 sm:p-10 text-center"
            role="status"
            aria-live="polite"
          >
            <SuccessMark className="w-14 h-14 mx-auto" />
            <h2 className="font-display font-extrabold text-xl text-ink mt-5">
              {form.companyName} is set up
            </h2>
            <p className="text-sm text-muted mt-2">Taking you to your dashboard.</p>
          </motion.div>
        ) : loadError ? (
          <ErrorBlock error={loadError} onRetry={() => setNonce((n) => n + 1)} />
        ) : !state ? (
          <div className="card-edge p-6" aria-busy="true" aria-live="polite" aria-label="Loading your details">
            <Skeleton className="h-6 w-48 rounded-lg" />
            <div className="flex items-center gap-4 mt-6">
              <Skeleton className="w-16 h-16 rounded-xl2" />
              <div className="flex-1">
                <Skeleton className="h-4 w-32 rounded" />
                <Skeleton className="h-3 w-40 rounded mt-2" />
              </div>
            </div>
            <SkeletonText lines={2} className="mt-6" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="mt-5">
                <Skeleton className="h-3 w-28 rounded" />
                <Skeleton className="h-10 w-full rounded-lg mt-2" />
              </div>
            ))}
          </div>
        ) : (
          <motion.div
            variants={withReducedMotion(rise, reduced)}
            initial="hidden"
            animate="visible"
            className="card-edge p-5 sm:p-7"
          >
            {/*
              One step, said out loud. A brand does not need a connected social
              account, so this is the whole of onboarding — and telling someone
              that up front is worth more than hiding it.
            */}
            <Steps steps={['Your business', 'Start hiring']} current={0} className="mb-6" />

            <h1 className="font-display font-extrabold text-xl sm:text-2xl text-ink">
              Set up your brand
            </h1>
            <p className="text-sm text-muted mt-1.5 leading-relaxed">
              This is what creators see when a brief arrives from you. You can change any of it
              later from your profile.
            </p>

            {saveError && (
              <div className="mt-5">
                <ErrorBlock error={saveError} onRetry={finish} />
              </div>
            )}

            <motion.div
              variants={withReducedMotion(stagger, reduced)}
              initial="hidden"
              animate="visible"
              className="mt-6 space-y-5"
            >
              {/* ── logo ── */}
              <motion.div variants={withReducedMotion(rise, reduced)} className="flex items-center gap-4">
                <label
                  htmlFor="brand-logo"
                  className={`w-16 h-16 rounded-xl2 border-2 border-dashed flex items-center justify-center
                              cursor-pointer overflow-hidden shrink-0 relative transition-colors focusable
                              ${uploadFailed ? 'border-rose-300' : 'border-line hover:border-brand-400'}`}
                >
                  {preview || logoUrl ? (
                    <img src={preview || logoUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl text-muted leading-none">+</span>
                  )}
                  {uploading && (
                    <span className="absolute inset-0 grid place-items-center bg-white/70">
                      <Spinner className="w-5 h-5 text-brand-600" />
                    </span>
                  )}
                  <input
                    id="brand-logo"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={onLogoPick}
                    disabled={uploading}
                  />
                </label>

                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">Company logo</p>
                  {uploadFailed ? (
                    <p className="text-xs text-rose-600 mt-0.5 leading-relaxed">
                      That upload did not complete, so no logo will be saved. You can add one
                      later from Profile.
                    </p>
                  ) : logoUrl ? (
                    <p className="text-xs text-jade-600 mt-0.5 inline-flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Uploaded
                    </p>
                  ) : (
                    <p className="text-xs text-muted mt-0.5">PNG or JPG, under 4 MB. Optional.</p>
                  )}

                  {(preview || logoUrl) && (
                    <button
                      type="button"
                      onClick={clearLogo}
                      className="text-xs text-muted hover:text-ink mt-1 inline-flex items-center gap-1 focusable"
                    >
                      <X className="w-3 h-3" /> Remove
                    </button>
                  )}
                </div>
              </motion.div>

              <motion.div variants={withReducedMotion(rise, reduced)}>
                <TextField
                  id="brand-name"
                  label="Company name"
                  required
                  value={form.companyName}
                  onChange={(v) => set('companyName', v)}
                  placeholder="e.g. Mamaearth"
                  autoComplete="organization"
                  hint={state.known.displayName
                    ? 'From your signup — edit it if it should read differently.'
                    : undefined}
                />
              </motion.div>

              {/* Pairs stack below `sm`. They used to stay two-up at every width. */}
              <motion.div
                variants={withReducedMotion(rise, reduced)}
                className="grid grid-cols-1 sm:grid-cols-2 gap-4"
              >
                <SelectField
                  id="brand-industry"
                  label="Business category"
                  required
                  value={form.industry}
                  onChange={(v) => set('industry', v)}
                  options={CATEGORIES}
                  placeholder="Choose one"
                />
                <TextField
                  id="brand-city"
                  label="City"
                  value={form.city}
                  onChange={(v) => set('city', v)}
                  placeholder="e.g. Mumbai"
                  autoComplete="address-level2"
                />
              </motion.div>

              <motion.div
                variants={withReducedMotion(rise, reduced)}
                className="grid grid-cols-1 sm:grid-cols-2 gap-4"
              >
                <TextField
                  id="brand-contact-person"
                  label="Contact person"
                  value={form.contactPerson}
                  onChange={(v) => set('contactPerson', v)}
                  placeholder="Who creators will hear from"
                  autoComplete="name"
                />

                {/*
                  Only the channel signup did not verify. Asking for both means
                  asking for one the account already holds and has confirmed.
                */}
                {asking ? (
                  <TextField
                    id="brand-contact"
                    label={asking === 'phone' ? 'Contact phone' : 'Contact email'}
                    required
                    type={asking === 'phone' ? 'tel' : 'email'}
                    inputMode={asking === 'phone' ? 'tel' : 'email'}
                    autoComplete={asking === 'phone' ? 'tel' : 'email'}
                    value={form.contact}
                    onChange={(v) => set('contact', v)}
                    placeholder={asking === 'phone' ? '+91 90000 00000' : 'brand@company.com'}
                    error={form.contact && !contactValid
                      ? (asking === 'phone' ? 'Enter a valid mobile number.' : 'Enter a valid email address.')
                      : undefined}
                  />
                ) : (
                  <div>
                    <span className="field-label">Contact</span>
                    <p className="mt-2 text-sm text-ink flex items-center gap-1.5">
                      <Check className="w-4 h-4 text-jade-600" />
                      {state.known.email || state.known.phone}
                    </p>
                    <p className="text-xs text-muted mt-1">Verified at signup.</p>
                  </div>
                )}
              </motion.div>

              <motion.div variants={withReducedMotion(rise, reduced)}>
                <TextField
                  id="brand-website"
                  label="Website"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  value={form.website}
                  onChange={(v) => set('website', v)}
                  placeholder="https://"
                  error={form.website && !websiteValid ? 'Include the https:// prefix.' : undefined}
                  hint="Optional — it helps creators recognise you."
                />
              </motion.div>

              <motion.div variants={withReducedMotion(rise, reduced)}>
                <TextField
                  id="brand-about"
                  label="What your brand does"
                  textarea
                  maxLength={ABOUT_MAX}
                  value={form.about}
                  onChange={(v) => set('about', v)}
                  placeholder="A couple of sentences a creator can read before deciding whether to work with you."
                  hint={`Optional. ${ABOUT_MAX - form.about.length} characters left.`}
                />
              </motion.div>

              <motion.button
                variants={withReducedMotion(rise, reduced)}
                whileTap={reduced || !canSubmit ? undefined : { scale: 0.99 }}
                onClick={finish}
                disabled={!canSubmit}
                className="btn-brand w-full justify-center py-3"
              >
                {busy
                  ? <><Spinner className="w-5 h-5" /> Setting up your account…</>
                  : 'Finish and start hiring'}
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── fields ────────────────────────────────────── */

/**
 * A labelled field with its error and hint wired up.
 *
 * The previous local `Field` rendered a `<label>` with no `htmlFor` and an
 * `<input>` with no `id`, which is a label only visually: it does not focus the
 * field when tapped, and assistive technology announces an unnamed textbox.
 */
function TextField({
  id, label, value, onChange, textarea, type = 'text',
  error, hint, required, ...props
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const common = {
    id,
    value,
    onChange: (e) => onChange(e.target.value),
    'aria-invalid': Boolean(error) || undefined,
    'aria-describedby': describedBy,
    'aria-required': required || undefined,
    className: `w-full border rounded-lg px-3 py-2.5 text-sm bg-white transition-colors focusable
                ${error ? 'border-rose-300' : 'border-line focus:border-brand-400'}`,
    ...props,
  };

  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        {required && <span className="text-rose-500 ml-0.5" aria-hidden="true">*</span>}
      </label>
      <div className="mt-1.5">
        {textarea ? <textarea rows={3} {...common} /> : <input type={type} {...common} />}
      </div>
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
      {!error && hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function SelectField({ id, label, value, onChange, options, placeholder, required }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        {required && <span className="text-rose-500 ml-0.5" aria-hidden="true">*</span>}
      </label>
      {/*
        No pre-selected value. The old version defaulted to "Sportswear", so a
        brand that never touched the control was filed under a category it did
        not choose — and the field looked answered, so nobody noticed.
      */}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required || undefined}
        className="w-full mt-1.5 border border-line rounded-lg px-3 py-2.5 text-sm bg-white
                   focus:border-brand-400 transition-colors focusable"
      >
        <option value="" disabled>{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

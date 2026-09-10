import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Logo } from '../components/ui';
import { Platform, Check, ChevRight, X, ShieldCheck, Verified } from '../components/icons';
import { Spinner, useToast, ErrorBlock } from '../lib/ui-state';
import { Skeleton, SkeletonText, SuccessMark } from '../components/feedback';
import { authStep, rise, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * Creator onboarding.
 *
 * Two steps, and the important property is what is *absent* from step one.
 *
 * Signup already collects a display name and a city, and the previous version of
 * this page asked for both again — the same two questions, back to back, with
 * the second copy overwriting the first. It also asked for a category from a
 * single-select dropdown, and demanded Instagram specifically while Facebook and
 * YouTube integrations sat unused.
 *
 *   Step 1  Complete your profile   picture, bio, the contact channel you did
 *                                   NOT sign up with, and 3+ categories
 *   Step 2  Connect a social account  Instagram, Facebook or YouTube — any one
 *
 * Everything already known comes from `GET /users/me/onboarding`, which the
 * server derives from the account rather than the client guessing. That endpoint
 * is also what makes a refresh resume at the right step instead of restarting,
 * and what stops a finished user being shown this page at all.
 *
 * ── What this pass fixed ────────────────────────────────────────────────────
 *
 *  1. **An avatar upload that failed was recorded as an avatar.** `AvatarPicker`
 *     did `await fetch(uploadUrl, { method: 'PUT', … })` and never looked at the
 *     result. `fetch` only rejects on a network failure — a 403 from expired
 *     signed-URL credentials, or a 413 on an oversized object, comes back as a
 *     *resolved* response with `ok: false`. So the next line set the profile
 *     picture to the URL of a file that does not exist, and the creator went on
 *     to be listed in discovery with a broken image. The response is checked
 *     now, and a URL is only accepted if the storage service actually issued
 *     one.
 *  2. **The refusal panel had its own amber palette.** Ochre carries "waiting
 *     on you" throughout Marqueiver; a bare Tailwind `amber` beside it is a
 *     near-miss, which reads worse than a clearly different colour.
 *  3. **The step swap had no exit**, so going back from "Connect an account"
 *     to "Complete your profile" read as the page redrawing rather than as a
 *     step back.
 *  4. **The social step's footer did not stack.** "Back" plus "Finish and go to
 *     dashboard" on one row put the primary action at about 150px on a small
 *     phone, with the label wrapping to three lines.
 *  5. Hand-rolled shimmer and error markup, where the system has both.
 */

/** Creator niches. Multi-select, minimum three — see MIN_CATEGORIES server-side. */
const CATEGORIES = [
  'Fitness', 'Lifestyle', 'Fashion', 'Beauty', 'Tech', 'Gaming',
  'Travel', 'Food', 'Finance', 'Education', 'Wellness', 'Parenting',
  'Comedy', 'Music', 'Art & Design', 'Sports', 'Automotive', 'Home & Decor',
  'Photography', 'Business', 'Books', 'Pets',
];

const LANGUAGES = ['English', 'Hindi', 'Tamil', 'Telugu', 'Bengali', 'Marathi', 'Kannada', 'Punjabi'];

const BIO_MIN = 40;
const BIO_MAX = 500;

export default function InfluencerOnboarding() {
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const nav = useNavigate();
  const toast = useToast();

  const reduced = usePrefersReducedMotion();
  const [state, setState] = useState(null);      // server's onboarding snapshot
  const [step, setStep] = useState(1);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Step 1 fields — never a name or a city; signup already has those.
  const [avatarUrl, setAvatarUrl] = useState('');
  const [bio, setBio] = useState('');
  const [contact, setContact] = useState('');
  const [categories, setCategories] = useState([]);
  const [language, setLanguage] = useState('English');
  const [touched, setTouched] = useState(false);

  /** Load (or reload) what the server knows and resume at the right step. */
  const load = useCallback(async ({ silent = false } = {}) => {
    try {
      const { data } = await api.onboardingState();
      setState(data);
      setAvatarUrl((v) => v || data.known.avatarUrl || '');
      setBio((v) => v || data.known.bio || '');
      setCategories((v) => (v.length ? v : data.known.categories || []));

      // A finished account must never be walked through this again.
      if (data.onboardingComplete) { nav('/dashboard', { replace: true }); return; }
      if (!silent) setStep(data.stage === 'profile_completed' ? 2 : 1);
    } catch (err) {
      setLoadError(err);
    }
  }, [nav]);

  useEffect(() => { load(); }, [load]);

  /* Returning from a social OAuth redirect. Every provider comes back with the
     same query shape, so one handler covers all three. */
  useEffect(() => {
    const platform = ['ig', 'fb', 'yt'].find((k) => params.get(k));
    if (!platform) return;
    const status = params.get(platform);

    if (status === 'connected') {
      toast.push('Account connected', 'success');
      load({ silent: true });
      setStep(2);
    } else if (status === 'error') {
      toast.push(params.get('message') || 'That connection did not complete', 'error');
      setStep(2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const known = state?.known;
  const minCategories = state?.minCategories ?? 3;

  /**
   * Which contact detail to ask for — precisely the one signup did not verify.
   * An email signup is asked for a phone, a WhatsApp signup for an email, and a
   * Google signup for a phone. Neither is ever requested twice.
   */
  const asking = useMemo(() => {
    if (!state) return null;
    if (state.needs.phone) return 'phone';
    if (state.needs.email) return 'email';
    return null;
  }, [state]);

  const bioOk = bio.trim().length >= BIO_MIN && bio.trim().length <= BIO_MAX;
  const categoriesOk = categories.length >= minCategories;
  const contactOk = !asking || !contact.trim() || (asking === 'email'
    ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact.trim())
    : contact.replace(/\D/g, '').length >= 10);
  const step1Ok = bioOk && categoriesOk && contactOk;

  const toggleCategory = (c) =>
    setCategories((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]));

  async function saveProfile() {
    setTouched(true);
    if (!step1Ok) return;
    setBusy(true);
    try {
      await api.updateCreator({
        avatarUrl,
        bio: bio.trim(),
        categories,
        languages: [language],
        ...(asking === 'email' && contact.trim() ? { contactEmail: contact.trim() } : {}),
        ...(asking === 'phone' && contact.trim() ? { contactPhone: contact.trim() } : {}),
      });
      await load({ silent: true });
      setStep(2);
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      await api.completeOnboarding();
      await refresh();
      toast.push("You're all set", 'success');
      nav('/dashboard', { replace: true });
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <Shell>
        {/* The system's error block, so a failure here looks like a failure
            anywhere else — and carries the same retry. */}
        <ErrorBlock error={loadError} onRetry={() => { setLoadError(null); load(); }} />
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell>
        <div
          className="card-edge p-6"
          aria-busy="true"
          aria-live="polite"
          aria-label="Loading your onboarding"
        >
          <Skeleton className="h-5 w-44 rounded" />
          <div className="flex items-center gap-4 mt-6">
            <Skeleton className="w-20 h-20" circle />
            <div className="flex-1">
              <Skeleton className="h-4 w-32 rounded" />
              <Skeleton className="h-3 w-40 rounded mt-2" />
            </div>
          </div>
          <SkeletonText lines={3} className="mt-6" />
          <Skeleton className="h-24 w-full rounded-xl2 mt-6" />
          <Skeleton className="h-11 w-full rounded-xl2 mt-6" />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Stepper step={step} />

      {/* What signup already gave us, shown as fact rather than asked again. */}
      <KnownSummary known={known} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          variants={withReducedMotion(authStep(step === 1), reduced)}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
        {step === 1 ? (
          <div className="card-edge p-5 sm:p-7">
            <h2 className="font-display font-extrabold text-xl text-ink">Complete your profile</h2>
            <p className="text-sm text-muted mt-1.5 mb-6">
              This is what brands see when they find you. You can change any of it later.
            </p>

            <AvatarPicker value={avatarUrl} onChange={setAvatarUrl} onError={(m) => toast.push(m, 'error')} />

            <div className="mt-6">
              <label htmlFor="bio" className="field-label">
                Bio
                <span className={`float-right font-normal tnum ${
                  bio.length > BIO_MAX ? 'text-rose-600' : 'text-muted'}`}
                >
                  {bio.length}/{BIO_MAX}
                </span>
              </label>
              <textarea
                id="bio"
                rows={4}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={BIO_MAX + 40}
                aria-invalid={touched && !bioOk}
                className="field resize-y"
                placeholder="What you make, who watches, and what you are like to work with."
              />
              {touched && !bioOk && (
                <p className="field-error">
                  {bio.trim().length < BIO_MIN
                    ? `Write at least ${BIO_MIN} characters — brands skip empty profiles.`
                    : `Keep it under ${BIO_MAX} characters.`}
                </p>
              )}
            </div>

            {asking && (
              <div className="mt-5">
                <label htmlFor="contact" className="field-label">
                  {asking === 'email' ? 'Email address' : 'Mobile number'}
                  <span className="ml-2 text-xs font-normal text-muted">Optional</span>
                </label>
                <input
                  id="contact"
                  type={asking === 'email' ? 'email' : 'tel'}
                  inputMode={asking === 'email' ? 'email' : 'tel'}
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  aria-invalid={touched && !contactOk}
                  className="field"
                  placeholder={asking === 'email' ? 'you@example.com' : '+91 90000 00000'}
                />
                {touched && !contactOk ? (
                  <p className="field-error">
                    {asking === 'email' ? 'Enter a valid email address.' : 'Enter a valid mobile number.'}
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-muted">
                    Saved to your profile. To use it to sign in as well, verify it later from Settings.
                  </p>
                )}
              </div>
            )}

            <div className="mt-6">
              <label className="field-label">
                Languages you create in
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="field bg-white"
              >
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            <CategoryPicker
              selected={categories}
              onToggle={toggleCategory}
              min={minCategories}
              showError={touched && !categoriesOk}
            />

            <button
              onClick={saveProfile}
              disabled={busy || (touched && !step1Ok)}
              className="btn-brand w-full justify-center py-3 mt-7"
            >
              {busy ? <><Spinner className="w-5 h-5" /> Saving…</> : <>Continue <ChevRight className="w-4 h-4" /></>}
            </button>
          </div>
        ) : (
          <SocialStep
            state={state}
            busy={busy}
            onBack={() => setStep(1)}
            onFinish={finish}
            onRefresh={() => load({ silent: true })}
          />
        )}
        </motion.div>
      </AnimatePresence>
    </Shell>
  );
}

/* ─────────────────────────────────── chrome ────────────────────────────────── */

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-2xl mx-auto px-5 sm:px-6 py-8 sm:py-10">
        <div className="mb-8"><Logo /></div>
        {children}
      </div>
    </div>
  );
}

function Stepper({ step }) {
  const steps = ['Complete your profile', 'Connect an account'];
  return (
    <div
      className="flex items-center gap-3 mb-6"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={steps.length}
      aria-valuenow={step}
      aria-valuetext={`Step ${step} of ${steps.length}: ${steps[step - 1]}`}
    >
      {steps.map((label, i) => {
        const n = i + 1;
        const done = step > n;
        return (
          <div key={label} className="flex items-center gap-2.5 flex-1 min-w-0">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                              transition-colors ${
                                done ? 'bg-jade-500 text-white'
                                  : step === n ? 'bg-brand-600 text-white'
                                    : 'bg-white border border-line text-muted'}`}
            >
              {done ? <Check className="w-4 h-4" /> : n}
            </span>
            <span className={`text-sm font-medium truncate ${step === n ? 'text-ink' : 'text-muted'}`}>
              {label}
            </span>
            {i === 0 && <div className="flex-1 h-px bg-line hidden sm:block" />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * What signup already captured. Shown read-only so the user can see it was
 * carried over rather than wondering why nobody asked.
 */
function KnownSummary({ known }) {
  if (!known) return null;
  const rows = [
    known.displayName && ['Name', known.displayName, false],
    known.city && ['City', known.city, false],
    known.email && ['Email', known.email, known.emailVerified],
    known.phone && ['Mobile', known.phone, known.phoneVerified],
  ].filter(Boolean);
  if (!rows.length) return null;

  return (
    <div className="rounded-xl2 border border-line bg-white/70 p-4 mb-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
        From your signup
      </p>
      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
        {rows.map(([label, value, verified]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 min-w-0">
            <dt className="text-xs text-muted shrink-0">{label}</dt>
            <dd className="text-sm text-ink font-medium truncate flex items-center gap-1.5">
              <span className="truncate">{value}</span>
              {verified && <Verified className="w-3.5 h-3.5 shrink-0" title="Verified" />}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ────────────────────────────────── avatar ─────────────────────────────────── */

function AvatarPicker({ value, onChange, onError }) {
  const input = useRef(null);
  const [uploading, setUploading] = useState(false);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';                 // allow re-picking the same file
    if (!file) return;

    if (!file.type.startsWith('image/')) { onError('Choose an image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { onError('Keep the image under 5 MB.'); return; }

    setUploading(true);
    try {
      const { data } = await api.avatarUploadUrl(file.name, file.type);
      if (!data?.uploadUrl) throw new Error('The upload service did not issue a URL.');

      // The signed PUT goes straight to storage; the API only ever issues the URL.
      const res = await fetch(data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      /*
        `fetch` rejects only on a network failure. A 403 from an expired signed
        URL, or a 413 on an oversized object, resolves normally with
        `ok: false` — and the old code went straight on to `onChange(...)`,
        recording a profile picture for a file that had never been stored. The
        creator then appeared in discovery with a broken image and no error had
        ever been shown.
      */
      if (!res.ok) throw new Error(`The image did not upload (${res.status}). Please try again.`);

      const url = data.publicUrl ?? data.fileUrl ?? data.url;
      if (!url) throw new Error('The upload finished but no address came back for the image.');
      onChange(url);
    } catch (err) {
      onError(err.message || 'That upload did not complete.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        {value ? (
          <img
            src={value}
            alt="Your profile picture"
            className="w-20 h-20 rounded-full object-cover border border-line"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-lilac border border-brand-100
                          flex items-center justify-center text-brand-400">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.6" aria-hidden="true">
              <circle cx="12" cy="9" r="3.4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
            </svg>
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 rounded-full bg-white/70 flex items-center justify-center">
            <Spinner className="w-5 h-5 text-brand-600" />
          </div>
        )}
      </div>

      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">Profile picture</p>
        <p className="text-xs text-muted mt-0.5">JPG or PNG, up to 5 MB.</p>
        <div className="flex flex-wrap gap-2 mt-2.5">
          <button type="button" onClick={() => input.current?.click()} disabled={uploading}
            className="btn-outline !py-1.5 !px-3 !text-xs">
            {value ? 'Change' : 'Upload'}
          </button>
          {value && (
            <button type="button" onClick={() => onChange('')}
              className="btn-ghost !py-1.5 !px-3 !text-xs">
              Remove
            </button>
          )}
        </div>
        <input ref={input} type="file" accept="image/*" onChange={pick} className="sr-only" />
      </div>
    </div>
  );
}

/* ───────────────────────────────── categories ──────────────────────────────── */

/**
 * Multi-select chips, replacing a single-select dropdown.
 *
 * A creator is rarely one niche, and discovery filters on this array — a single
 * value made most creators unfindable for searches they should have matched.
 */
function CategoryPicker({ selected, onToggle, min, showError }) {
  const remaining = Math.max(0, min - selected.length);

  return (
    <fieldset className="mt-6">
      <legend className="field-label !mb-0">
        Your categories
        <span className="ml-2 text-xs font-normal text-muted">Choose {min} or more</span>
      </legend>

      <p className={`text-xs mt-1 mb-3 ${showError ? 'text-rose-600' : 'text-muted'}`} aria-live="polite">
        {remaining > 0
          ? `Select at least ${remaining} more ${remaining === 1 ? 'category' : 'categories'} to continue.`
          : `${selected.length} selected.`}
      </p>

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => {
          const on = selected.includes(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => onToggle(c)}
              aria-pressed={on}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm
                          transition-all duration-150 focus-visible:outline-none
                          focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1
                          ${on
                            ? 'bg-brand-600 border-brand-600 text-white shadow-flat'
                            : 'bg-white border-line text-ink-soft hover:border-brand-300 hover:text-ink'}`}
            >
              {on && <Check className="w-3.5 h-3.5" />}
              {c}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/* ──────────────────────────────── social step ──────────────────────────────── */

const PLATFORM_META = {
  instagram: { label: 'Instagram', note: 'Creator or Business accounts only' },
  facebook: { label: 'Facebook', note: 'Requires a Facebook Page' },
  youtube: { label: 'YouTube', note: 'Connects your channel' },
};

function SocialStep({ state, busy, onBack, onFinish, onRefresh }) {
  const toast = useToast();
  const [connecting, setConnecting] = useState(null);
  const [issue, setIssue] = useState(null);       // eligibility / duplicate error

  const connected = state.connected ?? [];
  const isConnected = (p) => connected.some((c) => c.platform === p);
  const hasOne = connected.length > 0;

  async function connect(platform) {
    setConnecting(platform);
    setIssue(null);
    try {
      const { data } = platform === 'instagram' ? await api.instagramAuthUrl()
        : platform === 'facebook' ? await api.facebookAuthUrl()
          : await api.youtubeAuthUrl();
      window.location.href = data.authUrl;
    } catch (err) {
      // The backend refuses ineligible and already-claimed accounts with a code
      // and instructions; surface those rather than a bare message.
      setIssue({ platform, ...(err.detail ?? {}), message: err.message });
      setConnecting(null);
    }
  }

  async function disconnect(platform) {
    setConnecting(platform);
    try {
      if (platform === 'instagram') await api.instagramDisconnect();
      else if (platform === 'facebook') await api.disconnectFacebook();
      else await api.disconnectYoutube();
      await onRefresh();
      toast.push('Disconnected', 'success');
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setConnecting(null);
    }
  }

  return (
    <div className="card-edge p-5 sm:p-7">
      <h2 className="font-display font-extrabold text-xl text-ink">Connect a social account</h2>
      <p className="text-sm text-muted mt-1.5 mb-5">
        Connect at least one account to continue. Your audience and engagement figures come from
        here rather than being typed in, which is what brands search on.
      </p>

      {issue && <ConnectionIssue issue={issue} onDismiss={() => setIssue(null)} />}

      <div className="space-y-3">
        {['instagram', 'facebook', 'youtube'].map((p) => {
          const account = connected.find((c) => c.platform === p);
          return (
            <PlatformRow
              key={p}
              platform={p}
              account={account}
              busy={connecting === p}
              onConnect={() => connect(p)}
              onDisconnect={() => disconnect(p)}
            />
          );
        })}
      </div>

      {/*
        Stacked below `sm`, primary first. Side by side, "Finish and go to
        dashboard" sat in about 150px on a small phone with its label on three
        lines, next to a "Back" that needs none of that room.
      */}
      <div className="flex flex-col-reverse sm:flex-row gap-2 mt-7">
        <button onClick={onBack} className="btn-ghost sm:w-auto justify-center">Back</button>
        <button
          onClick={onFinish}
          disabled={!hasOne || busy}
          className="btn-brand flex-1 justify-center py-3"
        >
          {busy ? <><Spinner className="w-5 h-5" /> Finishing…</> : 'Finish and go to dashboard'}
        </button>
      </div>

      {!hasOne && (
        <p className="text-xs text-muted text-center mt-3">
          Connect Instagram, Facebook or YouTube to finish.
        </p>
      )}
    </div>
  );
}

function PlatformRow({ platform, account, busy, onConnect, onDisconnect }) {
  const meta = PLATFORM_META[platform];
  const connected = Boolean(account);

  return (
    <div className={`rounded-xl2 border p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4
                     transition-colors ${
      connected ? 'border-jade-100 bg-jade-50/60' : 'border-line bg-white'}`}
    >
      <div className="flex items-center gap-4 flex-1 min-w-0">
      {account?.image ? (
        <img src={account.image} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
      ) : (
        <Platform name={platform} className="w-10 h-10 shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-ink text-[15px]">{meta.label}</span>
          {connected && <Check className="w-4 h-4 text-jade-600 shrink-0" />}
        </div>
        <p className="text-xs text-muted truncate mt-0.5">
          {connected
            ? `${account.handle}${account.followers ? ` · ${account.followers.toLocaleString()} followers` : ''}`
            : meta.note}
        </p>
      </div>
      </div>

      {/* Full width when the row is stacked; hugging its label when it is not. */}
      {connected ? (
        <button onClick={onDisconnect} disabled={busy}
          className="btn-ghost !py-2 !px-3 !text-xs shrink-0 w-full sm:w-auto justify-center">
          {busy ? <Spinner className="w-4 h-4" /> : 'Disconnect'}
        </button>
      ) : (
        <button onClick={onConnect} disabled={busy}
          className="btn-outline !py-2 !px-4 !text-xs shrink-0 w-full sm:w-auto justify-center">
          {busy ? <Spinner className="w-4 h-4" /> : 'Connect'}
        </button>
      )}
    </div>
  );
}

/**
 * A refused connection, with the fix.
 *
 * The two cases that matter both have a concrete remedy, so the panel carries
 * the steps and a link rather than only stating the problem: an Instagram
 * account that is not Creator/Business, and an account already claimed by
 * another Marqueiver user.
 */
function ConnectionIssue({ issue, onDismiss }) {
  const steps = issue.details?.howTo ?? issue.howTo ?? [];
  const url = issue.details?.switchUrl ?? issue.switchUrl;
  const label = issue.details?.platform === 'instagram' || issue.platform === 'instagram'
    ? 'Switch to a Creator account'
    : 'Open Facebook Pages';

  return (
    /*
      Ochre, not amber. "Waiting on something you have to do" is ochre
      everywhere else in Marqueiver — an unfunded escrow, a pending review — and
      this is exactly that: the connection is refused until the creator changes
      something on Instagram. A neighbouring-but-different orange reads as a
      mistake rather than as a different meaning.
    */
    <div className="rounded-xl2 border border-money-100 bg-money-50 p-4 mb-5" role="alert">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-money-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{issue.message}</p>

          {steps.length > 0 && (
            <ol className="mt-2.5 space-y-1 text-[13px] text-ink-soft list-decimal pl-4">
              {steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
          )}

          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline !py-1.5 !px-3 !text-xs mt-3 inline-flex"
            >
              {label}
            </a>
          )}
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" className="text-muted hover:text-ink shrink-0 focusable">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

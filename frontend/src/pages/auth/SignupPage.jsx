import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Spinner } from '../../lib/ui-state';
import { AuthShell, AuthHeading, AuthSteps, BackButton } from '../../components/auth/AuthShell';
import {
  MethodButton, MethodUnavailable, AuthError, DevCodeNote, Field, OrDivider,
  WhatsAppMark, MailMark,
} from '../../components/auth/AuthBits';
import { OtpInput, ResendTimer } from '../../components/auth/OtpInput';
import { PolicyConsent, PolicyConsentSkeleton } from '../../components/auth/PolicyConsent';
import { useOtpFlow, useAuthConfig, useGoogle } from '../../components/auth/useAuthFlow';

/**
 * Signup.
 *
 *   1  role      — Creator or Brand. Everything after this is role-specific.
 *   2  method    — Google, email, or WhatsApp.
 *   3  verify    — the code, or Google's own screen.
 *   4  details   — the role's own fields, and the 18+ declaration (Policy 1.3).
 *   5  policies  — the policies that bind *this* role (Policy 24), then create.
 *
 * The account does not exist until step 5 completes. That ordering is the whole
 * design: the server will not create an account without the required policy
 * acceptances, so there is no window in which a user exists without a consent
 * record, and no "accept this later" popup to chase.
 *
 * Role is chosen here because here is the only place it is chosen. It is sent
 * once, on account creation. Login has no equivalent and cannot be given one.
 */

const ROLES = [
  {
    key: 'creator',
    label: 'Creator',
    tagline: 'I make content and want paid brand work.',
    points: [
      'Get discovered on verified audience data',
      'Receive briefs with the budget already attached',
      'Paid from escrow when your work is approved',
    ],
    accent: 'from-brand-500 to-pink-500',
  },
  {
    key: 'brand',
    label: 'Brand',
    tagline: 'I run campaigns and want to hire creators.',
    points: [
      'Search creators on verified metrics, not follower counts',
      'Send briefs with terms, deadlines and usage rights',
      'Fund escrow, release only on approval',
    ],
    accent: 'from-money-500 to-brand-600',
  },
];

/**
 * Five steps as far as the user is concerned. `phone` and `email` are the second
 * half of choosing a method, not steps of their own — the progress bar would
 * otherwise jump backwards for OTP users and not for Google users, which reads
 * as a bug rather than as a shorter path.
 */
const STEPS = ['role', 'method', 'verify', 'details', 'policies'];
const STEP_POSITION = {
  role: 1, method: 2, phone: 2, email: 2, verify: 3, details: 4, policies: 5,
};

export default function SignupPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { login } = useAuth();
  const { config } = useAuthConfig();

  const presetRole = ROLES.some((r) => r.key === params.get('role')) ? params.get('role') : null;

  const [role, setRole] = useState(presetRole);
  const [step, setStep] = useState(presetRole ? 'method' : 'role');
  const [direction, setDirection] = useState('forward');

  // Set once an identity is verified, by OTP or by Google. Until then no account
  // can be created, because the server requires it.
  const [verification, setVerification] = useState(null);

  const [draftPhone, setDraftPhone] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [fieldError, setFieldError] = useState({});

  const [profile, setProfile] = useState({ displayName: '', website: '', city: '' });
  const [dob, setDob] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [policies, setPolicies] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const otp = useOtpFlow({ purpose: 'signup' });

  const go = useCallback((next, dir = 'forward') => {
    setDirection(dir);
    setStep(next);
    setSubmitError(null);
  }, []);

  /* Google can hand back an identity on this page (in-page flow) or via the
     callback route (redirect flow), which navigates here with state. */
  const onGoogleIdentity = useCallback((data) => {
    if (data.accountExists) {
      // Already registered — send them to login rather than through a signup
      // that is going to be refused at the last step.
      setSubmitError({
        message: 'You already have a Marqueiver account with that Google address.',
        detail: { code: 'EMAIL_ALREADY_REGISTERED' },
      });
      return;
    }
    setVerification(data.verificationToken);
    setProfile((p) => ({ ...p, displayName: p.displayName || (data.name ?? '') }));

    /**
     * A Google user who started from the *login* page has no role yet — nothing
     * in that flow ever asked. Sending them straight to `details` skipped role
     * selection entirely and then failed at account creation, because the server
     * requires a role. Land them on the role step instead; `chooseRole` sees the
     * verification already in hand and continues from there.
     */
    go(data.role || role ? 'details' : 'role');
  }, [go, role]);

  // `role` rides along in the signed OAuth state so the callback can bring it
  // back; the identity itself returns through /auth/google/callback.
  const google = useGoogle({ intent: 'signup', role });

  /* A returning redirect-flow user lands back here with an identity in hand. */
  useEffect(() => {
    const handoff = window.history.state?.usr?.googleIdentity;
    if (handoff) {
      if (handoff.role) setRole(handoff.role);
      onGoogleIdentity(handoff);
    }
  }, [onGoogleIdentity]);

  /* The policies that bind this role. Fetched as soon as the role is known so
     the consent step never shows an empty checkbox while it loads. */
  useEffect(() => {
    if (!role) return;
    let alive = true;
    setPolicies(null);
    api.signupRequirements(role)
      .then(({ data }) => alive && setPolicies(data.policies))
      .catch((err) => alive && setSubmitError(err));
    return () => { alive = false; };
  }, [role]);

  const isAdult = useMemo(() => {
    if (!dob) return null;
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return null;
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    return d <= cutoff;
  }, [dob]);

  const stepIndex = STEP_POSITION[step] ?? 1;
  const roleMeta = ROLES.find((r) => r.key === role);
  const anim = direction === 'forward' ? 'anim-step' : 'anim-step-back';

  /* ── sending a code ──────────────────────────────────────────────────────── */

  async function startPhone() {
    setFieldError({});
    if (draftPhone.replace(/\D/g, '').length < 10) {
      setFieldError({ phone: 'Enter a valid mobile number.' });
      return;
    }
    const sent = await otp.send('phone', draftPhone);
    if (!sent) return;
    if (sent.accountExists) {
      setSubmitError({
        message: 'That mobile number already has a Marqueiver account.',
        detail: { code: 'PHONE_ALREADY_REGISTERED' },
      });
      return;
    }
    go('verify');
  }

  async function startEmail() {
    setFieldError({});
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(draftEmail)) {
      setFieldError({ email: 'Enter a valid email address.' });
      return;
    }
    const sent = await otp.send('email', draftEmail);
    if (!sent) return;
    if (sent.accountExists) {
      setSubmitError({
        message: 'That email address already has a Marqueiver account.',
        detail: { code: 'EMAIL_ALREADY_REGISTERED' },
      });
      return;
    }
    go('verify');
  }

  async function submitCode(value) {
    const data = await otp.verify(value);
    if (!data) return;
    if (data.accountExists) {
      setSubmitError({
        message: 'You already have a Marqueiver account.',
        detail: { code: 'EMAIL_ALREADY_REGISTERED' },
      });
      return;
    }
    setVerification(data.verificationToken);
    setTimeout(() => go('details'), 220);   // let the success state land first
  }

  /* ── creating the account ────────────────────────────────────────────────── */

  async function createAccount() {
    if (!accepted || !policies) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data } = await api.signup({
        verificationToken: verification,
        role,
        dob,
        ageDeclared18Plus: true,
        acceptedPolicies: policies.map((p) => p.slug),
        profile: {
          ...(role === 'creator'
            ? { displayName: profile.displayName, city: profile.city }
            : { companyName: profile.displayName, website: profile.website }),
        },
      });
      login(data);
      nav(data.next?.path ?? '/dashboard', { replace: true });
    } catch (err) {
      setSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  }

  /* ── render ──────────────────────────────────────────────────────────────── */

  return (
    <AuthShell wide={step === 'role'} aside={roleMeta ? <RoleAside role={roleMeta} /> : undefined}>
      <div className="mb-5 flex items-center justify-between gap-4">
        <AuthSteps total={STEPS.length} current={stepIndex} />
        <p className="text-sm text-white/60 shrink-0">
          Have an account?{' '}
          <Link to="/login" className="font-semibold text-white hover:underline">Log in</Link>
        </p>
      </div>

      <div key={step} className={anim}>
        {step === 'role' && (
          <RoleStep
            onChoose={(key) => {
              setRole(key);
              // A Google user who arrived already verified picks a role and goes
              // straight on — re-asking them to choose a sign-in method they
              // have already completed would be a dead end.
              go(verification ? 'details' : 'method');
            }}
          />
        )}

        {step === 'method' && (
          <div className="auth-card">
            <BackButton onClick={() => go('role', 'back')} >Change account type</BackButton>
            <AuthHeading
              eyebrow={`${roleMeta.label} account`}
              title="How would you like to sign up?"
              sub="You can add the others later — Marqueiver needs both a mobile number and an email before you can start collaborating."
            />

            <AuthError error={submitError} />

            <div className="space-y-3 mt-4 stagger">
              {config?.methods?.google?.enabled !== false ? (
                <MethodButton
                  method="google" label="Continue with Google" busy={google.busy}
                  onClick={google.start}
                />
              ) : (
                <MethodUnavailable label="Continue with Google" reason="Not configured on this environment" />
              )}

              <OrDivider />

              {config?.methods?.email?.enabled !== false ? (
                <MethodButton
                  method="email" label="Continue with email"
                  hint="We'll send a 6-digit code"
                  onClick={() => go('email')}
                />
              ) : (
                <MethodUnavailable label="Continue with email" reason="Not configured on this environment" />
              )}

              {config?.methods?.phone?.enabled !== false ? (
                <MethodButton
                  method="whatsapp" label="Continue with WhatsApp"
                  hint="Code sent to your WhatsApp — no SMS"
                  onClick={() => go('phone')}
                />
              ) : (
                <MethodUnavailable label="Continue with WhatsApp" reason="Not configured on this environment" />
              )}
            </div>
          </div>
        )}

        {step === 'phone' && (
          <div className="auth-card">
            <BackButton onClick={() => go('method', 'back')} />
            <AuthHeading
              eyebrow="Step 2 of 5"
              title="What's your WhatsApp number?"
              sub="We'll send a 6-digit code to this number on WhatsApp."
            />
            <AuthError error={otp.error ?? submitError} />
            <div className="space-y-4 mt-4">
              <Field
                id="signup-phone" label="Mobile number" type="tel" inputMode="tel"
                autoComplete="tel" placeholder="+91 90000 00000"
                icon={<WhatsAppMark className="w-[18px] h-[18px]" />}
                value={draftPhone}
                onChange={(e) => { setDraftPhone(e.target.value); setFieldError({}); }}
                onKeyDown={(e) => e.key === 'Enter' && startPhone()}
                error={fieldError.phone}
                hint="Include your country code, or we'll assume +91."
              />
              <button onClick={startPhone} disabled={otp.sending} className="auth-btn-primary">
                {otp.sending ? <Spinner className="w-5 h-5" /> : 'Send code on WhatsApp'}
              </button>
            </div>
          </div>
        )}

        {step === 'email' && (
          <div className="auth-card">
            <BackButton onClick={() => go('method', 'back')} />
            <AuthHeading
              eyebrow="Step 2 of 5"
              title="What's your email address?"
              sub="We'll send a 6-digit code to confirm it's yours."
            />
            <AuthError error={otp.error ?? submitError} />
            <div className="space-y-4 mt-4">
              <Field
                id="signup-email" label="Email address" type="email" inputMode="email"
                autoComplete="email" placeholder="you@company.com"
                icon={<MailMark className="w-[18px] h-[18px]" />}
                value={draftEmail}
                onChange={(e) => { setDraftEmail(e.target.value); setFieldError({}); }}
                onKeyDown={(e) => e.key === 'Enter' && startEmail()}
                error={fieldError.email}
              />
              <button onClick={startEmail} disabled={otp.sending} className="auth-btn-primary">
                {otp.sending ? <Spinner className="w-5 h-5" /> : 'Send code'}
              </button>
            </div>
          </div>
        )}

        {step === 'verify' && (
          <VerifyStep
            otp={otp}
            eyebrow="Step 3 of 5"
            onBack={() => { otp.reset(); go(otp.channel === 'phone' ? 'phone' : 'email', 'back'); }}
            onSubmit={submitCode}
            extraError={submitError}
          />
        )}

        {step === 'details' && (
          <div className="auth-card">
            <AuthHeading
              eyebrow="Step 4 of 5"
              title={role === 'creator' ? 'Tell us who you are' : 'Tell us about your business'}
              sub={role === 'creator'
                ? 'This is the name brands will see. You can change it any time.'
                : 'This is the name creators will see on your briefs.'}
            />
            <AuthError error={submitError} />

            <div className="space-y-4 mt-4">
              <Field
                id="signup-name"
                label={role === 'creator' ? 'Your name or handle' : 'Company name'}
                placeholder={role === 'creator' ? 'e.g. Damyanti Verma' : 'e.g. Mamaearth'}
                autoComplete={role === 'creator' ? 'name' : 'organization'}
                value={profile.displayName}
                onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))}
              />

              {role === 'creator' ? (
                <Field
                  id="signup-city" label="City" placeholder="e.g. Mumbai"
                  autoComplete="address-level2"
                  value={profile.city}
                  onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))}
                  hint="Optional — brands often filter by location."
                />
              ) : (
                <Field
                  id="signup-website" label="Website" placeholder="https://" type="url"
                  autoComplete="url"
                  value={profile.website}
                  onChange={(e) => setProfile((p) => ({ ...p, website: e.target.value }))}
                  hint="Optional — helps creators recognise you."
                />
              )}

              {/* Policy 1.3 — 18+ is a condition of using the Platform, so it is
                  asked before the account exists rather than checked afterwards. */}
              <Field
                id="signup-dob" label="Date of birth" type="date"
                autoComplete="bday"
                max={new Date().toISOString().slice(0, 10)}
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                error={isAdult === false ? 'You must be 18 or over to use Marqueiver.' : undefined}
                hint="Marqueiver is only available to people aged 18 or over."
              />

              <button
                onClick={() => go('policies')}
                disabled={!profile.displayName.trim() || isAdult !== true}
                className="auth-btn-primary"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'policies' && (
          <div className="auth-card">
            <BackButton onClick={() => go('details', 'back')} />
            <AuthHeading
              eyebrow="Step 5 of 5"
              title="Almost there"
              sub={`These are the Marqueiver policies that apply to ${
                role === 'creator' ? 'creators' : 'brands'}. Open any of them to read the full text.`}
            />

            <AuthError error={submitError} />

            <div className="space-y-4 mt-4">
              {policies ? (
                <PolicyConsent
                  policies={policies}
                  role={role}
                  checked={accepted}
                  onChange={setAccepted}
                  invalid={submitError?.detail?.code === 'POLICY_ACCEPTANCE_REQUIRED'}
                />
              ) : (
                <PolicyConsentSkeleton />
              )}

              <button
                onClick={createAccount}
                disabled={!accepted || !policies || submitting}
                className="auth-btn-primary"
              >
                {submitting
                  ? <><Spinner className="w-5 h-5" /> Creating your account…</>
                  : `Create ${role} account`}
              </button>

              <p className="text-xs text-muted text-center leading-relaxed">
                Your acceptance is recorded against the policy version currently in force,
                with the date and time.
              </p>
            </div>
          </div>
        )}
      </div>
    </AuthShell>
  );
}

/* ─────────────────────────────── step 1: role ──────────────────────────────── */

function RoleStep({ onChoose }) {
  return (
    <div>
      <div className="text-center mb-8">
        <h1 className="font-display font-extrabold text-[2rem] sm:text-[2.6rem] leading-[1.08] tracking-tight text-white">
          Join Marqueiver
        </h1>
        <p className="text-white/65 mt-3 max-w-md mx-auto leading-relaxed">
          Marqueiver works differently for creators and brands. This decides what you set up next —
          and which policies apply to you.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 stagger">
        {ROLES.map((r) => (
          <button
            key={r.key}
            onClick={() => onChoose(r.key)}
            className="auth-tile group flex flex-col"
          >
            <span className={`inline-flex w-11 h-11 rounded-xl2 bg-gradient-to-br ${r.accent}
                              items-center justify-center mb-4 shadow-raised`}>
              <RoleGlyph role={r.key} />
            </span>

            <span className="font-display font-extrabold text-xl text-ink">Continue as {r.label}</span>
            <span className="text-sm text-muted mt-1.5">{r.tagline}</span>

            <ul className="mt-4 space-y-2 flex-1">
              {r.points.map((p) => (
                <li key={p} className="flex gap-2 text-[13px] text-ink-soft leading-snug">
                  <svg className="w-3.5 h-3.5 text-brand-500 shrink-0 mt-[3px]" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <span>{p}</span>
                </li>
              ))}
            </ul>

            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700
                             group-hover:gap-2.5 transition-all">
              Get started
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RoleGlyph({ role }) {
  return role === 'creator' ? (
    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 8a3 3 0 1 0-6 0 3 3 0 0 0 6 0z" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  ) : (
    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21V8l9-5 9 5v13" /><path d="M9 21v-6h6v6" />
    </svg>
  );
}

function RoleAside({ role }) {
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50 mb-3">
        {role.label} account
      </p>
      <h2 className="font-display font-extrabold text-4xl xl:text-[2.9rem] leading-[1.1] tracking-tight">
        {role.key === 'creator'
          ? 'Your audience is the asset. Get paid like it.'
          : 'Brief, fund, approve. Nothing moves until you say so.'}
      </h2>
      <ul className="mt-8 space-y-3.5">
        {role.points.map((p) => (
          <li key={p} className="flex gap-3 text-white/70">
            <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <span className="leading-snug">{p}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ───────────────────────── shared verification step ────────────────────────── */

export function VerifyStep({ otp, onBack, onSubmit, eyebrow, extraError }) {
  const isPhone = otp.channel === 'phone';

  return (
    <div className="auth-card">
      <BackButton onClick={onBack}>Change {isPhone ? 'number' : 'email'}</BackButton>

      <AuthHeading
        eyebrow={eyebrow}
        title="Enter your code"
        sub={
          <>
            We sent a 6-digit code {isPhone ? 'on WhatsApp' : 'by email'} to{' '}
            <span className="font-semibold text-ink">{otp.sentTo}</span>.
          </>
        }
      />

      <AuthError error={otp.error ?? extraError} />
      <DevCodeNote code={otp.devCode} />

      <div className="space-y-5 mt-5">
        <OtpInput
          value={otp.code}
          onChange={otp.setCode}
          onComplete={onSubmit}
          state={otp.codeState}
          disabled={otp.verifying}
        />

        <button
          onClick={() => onSubmit(otp.code)}
          disabled={otp.code.length < 6 || otp.verifying}
          className="auth-btn-primary"
        >
          {otp.verifying ? <><Spinner className="w-5 h-5" /> Verifying…</> : 'Verify and continue'}
        </button>

        <ResendTimer
          secondsLeft={otp.cooldown}
          busy={otp.sending}
          onResend={() => otp.send(otp.channel, otp.identifier, { resend: true })}
        />
      </div>
    </div>
  );
}

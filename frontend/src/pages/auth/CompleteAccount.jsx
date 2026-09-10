import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Spinner } from '../../lib/ui-state';
import { StatusPill } from '../../components/feedback';
import { authStep, rise, withReducedMotion, usePrefersReducedMotion } from '../../lib/motion';
import { AuthShell, AuthHeading } from '../../components/auth/AuthShell';
import {
  AuthError, Field, DevCodeNote, WhatsAppMark, MailMark,
} from '../../components/auth/AuthBits';
import { OtpInput, ResendTimer } from '../../components/auth/OtpInput';
import { PolicyConsent, PolicyConsentSkeleton } from '../../components/auth/PolicyConsent';
import { useOtpFlow, useAuthConfig } from '../../components/auth/useAuthFlow';

/**
 * The screens between "signed in" and "allowed to work".
 *
 * A new signup satisfies all of these on the way through, so most users never
 * see any of them. They exist for the cases that do arise:
 *
 *  - an account created before the age gate existed (Policy 1.3),
 *  - a new policy version published after registration (Policy 1.14),
 *  - an account with only one of mobile and email verified (Policy 13.1),
 *  - an account under enforcement (Policy 12).
 *
 * Before this, the backend had middleware for all four and no screen for any of
 * them: a user was blocked with a machine-readable code and nowhere to go. That
 * is the gap these close. Which one renders is decided by the server's `next`,
 * so the UI and the API cannot disagree about what is outstanding.
 *
 * ── What this pass fixed ────────────────────────────────────────────────────
 *
 *  1. **A failed policy fetch shimmered forever.** `PolicyAcceptancePage` set
 *     an error *and* left `policies` null, and the render only asks whether
 *     `policies` is truthy — so the screen showed an error message above a
 *     skeleton that would never resolve, with no retry and no way forward. On
 *     a screen that blocks the whole product until it is completed, that is a
 *     dead end, not a loading state.
 *  2. **`restricted` had no copy.** Policy 12's ladder is Warning →
 *     Restriction → Suspension → Termination, and `accountStatus` can be
 *     `restricted`, but the map handled only suspended and terminated. A
 *     restricted user got "Some actions are unavailable on your account at the
 *     moment", which tells them nothing about which actions or what to do.
 *  3. **`VerifyChannelPage` swapped its two stages with no transition**, so
 *     "Change number" looked like a glitch rather than a step back.
 *  4. **Nothing on these four screens moved**, on the one path where a user has
 *     been stopped and needs the product to feel deliberate rather than broken.
 */

/* ────────────────────────────── shared frame ───────────────────────────────── */

/**
 * One of these screens, entering.
 *
 * All four are a single card in the auth shell, reached by being blocked from
 * somewhere else. One quiet entrance is right; anything more would be
 * celebrating an interruption.
 */
function BlockedCard({ children }) {
  const reduced = usePrefersReducedMotion();
  return (
    <motion.div
      variants={withReducedMotion(rise, reduced)}
      initial="hidden"
      animate="visible"
      className="auth-card"
    >
      {children}
    </motion.div>
  );
}

export function AgeDeclarationPage() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [dob, setDob] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isAdult = useMemo(() => {
    if (!dob) return null;
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return null;
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    return d <= cutoff;
  }, [dob]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.declareAge(dob);
      const state = await refresh();
      nav(state?.next?.path ?? '/dashboard', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <BlockedCard>
        <AuthHeading
          eyebrow="One more thing"
          title="Confirm your date of birth"
          sub="Marqueiver is only available to people aged 18 or over. We ask once and keep it on your account."
        />
        <AuthError error={error} />
        <div className="space-y-4 mt-4">
          <Field
            id="dob" label="Date of birth" type="date" autoComplete="bday"
            max={new Date().toISOString().slice(0, 10)}
            value={dob} onChange={(e) => setDob(e.target.value)}
            error={isAdult === false ? 'You must be 18 or over to use Marqueiver.' : undefined}
          />
          <button onClick={submit} disabled={isAdult !== true || busy} className="auth-btn-primary">
            {busy ? <><Spinner className="w-5 h-5" /> Saving…</> : 'Confirm and continue'}
          </button>
        </div>
      </BlockedCard>
    </AuthShell>
  );
}

/**
 * Policy 1.14 re-consent. The outstanding versions come from the server, so a
 * user is only ever asked about what they have genuinely not accepted.
 */
export function PolicyAcceptancePage() {
  const { user, refresh, logout } = useAuth();
  const nav = useNavigate();
  const [policies, setPolicies] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Which failure this is matters here, because the two need different screens.
   *
   * `loadError` is "we could not fetch the policies" — nothing can be shown, so
   * the skeleton must stop and a retry must appear. `error` is "the submission
   * failed" — the policies are on screen and the user can try again. Before,
   * both went into one `error` and the loading branch only asked whether
   * `policies` was truthy, so a fetch failure left a permanent skeleton under
   * an error message.
   */
  const [loadError, setLoadError] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!user?.role) return undefined;
    let alive = true;
    setLoadError(null);
    setPolicies(null);
    api.signupRequirements(user.role)
      .then(({ data }) => alive && setPolicies(data.policies))
      .catch((err) => alive && setLoadError(err));
    return () => { alive = false; };
  }, [user?.role, nonce]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.acceptOutstandingPolicies(policies.map((p) => p.slug), 're-consent');
      const state = await refresh();
      nav(state?.next?.path ?? '/dashboard', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <BlockedCard>
        <AuthHeading
          eyebrow="Policy update"
          title="We've updated our policies"
          sub="Please review and accept the current versions to carry on using Marqueiver."
        />
        <AuthError error={error} />

        <div className="space-y-4 mt-4">
          {loadError ? (
            <>
              <AuthError error={loadError} />
              <button onClick={() => setNonce((n) => n + 1)} className="auth-btn-primary">
                Try again
              </button>
            </>
          ) : policies && user?.role ? (
            <>
              <PolicyConsent
                policies={policies} role={user.role}
                checked={accepted} onChange={setAccepted}
              />
              <button onClick={submit} disabled={!accepted || busy} className="auth-btn-primary">
                {busy ? <><Spinner className="w-5 h-5" /> Recording your acceptance…</> : 'Accept and continue'}
              </button>
            </>
          ) : (
            <PolicyConsentSkeleton />
          )}

          {/* An escape that is not "dismiss" — declining means not using the
              platform, so signing out is the honest option to offer. */}
          <button onClick={() => { logout(); nav('/', { replace: true }); }}
            className="auth-btn-ghost w-full justify-center">
            Sign out instead
          </button>
        </div>
      </BlockedCard>
    </AuthShell>
  );
}

/**
 * Adding a second sign-in method.
 *
 * Signup needs only one verified identity, so this screen is normally optional —
 * reached from Profile by someone who wants a second way in, or as a recovery
 * path. It becomes required only where Policy 13.1 genuinely binds: with
 * `REQUIRE_DUAL_VERIFICATION=true` the server asks for both a mobile and an
 * email before a collaboration, and routes here to collect the missing one.
 *
 * The code is verified exactly as it is at signup, and the resulting
 * verification token is linked to the session's account rather than creating a
 * second one.
 */
export function VerifyChannelPage({ channel }) {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [draft, setDraft] = useState('');
  const [stage, setStage] = useState('identify');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const reduced = usePrefersReducedMotion();
  const otp = useOtpFlow({ purpose: 'login' });
  // Server-declared code length; the UI used to hardcode 6 and lock itself
  // out whenever OTP_LENGTH was set to anything else. See VerifyStep.
  const { config: authConfig } = useAuthConfig();
  const codeLength = authConfig?.otp?.length ?? 6;
  const isPhone = channel === 'phone';
  const working = otp.verifying || busy;

  async function send() {
    setError(null);
    const ok = isPhone
      ? draft.replace(/\D/g, '').length >= 10
      : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(draft);
    if (!ok) {
      setError({ message: isPhone ? 'Enter a valid mobile number.' : 'Enter a valid email address.' });
      return;
    }
    if (await otp.send(channel, draft)) setStage('verify');
  }

  async function submitCode(value) {
    const data = await otp.verify(value);
    if (!data) return;
    setBusy(true);
    try {
      await api.linkIdentity(data.verificationToken);
      const state = await refresh();
      nav(state?.next?.path ?? '/dashboard', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <BlockedCard>
        <AuthHeading
          eyebrow="Add a sign-in method"
          title={isPhone ? 'Add your mobile number' : 'Add your email address'}
          sub={isPhone
            ? "A second way to sign in, and a way back into your account if you lose access to the first. We'll send a code on WhatsApp."
            : "A second way to sign in, and a way back into your account if you lose access to the first. We'll send a code by email."}
        />
        <AuthError error={otp.error ?? error} />
        <DevCodeNote code={otp.devCode} />

        {/*
          The two stages replaced each other instantly. Now they move in the
          direction of travel, so "Change number" reads as going back rather
          than as the screen redrawing itself.
        */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={stage}
            variants={withReducedMotion(authStep(stage === 'identify'), reduced)}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {stage === 'identify' ? (
              <div className="space-y-4 mt-4">
                <Field
                  id={`verify-${channel}`}
                  label={isPhone ? 'Mobile number' : 'Email address'}
                  type={isPhone ? 'tel' : 'email'}
                  inputMode={isPhone ? 'tel' : 'email'}
                  autoComplete={isPhone ? 'tel' : 'email'}
                  placeholder={isPhone ? '+91 90000 00000' : 'you@company.com'}
                  icon={isPhone ? <WhatsAppMark className="w-[18px] h-[18px]" /> : <MailMark className="w-[18px] h-[18px]" />}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                />
                <button onClick={send} disabled={otp.sending} className="auth-btn-primary">
                  {otp.sending ? <><Spinner className="w-5 h-5" /> Sending…</> : 'Send code'}
                </button>
              </div>
            ) : (
              <div className="space-y-5 mt-5">
                <OtpInput
                  value={otp.code} onChange={otp.setCode} onComplete={submitCode}
                  state={otp.codeState} disabled={working}
                  length={codeLength}
                />
                <button
                  onClick={() => submitCode(otp.code)}
                  disabled={otp.code.length < codeLength || working}
                  className="auth-btn-primary"
                >
                  {working
                    ? (
                      <>
                        <Spinner className="w-5 h-5" />
                        {otp.verifying ? 'Verifying…' : 'Linking to your account…'}
                      </>
                    )
                    : 'Verify and continue'}
                </button>
                <ResendTimer
                  secondsLeft={otp.cooldown} busy={otp.sending || working}
                  onResend={() => otp.send(channel, otp.identifier, { resend: true })}
                />
                <button
                  onClick={() => { otp.reset(); setStage('identify'); }}
                  disabled={working}
                  className="auth-btn-ghost w-full justify-center disabled:opacity-40"
                >
                  Change {isPhone ? 'number' : 'email'}
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </BlockedCard>
    </AuthShell>
  );
}

/**
 * Policy 12 — an account under enforcement, with the appeal route stated.
 *
 * All four rungs of the ladder are covered. `restricted` in particular used to
 * fall through to a generic "some actions are unavailable", which is the least
 * useful thing to tell someone who has just been stopped: it names no action
 * and offers no way out.
 */
const ENFORCEMENT_COPY = {
  restricted: {
    pill: 'resolution',
    pillLabel: 'Restricted',
    title: 'Your account is restricted',
    body: 'You can sign in and read your existing collaborations, but you cannot start new ones '
      + 'or receive new invitations while the restriction is in place. Anything already in '
      + 'escrow stays where it is.',
  },
  suspended: {
    pill: 'disputed',
    pillLabel: 'Suspended',
    title: 'Your account is suspended',
    body: 'While an account is suspended you cannot start or continue collaborations, and any '
      + 'funds held in escrow stay held until the matter is resolved.',
  },
  terminated: {
    pill: 'cancelled',
    pillLabel: 'Terminated',
    title: 'Your account has been terminated',
    body: 'Termination ends access to the platform. If you believe this was made in error, you '
      + 'can appeal.',
  },
};

export function RestrictedAccountPage() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const status = user?.accountStatus ?? 'suspended';

  const copy = ENFORCEMENT_COPY[status] ?? {
    pill: 'resolution',
    pillLabel: 'Restricted',
    title: 'Your account is restricted',
    body: 'Some actions are unavailable on your account at the moment.',
  };

  return (
    <AuthShell>
      <BlockedCard>
        {/* The status itself, in the product's own status colours rather than
            only as a sentence. This is the fact the page exists to deliver. */}
        <StatusPill status={copy.pill} label={copy.pillLabel} className="mb-4" />

        <AuthHeading eyebrow="Account status" title={copy.title} sub={copy.body} />

        <div className="space-y-3 mt-5">
          <a href="mailto:support@marqueiver.com" className="auth-btn-primary">Contact support</a>
          <Link to="/policies/account-suspension-policy" className="auth-btn-secondary">
            Read the Account Suspension &amp; Termination Policy
          </Link>
          <button onClick={() => { logout(); nav('/', { replace: true }); }}
            className="auth-btn-ghost w-full justify-center">
            Sign out
          </button>
        </div>
      </BlockedCard>
    </AuthShell>
  );
}

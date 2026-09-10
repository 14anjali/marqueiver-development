import { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Spinner } from '../../lib/ui-state';
import { Skeleton } from '../../components/feedback';
import { authStep, withReducedMotion, usePrefersReducedMotion } from '../../lib/motion';
import { AuthShell, AuthHeading, BackButton } from '../../components/auth/AuthShell';
import {
  MethodButton, MethodUnavailable, AuthError, Field, OrDivider, WhatsAppMark, MailMark,
} from '../../components/auth/AuthBits';
import { useOtpFlow, useAuthConfig, useGoogle } from '../../components/auth/useAuthFlow';
import { VerifyStep } from './SignupPage';

/**
 * Login.
 *
 * Note what is not on this screen: any question about whether you are a Creator
 * or a Brand. The previous login page asked, defaulted to "brand", and then sent
 * that answer to an endpoint that would happily create an account with it — so a
 * creator who left the default alone could end up in the brand product, or with
 * a second account.
 *
 * Here, the only thing login establishes is *which identity you are*. The
 * account behind it already has a role, the server reads it, and the session
 * comes back with a destination the server computed from the account's real
 * state — role, verification, policy acceptance, onboarding, enforcement. This
 * page just goes where it is told.
 *
 * ── What this pass fixed ────────────────────────────────────────────────────
 *
 *  1. **The method list rendered before it knew what was available.** The
 *     checks read `config?.methods?.google?.enabled !== false`, and `config` is
 *     null until `GET /auth/config` returns — so every environment showed all
 *     three buttons for the first few hundred milliseconds, and then some of
 *     them turned into "Not configured on this environment". On a slow
 *     connection that is long enough to press one. Optimism is the wrong
 *     default when the answer decides whether a button works.
 *  2. **`useAuthConfig()` returns an error nobody read.** The destructure took
 *     `config` and dropped `error`, so if the config call failed the page fell
 *     back to showing all three methods as though everything worked. It is
 *     surfaced now, with a retry.
 *  3. **The window between "code verified" and "logged in" left the form
 *     live.** `otp.verifying` goes false as soon as the code check returns,
 *     while `finish()` is still running — so the Verify button re-enabled
 *     mid-login. `VerifyStep` takes `busy` for exactly this.
 *  4. **Steps had no exit animation.** A CSS class keyed on the step name meant
 *     the outgoing card disappeared instantly, so "Back" looked like a jump
 *     rather than a reversal. `authStep` moves in the direction of travel.
 */
export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const { login } = useAuth();
  const { config, error: configError } = useAuthConfig();

  const [step, setStep] = useState('method');   // method | phone | email | verify
  const [direction, setDirection] = useState('forward');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [fieldError, setFieldError] = useState({});
  const [error, setError] = useState(null);
  const [finishing, setFinishing] = useState(false);

  const otp = useOtpFlow({ purpose: 'login' });

  const go = (next, dir = 'forward') => { setDirection(dir); setStep(next); setError(null); };

  /** Where the user was heading before the redirect, if anywhere sensible. */
  const intended = loc.state?.from?.pathname;

  const finish = useCallback(async (verificationToken) => {
    setFinishing(true);
    setError(null);
    try {
      const { data } = await api.login(verificationToken);
      login(data);
      // The server's `next.path` wins over the intended destination whenever the
      // account is not ready for it — an un-onboarded user asked for /deals
      // still has to finish onboarding first.
      const target = data.next?.step === 'dashboard' && intended && intended !== '/login'
        ? intended
        : (data.next?.path ?? '/dashboard');
      nav(target, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setFinishing(false);
    }
  }, [login, nav, intended]);

  const onGoogleIdentity = useCallback((data) => {
    if (!data.accountExists) {
      setError({
        message: 'No Marqueiver account uses that Google address yet.',
        detail: { code: 'ACCOUNT_NOT_FOUND' },
      });
      return;
    }
    finish(data.verificationToken);
  }, [finish]);

  // The redirect flow needs only the intent; the identity comes back through
  // /auth/google/callback and is handled by the effect below.
  const google = useGoogle({ intent: 'login' });

  /* Redirect-flow return. */
  useEffect(() => {
    const handoff = window.history.state?.usr?.googleIdentity;
    if (handoff) onGoogleIdentity(handoff);
  }, [onGoogleIdentity]);

  async function startPhone() {
    setFieldError({});
    if (draftPhone.replace(/\D/g, '').length < 10) {
      setFieldError({ phone: 'Enter a valid mobile number.' });
      return;
    }
    const sent = await otp.send('phone', draftPhone);
    if (!sent) return;
    if (sent.accountExists === false) {
      setError({
        message: 'No Marqueiver account uses that number yet.',
        detail: { code: 'ACCOUNT_NOT_FOUND' },
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
    if (sent.accountExists === false) {
      setError({
        message: 'No Marqueiver account uses that email address yet.',
        detail: { code: 'ACCOUNT_NOT_FOUND' },
      });
      return;
    }
    go('verify');
  }

  async function submitCode(value) {
    const data = await otp.verify(value);
    if (!data) return;
    if (!data.accountExists) {
      setError({
        message: 'That is verified, but no Marqueiver account uses it yet.',
        detail: { code: 'ACCOUNT_NOT_FOUND' },
      });
      return;
    }
    // The role on `data` is only ever used for copy. `finish` re-reads it from
    // the session the server issues.
    await finish(data.verificationToken);
  }

  const reduced = usePrefersReducedMotion();
  const back = direction === 'back';

  // Until the server has told us which methods exist, we do not guess.
  const configLoading = !config && !configError;
  const enabled = (name) => config?.methods?.[name]?.enabled !== false;

  return (
    <AuthShell aside={<LoginAside />}>
      <div className="mb-5 text-right">
        <p className="text-sm text-white/60">
          New to Marqueiver?{' '}
          <Link to="/signup" className="font-semibold text-white hover:underline">Create an account</Link>
        </p>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          variants={withReducedMotion(authStep(back), reduced)}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
        {step === 'method' && (
          <div className="auth-card">
            <AuthHeading
              title="Welcome back"
              sub="Sign in the way you signed up. We'll take you to the right place."
            />

            <AuthError error={error} />
            {/*
              A failed config call used to be invisible: the page fell through to
              showing all three methods as though everything were available.
              Saying so, with a retry, beats offering a button that cannot work.
            */}
            <AuthError error={configError} onRetry={() => window.location.reload()} />

            <div className="space-y-3 mt-4 stagger">
              {configLoading ? (
                /*
                  Placeholders at the exact height of a method button. The
                  alternative — rendering all three optimistically — showed
                  buttons that could turn into "Not configured" a moment later,
                  which is enough time to click one.
                */
                <div aria-busy="true" aria-live="polite" aria-label="Checking which sign-in methods are available">
                  <Skeleton className="h-[3.25rem] w-full rounded-xl2" />
                  <Skeleton className="h-[3.25rem] w-full rounded-xl2 mt-3" />
                  <Skeleton className="h-[3.25rem] w-full rounded-xl2 mt-3" />
                </div>
              ) : (
                <>
                  {enabled('google') ? (
                    <MethodButton method="google" label="Continue with Google"
                      busy={google.busy || finishing} onClick={google.start} />
                  ) : (
                    <MethodUnavailable label="Continue with Google" reason="Not configured on this environment" />
                  )}

                  <OrDivider />

                  {enabled('email') ? (
                    <MethodButton method="email" label="Continue with email" onClick={() => go('email')} />
                  ) : (
                    <MethodUnavailable label="Continue with email" reason="Not configured on this environment" />
                  )}

                  {enabled('phone') ? (
                    <MethodButton method="whatsapp" label="Continue with WhatsApp"
                      hint="Code sent to your WhatsApp — no SMS" onClick={() => go('phone')} />
                  ) : (
                    <MethodUnavailable label="Continue with WhatsApp" reason="Not configured on this environment" />
                  )}
                </>
              )}
            </div>

            <p className="mt-6 text-xs text-muted text-center leading-relaxed">
              Marqueiver knows whether your account is a creator or a brand account —
              you don&apos;t need to tell us.
            </p>
          </div>
        )}

        {step === 'phone' && (
          <div className="auth-card">
            <BackButton onClick={() => go('method', 'back')} />
            <AuthHeading title="Your WhatsApp number"
              sub="We'll send a 6-digit code to this number on WhatsApp." />
            <AuthError error={otp.error ?? error} />
            <div className="space-y-4 mt-4">
              <Field
                id="login-phone" label="Mobile number" type="tel" inputMode="tel"
                autoComplete="tel" placeholder="+91 90000 00000"
                icon={<WhatsAppMark className="w-[18px] h-[18px]" />}
                value={draftPhone}
                onChange={(e) => { setDraftPhone(e.target.value); setFieldError({}); }}
                onKeyDown={(e) => e.key === 'Enter' && startPhone()}
                error={fieldError.phone}
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
            <AuthHeading title="Your email address"
              sub="We'll send a 6-digit code to confirm it's you." />
            <AuthError error={otp.error ?? error} />
            <div className="space-y-4 mt-4">
              <Field
                id="login-email" label="Email address" type="email" inputMode="email"
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
            onBack={() => { otp.reset(); go(otp.channel === 'phone' ? 'phone' : 'email', 'back'); }}
            onSubmit={submitCode}
            extraError={error}
            busy={finishing}
          />
        )}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}

function LoginAside() {
  return (
    <>
      <h2 className="font-display font-extrabold text-4xl xl:text-[3rem] leading-[1.08] tracking-tight">
        Pick up
        <span className="block bg-gradient-to-r from-brand-300 via-pink-500 to-money-300 bg-clip-text text-transparent">
          exactly where you left off.
        </span>
      </h2>
      <p className="text-white/65 mt-5 leading-relaxed max-w-sm">
        Your deals, your escrow, your conversations. We&apos;ll take you straight to your side of
        the product — no need to tell us which one that is.
      </p>
    </>
  );
}

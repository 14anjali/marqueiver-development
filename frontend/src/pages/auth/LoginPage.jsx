import { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Spinner } from '../../lib/ui-state';
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
 */
export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const { login } = useAuth();
  const { config } = useAuthConfig();

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

  const anim = direction === 'forward' ? 'anim-step' : 'anim-step-back';

  return (
    <AuthShell aside={<LoginAside />}>
      <div className="mb-5 text-right">
        <p className="text-sm text-white/60">
          New to Marqueiver?{' '}
          <Link to="/signup" className="font-semibold text-white hover:underline">Create an account</Link>
        </p>
      </div>

      <div key={step} className={anim}>
        {step === 'method' && (
          <div className="auth-card">
            <AuthHeading
              title="Welcome back"
              sub="Sign in the way you signed up. We'll take you to the right place."
            />

            <AuthError error={error} />

            <div className="space-y-3 mt-4 stagger">
              {config?.methods?.google?.enabled !== false ? (
                <MethodButton method="google" label="Continue with Google"
                  busy={google.busy || finishing} onClick={google.start} />
              ) : (
                <MethodUnavailable label="Continue with Google" reason="Not configured on this environment" />
              )}

              <OrDivider />

              {config?.methods?.email?.enabled !== false ? (
                <MethodButton method="email" label="Continue with email" onClick={() => go('email')} />
              ) : (
                <MethodUnavailable label="Continue with email" reason="Not configured on this environment" />
              )}

              {config?.methods?.phone?.enabled !== false ? (
                <MethodButton method="whatsapp" label="Continue with WhatsApp"
                  hint="Code sent to your WhatsApp — no SMS" onClick={() => go('phone')} />
              ) : (
                <MethodUnavailable label="Continue with WhatsApp" reason="Not configured on this environment" />
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
          />
        )}
      </div>
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

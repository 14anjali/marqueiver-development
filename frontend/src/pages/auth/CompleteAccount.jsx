import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Spinner } from '../../lib/ui-state';
import { AuthShell, AuthHeading } from '../../components/auth/AuthShell';
import {
  AuthError, Field, DevCodeNote, WhatsAppMark, MailMark,
} from '../../components/auth/AuthBits';
import { OtpInput, ResendTimer } from '../../components/auth/OtpInput';
import { PolicyConsent, PolicyConsentSkeleton } from '../../components/auth/PolicyConsent';
import { useOtpFlow } from '../../components/auth/useAuthFlow';

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
 */

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
      <div className="auth-card">
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
            {busy ? <Spinner className="w-5 h-5" /> : 'Confirm and continue'}
          </button>
        </div>
      </div>
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

  useEffect(() => {
    if (!user?.role) return;
    let alive = true;
    api.signupRequirements(user.role)
      .then(({ data }) => alive && setPolicies(data.policies))
      .catch((err) => alive && setError(err));
    return () => { alive = false; };
  }, [user?.role]);

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
      <div className="auth-card">
        <AuthHeading
          eyebrow="Policy update"
          title="We've updated our policies"
          sub="Please review and accept the current versions to carry on using Marqueiver."
        />
        <AuthError error={error} />
        <div className="space-y-4 mt-4">
          {policies && user?.role ? (
            <PolicyConsent
              policies={policies} role={user.role}
              checked={accepted} onChange={setAccepted}
            />
          ) : (
            <PolicyConsentSkeleton />
          )}
          <button onClick={submit} disabled={!accepted || !policies || busy} className="auth-btn-primary">
            {busy ? <Spinner className="w-5 h-5" /> : 'Accept and continue'}
          </button>
          {/* An escape that is not "dismiss" — declining means not using the
              platform, so signing out is the honest option to offer. */}
          <button onClick={() => { logout(); nav('/', { replace: true }); }}
            className="auth-btn-ghost w-full justify-center">
            Sign out instead
          </button>
        </div>
      </div>
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

  const otp = useOtpFlow({ purpose: 'login' });
  const isPhone = channel === 'phone';

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
      <div className="auth-card">
        <AuthHeading
          eyebrow="Add a sign-in method"
          title={isPhone ? 'Add your mobile number' : 'Add your email address'}
          sub={isPhone
            ? "A second way to sign in, and a way back into your account if you lose access to the first. We'll send a code on WhatsApp."
            : "A second way to sign in, and a way back into your account if you lose access to the first. We'll send a code by email."}
        />
        <AuthError error={otp.error ?? error} />
        <DevCodeNote code={otp.devCode} />

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
              {otp.sending ? <Spinner className="w-5 h-5" /> : 'Send code'}
            </button>
          </div>
        ) : (
          <div className="space-y-5 mt-5">
            <OtpInput
              value={otp.code} onChange={otp.setCode} onComplete={submitCode}
              state={otp.codeState} disabled={otp.verifying || busy}
            />
            <button
              onClick={() => submitCode(otp.code)}
              disabled={otp.code.length < 6 || otp.verifying || busy}
              className="auth-btn-primary"
            >
              {otp.verifying || busy ? <><Spinner className="w-5 h-5" /> Verifying…</> : 'Verify and continue'}
            </button>
            <ResendTimer
              secondsLeft={otp.cooldown} busy={otp.sending}
              onResend={() => otp.send(channel, otp.identifier, { resend: true })}
            />
            <button onClick={() => { otp.reset(); setStage('identify'); }}
              className="auth-btn-ghost w-full justify-center">
              Change {isPhone ? 'number' : 'email'}
            </button>
          </div>
        )}
      </div>
    </AuthShell>
  );
}

/** Policy 12 — a suspended or terminated account, with the appeal route stated. */
export function RestrictedAccountPage() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const status = user?.accountStatus ?? 'suspended';

  const copy = {
    suspended: {
      title: 'Your account is suspended',
      body: 'While an account is suspended you cannot start or continue collaborations, and any funds held in escrow stay held until the matter is resolved.',
    },
    terminated: {
      title: 'Your account has been terminated',
      body: 'Termination ends access to the platform. If you believe this was made in error, you can appeal.',
    },
  }[status] ?? {
    title: 'Your account is restricted',
    body: 'Some actions are unavailable on your account at the moment.',
  };

  return (
    <AuthShell>
      <div className="auth-card">
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
      </div>
    </AuthShell>
  );
}

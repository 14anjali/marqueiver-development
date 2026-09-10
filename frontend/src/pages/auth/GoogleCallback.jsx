import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Logo } from '../../components/ui';
import { X } from '../../components/icons';
import { GoogleMark, AuthError } from '../../components/auth/AuthBits';
import { SuccessMark } from '../../components/feedback';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../../lib/motion';

/**
 * Where Google's redirect flow lands.
 *
 * The backend puts the result in the URL **fragment**, not the query string, so
 * the verification token never reaches a server log or a `Referer` header. The
 * fragment is read once and then stripped from the address bar, so it does not
 * sit in history or get shared when someone copies the URL.
 *
 * From here there are exactly two outcomes, decided by whether the account
 * exists — which the server determined, not this page:
 *
 *   existing account → log in and go where the server says
 *   new account      → hand the verified identity to signup, which still has to
 *                      collect a role and the policy acceptances before anything
 *                      is created
 *
 * ── What this pass fixed ────────────────────────────────────────────────────
 *
 *  1. **A failed login threw the verification away.** `.catch(setError)` showed
 *     the message and offered one button: "Back to sign in" — which drops a
 *     verification the user has already completed with Google and makes them do
 *     the whole round trip again. The token is still in hand at that point, so
 *     a retry is one request, not one round trip. Only genuinely dead states
 *     (an expired link, a cancelled consent) send them back to sign in.
 *  2. **The three social callbacks got a designed handover screen and this one
 *     did not.** Connecting an Instagram account was acknowledged with the
 *     product's own success mark; *signing in* — the more consequential of the
 *     two — was a bare spinner on an otherwise empty card. This now matches
 *     `OAuthHandoff`: the two marks, the handover bar, the same motion.
 *
 * It is deliberately not folded into `OAuthHandoff`. That component's whole job
 * is to forward a query string it does not consume; this one holds a credential,
 * makes a request with it, and has a failure state of its own.
 */
export default function GoogleCallback() {
  const nav = useNavigate();
  const { login } = useAuth();
  const reduced = usePrefersReducedMotion();

  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);

  // Kept out of state: it is a credential, and it must survive a re-render
  // without ever being part of one.
  const token = useRef(null);

  const finish = useCallback(async (verificationToken) => {
    setRetrying(true);
    setError(null);
    try {
      const { data } = await api.login(verificationToken);
      login(data);
      nav(data.next?.path ?? '/dashboard', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setRetrying(false);
    }
  }, [login, nav]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    // Do not leave credentials in the address bar or in history.
    window.history.replaceState({}, '', window.location.pathname);

    const failure = params.get('error');
    if (failure) {
      setError({
        message: GOOGLE_ERRORS[failure] ?? params.get('message') ?? GOOGLE_ERRORS.DEFAULT,
        detail: { code: failure },
      });
      return;
    }

    const verificationToken = params.get('verificationToken');
    if (!verificationToken) {
      setError({ message: GOOGLE_ERRORS.DEFAULT, detail: { code: 'GOOGLE_NO_CODE' } });
      return;
    }

    token.current = verificationToken;

    const identity = {
      verificationToken,
      accountExists: params.get('accountExists') === 'true',
      email: params.get('email') ?? '',
      name: params.get('name') ?? '',
      role: params.get('role') ?? null,
    };

    if (!identity.accountExists) {
      // An intent of "login" that finds no account is not an error worth a dead
      // end — it is someone who has not signed up yet, so send them to signup
      // with the verification they already completed.
      nav('/signup', { replace: true, state: { googleIdentity: identity } });
      return;
    }

    finish(verificationToken);
  }, [nav, finish]);

  /*
    Whether the verification is worth retrying. An expired or already-used state,
    a cancelled consent, or a Google account we were never given — those cannot
    be retried from here, and offering a button that will fail again is worse
    than sending the user back. A network blip or a 5xx during `POST /auth/login`
    is retryable, and the token is still in hand.
  */
  const canRetry = Boolean(token.current) && !DEAD_ENDS.has(error?.detail?.code);

  return (
    <main className="auth-stage min-h-dvh grid place-items-center px-4 sm:px-6 py-8 sm:py-12">
      <div className="auth-orb" aria-hidden="true" />
      <div className="auth-orb auth-orb--two" aria-hidden="true" />

      <motion.div
        variants={withReducedMotion(rise, reduced)}
        initial="hidden"
        animate="visible"
        className="glass rounded-xl3 w-full max-w-[22rem] sm:max-w-sm p-6 sm:p-8 text-center relative flex flex-col"
        role="status"
        aria-live="polite"
      >
        <Logo className="mx-auto mb-7 h-6" />

        {/* The same "this is joining that" pairing as the social callbacks. */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <GoogleMark className="w-11 h-11" />

          <span className="w-8 h-px bg-line relative" aria-hidden="true">
            <span
              className={`absolute -top-[3px] w-1.5 h-1.5 rounded-full ${
                error
                  ? 'bg-rose-400 right-0'
                  : 'bg-brand-500 animate-[slidein_1.1s_ease-in-out_infinite]'
              }`}
            />
          </span>

          {error ? (
            <span
              className="w-11 h-11 rounded-full bg-rose-50 text-rose-500 grid place-items-center"
              role="img"
              aria-label="Not signed in"
            >
              <X className="w-5 h-5" />
            </span>
          ) : (
            <SuccessMark className="w-11 h-11" />
          )}
        </div>

        <h1 className="font-display font-extrabold text-lg text-ink">
          {error ? 'That didn’t work' : 'Google verified'}
        </h1>

        {error ? (
          <>
            <div className="text-left mt-4">
              <AuthError error={error} />
            </div>

            <div className="mt-5 space-y-2">
              {canRetry && (
                <button
                  onClick={() => finish(token.current)}
                  disabled={retrying}
                  className="auth-btn-primary"
                >
                  {retrying ? 'Trying again…' : 'Try again'}
                </button>
              )}
              <button
                onClick={() => nav('/login', { replace: true })}
                className={canRetry ? 'auth-btn-ghost w-full justify-center' : 'auth-btn-primary'}
              >
                Back to sign in
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted mt-2 leading-relaxed">
              Signing you in and taking you to your dashboard.
            </p>

            {/*
              A handover bar rather than a spinner. This screen exists for a
              fraction of a second; a spinner in that window reads as a stall.
            */}
            <span className="track mt-7 block" aria-hidden="true">
              <span
                className="track-fill"
                style={{ width: '100%', animation: 'shimmer 1s linear infinite' }}
              />
            </span>
          </>
        )}
      </motion.div>
    </main>
  );
}

/** Failures where the verification is spent and retrying it cannot succeed. */
const DEAD_ENDS = new Set([
  'GOOGLE_CANCELLED',
  'GOOGLE_NO_CODE',
  'GOOGLE_STATE_INVALID',
  'GOOGLE_NOT_CONFIGURED',
  'GOOGLE_EMAIL_UNVERIFIED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_TERMINATED',
  'ACCOUNT_DELETED',
]);

const GOOGLE_ERRORS = {
  GOOGLE_CANCELLED: 'You cancelled the Google sign-in. No problem — try another way.',
  GOOGLE_NO_CODE: 'Google did not send us anything to verify. Please try again.',
  GOOGLE_STATE_INVALID: 'That sign-in link has expired or was already used. Please start again.',
  GOOGLE_NOT_CONFIGURED: 'Google sign-in is not configured on this environment yet.',
  GOOGLE_EMAIL_UNVERIFIED: 'Your Google account email is not verified. Verify it with Google, then try again.',
  DEFAULT: 'We could not complete that Google sign-in. Please try again.',
};

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Spinner } from '../../lib/ui-state';
import { AuthShell, AuthHeading } from '../../components/auth/AuthShell';
import { AuthError } from '../../components/auth/AuthBits';

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
 */
export default function GoogleCallback() {
  const nav = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    // Do not leave credentials in the address bar or in history.
    window.history.replaceState({}, '', window.location.pathname);

    const failure = params.get('error');
    if (failure) {
      setError({ message: GOOGLE_ERRORS[failure] ?? params.get('message') ?? GOOGLE_ERRORS.DEFAULT });
      return;
    }

    const verificationToken = params.get('verificationToken');
    if (!verificationToken) {
      setError({ message: GOOGLE_ERRORS.DEFAULT });
      return;
    }

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

    api.login(verificationToken)
      .then(({ data }) => {
        login(data);
        nav(data.next?.path ?? '/dashboard', { replace: true });
      })
      .catch(setError);
  }, [nav, login]);

  return (
    <AuthShell>
      <div className="auth-card text-center">
        {error ? (
          <>
            <AuthHeading title="That didn't work" />
            <AuthError error={error} />
            <button onClick={() => nav('/login', { replace: true })} className="auth-btn-primary mt-5">
              Back to sign in
            </button>
          </>
        ) : (
          <div className="py-10 flex flex-col items-center gap-4">
            <Spinner className="w-8 h-8 text-brand-600" />
            <p className="text-sm text-muted" aria-live="polite">Finishing your Google sign-in…</p>
          </div>
        )}
      </div>
    </AuthShell>
  );
}

const GOOGLE_ERRORS = {
  GOOGLE_CANCELLED: 'You cancelled the Google sign-in. No problem — try another way.',
  GOOGLE_NO_CODE: 'Google did not send us anything to verify. Please try again.',
  GOOGLE_STATE_INVALID: 'That sign-in link has expired or was already used. Please start again.',
  GOOGLE_NOT_CONFIGURED: 'Google sign-in is not configured on this environment yet.',
  GOOGLE_EMAIL_UNVERIFIED: 'Your Google account email is not verified. Verify it with Google, then try again.',
  DEFAULT: 'We could not complete that Google sign-in. Please try again.',
};

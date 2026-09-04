import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../lib/api';

/**
 * The verification half of both auth flows.
 *
 * Signup and login differ in what happens *after* an identity is verified, not
 * in how it is verified — so send/verify/resend/countdown lives here once,
 * rather than being written twice and drifting.
 *
 * Everything about timing comes from the server response: how long the code
 * lasts, how long until a resend is allowed. Hardcoding 30 seconds here would
 * mean the button becomes clickable at a moment the API may still refuse.
 */
export function useOtpFlow({ purpose }) {
  const [channel, setChannel] = useState(null);      // 'phone' | 'email'
  const [identifier, setIdentifier] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [devCode, setDevCode] = useState('');
  const [code, setCode] = useState('');
  const [accountExists, setAccountExists] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);
  const [codeState, setCodeState] = useState('idle');  // idle | error | ok

  const timer = useRef(null);

  const startCooldown = useCallback((seconds) => {
    setCooldown(seconds);
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) { clearInterval(timer.current); return 0; }
        return s - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => () => clearInterval(timer.current), []);

  const send = useCallback(async (ch, value, { resend = false } = {}) => {
    setSending(true);
    setError(null);
    if (resend) { setCode(''); setCodeState('idle'); }
    try {
      const fn = ch === 'phone'
        ? (resend ? api.resendWhatsappOtp : api.sendWhatsappOtp)
        : (resend ? api.resendEmailOtp : api.sendEmailOtp);
      const { data } = await fn(value, purpose);

      setChannel(ch);
      setIdentifier(value);
      setSentTo(data.sentTo);
      setAccountExists(data.accountExists);
      setDevCode(data.devCode ?? '');
      startCooldown(data.resendAvailableInSeconds ?? 30);
      return data;
    } catch (err) {
      setError(err);
      // A throttled request tells us exactly how long to wait — use it rather
      // than leaving the button live and inviting another refusal.
      if (err.detail?.details?.retryAfterSeconds) startCooldown(err.detail.details.retryAfterSeconds);
      return null;
    } finally {
      setSending(false);
    }
  }, [purpose, startCooldown]);

  const verify = useCallback(async (value = code) => {
    setVerifying(true);
    setError(null);
    try {
      const { data } = await api.verifyOtp(channel, identifier, value);
      setCodeState('ok');
      return data;
    } catch (err) {
      setError(err);
      setCodeState('error');
      // An expired or exhausted code is not a typo — clear it so the user is not
      // staring at six digits that can never work.
      if (['OTP_EXPIRED', 'OTP_NOT_FOUND', 'OTP_TOO_MANY_ATTEMPTS', 'OTP_LOCKED']
        .includes(err.detail?.code)) setCode('');
      return null;
    } finally {
      setVerifying(false);
    }
  }, [channel, identifier, code]);

  const reset = useCallback(() => {
    clearInterval(timer.current);
    setChannel(null); setIdentifier(''); setSentTo(''); setDevCode('');
    setCode(''); setAccountExists(null); setCooldown(0);
    setError(null); setCodeState('idle');
  }, []);

  // Typing again after a rejection clears the red state, so the boxes are not
  // still shouting at a code the user has already started fixing.
  const updateCode = useCallback((next) => {
    setCode(next);
    setCodeState((s) => (s === 'error' ? 'idle' : s));
  }, []);

  return {
    channel, identifier, sentTo, devCode, code, accountExists,
    cooldown, sending, verifying, error, codeState,
    send, verify, reset, setCode: updateCode, setError,
  };
}

/**
 * Which methods this deployment can actually offer.
 *
 * Read from the server rather than assumed, so an environment without MSG91 or
 * Google credentials shows an honest "not available here" instead of a button
 * that fails when pressed.
 */
export function useAuthConfig() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.authConfig()
      .then(({ data }) => alive && setConfig(data))
      .catch((err) => alive && setError(err));
    return () => { alive = false; };
  }, []);

  return { config, error };
}

/**
 * Google, both ways.
 *
 * If Google Identity Services has loaded, the in-page flow is used — no page
 * navigation, no lost form state. Otherwise the redirect flow is used, which
 * needs no third-party script at all. Either way the token is verified on the
 * server; the browser never decides who signed in.
 */
export function useGoogle({ intent, role }) {
  const [busy, setBusy] = useState(false);

  /**
   * "Continue with Google" starts the server-side authorization-code flow.
   *
   * It previously called `google.accounts.id.prompt()` — Google **One Tap** —
   * and only fell back to this redirect when One Tap reported itself
   * suppressed. That was the bug behind "Google stopped working after I added
   * the real credentials", and it is worth spelling out because it is
   * counter-intuitive:
   *
   *   - With no `GOOGLE_CLIENT_ID`, `clientId` was null, the One Tap branch was
   *     skipped, and the redirect ran. Google sign-in worked.
   *   - The moment a real client id was configured, the One Tap branch became
   *     live — and One Tap is not a sign-in-button primitive. It is suppressed
   *     when the user is not already signed into Google in that browser, when
   *     third-party cookies are blocked (now Chrome's default), and after a
   *     couple of dismissals ("exponential cooldown").
   *   - The fallback was gated on `isNotDisplayed()` / `isSkippedMoment()`,
   *     which are deprecated and absent under FedCM. With `?.()` they evaluate
   *     to `undefined`, so the fallback never fired.
   *
   * Net effect: the button set `busy` and did nothing, with no error. Adding
   * the credentials is what activated the broken path.
   *
   * The redirect flow has none of that variability: no third-party script, no
   * cookie dependency, no FedCM surface, and the client secret stays on the
   * server. It is also exactly the flow the backend already implements at
   * `/auth/google/start` → Google → `/auth/google/callback`.
   */
  const start = useCallback(() => {
    setBusy(true);
    window.location.href = api.googleStartUrl(intent, role);
  }, [intent, role]);

  return { start, busy };
}

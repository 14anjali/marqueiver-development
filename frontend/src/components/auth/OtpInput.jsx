import { useRef, useEffect, useMemo } from 'react';

/**
 * Segmented code entry.
 *
 * Six boxes are the convention, but the convention is usually implemented in a
 * way that fights the user. The behaviours below exist because each of them is
 * something people actually do:
 *
 *  - **Paste the whole code.** From the WhatsApp message or the email, into
 *    whichever box happens to be focused. Handled on every box, and the paste is
 *    stripped to digits first so "Your code is 493021" pastes cleanly.
 *  - **Backspace on an empty box.** Should move back and clear, not sit there.
 *  - **Type over a filled box.** Should replace, not be ignored.
 *  - **Arrow keys.** Should move between boxes.
 *  - **Autofill from SMS/WhatsApp.** `autoComplete="one-time-code"` on the first
 *    box is what lets iOS and Android offer the code above the keyboard;
 *    `inputMode="numeric"` gets the number pad rather than the full keyboard.
 *
 * The whole group is one labelled `group` for assistive tech, so it is announced
 * as "verification code" once rather than as six unlabelled text fields.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  state = 'idle',   // idle | error | ok
  disabled = false,
  autoFocus = true,
  label = 'Verification code',
}) {
  const refs = useRef([]);
  const digits = useMemo(
    () => Array.from({ length }, (_, i) => value[i] ?? ''),
    [value, length],
  );

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  // On a wrong code the boxes shake and refocus, so the next attempt does not
  // need a click. Clearing is left to the caller — a user who mistyped one digit
  // should not lose the other five.
  useEffect(() => {
    if (state === 'error') refs.current[Math.min(value.length, length - 1)]?.focus();
  }, [state, value.length, length]);

  const commit = (next) => {
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };

  const handleChange = (i, raw) => {
    const typed = raw.replace(/\D/g, '');
    if (!typed) return;

    // More than one digit in a single box means a paste or an autofill.
    if (typed.length > 1) {
      const next = (value.slice(0, i) + typed).slice(0, length);
      commit(next);
      refs.current[Math.min(next.length, length - 1)]?.focus();
      return;
    }

    const chars = value.padEnd(length, ' ').split('');
    chars[i] = typed;
    const next = chars.join('').replace(/\s+$/, '').slice(0, length);
    commit(next);
    if (i < length - 1) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[i]) {
        const chars = value.padEnd(length, ' ').split('');
        chars[i] = ' ';
        onChange(chars.join('').replace(/\s+$/, ''));
      } else if (i > 0) {
        const chars = value.padEnd(length, ' ').split('');
        chars[i - 1] = ' ';
        onChange(chars.join('').replace(/\s+$/, ''));
        refs.current[i - 1]?.focus();
      }
      return;
    }
    if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); refs.current[i - 1]?.focus(); }
    if (e.key === 'ArrowRight' && i < length - 1) { e.preventDefault(); refs.current[i + 1]?.focus(); }
  };

  const handlePaste = (e) => {
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, length);
    if (!text) return;
    e.preventDefault();
    commit(text);
    refs.current[Math.min(text.length, length - 1)]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={label}
      className={`flex gap-2 sm:gap-2.5 justify-between ${state === 'error' ? 'anim-shake' : ''}`}
    >
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={d.trim()}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={state === 'error'}
          data-filled={Boolean(d.trim())}
          data-state={state}
          className="otp-box"
        />
      ))}
    </div>
  );
}

/**
 * Resend control with a live countdown.
 *
 * The cooldown comes from the server, not from a hardcoded number here, so the
 * button never invites a request the API is going to refuse.
 */
export function ResendTimer({ secondsLeft, onResend, busy, sendsLeft }) {
  if (secondsLeft > 0) {
    return (
      <p className="text-sm text-muted text-center tnum" aria-live="polite">
        Resend available in {secondsLeft}s
      </p>
    );
  }
  if (sendsLeft === 0) {
    return (
      <p className="text-sm text-muted text-center">
        No resends left. Go back and start again in a few minutes.
      </p>
    );
  }
  return (
    <p className="text-sm text-muted text-center">
      Didn&apos;t get it?{' '}
      <button
        type="button"
        onClick={onResend}
        disabled={busy}
        className="font-semibold text-brand-700 hover:underline disabled:opacity-50 disabled:no-underline"
      >
        {busy ? 'Sending…' : 'Send a new code'}
      </button>
    </p>
  );
}

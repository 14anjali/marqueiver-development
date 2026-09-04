import { Link } from 'react-router-dom';
import { Spinner } from '../../lib/ui-state';

/* ─────────────────────────────── brand marks ──────────────────────────────── */

/**
 * Google's "G". Reproduced to Google's own identity guidelines because a
 * recoloured or redrawn G is both a trademark problem and a usability one —
 * people scan for the exact mark.
 */
export function GoogleMark({ className = 'w-5 h-5' }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  );
}

/** WhatsApp glyph, in WhatsApp green — the channel has to be recognisable. */
export function WhatsAppMark({ className = 'w-5 h-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#25D366" d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.19-1.36a9.9 9.9 0 0 0 4.85 1.24h.01c5.5 0 9.96-4.46 9.96-9.96S17.54 2 12.04 2z" />
      <path fill="#fff" d="M9.5 7.2c-.2-.45-.4-.46-.6-.47h-.5c-.17 0-.45.07-.69.32-.24.25-.9.88-.9 2.15s.92 2.5 1.05 2.67c.13.17 1.79 2.86 4.41 3.9 2.18.86 2.62.69 3.09.64.47-.04 1.53-.62 1.74-1.23.21-.6.21-1.12.15-1.23-.06-.1-.23-.17-.48-.29-.25-.13-1.53-.75-1.76-.84-.24-.09-.41-.13-.58.13-.17.25-.67.84-.82 1.01-.15.17-.3.2-.55.07-.25-.13-1.09-.4-2.07-1.28-.76-.68-1.28-1.52-1.43-1.77-.15-.25-.02-.39.11-.51.11-.11.25-.3.38-.44.12-.15.16-.25.25-.42.08-.17.04-.32-.02-.44-.06-.13-.55-1.4-.78-1.92z" />
    </svg>
  );
}

export function MailMark({ className = 'w-5 h-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7.5 8.5 5.5 8.5-5.5" />
    </svg>
  );
}

/* ─────────────────────────────── method buttons ────────────────────────────── */

/**
 * One of the three ways in. Each is a full-width button with the method's own
 * mark, because "Continue with Google" is recognised by its logo long before
 * anyone reads the label.
 */
export function MethodButton({ method, onClick, disabled, busy, label, hint }) {
  const marks = { google: <GoogleMark />, whatsapp: <WhatsAppMark />, email: <MailMark /> };
  const cls = method === 'whatsapp' ? 'auth-btn-whatsapp' : 'auth-btn-secondary';

  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className={cls}>
      {busy ? <Spinner className="w-5 h-5 text-brand-600" /> : marks[method]}
      <span className="flex-1 text-left">
        {label}
        {hint && <span className="block text-xs font-normal text-muted mt-0.5">{hint}</span>}
      </span>
      <svg className="w-4 h-4 text-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  );
}

/** A method that this deployment cannot offer, said plainly rather than hidden. */
export function MethodUnavailable({ label, reason }) {
  return (
    <div className="auth-btn-secondary opacity-55 cursor-not-allowed" aria-disabled="true">
      <span className="flex-1 text-left">
        {label}
        <span className="block text-xs font-normal text-muted mt-0.5">{reason}</span>
      </span>
    </div>
  );
}

/* ──────────────────────────────── messages ─────────────────────────────────── */

const AlertIcon = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16.5h.01" />
  </svg>
);

/**
 * The error surface for the whole auth flow.
 *
 * `role="alert"` so it is announced the moment it appears — a visually-shown
 * error that a screen-reader user has to go hunting for is not an error message.
 * Some failures have an obvious next action (an account that already exists, an
 * expired verification), and those carry it as a link rather than leaving the
 * user to work it out.
 */
export function AuthError({ error, onRetry }) {
  if (!error) return null;

  const code = error.detail?.code ?? error.code;
  const action = ACTIONS[code];

  return (
    <div className="auth-error anim-rise" role="alert">
      <AlertIcon className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p>{error.message}</p>
        {action && (
          <p className="mt-1.5">
            <Link to={action.to} className="font-semibold underline underline-offset-2">{action.label}</Link>
          </p>
        )}
        {!action && onRetry && (
          <button type="button" onClick={onRetry}
            className="mt-1.5 font-semibold underline underline-offset-2">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

const ACTIONS = {
  ACCOUNT_NOT_FOUND: { to: '/signup', label: 'Create an account' },
  PHONE_ALREADY_REGISTERED: { to: '/login', label: 'Log in instead' },
  EMAIL_ALREADY_REGISTERED: { to: '/login', label: 'Log in instead' },
  GOOGLE_ALREADY_LINKED: { to: '/login', label: 'Log in instead' },
  ACCOUNT_SUSPENDED: { to: '/support', label: 'Contact support' },
  ACCOUNT_TERMINATED: { to: '/support', label: 'Contact support' },
  ACCOUNT_DELETED: { to: '/support', label: 'Contact support' },
};

export function AuthNote({ children }) {
  return <div className="auth-note">{children}</div>;
}

/** Dev-mode code banner. Only ever rendered when the API returns a devCode. */
export function DevCodeNote({ code }) {
  if (!code) return null;
  return (
    <div className="auth-note tnum">
      <span>
        <strong className="font-semibold">Mock mode</strong> — your code is{' '}
        <code className="font-mono font-bold tracking-wider">{code}</code>. No message was sent.
      </span>
    </div>
  );
}

/* ───────────────────────────────── fields ──────────────────────────────────── */

/**
 * A labelled input with its error wired up.
 *
 * `aria-describedby` and `aria-invalid` are set together, so the error is read
 * out with the field rather than existing only as red text next to it.
 */
export function Field({
  label, error, hint, id, icon, children, ...props
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <div className="auth-field-wrap">
        {icon && <span className="auth-field-icon">{icon}</span>}
        {children ?? (
          <input
            id={id}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            className={`auth-field ${icon ? 'auth-field--icon' : ''}`}
            {...props}
          />
        )}
      </div>
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
      {!error && hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Checkbox that looks like a control rather than a browser default. */
export function Checkbox({ id, checked, onChange, children, invalid }) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 cursor-pointer group">
      <span
        className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0
                    transition-all duration-150
                    ${checked
                      ? 'bg-brand-600 border-brand-600 scale-100'
                      : invalid
                        ? 'border-rose-400 group-hover:border-rose-500'
                        : 'border-line group-hover:border-brand-400'}`}
        aria-hidden="true"
      >
        <svg
          className={`w-3.5 h-3.5 text-white transition-transform duration-150 ${checked ? 'scale-100' : 'scale-0'}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-invalid={invalid || undefined}
        className="sr-only"
      />
      <span className="text-sm text-ink-soft leading-relaxed">{children}</span>
    </label>
  );
}

/** Divider used between the social buttons and the form. */
export function OrDivider({ label = 'or' }) {
  return (
    <div className="flex items-center gap-3 my-1" aria-hidden="true">
      <span className="flex-1 h-px bg-line" />
      <span className="text-xs font-medium text-muted uppercase tracking-wider">{label}</span>
      <span className="flex-1 h-px bg-line" />
    </div>
  );
}

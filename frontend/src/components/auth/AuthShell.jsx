import { Link } from 'react-router-dom';
import { Logo } from '../ui';

/**
 * The frame every auth screen sits in.
 *
 * A split layout on desktop, a single column on mobile. The left rail is
 * atmosphere and reassurance; it is `aria-hidden` and carries nothing the user
 * needs, so a screen reader goes straight to the form and a narrow viewport
 * loses nothing by dropping it.
 */
export function AuthShell({ children, aside, wide = false }) {
  return (
    <div className="auth-stage">
      <div className="auth-orb w-[42rem] h-[42rem] -left-40 -top-52 bg-brand-500" />
      <div className="auth-orb auth-orb--two w-[34rem] h-[34rem] -right-32 bottom-[-14rem] bg-pink-500" />
      <div className="auth-grid" />

      <div className="relative z-10 min-h-screen grid lg:grid-cols-[1.05fr_1fr]">
        <AuthAside>{aside}</AuthAside>

        <main className="flex flex-col min-h-screen px-5 py-8 sm:px-8">
          <header className="lg:hidden mb-8">
            <Link to="/" aria-label="Marqueiver home" className="inline-block">
              <Logo tone="light" />
            </Link>
          </header>

          <div className="flex-1 flex items-center justify-center">
            <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'}`}>{children}</div>
          </div>

          <footer className="mt-8 text-center text-xs text-white/45">
            <Link to="/terms" className="hover:text-white/80 transition-colors">Terms</Link>
            <span className="mx-2">·</span>
            <Link to="/privacy" className="hover:text-white/80 transition-colors">Privacy</Link>
            <span className="mx-2">·</span>
            <Link to="/policies" className="hover:text-white/80 transition-colors">All policies</Link>
          </footer>
        </main>
      </div>
    </div>
  );
}

function AuthAside({ children }) {
  return (
    <aside className="hidden lg:flex flex-col justify-between p-12 xl:p-16 text-white" aria-hidden="true">
      <Link to="/" tabIndex={-1} className="inline-block w-fit">
        <Logo tone="light" />
      </Link>
      <div className="max-w-md anim-rise">{children ?? <DefaultAside />}</div>
      <p className="text-white/40 text-sm">© 2026 Marqueiver · Dahmion Technologies</p>
    </aside>
  );
}

function DefaultAside() {
  return (
    <>
      <h2 className="font-display font-extrabold text-4xl xl:text-5xl leading-[1.08] tracking-tight">
        Where brands and creators
        <span className="block bg-gradient-to-r from-brand-300 via-pink-500 to-money-300 bg-clip-text text-transparent">
          build something worth watching.
        </span>
      </h2>
      <p className="text-white/70 mt-5 leading-relaxed">
        Escrow-secured collaborations, verified audience data, and one place to run every deal.
      </p>
      <dl className="flex gap-10 mt-10">
        {[['2,843', 'Creators'], ['320+', 'Campaigns'], ['₹2Cr+', 'Paid out']].map(([n, l]) => (
          <div key={l}>
            <dt className="sr-only">{l}</dt>
            <dd className="font-display font-extrabold text-3xl tnum">{n}</dd>
            <p className="text-white/50 text-sm mt-0.5">{l}</p>
          </div>
        ))}
      </dl>
    </>
  );
}

/** Heading block for a step. `eyebrow` names the step, `title` states the ask. */
export function AuthHeading({ eyebrow, title, sub }) {
  return (
    <div className="mb-6">
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600 mb-2">{eyebrow}</p>
      )}
      <h1 className="font-display font-extrabold text-[1.7rem] sm:text-[2rem] leading-[1.12] tracking-tight text-ink">
        {title}
      </h1>
      {sub && <p className="text-[15px] text-muted mt-2 leading-relaxed">{sub}</p>}
    </div>
  );
}

/**
 * Progress. Rendered as a labelled progressbar rather than decorative dots, so
 * "step 3 of 5" is announced rather than merely drawn.
 */
export function AuthSteps({ total, current, label = 'Signup progress' }) {
  return (
    <div
      className="auth-steps"
      role="progressbar"
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-valuetext={`Step ${current} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'current' : 'todo';
        return <span key={n} className={`auth-step auth-step--${state}`} />;
      })}
    </div>
  );
}

export function BackButton({ onClick, children = 'Back' }) {
  return (
    <button type="button" onClick={onClick} className="auth-btn-ghost mb-5">
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
      </svg>
      {children}
    </button>
  );
}

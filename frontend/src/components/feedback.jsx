import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../lib/motion';

/**
 * Skeletons, counters, progress and status.
 *
 * The pieces that make a screen feel finished rather than functional, and the
 * ones the product had least of: six files had skeletons, four had any depth
 * treatment, two had motion.
 *
 * The rule running through all of them: **every animation here is carrying
 * information.** A skeleton says what shape is coming. A counter says a number
 * changed and by roughly how much. A progress bar says how far along. A status
 * pill says a state moved. None of it is decoration, which is also why none of
 * it is missed when reduced-motion strips it.
 */

/* ────────────────────────────── skeletons ─────────────────────────────────── */

/**
 * A placeholder shaped like the thing it stands in for.
 *
 * The point is not the shimmer — it is that the page does not reflow when the
 * data lands. A spinner in the middle of an empty page tells the reader
 * nothing about what is coming and guarantees a layout jump when it does.
 */
export function Skeleton({ className = '', w, h, circle = false }) {
  const style = {};
  if (w) style.width = typeof w === 'number' ? `${w}px` : w;
  if (h) style.height = typeof h === 'number' ? `${h}px` : h;

  return (
    <div
      className={`${circle ? 'skeleton-circle' : 'skeleton'} ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

/**
 * Lines of placeholder text with a ragged last line.
 *
 * Uniform-width lines read as a loading graphic; a short final line reads as a
 * paragraph, which is what is actually arriving.
 */
export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton-text"
          style={{ width: i === lines - 1 ? '62%' : '100%' }}
        />
      ))}
    </div>
  );
}

/** A card-shaped placeholder: avatar, title, two lines. */
export function SkeletonCard({ className = '' }) {
  return (
    <div className={`card p-4 ${className}`} aria-hidden="true">
      <div className="flex items-center gap-3 mb-4">
        <Skeleton circle w={40} h={40} />
        <div className="flex-1">
          <Skeleton h={14} className="w-1/3 mb-2" />
          <Skeleton h={11} className="w-1/4" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}

/**
 * A loading state that announces itself.
 *
 * `role="status"` with `aria-live="polite"` is what tells a screen reader
 * anything is happening at all — the skeletons themselves are `aria-hidden`,
 * because reading out six empty boxes is worse than silence.
 */
export function SkeletonList({ count = 3, label = 'Loading…' }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

/* ───────────────────────────── animated counter ───────────────────────────── */

/**
 * A number that counts to its value.
 *
 * Used for figures that change while the user is looking — a dashboard total
 * refreshing, escrow released. It is deliberately NOT the default for every
 * number on a page: animating a static figure on mount just delays reading it.
 *
 * `requestAnimationFrame` rather than a CSS transition because the value is
 * text, and rather than `setInterval` because the frame callback is already
 * synchronised to the display and pauses in a background tab.
 */
export function AnimatedNumber({
  value,
  duration = 700,
  format = (n) => n.toLocaleString('en-IN'),
  className = '',
}) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(null);

  useEffect(() => {
    // Someone who asked for reduced motion wants the number, not the journey.
    if (reduced || from.current === value) {
      from.current = value;
      setShown(value);
      return undefined;
    }

    const start = performance.now();
    const origin = from.current;
    const delta = value - origin;

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease out: fast to roughly the right magnitude, then settle. Matches
      // how the rest of the system's motion decelerates.
      const eased = 1 - (1 - t) ** 3;
      setShown(origin + delta * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else from.current = value;
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration, reduced]);

  // tnum keeps the width stable while the digits change, so nothing beside it
  // shifts as it counts.
  return <span className={`tnum ${className}`}>{format(Math.round(shown))}</span>;
}

/** A rupee figure. Ochre is money everywhere in this system. */
export function Money({ amount, className = '', animate = false }) {
  const format = (n) => `₹${n.toLocaleString('en-IN')}`;
  return animate
    ? <AnimatedNumber value={amount ?? 0} format={format} className={`money ${className}`} />
    : <span className={`money ${className}`}>{format(amount ?? 0)}</span>;
}

/* ──────────────────────────────── progress ────────────────────────────────── */

/**
 * A determinate bar.
 *
 * `tone="money"` for escrow funding, `done` for completion — the same colour
 * language as everything else, so a half-funded escrow is ochre before the
 * label is read.
 */
export function Progress({ value = 0, max = 100, tone = 'brand', label, className = '' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const fill = { money: 'track-fill--money', done: 'track-fill--done' }[tone] ?? '';

  return (
    <div className={className}>
      {label && (
        <div className="flex justify-between items-baseline mb-1.5">
          <span className="text-xs font-medium text-ink">{label}</span>
          <span className="text-xs text-muted tnum">{Math.round(pct)}%</span>
        </div>
      )}
      <div
        className="track"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={`track-fill ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * How far along a collaboration is.
 *
 * Named steps rather than a percentage, because "60%" of a deal means nothing
 * — "Escrow funded, awaiting delivery" means something. The current step is
 * announced so a screen reader gets the same summary as the eye.
 */
export function Steps({ steps = [], current = 0, className = '' }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5" role="list">
        {steps.map((s, i) => (
          <div
            key={s}
            role="listitem"
            aria-current={i === current ? 'step' : undefined}
            className={`h-1 rounded-full transition-all duration-500 ease-out ${
              i < current ? 'bg-jade-500 flex-1'
                : i === current ? 'flex-[1.6] bg-gradient-to-r from-brand-600 to-pink-500'
                  : 'bg-line flex-1'}`}
          />
        ))}
      </div>
      <p className="text-xs text-muted mt-2" aria-live="polite">
        {steps[current] ?? ''}
      </p>
    </div>
  );
}

/* ───────────────────────────────── status ─────────────────────────────────── */

/**
 * Deal and campaign states, in the product's colour language.
 *
 * Kept here rather than inline in each page so a state cannot be ochre on the
 * dashboard and grey on the deal screen. Anything unmapped falls through to
 * quiet — a new state added to the backend shows up looking unremarkable
 * rather than crashing or borrowing a colour that means something else.
 */
const STATUS_TONE = {
  // Money is in play.
  escrow_pending: 'pill-money',
  in_progress: 'pill-live',
  // Waiting on someone.
  invitation: 'pill-wait',
  negotiation: 'pill-wait',
  accepted: 'pill-wait',
  submitted: 'pill-wait',
  revision: 'pill-wait',
  pending_review: 'pill-wait',
  // Finished well.
  completed: 'pill-done',
  open: 'pill-done',
  // Finished badly, or needs attention.
  disputed: 'pill-warn',
  resolution: 'pill-warn',
  rejected: 'pill-warn',
  declined: 'pill-quiet',
  cancelled: 'pill-quiet',
  closed: 'pill-quiet',
  draft: 'pill-quiet',
};

const STATUS_LABEL = {
  escrow_pending: 'Awaiting payment',
  in_progress: 'In progress',
  pending_review: 'Awaiting review',
  resolution: 'Needs resolution',
  invitation: 'Invited',
  negotiation: 'Negotiating',
};

/**
 * A status that shows it changed.
 *
 * The pill re-mounts on a state change (the state is its `key`), so the CSS
 * transition runs and the change is visible. A pill whose text silently swaps
 * is a change the user has to notice by re-reading.
 */
export function StatusPill({ status, label: labelOverride, className = '' }) {
  if (!status) return null;

  const tone = STATUS_TONE[status] ?? 'pill-quiet';
  /*
    `label` lets a screen outside the deal/campaign vocabulary borrow the tone
    without inheriting the wording. A Meta data-deletion request that has failed
    is the same "finished badly, needs attention" colour as a disputed deal, but
    calling it "Disputed" would be nonsense — and the alternative, a second
    private colour map on that page, is exactly what this component exists to
    prevent. The tone stays centralised; only the noun is local.
  */
  const label = labelOverride
    ?? STATUS_LABEL[status]
    ?? status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const live = status === 'in_progress';

  return (
    <span key={status} className={`${tone} pill-shift ${className}`}>
      {live && <span className="dot-live" aria-hidden="true" />}
      {label}
    </span>
  );
}

/* ───────────────────────────────── success ────────────────────────────────── */

/**
 * The mark shown after something irreversible has gone right — escrow funded,
 * deliverable approved, payout sent.
 *
 * One use per flow. A tick that appears after every save stops meaning
 * anything, and this one needs to still mean something when money moved.
 */
export function SuccessMark({ className = 'w-12 h-12' }) {
  return (
    <span
      className={`${className} rounded-full bg-jade-50 text-jade-600 grid place-items-center`}
      role="img"
      aria-label="Done"
    >
      <svg viewBox="0 0 24 24" className="w-1/2 h-1/2" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" className="animate-checkdraw" />
      </svg>
    </span>
  );
}

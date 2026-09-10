import { useEffect, useState } from 'react';

/**
 * Shared motion vocabulary.
 *
 * Every animated surface in Marqueiver draws from these, so a modal, a drawer
 * and a toast feel like the same product rather than three people's ideas about
 * easing. Defining them once also means reduced-motion is honoured everywhere
 * by construction instead of being remembered per component.
 *
 * The curves:
 *   SETTLE — `cubic-bezier(.2,.7,.3,1)`, the one already in tailwind.config.js
 *            for the offer stack. Decelerating, slightly overshooting the
 *            midpoint: things arrive and come to rest rather than stopping dead.
 *   EXIT   — faster and linear-ish. Leaving should never cost the user time;
 *            an exit that matches the entrance in length feels sluggish.
 *
 * Durations are short on purpose. This is a product people use daily to move
 * money — motion here is feedback, not entertainment.
 */

export const SETTLE = [0.2, 0.7, 0.3, 1];
export const EXIT = [0.4, 0, 1, 1];

export const DURATION = {
  instant: 0.12,   // hover, press
  quick: 0.2,      // toasts, tooltips, tabs
  base: 0.32,      // modals, drawers, page sections
  slow: 0.55,      // the deliberate arrival — hero, first paint of a list
};

/**
 * Does this person want motion?
 *
 * Read as a hook rather than a module constant because the OS setting can
 * change while the app is open, and because a module-level `matchMedia` read
 * would run at import time during SSR or a test.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}

/**
 * Reduced motion means *no movement*, not *no feedback*.
 *
 * Stripping the animation entirely removes the cue that something appeared,
 * which is worse for the people who asked for it. So transforms are dropped and
 * a short opacity fade is kept — the state change is still legible, nothing
 * slides or scales.
 */
export function withReducedMotion(variants, reduced) {
  if (!reduced) return variants;

  const strip = (v) => {
    if (!v || typeof v !== 'object') return v;
    const { x, y, scale, rotate, ...rest } = v;
    return { ...rest, transition: { duration: DURATION.instant } };
  };

  return Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, strip(v)]));
}

/* ─────────────────────────── the vocabulary ───────────────────────────────── */

/** Something arriving in place — cards, panels, list rows. */
export const rise = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: DURATION.base, ease: SETTLE } },
  exit: { opacity: 0, y: 8, transition: { duration: DURATION.quick, ease: EXIT } },
};

/** A dialog taking focus: it comes forward, it does not slide in from an edge. */
export const dialog = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: DURATION.base, ease: SETTLE } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: DURATION.quick, ease: EXIT } },
};

/** The dimmed ground behind a dialog or drawer. */
export const scrim = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.quick } },
  exit: { opacity: 0, transition: { duration: DURATION.quick } },
};

/** A panel from the right edge. */
export const drawerRight = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0, transition: { duration: DURATION.base, ease: SETTLE } },
  exit: { opacity: 0, x: 16, transition: { duration: DURATION.quick, ease: EXIT } },
};

/** A toast: in from below, out without ceremony. */
export const toast = {
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: DURATION.quick, ease: SETTLE } },
  exit: { opacity: 0, y: 8, scale: 0.98, transition: { duration: DURATION.instant, ease: EXIT } },
};

/**
 * A list that arrives one row at a time.
 *
 * `staggerChildren` is small and capped by `delayChildren` staying at 0: a long
 * list must not take a second and a half to finish appearing. Above roughly ten
 * rows the effect reads as lag rather than polish, so pages with long lists
 * should use `rise` on the container instead of staggering every row.
 */
export const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};

/**
 * One step of a multi-step flow, moving in the direction of travel.
 *
 * Signup, login and CompleteAccount are all wizards, and all three animated
 * their steps with a CSS class keyed on the step name (`anim-step` /
 * `anim-step-back`). That has no exit: the outgoing card vanished on the frame
 * the next one started, so going back read as a glitch rather than as reversing.
 * Motion is the only thing telling someone whether they moved forward or back,
 * so it has to actually reverse.
 *
 * `back` is the direction the user is travelling, not the direction of the
 * animation — forward comes in from the right and leaves to the left, and back
 * is the mirror of that.
 */
export const authStep = (back = false) => ({
  hidden: { opacity: 0, x: back ? -22 : 22 },
  visible: { opacity: 1, x: 0, transition: { duration: DURATION.base, ease: SETTLE } },
  exit: { opacity: 0, x: back ? 22 : -22, transition: { duration: DURATION.quick, ease: EXIT } },
});

/** Page-level transition, used by the router shell. */
export const page = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: SETTLE } },
  exit: { opacity: 0, transition: { duration: DURATION.quick, ease: EXIT } },
};

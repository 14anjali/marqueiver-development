import { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform, useSpring } from 'framer-motion';

/**
 * Motion primitives for the public site.
 *
 * Defined once so every section shares the same timing and easing. A landing
 * page where each section invents its own duration reads as several pages
 * stapled together, and the inconsistency is felt even when it is not noticed.
 *
 * Two rules hold everywhere:
 *
 *  - **Reveals are viewport-triggered and fire once.** Animating everything on
 *    load means the work below the fold is finished before anyone sees it, and
 *    re-animating on every scroll-back is nausea, not delight.
 *  - **`prefers-reduced-motion` is honoured by returning the finished state**,
 *    not a faster animation. Someone who asks for less motion gets none, and
 *    still gets the whole page.
 */

/** One easing curve for the entire site: quick out, soft settle. */
export const EASE = [0.22, 0.7, 0.3, 1];

export const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};

export const fadeIn = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.6, ease: EASE } },
};

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.94 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.6, ease: EASE } },
};

/**
 * Stagger container. 70ms is the useful window: below ~50ms the sequence reads
 * as one simultaneous jump, above ~120ms the last item keeps the reader waiting.
 */
export const stagger = (delay = 0, each = 0.07) => ({
  hidden: {},
  show: { transition: { staggerChildren: each, delayChildren: delay } },
});

/** Viewport config — fire once, slightly before the element is fully in view. */
export const inView = { once: true, margin: '-80px 0px -80px 0px' };

/**
 * A section that reveals its children in sequence when scrolled into view.
 * Children opt in by using `fadeUp` (or any variant with `hidden`/`show`).
 */
export function Reveal({
  as = 'div', children, className = '', delay = 0, each = 0.07, ...rest
}) {
  const reduce = useReducedMotion();
  const Tag = motion[as] ?? motion.div;

  if (reduce) {
    const Plain = as;
    return <Plain className={className} {...rest}>{children}</Plain>;
  }

  return (
    <Tag
      className={className}
      variants={stagger(delay, each)}
      initial="hidden"
      whileInView="show"
      viewport={inView}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** A single revealing item. Safe to use outside a Reveal — it self-triggers. */
export function RevealItem({
  as = 'div', children, className = '', variants = fadeUp, standalone = false, ...rest
}) {
  const reduce = useReducedMotion();
  const Tag = motion[as] ?? motion.div;

  if (reduce) {
    const Plain = as;
    return <Plain className={className} {...rest}>{children}</Plain>;
  }

  const trigger = standalone
    ? { initial: 'hidden', whileInView: 'show', viewport: inView }
    : {};

  return (
    <Tag className={className} variants={variants} {...trigger} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Scroll-linked parallax. `speed` is how far the element travels across the
 * whole scroll of its container, in pixels; negative moves against the scroll.
 *
 * Spring-smoothed because raw scroll values are jittery on trackpads and on
 * phones with high-frequency scroll events, and the jitter is very visible on a
 * slow-moving element.
 */
export function Parallax({ children, speed = 40, className = '' }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const raw = useTransform(scrollYProgress, [0, 1], [speed, -speed]);
  const y = useSpring(raw, { stiffness: 90, damping: 24, mass: 0.4 });

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <div ref={ref} className={className}>
      <motion.div style={{ y }}>{children}</motion.div>
    </div>
  );
}

/**
 * Pointer-reactive tilt and glow for a card.
 *
 * Returns props to spread. The highlight is driven by CSS custom properties
 * rather than React state, so moving the pointer costs one style write and
 * never re-renders the tree — which is what keeps a grid of these cheap.
 * Disabled entirely under reduced motion and on touch, where there is no hover
 * and the tilt would only fight the scroll.
 */
export function useLiquidPointer({ tilt = 6 } = {}) {
  const ref = useRef(null);
  const reduce = useReducedMotion();

  if (reduce) return { ref: undefined, onPointerMove: undefined, onPointerLeave: undefined };

  const onPointerMove = (e) => {
    const el = ref.current;
    if (!el || e.pointerType === 'touch') return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty('--mx', `${px * 100}%`);
    el.style.setProperty('--my', `${py * 100}%`);
    el.style.transform =
      `perspective(1000px) rotateX(${(0.5 - py) * tilt}deg) rotateY(${(px - 0.5) * tilt}deg) translateY(-4px)`;
  };

  const onPointerLeave = () => {
    const el = ref.current;
    if (el) el.style.transform = '';
  };

  return { ref, onPointerMove, onPointerLeave };
}

export { motion, useReducedMotion };

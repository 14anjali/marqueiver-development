import { useRef, useEffect, useState } from 'react';
import { motion, useReducedMotion, EASE } from './motion';
import { Verified, Star, Check, ShieldCheck, Handshake } from '../icons';

/**
 * The hero visual: the Marqueiver ecosystem, shown rather than described.
 *
 * The brief was explicit that this should not be decorative shapes, so every
 * card here is a real screen from the product, with the product's real numbers:
 * a brand's campaign brief, a creator's verified metrics, an escrow state, and
 * the offer thread between them. Someone who reads nothing but this column
 * should still understand what Marqueiver does — brand posts a brief, creator is
 * found on verified data, terms are agreed on the record, money sits in escrow
 * until the work is approved.
 *
 * The four cards are laid out as a flow, top to bottom:
 *
 *     Brand campaign  →  Creator match  →  Agreed terms  →  Escrow funded
 *
 * Motion discipline: cards enter once on load in sequence, then only drift by a
 * few pixels on a long loop. The whole group tilts very slightly toward the
 * pointer, driven by a CSS variable rather than React state so pointer movement
 * costs a style write and no re-render. On touch and under reduced motion the
 * tilt and the drift are both off, and the composition stands still.
 */

const CARD_IN = {
  hidden: { opacity: 0, y: 28, scale: 0.96 },
  show: (i) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { delay: 0.25 + i * 0.13, duration: 0.7, ease: EASE },
  }),
};

export function HeroEcosystem() {
  const wrap = useRef(null);
  const reduce = useReducedMotion();
  const [live, setLive] = useState(false);

  // The escrow amount counts up once, on entry — it is the number the whole
  // product is about, so it earns the one piece of attention-drawing motion.
  useEffect(() => {
    const t = setTimeout(() => setLive(true), 900);
    return () => clearTimeout(t);
  }, []);

  const onPointerMove = (e) => {
    if (reduce || e.pointerType === 'touch') return;
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--tilt-x', `${-py * 5}deg`);
    el.style.setProperty('--tilt-y', `${px * 5}deg`);
  };

  const onPointerLeave = () => {
    const el = wrap.current;
    if (!el) return;
    el.style.setProperty('--tilt-x', '0deg');
    el.style.setProperty('--tilt-y', '0deg');
  };

  return (
    <div
      ref={wrap}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className="relative w-full max-w-[30rem] mx-auto lg:mx-0 select-none"
      style={{
        perspective: '1400px',
        transform: 'rotateX(var(--tilt-x,0deg)) rotateY(var(--tilt-y,0deg))',
        transition: 'transform .45s cubic-bezier(.22,.7,.3,1)',
        transformStyle: 'preserve-3d',
      }}
      aria-hidden="true"
    >
      {/* Connective spine. The flow between the cards is the actual message, so
          it is drawn rather than implied by proximity alone. */}
      <div
        className="absolute left-1/2 top-[12%] bottom-[12%] w-px -translate-x-1/2
                   bg-gradient-to-b from-transparent via-brand-300/50 to-transparent hidden sm:block"
      />

      <div className="space-y-3.5">
        <FloatCard i={0} drift={-6}>
          <BrandBriefCard />
        </FloatCard>

        <FlowArrow label="matched on verified data" />

        <FloatCard i={1} drift={5} offset="sm:translate-x-6">
          <CreatorMatchCard />
        </FloatCard>

        <FlowArrow label="terms agreed on the record" />

        <FloatCard i={2} drift={-4} offset="sm:-translate-x-4">
          <EscrowCard live={live} />
        </FloatCard>
      </div>
    </div>
  );
}

/* ─────────────────────────────── scaffolding ───────────────────────────────── */

function FloatCard({ i, drift, offset = '', children }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      custom={i}
      variants={CARD_IN}
      initial="hidden"
      animate="show"
      className={`relative ${offset}`}
      style={{ transformStyle: 'preserve-3d' }}
    >
      <motion.div
        animate={reduce ? undefined : { y: [0, drift, 0] }}
        transition={reduce ? undefined
          : { duration: 9 + i * 2.5, repeat: Infinity, ease: 'easeInOut' }}
        className="will-change-transform"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

function FlowArrow({ label }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="flex items-center justify-center gap-2 py-0.5"
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1, duration: 0.5 }}
    >
      <span className="liquid-chip px-3 py-1 text-[10.5px] font-medium text-ink-soft whitespace-nowrap">
        {label}
      </span>
    </motion.div>
  );
}

/* ──────────────────────────────── the cards ────────────────────────────────── */

/** A brand's live campaign brief — where a collaboration starts. */
function BrandBriefCard() {
  return (
    <div className="liquid-pane liquid-lit p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl2 bg-gradient-to-br from-money-500 to-brand-600
                        flex items-center justify-center text-white font-display font-extrabold text-sm shrink-0">
          M
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-display font-bold text-[15px] text-ink truncate">Mamaearth</span>
            <Verified className="w-3.5 h-3.5 shrink-0" />
          </div>
          <p className="text-[11.5px] text-muted">Beauty &amp; Personal Care · Brand</p>
        </div>
        <span className="pill-live text-[10px] shrink-0">Live brief</span>
      </div>

      <p className="text-[13px] text-ink-soft mt-3.5 leading-relaxed">
        Monsoon haircare launch — 1 reel plus 2 stories, delivered within 14 days.
      </p>

      <div className="flex items-center gap-4 mt-4 pt-3.5 border-t border-line/80">
        <Metric label="Budget" value="₹45,000" money />
        <Metric label="Deliverables" value="3" />
        <Metric label="Deadline" value="14 days" />
      </div>
    </div>
  );
}

/** The creator the brand found — ranked on connected-account data, not claims. */
function CreatorMatchCard() {
  return (
    <div className="liquid-pane liquid-lit p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-pink-500
                        flex items-center justify-center text-white font-display font-extrabold text-sm shrink-0">
          DV
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-display font-bold text-[15px] text-ink truncate">Damyanti Verma</span>
            <Verified className="w-3.5 h-3.5 shrink-0" />
          </div>
          <p className="text-[11.5px] text-muted">Fitness &amp; Lifestyle · Delhi</p>
        </div>
        <span className="flex items-center gap-1 text-[11px] font-semibold text-ink shrink-0">
          <Star className="w-3.5 h-3.5" /> 4.9
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-4">
        <StatTile value="128K" label="Followers" />
        <StatTile value="6.4%" label="Engagement" />
        <StatTile value="24h" label="Responds" />
      </div>

      <div className="flex items-center gap-1.5 mt-3.5 text-[11px] text-jade-700">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
        <span>Metrics from connected accounts, not self-reported</span>
      </div>
    </div>
  );
}

/** Escrow — the moment that makes the collaboration real for both sides. */
function EscrowCard({ live }) {
  const reduce = useReducedMotion();
  return (
    <div className="liquid-pane liquid-lit p-4 sm:p-5 overflow-hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 rounded-xl2 bg-jade-50 flex items-center justify-center shrink-0">
            <Handshake className="w-4 h-4 text-jade-600" />
          </span>
          <div className="min-w-0">
            <p className="font-display font-bold text-[14px] text-ink leading-tight">Terms accepted</p>
            <p className="text-[11px] text-muted">Version 3 · both parties confirmed</p>
          </div>
        </div>
        <span className="pill-done text-[10px] shrink-0">
          <Check className="w-3 h-3" /> Agreed
        </span>
      </div>

      <div className="mt-4 rounded-xl2 bg-money-50 border border-money-100 p-3.5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-money-700">
              Held in escrow
            </p>
            <motion.p
              className="money text-2xl text-money-700 mt-0.5"
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={live ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, ease: EASE }}
            >
              ₹45,000
            </motion.p>
          </div>
          <p className="text-[10.5px] text-money-700/80 text-right leading-snug max-w-[9rem]">
            Released to the creator on approval
          </p>
        </div>

        {/* Funding bar. `scaleX` on a composited layer — no layout work. */}
        <div className="h-1.5 rounded-full bg-money-100 mt-3 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-money-500 to-money-600 origin-left"
            initial={reduce ? false : { scaleX: 0 }}
            animate={live ? { scaleX: 1 } : {}}
            transition={{ duration: 1.1, ease: EASE, delay: 0.15 }}
          />
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────── fragments ────────────────────────────────── */

function Metric({ label, value, money }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`text-[13px] font-semibold mt-0.5 truncate ${money ? 'money text-money-700' : 'text-ink'}`}>
        {value}
      </p>
    </div>
  );
}

function StatTile({ value, label }) {
  return (
    <div className="rounded-xl2 bg-lilac/70 border border-brand-100 px-2.5 py-2 text-center">
      <p className="stat-num text-[15px] leading-none">{value}</p>
      <p className="text-[10px] text-muted mt-1">{label}</p>
    </div>
  );
}

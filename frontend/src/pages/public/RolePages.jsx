import { Link } from 'react-router-dom';
import { PublicLayout } from '../../components/public/PublicChrome';
import LifecycleTrack from '../../components/public/LifecycleTrack';
import FeatureGrid from '../../components/public/FeatureGrid';
import FaqList from '../../components/public/FaqList';
import ClosingCta from '../../components/public/ClosingCta';
import MoneyExplainer from '../../components/public/MoneyExplainer';
import { useAuth } from '../../lib/auth';
import * as Icons from '../../components/icons';
import {
  Reveal, RevealItem, fadeUp, useLiquidPointer, motion, useReducedMotion, EASE,
} from '../../components/public/motion';
import { CREATOR_STEPS, BRAND_STEPS, LIFECYCLE, numberWord } from './content';

/**
 * The four dedicated public pages behind the nav (scope §4).
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * These pages were written against the *previous* public design vocabulary —
 * `container-page`, `h-display`, `section`, `btn-cta` — while the home page and
 * the site chrome were rebuilt on the liquid one. So the nav, which is shared,
 * rendered the new glass bar over a page from the old system: different
 * gutters, a different heading scale, a different button. Clicking "For
 * creators" from the home page looked like leaving the product.
 *
 * Three real content faults went with it:
 *
 *  1. `HowItWorksPage` claimed "ten stages" as literal copy while `LIFECYCLE`
 *     held ten and the home page claimed nine. The number is now counted.
 *  2. A signed-in visitor was still offered "Join as a creator" and "Already
 *     have an account? Log in". The nav had been fixed to say "Go to
 *     dashboard"; the page body had not, so the two disagreed on the same
 *     screen. The head now reads the session.
 *  3. Neither role page answered the question each audience actually arrives
 *     with — what a creator takes home, and whether a brand pays a fee on top.
 *     `MoneyExplainer` answers it with the live rate rather than a sentence.
 *
 * The steps still come from `content.js`, so the claims here and on the home
 * page remain one copy.
 */

/* ──────────────────────────────── page head ────────────────────────────────── */

function PageHead({ title, lede, primary, primaryLabel, badge }) {
  const reduce = useReducedMotion();
  const { isAuthed } = useAuth();

  return (
    <section className="liquid-stage pt-10 pb-16 md:pt-16 md:pb-24 -mt-[4.5rem]">
      {/* One light field only. The home page carries two; a secondary page that
          matches it exactly competes with it. */}
      <div
        className="pointer-events-none absolute -top-40 -left-32 w-[42rem] h-[42rem] rounded-full
                   opacity-[0.45] animate-liquid"
        style={{
          background: 'radial-gradient(circle, rgba(167,139,250,.42) 0%, transparent 65%)',
          filter: 'blur(64px)',
        }}
      />

      <div className="container-wide relative z-10 pt-[4.5rem]">
        {badge && (
          <motion.span
            className="liquid-chip inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-ink-soft"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            {badge}
          </motion.span>
        )}

        <motion.h1
          className="display-hero text-ink mt-6 max-w-4xl"
          initial={reduce ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: EASE, delay: 0.05 }}
        >
          {title}
        </motion.h1>

        <motion.p
          className="text-lg text-ink-soft mt-6 max-w-2xl leading-relaxed"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.14 }}
        >
          {lede}
        </motion.p>

        {primary && (
          <motion.div
            className="flex flex-col sm:flex-row sm:items-center gap-3 mt-9"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.22 }}
          >
            {isAuthed ? (
              // Already signed in — the sign-up call to action is noise, and
              // "already have an account?" is worse than noise.
              <Link to="/dashboard" className="btn-liquid">
                Go to your dashboard
                <Icons.ChevRight className="w-4 h-4" />
              </Link>
            ) : (
              <>
                <Link to={primary} className="btn-liquid">
                  {primaryLabel}
                  <Icons.ChevRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/login"
                  className="link-slide text-sm font-semibold text-brand-700 inline-flex items-center gap-1"
                >
                  Already have an account? Log in
                </Link>
              </>
            )}
          </motion.div>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────────────── step list ───────────────────────────────── */

/**
 * The role's steps, as numbered cards rather than a two-column wall of prose.
 *
 * These are a sequence — "search, offer, fund, approve" — and the previous
 * layout dropped them into an unnumbered grid that reads left-to-right on
 * desktop and top-to-bottom on a phone, so the order silently changed with the
 * viewport.
 */
function StepList({ steps, eyebrow, heading }) {
  return (
    <section className="py-20 md:py-28 bg-white">
      <div className="container-wide">
        <Reveal className="max-w-2xl mb-12">
          <RevealItem variants={fadeUp}><p className="eyebrow">{eyebrow}</p></RevealItem>
          <RevealItem variants={fadeUp}>
            <h2 className="display-section mt-3">{heading}</h2>
          </RevealItem>
        </Reveal>

        <Reveal className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" each={0.05}>
          {steps.map((s, i) => (
            <RevealItem key={s.title} variants={fadeUp}>
              <StepCard n={i + 1} title={s.title} body={s.body} />
            </RevealItem>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

function StepCard({ n, title, body }) {
  const pointer = useLiquidPointer({ tilt: 4 });
  return (
    <article {...pointer} className="liquid-card liquid-glow h-full p-5 will-change-transform">
      <span className="w-7 h-7 rounded-full bg-brand-600 text-white text-[11px] font-bold
                       flex items-center justify-center tnum shrink-0">
        {n}
      </span>
      <h3 className="font-display font-bold text-ink mt-4 leading-snug">{title}</h3>
      <p className="text-[13.5px] text-ink-soft mt-3 leading-relaxed">{body}</p>
    </article>
  );
}

/* ──────────────────────────────── the pages ────────────────────────────────── */

export function ForCreatorsPage() {
  return (
    <PublicLayout>
      <PageHead
        badge="For creators"
        title="Know what you are being paid, before you start filming."
        lede="Brands come to you with an actual budget, deliverables and a deadline attached. You counter until the terms work, and the money sits in escrow before the campaign starts."
        primary="/signup?role=creator"
        primaryLabel="Join as a creator"
      />
      <StepList
        steps={CREATOR_STEPS}
        eyebrow="How it works for you"
        heading="From profile to payout"
      />
      <MoneyExplainer side="creator" />
      <LifecycleTrack />
      <FaqList limit={4} />
      <ClosingCta />
    </PublicLayout>
  );
}

export function ForBrandsPage() {
  return (
    <PublicLayout>
      <PageHead
        badge="For brands"
        title="Run creator campaigns that survive an audit."
        lede="Search creators on verified audience data, send offers with real terms, and keep every counter-offer, approval and payout on one record you can point at later."
        primary="/signup?role=brand"
        primaryLabel="Join as a brand"
      />
      <StepList
        steps={BRAND_STEPS}
        eyebrow="How it works for you"
        heading="From shortlist to signed-off campaign"
      />
      <MoneyExplainer side="brand" />
      <LifecycleTrack />
      <FaqList limit={4} />
      <ClosingCta />
    </PublicLayout>
  );
}

export function HowItWorksPage() {
  return (
    <PublicLayout>
      <PageHead
        badge="The lifecycle"
        title="A collaboration, stage by stage."
        lede={`Every Marqueiver campaign moves through the same ${numberWord(LIFECYCLE.length)} stages. A stage only advances when the party responsible for it acts, and the platform will not let it skip.`}
      />
      <LifecycleTrack heading={false} />
      <FeatureGrid />
      <ClosingCta />
    </PublicLayout>
  );
}

export function FaqPage() {
  return (
    <PublicLayout>
      <PageHead
        badge="Answers"
        title="Questions, answered plainly."
        lede="How joining works, why a connected account is required, when messaging opens, and what happens to your money at each stage."
      />
      <FaqList />
      <ClosingCta />
    </PublicLayout>
  );
}

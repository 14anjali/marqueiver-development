import { Link } from 'react-router-dom';
import * as Icons from '../../components/icons';
import { PublicLayout } from '../../components/public/PublicChrome';
import { HeroEcosystem } from '../../components/public/HeroEcosystem';
import ClosingCta from '../../components/public/ClosingCta';
import {
  Reveal, RevealItem, Parallax, fadeUp, scaleIn, useLiquidPointer, motion, useReducedMotion, EASE,
} from '../../components/public/motion';
import { LIFECYCLE, CREATOR_STEPS, BRAND_STEPS, FEATURES } from './content';

/**
 * The Marqueiver landing page.
 *
 * The copy is not written here — it comes from `content.js`, which mirrors the
 * real rules in `dealStateMachine.js` and `messaging.policy.js`. That is
 * deliberate: a marketing page that describes a product the code does not
 * implement is worse than a plain one, and this way a backend rule change has a
 * single place to propagate.
 *
 * Structure, in the order a visitor needs it:
 *
 *   hero            what this is, shown as the real product
 *   proof           the numbers, immediately after the claim
 *   lifecycle       how a collaboration actually runs, end to end
 *   two audiences   the same platform read from each side
 *   platform        what you get, once you are inside
 *   trust           why the money is safe — the objection nobody says out loud
 *   close           one clear action
 */

export default function HomePage() {
  return (
    <PublicLayout>
      <Hero />
      <Proof />
      <Lifecycle />
      <Audiences />
      <Platform />
      <Trust />
      <ClosingCta />
    </PublicLayout>
  );
}

/* ─────────────────────────────────── hero ──────────────────────────────────── */

function Hero() {
  const reduce = useReducedMotion();

  return (
    <section className="liquid-stage pt-10 pb-20 md:pt-16 md:pb-28 -mt-[4.5rem]">
      {/* Two slow light fields. Blurred to the point of being light rather than
          shape — this is what separates depth from decoration. */}
      <div
        className="pointer-events-none absolute -top-40 -left-40 w-[46rem] h-[46rem] rounded-full
                   opacity-[0.55] animate-liquid"
        style={{
          background: 'radial-gradient(circle, rgba(167,139,250,.45) 0%, transparent 65%)',
          filter: 'blur(60px)',
        }}
      />
      <div
        className="pointer-events-none absolute top-20 -right-52 w-[38rem] h-[38rem] rounded-full
                   opacity-[0.45] animate-liquid-slow"
        style={{
          background: 'radial-gradient(circle, rgba(236,72,153,.40) 0%, transparent 65%)',
          filter: 'blur(70px)',
        }}
      />

      <div className="container-wide relative z-10 pt-[4.5rem]">
        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-14 lg:gap-10 items-center">
          {/* ── copy ── */}
          <div>
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
            >
              <span className="liquid-chip inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-ink-soft">
                <span className="relative flex w-1.5 h-1.5">
                  {!reduce && (
                    <span className="absolute inline-flex w-full h-full rounded-full bg-jade-500 opacity-70 animate-ping" />
                  )}
                  <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-jade-500" />
                </span>
                Escrow-secured creator collaborations
              </span>
            </motion.div>

            <motion.h1
              className="display-hero text-ink mt-6"
              initial={reduce ? false : { opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.06 }}
            >
              Brands and creators,
              <span className="block text-flow">on the same record.</span>
            </motion.h1>

            <motion.p
              className="text-lg text-ink-soft mt-6 max-w-xl leading-relaxed"
              initial={reduce ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.16 }}
            >
              Find creators on verified audience data, agree terms that are versioned rather than
              remembered, and hold the payment in escrow until the work is approved.
            </motion.p>

            <motion.div
              className="flex flex-col sm:flex-row gap-3 mt-9"
              initial={reduce ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.24 }}
            >
              <Link to="/signup?role=brand" className="btn-liquid">
                Start hiring creators
                <Icons.ChevRight className="w-4 h-4" />
              </Link>
              <Link to="/signup?role=creator" className="btn-liquid-ghost">
                Join as a creator
              </Link>
            </motion.div>

            <motion.p
              className="text-xs text-muted mt-5"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.34 }}
            >
              Sign up with Google, email or WhatsApp — one is enough.
            </motion.p>
          </div>

          {/* ── the product itself ── */}
          <div className="lg:pl-4">
            <HeroEcosystem />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────── proof ─────────────────────────────────── */

const STATS = [
  ['2,843', 'Creators on the platform'],
  ['320+', 'Campaigns run'],
  ['₹2Cr+', 'Paid out through escrow'],
  ['12.5%', 'Flat commission, creator-side'],
];

function Proof() {
  return (
    <section className="border-y border-line bg-white">
      <Reveal className="container-wide py-10 grid grid-cols-2 lg:grid-cols-4 gap-8" each={0.06}>
        {STATS.map(([value, label]) => (
          <RevealItem key={label} variants={fadeUp}>
            <p className="stat-num text-2xl sm:text-3xl">{value}</p>
            <p className="text-[13px] text-muted mt-1.5 leading-snug">{label}</p>
          </RevealItem>
        ))}
      </Reveal>
    </section>
  );
}

/* ───────────────────────────────── lifecycle ───────────────────────────────── */

/**
 * The nine real stages, from `content.js`. This is the section that does the
 * most work on the page: the product's whole argument is that a collaboration
 * should be a tracked record rather than a conversation, and that is only
 * convincing if you can see the record.
 */
function Lifecycle() {
  return (
    <section className="liquid-stage py-24 md:py-32">
      <div className="container-wide relative z-10">
        <Reveal className="max-w-2xl">
          <RevealItem variants={fadeUp}>
            <p className="eyebrow">How Marqueiver works</p>
          </RevealItem>
          <RevealItem variants={fadeUp}>
            <h2 className="display-section mt-3">
              Every collaboration follows the same nine stages
            </h2>
          </RevealItem>
          <RevealItem variants={fadeUp}>
            <p className="text-lg text-ink-soft mt-5 leading-relaxed">
              Not a chat thread that someone has to reconstruct later. Each stage has a state, an
              owner, and a record of what was agreed.
            </p>
          </RevealItem>
        </Reveal>

        <Reveal
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-14"
          each={0.05}
        >
          {LIFECYCLE.map((s) => (
            <RevealItem key={s.n} variants={fadeUp}>
              <LifecycleCard stage={s} />
            </RevealItem>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

function LifecycleCard({ stage }) {
  const pointer = useLiquidPointer({ tilt: 4 });
  return (
    <article
      {...pointer}
      className="liquid-card liquid-glow h-full p-5 will-change-transform"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="w-7 h-7 rounded-full bg-brand-600 text-white text-[11px] font-bold
                         flex items-center justify-center tnum shrink-0">
          {stage.n}
        </span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
          stage.chat
            ? 'bg-jade-50 text-jade-700'
            : 'bg-bg text-muted border border-line'}`}
        >
          {stage.chat ? 'Chat open' : 'Chat locked'}
        </span>
      </div>

      <h3 className="font-display font-bold text-ink mt-4">{stage.stage}</h3>
      <p className="text-[10.5px] uppercase tracking-wider text-muted mt-1">{stage.actor}</p>
      <p className="text-[13.5px] text-ink-soft mt-3 leading-relaxed">{stage.body}</p>
    </article>
  );
}

/* ──────────────────────────────── audiences ────────────────────────────────── */

function Audiences() {
  return (
    <section className="py-24 md:py-32 bg-white">
      <div className="container-wide">
        <Reveal className="max-w-2xl mb-14">
          <RevealItem variants={fadeUp}>
            <p className="eyebrow">Two sides, one record</p>
          </RevealItem>
          <RevealItem variants={fadeUp}>
            <h2 className="display-section mt-3">The same platform, read from either side</h2>
          </RevealItem>
        </Reveal>

        <div className="grid lg:grid-cols-2 gap-6">
          <AudienceColumn
            eyebrow="For brands"
            title="Hire on data, pay on delivery"
            steps={BRAND_STEPS}
            cta={{ to: '/signup?role=brand', label: 'Start hiring creators' }}
            more={{ to: '/for-brands', label: 'More for brands' }}
            tone="money"
          />
          <AudienceColumn
            eyebrow="For creators"
            title="Real offers, with the budget attached"
            steps={CREATOR_STEPS}
            cta={{ to: '/signup?role=creator', label: 'Join as a creator' }}
            more={{ to: '/for-creators', label: 'More for creators' }}
            tone="brand"
          />
        </div>
      </div>
    </section>
  );
}

function AudienceColumn({ eyebrow, title, steps, cta, more, tone }) {
  const accent = tone === 'money'
    ? 'from-money-500/12 to-transparent'
    : 'from-brand-500/12 to-transparent';

  return (
    <Reveal className="liquid-tile liquid-lit relative overflow-hidden p-7 sm:p-9" each={0.05}>
      <div className={`absolute inset-x-0 top-0 h-40 bg-gradient-to-b ${accent} pointer-events-none`} />

      <div className="relative">
        <RevealItem variants={fadeUp}><p className="eyebrow">{eyebrow}</p></RevealItem>
        <RevealItem variants={fadeUp}>
          <h3 className="font-display font-extrabold text-2xl text-ink mt-3 tracking-tight">{title}</h3>
        </RevealItem>

        <ol className="mt-7 space-y-4">
          {steps.map((s, i) => (
            <RevealItem as="li" key={s.title} variants={fadeUp} className="flex gap-3.5">
              <span className="w-6 h-6 rounded-full bg-white border border-line text-[11px] font-bold
                               text-ink-soft flex items-center justify-center shrink-0 mt-0.5 tnum">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-[14.5px] text-ink leading-snug">{s.title}</p>
                <p className="text-[13.5px] text-muted mt-1 leading-relaxed">{s.body}</p>
              </div>
            </RevealItem>
          ))}
        </ol>

        <RevealItem variants={fadeUp} className="flex flex-wrap items-center gap-3 mt-8">
          <Link to={cta.to} className="btn-liquid !px-6 !py-3 !text-sm">{cta.label}</Link>
          <Link
            to={more.to}
            className="link-slide text-sm font-semibold text-brand-700 inline-flex items-center gap-1"
          >
            {more.label} <Icons.ChevRight className="w-4 h-4" />
          </Link>
        </RevealItem>
      </div>
    </Reveal>
  );
}

/* ──────────────────────────────── platform ─────────────────────────────────── */

function Platform() {
  return (
    <section className="liquid-stage liquid-stage--ink text-white py-24 md:py-32 relative">
      <Parallax speed={26} className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[52rem] h-[52rem] rounded-full opacity-40"
          style={{
            background: 'radial-gradient(circle, rgba(168,85,247,.35) 0%, transparent 60%)',
            filter: 'blur(80px)',
          }}
        />
      </Parallax>

      <div className="container-wide relative z-10">
        <Reveal className="max-w-2xl">
          <RevealItem variants={fadeUp}>
            <p className="eyebrow text-brand-300">Inside the platform</p>
          </RevealItem>
          <RevealItem variants={fadeUp}>
            <h2 className="display-section mt-3 !text-white">
              Everything a collaboration needs, in one place
            </h2>
          </RevealItem>
          <RevealItem variants={fadeUp}>
            <p className="text-lg text-white/65 mt-5 leading-relaxed">
              Discovery, terms, payment and delivery all sit on the same record, so nothing depends
              on someone remembering what was said in a chat.
            </p>
          </RevealItem>
        </Reveal>

        <Reveal className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-14" each={0.045}>
          {FEATURES.map((f) => {
            const Icon = Icons[f.icon];
            return (
              <RevealItem key={f.title} variants={scaleIn}>
                <div className="liquid-tile-ink liquid-lit liquid-lit-ink h-full p-5
                                transition-[transform,border-color] duration-300 hover:-translate-y-1
                                hover:border-white/25">
                  {Icon && (
                    <span className="inline-flex w-10 h-10 rounded-xl2 bg-white/10 text-brand-200
                                     items-center justify-center mb-4">
                      <Icon className="w-5 h-5" />
                    </span>
                  )}
                  <h3 className="font-display font-bold text-white text-[15px]">{f.title}</h3>
                  <p className="text-[13.5px] text-white/60 mt-2 leading-relaxed">{f.body}</p>
                </div>
              </RevealItem>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}

/* ────────────────────────────────── trust ──────────────────────────────────── */

const TRUST = [
  {
    icon: 'ShieldCheck',
    title: 'The money is committed before work starts',
    body: 'A campaign only becomes active once the brand has funded escrow. A creator is never producing work against an unfunded promise, and a brand keeps its money until the deliverables are approved.',
  },
  {
    icon: 'FileText',
    title: 'Terms are versioned, not remembered',
    body: 'Every offer and counter-offer is kept — amount, deliverables and deadline. When a campaign is questioned months later, the record answers it.',
  },
  {
    icon: 'Verified',
    title: 'Metrics come from connected accounts',
    body: 'Audience and engagement figures are pulled from Instagram, YouTube and Facebook rather than typed into a profile. Discovery is only useful if the numbers behind it are real.',
  },
];

function Trust() {
  return (
    <section className="py-24 md:py-32 bg-white">
      <div className="container-wide">
        <Reveal className="max-w-2xl mb-14">
          <RevealItem variants={fadeUp}><p className="eyebrow">Why it holds up</p></RevealItem>
          <RevealItem variants={fadeUp}>
            <h2 className="display-section mt-3">
              The parts people worry about, handled
            </h2>
          </RevealItem>
        </Reveal>

        <Reveal className="grid gap-5 md:grid-cols-3" each={0.08}>
          {TRUST.map((t) => {
            const Icon = Icons[t.icon];
            return (
              <RevealItem key={t.title} variants={fadeUp}>
                <div className="h-full border-t-2 border-brand-500 pt-6">
                  {Icon && (
                    <span className="inline-flex w-10 h-10 rounded-xl2 bg-brand-50 text-brand-700
                                     items-center justify-center mb-4">
                      <Icon className="w-5 h-5" />
                    </span>
                  )}
                  <h3 className="font-display font-bold text-ink leading-snug">{t.title}</h3>
                  <p className="text-[14px] text-ink-soft mt-3 leading-relaxed">{t.body}</p>
                </div>
              </RevealItem>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}

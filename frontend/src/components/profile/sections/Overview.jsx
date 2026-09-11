import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../../../lib/api';
import { Money, Skeleton, StatusPill } from '../../feedback';
import {
  Platform, MapPin, Check, Verified, Play, Star, ShieldCheck, Lock,
} from '../../icons';
import { rise, stagger, withReducedMotion, usePrefersReducedMotion } from '../../../lib/motion';
import { followerCount } from '../shared';

/**
 * Overview — the profile as a brand sees it, and nothing more.
 *
 * Deliberately read-only. An overview that is also editable is two things at
 * once: you cannot trust it as a preview, because the fields look like inputs,
 * and you cannot use it as a form, because the fields are spread across eight
 * unrelated groups. Every block here instead carries a quiet Edit that moves to
 * the section that owns it — so the page answers "what do brands see" and
 * "where do I change that" without conflating them.
 *
 * The one thing shown here that a brand does *not* see is marked as such:
 * profile completeness, and the reminder that payout and verification documents
 * are private. Those are the creator's own view of their profile, and leaving
 * them out would make the page less useful than it should be.
 */
export default function Overview({ profile, onEdit }) {
  const reduced = usePrefersReducedMotion();
  const [connected, setConnected] = useState(null);

  /*
    Facebook Pages are read separately because `socialAccounts` carries one
    entry per platform — a creator with three Pages has one Facebook row there,
    the primary one. The overview should say so rather than appearing to lose
    two Pages.
  */
  const [fbPages, setFbPages] = useState(null);

  /*
    Verification status is its own collection, not a flag on the profile —
    `CreatorProfile` has no `verified` field, so reading `profile.verified`
    would have been permanently `undefined` and the badge would never appear.
  */
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    let alive = true;

    api.myVerifications()
      .then(({ data }) => {
        if (alive) setVerified((data ?? []).some((v) => v.status === 'approved'));
      })
      .catch(() => { /* absence of a badge is the correct fallback */ });

    api.connectedFacebookPages()
      .then(({ data }) => { if (alive) setFbPages(data ?? []); })
      .catch(() => { if (alive) setFbPages([]); });

    // The onboarding endpoint already resolves "what is connected" across all
    // three platforms server-side, so this does not re-derive it client-side.
    api.onboardingState()
      .then(({ data }) => { if (alive) setConnected(data?.connected ?? []); })
      .catch(() => { if (alive) setConnected([]); });

    return () => { alive = false; };
  }, []);

  const p = profile;
  const socials = p.socialAccounts ?? [];
  const portfolio = p.portfolio ?? [];
  const rates = p.rateCard ?? [];

  const totalAudience = socials.reduce((sum, s) => sum + (Number(s.followers) || 0), 0);
  const lowestRate = rates.length ? Math.min(...rates.map((r) => Number(r.price) || 0)) : 0;

  const section = withReducedMotion(rise, reduced);

  return (
    <motion.div
      variants={withReducedMotion(stagger, reduced)}
      initial="hidden"
      animate="visible"
      className="space-y-5"
    >
      {/* ── the header a brand lands on ── */}
      <motion.section
        variants={section}
        className="rounded-xl3 border border-line bg-white overflow-hidden shadow-flat"
      >
        <div className="relative">
          <div className="h-28 sm:h-40 bg-gradient-to-br from-brand-500 via-brand-600 to-pink-500">
            {p.coverUrl && (
              <img src={p.coverUrl} alt="" className="w-full h-full object-cover" />
            )}
          </div>

          <EditPin onClick={() => onEdit('personal')} label="Edit photos and details" />
        </div>

        {/*
          `relative z-10` is load-bearing, not decoration. The banner above sits
          in its own positioned wrapper, so it forms a stacking context and
          paints over any later sibling that is not itself positioned — which
          put the gradient on top of the avatar and clipped the creator's name
          in half. Giving this block a stacking context of its own is what lets
          the avatar overlap the banner rather than the other way round.
        */}
        <div className="relative z-10 px-5 sm:px-7 pb-6">
          {/*
            The negative margin is on the avatar alone, not on the row.

            On the row, it lifted the name and headline into the banner too —
            ink-coloured text on a saturated purple-to-pink gradient, which was
            unreadable at the headline's weight. The avatar is a shape with a
            white ring and reads fine against anything; text does not. So the
            avatar breaches the banner and every word stays on white.
          */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <span
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 border-white bg-bg
                         overflow-hidden shrink-0 shadow-raised grid place-items-center
                         -mt-12 sm:-mt-14"
            >
              {p.avatarUrl
                ? <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" />
                : (
                  <span className="font-display font-extrabold text-2xl text-brand-400">
                    {(p.displayName || '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
            </span>

            <div className="min-w-0 flex-1 sm:pt-2">
              <h2 className="font-display font-extrabold text-xl sm:text-2xl text-ink flex items-center gap-2">
                <span className="truncate">{p.displayName || 'Unnamed creator'}</span>
                {verified && <Verified className="w-5 h-5 shrink-0" />}
              </h2>

              {p.headline ? (
                <p className="text-sm text-ink-soft mt-1 leading-relaxed">{p.headline}</p>
              ) : (
                <MissingLine onClick={() => onEdit('personal')}>Add a headline</MissingLine>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2.5 text-sm text-muted">
                {p.location?.city && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {p.location.city}{p.location.country ? `, ${p.location.country}` : ''}
                  </span>
                )}
                <StatusPill
                  status={p.availability === false ? 'cancelled' : 'completed'}
                  label={p.availability === false ? 'Not taking work' : 'Open to work'}
                />
                {p.isPublished === false && (
                  <StatusPill status="draft" label="Hidden from discovery" />
                )}
              </div>
            </div>
          </div>

          {/* ── the three figures a brand scans first ── */}
          <div className="grid grid-cols-3 gap-3 mt-6">
            <Stat
              label="Total audience"
              value={totalAudience > 0 ? followerCount(totalAudience) : '—'}
              hint={socials.length ? `across ${socials.length} platform${socials.length === 1 ? '' : 's'}` : 'no accounts connected'}
            />
            <Stat
              label="Avg. engagement"
              value={p.avgEngagement > 0 ? `${p.avgEngagement}%` : '—'}
              hint={p.avgEngagement > 0 ? 'from connected accounts' : 'connect an account'}
            />
            <Stat
              label="Rates from"
              value={lowestRate > 0 ? <Money amount={lowestRate} className="!text-lg sm:!text-xl" /> : '—'}
              hint={lowestRate > 0 ? `${rates.length} rate${rates.length === 1 ? '' : 's'}` : 'no rate card'}
            />
          </div>
        </div>
      </motion.section>

      {/* ── bio ── */}
      <Block
        title="About"
        onEdit={() => onEdit('personal')}
        empty={!p.bio?.trim()}
        emptyLabel="No bio yet — this is the one place to say what you make and who for."
        variants={section}
      >
        <p className="text-sm text-ink-soft leading-relaxed whitespace-pre-line">{p.bio}</p>
      </Block>

      {/* ── categories and languages ── */}
      <Block
        title="Categories and languages"
        onEdit={() => onEdit('personal')}
        empty={!(p.categories?.length || p.languages?.length)}
        emptyLabel="No categories yet. Brands filter by category more than by anything else."
        variants={section}
      >
        {p.categories?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {p.categories.map((c) => (
              <span key={c} className="pill bg-brand-50 text-brand-700 border border-brand-100">{c}</span>
            ))}
          </div>
        )}
        {p.languages?.length > 0 && (
          <p className="text-sm text-muted mt-3">
            Creates in <span className="text-ink">{p.languages.join(', ')}</span>
          </p>
        )}
      </Block>

      {/* ── connected accounts ── */}
      <Block
        title="Connected accounts"
        onEdit={() => onEdit('social')}
        empty={!socials.length}
        emptyLabel="No accounts connected. Without one you do not appear in brand discovery at all."
        variants={section}
      >
        <div className="grid sm:grid-cols-2 gap-3">
          {socials.map((s) => (
            <div
              key={s.platform}
              className="flex items-center gap-3 rounded-xl2 border border-line p-3.5"
            >
              <Platform name={s.platform} className="w-9 h-9 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink truncate">{s.handle || s.platform}</p>
                <p className="text-xs text-muted tnum">
                  {followerCount(s.followers)} followers
                  {s.engagementRate > 0 && ` · ${s.engagementRate}% engagement`}
                </p>
              </div>
              {s.dataSource === 'connected' && (
                <span className="pill-done shrink-0"><Check className="w-3 h-3" /> Verified</span>
              )}
            </div>
          ))}
        </div>

        {/*
          Said explicitly, because "why do brands only see one of my Pages" is
          the obvious question the moment a second Page is connected.
        */}
        {fbPages && fbPages.length > 1 && (
          <p className="text-xs text-muted mt-3 leading-relaxed">
            You manage <span className="text-ink font-medium">{fbPages.length} Facebook Pages</span>.
            {' '}
            {fbPages.find((f) => f.isPrimary)?.name ?? 'One of them'} is the Page shown here and in
            discovery — the others are managed in Social Media.
          </p>
        )}

        {connected === null && <Skeleton className="h-3 w-48 rounded mt-3" />}
      </Block>

      {/* ── portfolio ── */}
      <Block
        title="Portfolio"
        onEdit={() => onEdit('portfolio')}
        empty={!portfolio.length && !p.portfolioLink}
        emptyLabel="No work samples yet. Showing what you make is more convincing than describing it."
        variants={section}
      >
        {portfolio.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
            {portfolio.slice(0, 8).map((item) => (
              <figure
                key={item._id}
                className="relative rounded-xl2 overflow-hidden border border-line bg-bg aspect-square"
              >
                {item.mediaType === 'video' ? (
                  <>
                    <video src={item.mediaUrl} className="w-full h-full object-cover" preload="metadata" muted />
                    <span className="absolute inset-0 grid place-items-center">
                      <span className="w-8 h-8 rounded-full bg-ink/60 backdrop-blur-sm grid place-items-center">
                        <Play className="w-3.5 h-3.5 text-white" />
                      </span>
                    </span>
                  </>
                ) : (
                  <img
                    src={item.mediaUrl}
                    alt={item.title || 'Work sample'}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                )}
              </figure>
            ))}
          </div>
        )}

        {portfolio.length > 8 && (
          <p className="text-xs text-muted mt-3">
            and {portfolio.length - 8} more
          </p>
        )}

        {p.portfolioLink && (
          <a
            href={p.portfolioLink}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700
                        hover:text-brand-800 focusable ${portfolio.length ? 'mt-4' : ''}`}
          >
            {p.portfolioLink.replace(/^https?:\/\//, '').slice(0, 48)} →
          </a>
        )}
      </Block>

      {/* ── work preferences ── */}
      <Block
        title="Work preferences"
        onEdit={() => onEdit('preferences')}
        empty={!(p.contentTypes?.length || p.collaborationTypes?.length)}
        emptyLabel="Nothing set — brands cannot tell what you are willing to make."
        variants={section}
      >
        <dl className="grid sm:grid-cols-2 gap-5">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted">Collaborations</dt>
            <dd className="flex flex-wrap gap-1.5 mt-2">
              {(p.collaborationTypes ?? []).map((t) => (
                <span key={t} className="pill-quiet capitalize">{t}</span>
              ))}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted">Content</dt>
            <dd className="flex flex-wrap gap-1.5 mt-2">
              {(p.contentTypes ?? []).length
                ? p.contentTypes.map((t) => (
                  <span key={t} className="pill-quiet capitalize">{t}</span>
                ))
                : <span className="text-sm text-muted">Not set</span>}
            </dd>
          </div>
        </dl>
      </Block>

      {/* ── rate card ── */}
      <Block
        title="Rate card"
        onEdit={() => onEdit('rates')}
        empty={!rates.length}
        emptyLabel="No rates set — brands see “Contact for pricing”, and you are left out of budget filters."
        variants={section}
      >
        <ul className="divide-y divide-line">
          {rates.map((r) => (
            <li key={r.contentType} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-sm text-ink capitalize">{r.contentType}</span>
              <Money amount={r.price} className="!text-sm" />
            </li>
          ))}
        </ul>
      </Block>

      {/* ── what brands never see ── */}
      <motion.section
        variants={section}
        className="rounded-xl3 border border-line bg-gradient-to-br from-brand-50/50 to-pink-50/40 p-5 sm:p-6"
      >
        <h3 className="font-display font-bold text-ink flex items-center gap-2">
          <Lock className="w-4 h-4 text-brand-600" />
          Private to you
        </h3>
        <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-prose">
          None of this appears on your public profile or is visible to brands, on a collaboration or
          anywhere in search.
        </p>

        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <PrivateRow
            icon={ShieldCheck}
            label="Verification documents"
            value={verified ? 'Verified — badge shown' : 'Not submitted'}
            onClick={() => onEdit('verification')}
          />
          <PrivateRow
            icon={Star}
            label="Payout details"
            value={p.payoutMethod?.type
              ? `${p.payoutMethod.type === 'bank' ? 'Bank account' : 'UPI'} saved`
              : 'Not set'}
            onClick={() => onEdit('bank')}
          />
        </div>
      </motion.section>
    </motion.div>
  );
}

/* ─────────────────────────────── pieces ────────────────────────────────────── */

/**
 * The Edit control that sits over the banner.
 *
 * Glass rather than a solid button because it overlays an image that could be
 * any colour, and a white button on a pale banner disappears.
 */
function EditPin({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full
                 bg-white/85 backdrop-blur-sm border border-white/60 px-3 py-1.5
                 text-xs font-semibold text-ink shadow-flat hover:bg-white
                 transition-colors focusable"
    >
      Edit
    </button>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl2 border border-line bg-bg/50 p-3 sm:p-4 text-center">
      <p className="font-display font-extrabold text-lg sm:text-xl text-ink tnum">{value}</p>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mt-1">{label}</p>
      <p className="text-[11px] text-muted mt-0.5 leading-snug">{hint}</p>
    </div>
  );
}

/**
 * One read-only block, with the Edit that owns it.
 *
 * `empty` is a first-class state rather than a blank card: an overview whose
 * job is "what do brands see" has to say when the answer is "nothing", and say
 * what that costs.
 */
function Block({ title, onEdit, empty, emptyLabel, children, variants }) {
  return (
    <motion.section
      variants={variants}
      className="rounded-xl3 border border-line bg-white shadow-flat p-5 sm:p-6"
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="font-display font-bold text-ink">{title}</h3>
        <button
          onClick={onEdit}
          className="text-xs font-semibold text-brand-700 hover:text-brand-800 shrink-0 focusable"
        >
          Edit
        </button>
      </div>

      {empty ? (
        <button
          onClick={onEdit}
          className="w-full text-left rounded-xl2 border border-dashed border-line bg-bg/40
                     px-4 py-5 hover:border-brand-300 hover:bg-brand-50/30 transition-colors focusable"
        >
          <span className="text-sm text-muted leading-relaxed">{emptyLabel}</span>
          <span className="block text-xs font-semibold text-brand-700 mt-2">Add it →</span>
        </button>
      ) : children}
    </motion.section>
  );
}

/** A single missing value, inline, where a sentence would otherwise be. */
function MissingLine({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-sm text-muted italic hover:text-brand-700 transition-colors mt-1 focusable"
    >
      {children} →
    </button>
  );
}

function PrivateRow({ icon: Icon, label, value, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl2 border border-line bg-white/70 p-3.5
                 text-left hover:border-brand-200 transition-colors focusable"
    >
      <span className="w-8 h-8 rounded-lg bg-bg text-muted grid place-items-center shrink-0">
        <Icon className="w-4 h-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-ink truncate">{label}</span>
        <span className="block text-xs text-muted truncate">{value}</span>
      </span>
    </button>
  );
}
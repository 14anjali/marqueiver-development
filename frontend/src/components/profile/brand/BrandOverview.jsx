import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../../../lib/api';
import { Money, Skeleton, StatusPill } from '../../feedback';
import { Platform, MapPin, Check, Verified, Lock, ShieldCheck, Wallet } from '../../icons';
import { rise, stagger, withReducedMotion, usePrefersReducedMotion } from '../../../lib/motion';
import { followerCount } from '../shared';

/**
 * Overview — the brand exactly as a creator sees it.
 *
 * Read-only by design. It answers "what do creators see about us", which is the
 * question a brand opens this page with, and a preview that is also a form
 * cannot be trusted as either: the fields look like inputs, and they belong to
 * seven unrelated groups. Each block carries a quiet Edit that moves to the
 * section that owns it.
 *
 * ── What a creator does NOT see ────────────────────────────────────────────
 *
 * `discovery.controller.js` projects `gstin`, `billing`, `contactEmail`,
 * `contactPhone`, `contactPerson` and `teamMembers` out of every brand read.
 * This page reflects that: the private block at the bottom states what is held
 * and never shows the values, so a brand can confirm the boundary rather than
 * assume it.
 */
export default function BrandOverview({ profile, onEdit }) {
  const reduced = usePrefersReducedMotion();

  const [campaigns, setCampaigns] = useState(null);
  const [deals, setDeals] = useState(null);
  const [fbPages, setFbPages] = useState(null);

  useEffect(() => {
    let alive = true;
    // Each is independent: an empty list is the right fallback for a section of
    // the overview, not a reason to fail the whole page.
    api.listCampaigns().then(({ data }) => { if (alive) setCampaigns(data ?? []); }).catch(() => { if (alive) setCampaigns([]); });
    api.myDeals().then(({ data }) => { if (alive) setDeals(data ?? []); }).catch(() => { if (alive) setDeals([]); });
    api.connectedFacebookPages().then(({ data }) => { if (alive) setFbPages(data ?? []); }).catch(() => { if (alive) setFbPages([]); });
    return () => { alive = false; };
  }, []);

  const p = profile;
  const socials = p.socialAccounts ?? [];
  const prefs = p.campaignPreferences ?? {};
  const level = p.verificationLevel ?? {};
  const totalAudience = socials.reduce((sum, s) => sum + (Number(s.followers) || 0), 0);
  const completed = (deals ?? []).filter((d) => d.status === 'completed');

  const section = withReducedMotion(rise, reduced);

  return (
    <motion.div
      variants={withReducedMotion(stagger, reduced)}
      initial="hidden"
      animate="visible"
      className="space-y-5"
    >
      {/* ── the header a creator lands on ── */}
      <motion.section
        variants={section}
        className="rounded-xl3 border border-line bg-white overflow-hidden shadow-flat"
      >
        <div className="relative">
          <div className="h-28 sm:h-40 bg-gradient-to-br from-brand-500 via-brand-600 to-pink-500">
            {p.coverUrl && <img src={p.coverUrl} alt="" className="w-full h-full object-cover" />}
          </div>
          <button
            onClick={() => onEdit('identity')}
            aria-label="Edit brand identity"
            className="absolute top-3 right-3 inline-flex items-center rounded-full bg-white/85
                       backdrop-blur-sm border border-white/60 px-3 py-1.5 text-xs font-semibold
                       text-ink shadow-flat hover:bg-white transition-colors focusable"
          >
            Edit
          </button>
        </div>

        {/*
          `relative z-10` so this block paints above the banner's positioned
          wrapper — without it the gradient covers the logo and clips the name.
        */}
        <div className="relative z-10 px-5 sm:px-7 pb-6">
          {/* The negative margin is on the logo alone: on the row it lifted the
              name onto the gradient, where dark text is unreadable. */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <span className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl3 border-4 border-white bg-white
                             overflow-hidden shrink-0 shadow-raised grid place-items-center -mt-12 sm:-mt-14">
              {p.logo
                ? <img src={p.logo} alt="" className="w-full h-full object-contain p-1" />
                : (
                  <span className="font-display font-extrabold text-2xl text-brand-400">
                    {(p.companyName || '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
            </span>

            <div className="min-w-0 flex-1 sm:pt-2">
              <h2 className="font-display font-extrabold text-xl sm:text-2xl text-ink flex items-center gap-2">
                <span className="truncate">{p.companyName || 'Unnamed brand'}</span>
                {level.brandVerified && <Verified className="w-5 h-5 shrink-0" />}
              </h2>

              {p.tagline ? (
                <p className="text-sm text-ink-soft mt-1 leading-relaxed">{p.tagline}</p>
              ) : (
                <button
                  onClick={() => onEdit('identity')}
                  className="text-sm text-muted italic hover:text-brand-700 transition-colors mt-1 focusable"
                >
                  Add a tagline →
                </button>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2.5 text-sm text-muted">
                {p.location?.city && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {p.location.city}{p.location.country ? `, ${p.location.country}` : ''}
                  </span>
                )}
                {p.industry && <span>{p.industry}</span>}
                <StatusPill
                  status={level.brandVerified ? 'completed' : 'pending_review'}
                  label={level.label ?? 'Not verified'}
                />
              </div>

              {p.website && (
                <a
                  href={p.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-sm font-semibold text-brand-700 hover:text-brand-800 mt-2 focusable"
                >
                  {p.website.replace(/^https?:\/\//, '')} →
                </a>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-6">
            <Stat
              label="Campaigns"
              value={campaigns === null ? '—' : campaigns.length}
              hint={campaigns === null ? 'loading' : `${campaigns.filter((c) => c.status === 'open').length} live`}
            />
            <Stat
              label="Collaborations"
              value={deals === null ? '—' : deals.length}
              hint={deals === null ? 'loading' : `${completed.length} completed`}
            />
            <Stat
              label="Brand audience"
              value={totalAudience > 0 ? followerCount(totalAudience) : '—'}
              hint={socials.length ? `across ${socials.length} platform${socials.length === 1 ? '' : 's'}` : 'no accounts connected'}
            />
          </div>
        </div>
      </motion.section>

      <Block title="About" onEdit={() => onEdit('identity')} variants={section}
        empty={!p.about?.trim()}
        emptyLabel="No description yet — the first thing a creator reads about your brand.">
        <p className="text-sm text-ink-soft leading-relaxed whitespace-pre-line">{p.about}</p>
      </Block>

      <Block title="Business" onEdit={() => onEdit('business')} variants={section}
        empty={!(p.industry || p.categories?.length || p.businessType || p.companySize)}
        emptyLabel="Nothing set. Creators use industry and categories to judge whether your brand fits their audience.">
        <dl className="grid sm:grid-cols-2 gap-4">
          {p.businessType && <Pair label="Business type" value={p.businessType} />}
          {p.companySize && <Pair label="Company size" value={`${p.companySize} people`} />}
          {p.foundedYear && <Pair label="Founded" value={p.foundedYear} />}
          {p.industry && <Pair label="Industry" value={p.industry} />}
        </dl>

        {p.categories?.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {p.categories.map((c) => (
              <span key={c} className="pill bg-brand-50 text-brand-700 border border-brand-100">{c}</span>
            ))}
          </div>
        )}
      </Block>

      <Block title="Social presence" onEdit={() => onEdit('social')} variants={section}
        empty={!socials.length}
        emptyLabel="No accounts connected. Showing your own reach tells a creator how visible a collaboration will be.">
        <div className="grid sm:grid-cols-2 gap-3">
          {socials.map((s) => (
            <div key={s.platform} className="flex items-center gap-3 rounded-xl2 border border-line p-3.5">
              <Platform name={s.platform} className="w-9 h-9 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink truncate">{s.handle || s.platform}</p>
                <p className="text-xs text-muted tnum">{followerCount(s.followers)} followers</p>
              </div>
              {s.dataSource === 'connected' && (
                <span className="pill-done shrink-0"><Check className="w-3 h-3" /> Verified</span>
              )}
            </div>
          ))}
        </div>

        {fbPages && fbPages.length > 1 && (
          <p className="text-xs text-muted mt-3 leading-relaxed">
            You manage <span className="text-ink font-medium">{fbPages.length} Facebook Pages</span>.
            {' '}{fbPages.find((f) => f.isPrimary)?.name ?? 'One of them'} is the Page shown here —
            the others are managed in Social Media.
          </p>
        )}
      </Block>

      <Block title="Campaign preferences" onEdit={() => onEdit('preferences')} variants={section}
        empty={!(prefs.creatorCategories?.length || prefs.contentTypes?.length
          || prefs.collaborationTypes?.length || prefs.targetAudience)}
        emptyLabel="Nothing set. Creators cannot tell what kind of collaborations you are looking for.">
        <div className="space-y-4">
          {prefs.creatorCategories?.length > 0 && (
            <Chips label="Creator categories" items={prefs.creatorCategories} />
          )}
          {prefs.contentTypes?.length > 0 && (
            <Chips label="Content types" items={prefs.contentTypes} capitalize />
          )}
          {prefs.collaborationTypes?.length > 0 && (
            <Chips label="Collaboration types" items={prefs.collaborationTypes} capitalize />
          )}
          {prefs.targetAudience && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Target audience</p>
              <p className="text-sm text-ink-soft mt-1.5 leading-relaxed">{prefs.targetAudience}</p>
            </div>
          )}
        </div>
      </Block>

      <Block title="Previous work" onEdit={() => onEdit('work')} variants={section}
        empty={campaigns !== null && campaigns.length === 0}
        emptyLabel="No campaigns yet. Once you run one it appears here, and creators can see your track record.">
        {campaigns === null ? (
          <Skeleton className="h-16 w-full rounded-xl2" />
        ) : (
          <ul className="divide-y divide-line">
            {campaigns.slice(0, 5).map((c) => (
              <li key={c._id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-sm text-ink truncate">{c.title}</span>
                <StatusPill status={c.status} className="shrink-0" />
              </li>
            ))}
          </ul>
        )}
        {campaigns?.length > 5 && (
          <p className="text-xs text-muted mt-3">and {campaigns.length - 5} more</p>
        )}
      </Block>

      {/* ── what creators never see ── */}
      <motion.section
        variants={section}
        className="rounded-xl3 border border-line bg-gradient-to-br from-brand-50/50 to-pink-50/40 p-5 sm:p-6"
      >
        <h3 className="font-display font-bold text-ink flex items-center gap-2">
          <Lock className="w-4 h-4 text-brand-600" />
          Private to you
        </h3>
        <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-prose">
          None of this appears on your public brand profile or is visible to creators — not in
          search, not on a campaign, not on a collaboration.
        </p>

        <div className="grid sm:grid-cols-3 gap-3 mt-4">
          <PrivateRow icon={ShieldCheck} label="Verification documents"
            value={level.brandVerified ? 'Verified — badge shown' : 'Not complete'}
            onClick={() => onEdit('verification')} />
          <PrivateRow icon={Wallet} label="Invoicing details"
            value={p.billing?.legalName ? 'On record' : 'Not set'}
            onClick={() => onEdit('billing')} />
          <PrivateRow icon={Lock} label="Contact details"
            value={p.contactEmail ? 'On record' : 'Not set'}
            onClick={() => onEdit('business')} />
        </div>
      </motion.section>
    </motion.div>
  );
}

/* ─────────────────────────────── pieces ────────────────────────────────────── */

function Stat({ label, value, hint }) {
  // `min-w-0` + `break-words`: a grid track is `min-width: auto` by default, so a
  // single unbreakable word ("COLLABORATIONS" at 11px with letter-spacing) widens
  // its own column and pushes the label out over the neighbouring tile at phone
  // width. Letting it wrap keeps all three tiles equal.
  return (
    <div className="min-w-0 rounded-xl2 border border-line bg-bg/50 p-3 sm:p-4 text-center">
      <p className="font-display font-extrabold text-lg sm:text-xl text-ink tnum">{value}</p>
      <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide sm:tracking-wider
                    text-muted mt-1 break-words leading-snug">{label}</p>
      <p className="text-[11px] text-muted mt-0.5 leading-snug">{hint}</p>
    </div>
  );
}

function Pair({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="text-sm text-ink mt-1">{value}</dd>
    </div>
  );
}

function Chips({ label, items, capitalize = false }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {items.map((t) => (
          <span key={t} className={`pill-quiet ${capitalize ? 'capitalize' : ''}`}>{t}</span>
        ))}
      </div>
    </div>
  );
}

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
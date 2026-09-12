import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Money, StatusPill } from '../feedback';
import { MapPin, ShieldCheck, Image as ImageIcon } from '../icons';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../../lib/motion';
import { PLATFORM_LABEL } from './vocab';
import { statusMeta } from './applicationStatus';

/**
 * One campaign in the browse grid.
 *
 * ── What a creator decides from ────────────────────────────────────────────
 *
 * Whether to open a campaign at all is decided from a card, so the card carries
 * the five things that decision actually turns on: who is asking and whether
 * they are verified, what the work is, what it pays, where it is, and how long
 * is left to apply. Everything else waits for the detail page.
 *
 * The deadline is shown as days remaining rather than a date, because "4 days
 * left" is a decision and "20 Oct" is arithmetic the reader has to do.
 *
 * ── Nothing here is invented ───────────────────────────────────────────────
 *
 * The brand name and verified badge come from the server's `brandSummary`,
 * which is derived from the real BrandProfile and Policy 13.1 verification
 * state. A campaign whose brand has not filled in a profile shows an initial
 * and no badge, rather than a placeholder name.
 */

const dateOf = (v) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** "4 days left", "Last day", "Closed" — whichever is true. */
function deadlineLabel(iso, now = Date.now()) {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;

  const days = Math.ceil((at - now) / 86400000);
  if (days < 0) return { text: 'Applications closed', tone: 'muted' };
  if (days === 0) return { text: 'Last day to apply', tone: 'warn' };
  if (days <= 3) return { text: `${days} day${days === 1 ? '' : 's'} left`, tone: 'warn' };
  return { text: `Apply by ${dateOf(iso)}`, tone: 'muted' };
}

export default function CampaignCard({ campaign: c, showStatus = false }) {
  const reduced = usePrefersReducedMotion();

  const brand = c.brandSummary;
  const image = c.images?.[0];
  const deadline = deadlineLabel(c.applicationWindow?.deadline ?? c.schedule?.applicationDeadline);
  const closed = c.applicationWindow?.open === false;
  const applied = Boolean(c.myApplication);

  /** Deliverables as one readable line: "2× Reel · 1× Carousel". */
  const deliverables = (c.deliverables ?? []).slice(0, 3)
    .map((d) => `${d.quantity}× ${d.contentType}`)
    .join(' · ');
  const moreDeliverables = Math.max(0, (c.deliverables?.length ?? 0) - 3);

  return (
    <motion.article
      variants={withReducedMotion(rise, reduced)}
      className="card overflow-hidden flex flex-col hover:border-brand-200 transition-colors"
    >
      {/* ── image ── */}
      <Link
        to={`/campaigns/${c._id}`}
        className="block aspect-[16/9] bg-gradient-to-br from-brand-50 to-pink-50 relative focusable"
        aria-label={`Open ${c.title}`}
      >
        {image ? (
          <img src={image} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-brand-300">
            <ImageIcon className="w-8 h-8" />
          </span>
        )}
        {showStatus && c.status && (
          <span className="absolute top-2.5 right-2.5">
            <StatusPill status={c.status} />
          </span>
        )}
      </Link>

      <div className="p-4 flex-1 flex flex-col">
        {/* ── who is asking ── */}
        {brand && (
          <div className="flex items-center gap-2 mb-2.5 min-w-0">
            {brand.logo ? (
              <img src={brand.logo} alt="" className="w-6 h-6 rounded-lg object-cover border border-line shrink-0" />
            ) : (
              <span className="w-6 h-6 rounded-lg bg-bg border border-line grid place-items-center
                               text-[10px] font-bold text-muted shrink-0"
              >
                {(brand.companyName || '?').trim().charAt(0).toUpperCase()}
              </span>
            )}
            <span className="text-xs font-medium text-ink truncate">{brand.companyName || 'Brand'}</span>
            {brand.verified && (
              <ShieldCheck className="w-3.5 h-3.5 text-brand-600 shrink-0" aria-label="Verified brand" />
            )}
          </div>
        )}

        <h2 className="font-semibold text-ink leading-snug">
          <Link to={`/campaigns/${c._id}`} className="hover:text-brand-700 transition-colors focusable">
            {c.title}
          </Link>
        </h2>

        {/* ── category and platforms ── */}
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {c.category && <span className="chip">{c.category}</span>}
          {(c.platforms ?? []).map((p) => (
            <span key={p} className="chip">{PLATFORM_LABEL[p] ?? p}</span>
          ))}
        </div>

        {deliverables && (
          <p className="text-xs text-muted mt-2.5 leading-relaxed">
            {deliverables}{moreDeliverables > 0 ? ` +${moreDeliverables} more` : ''}
          </p>
        )}

        {/* ── money and place ── */}
        <div className="flex items-end justify-between gap-2 mt-auto pt-3">
          <div className="min-w-0">
            <Money amount={c.budget} />
            <p className="text-[11px] text-muted mt-0.5">per creator</p>
          </div>
          <span className="text-xs text-muted inline-flex items-center gap-1 shrink-0">
            <MapPin className="w-3 h-3" />{c.location}
          </span>
        </div>

        {deadline && (
          <p className={`text-xs mt-2.5 font-medium ${
            deadline.tone === 'warn' ? 'text-money-700' : 'text-muted'}`}
          >
            {deadline.text}
          </p>
        )}

        {/*
          ── the CTA ──

          Apply is a link to the campaign, not a button that posts from here.
          An application now carries a pitch, portfolio links and answers to the
          brand's questions, so there is nothing sensible to send from a card —
          and a one-click apply would produce exactly the empty application the
          form exists to prevent.
        */}
        <div className="mt-3">
          {applied ? (
            <Link
              to={`/campaigns/${c._id}`}
              className="block w-full text-center text-sm font-semibold rounded-lg py-2.5
                         bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors focusable"
            >
              {statusMeta(c.myApplication.status).label}
            </Link>
          ) : (
            <Link
              to={`/campaigns/${c._id}`}
              className={`w-full text-sm justify-center ${closed ? 'btn-ghost' : 'btn-brand'}`}
            >
              {closed ? 'View campaign' : 'View and apply'}
            </Link>
          )}
        </div>
      </div>
    </motion.article>
  );
}
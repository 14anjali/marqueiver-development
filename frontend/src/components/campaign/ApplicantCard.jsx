import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Money, StatusPill } from '../feedback';
import { MapPin, ShieldCheck, Check, X, FileText, Star } from '../icons';
import { Spinner } from '../../lib/ui-state';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../../lib/motion';
import { brandStatusMeta } from './applicationStatus';

/**
 * One applicant, as the brand reviews them.
 *
 * ── What is on the card, and why ───────────────────────────────────────────
 *
 * A brand reading twenty applications is deciding twice: is this creator right
 * for the brief, and is this application any good. So the card carries both —
 * the profile facts they would otherwise open a second tab for (reach,
 * engagement, categories, location, verification) and the application itself
 * (the pitch, the price, the work they attached).
 *
 * Reach and engagement come from connected accounts, so they are stated as
 * such. A self-reported follower count and a measured one are not the same
 * claim, and Policy 3.2/13.2 keeps them apart in the data; this says which one
 * the brand is looking at.
 *
 * ── What is not on it ──────────────────────────────────────────────────────
 *
 * No payout details, no PAN, no KYC, no contact email or phone — the server's
 * projection does not select them, so they are not in the payload at all. A
 * brand reaches a creator through the collaboration, which is what keeps the
 * work on the record (Policy 4.2).
 *
 * ── Shortlisting is not a commitment ───────────────────────────────────────
 *
 * Shortlist and un-shortlist move the application between review states and
 * nothing else: no deal moves, no money is involved. Only Select and Reject are
 * decisions, so only those two ask for confirmation.
 */

const fmt = (n) => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `${(v / 10000000).toFixed(1).replace(/\.0$/, '')}Cr`;
  if (v >= 100000) return `${(v / 100000).toFixed(1).replace(/\.0$/, '')}L`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(v);
};

const when = (v) => (v
  ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '');

export default function ApplicantCard({ applicant: a, campaign, onDecide, busy }) {
  const reduced = usePrefersReducedMotion();
  const [confirming, setConfirming] = useState(null);   // 'selected' | 'rejected' | null
  const [message, setMessage] = useState('');

  const p = a.profile ?? {};
  const submission = a.submission ?? {};
  // The brand's voice, not the creator's — this card is read by the brand.
  const meta = brandStatusMeta(a.status);
  const decided = ['selected', 'rejected', 'withdrawn'].includes(a.status);
  const shortlisted = a.status === 'shortlisted';

  const socials = (p.socialAccounts ?? []).filter((s) => s.dataSource === 'connected');
  const portfolio = (p.portfolio ?? []).slice(0, 4);

  function decide(status) {
    onDecide(a.creator, status, message.trim() || undefined);
    setConfirming(null);
    setMessage('');
  }

  return (
    <motion.article
      variants={withReducedMotion(rise, reduced)}
      className={`card overflow-hidden ${a.status === 'selected' ? 'border-jade-200' : ''}`}
    >
      <div className="p-4 sm:p-5">
        {/* ── who ── */}
        <div className="flex items-start gap-3.5">
          {p.avatarUrl ? (
            <img
              src={p.avatarUrl}
              alt=""
              className="w-14 h-14 rounded-xl2 object-cover border border-line shrink-0"
            />
          ) : (
            <span className="w-14 h-14 rounded-xl2 bg-gradient-to-br from-brand-500 to-pink-500
                             text-white grid place-items-center shrink-0 font-display font-bold text-lg"
            >
              {(p.displayName || '?').trim().charAt(0).toUpperCase()}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="font-semibold text-ink truncate">
                <Link
                  to={`/creator/${a.creator}`}
                  className="hover:text-brand-700 transition-colors focusable"
                >
                  {p.displayName || 'Creator'}
                </Link>
              </h3>
              {a.verification?.identity && (
                <ShieldCheck className="w-4 h-4 text-brand-600 shrink-0" aria-label="Identity verified" />
              )}
              <StatusPill status={meta.pill} label={meta.label} className="ml-auto shrink-0" />
            </div>

            {p.headline && <p className="text-xs text-muted mt-0.5 truncate">{p.headline}</p>}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted">
              {socials[0]?.handle && <span className="truncate">@{socials[0].handle}</span>}
              {p.location?.city && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {[p.location.city, p.location.country].filter(Boolean).join(', ')}
                </span>
              )}
              <span>Applied {when(a.appliedAt)}</span>
            </div>
          </div>
        </div>

        {/* ── categories ── */}
        {(p.categories?.length > 0 || p.languages?.length > 0) && (
          <div className="flex flex-wrap gap-1.5 mt-3.5">
            {(p.categories ?? []).slice(0, 4).map((c) => <span key={c} className="chip">{c}</span>)}
            {(p.languages ?? []).slice(0, 3).map((l) => (
              <span key={l} className="chip !bg-bg !text-muted">{l}</span>
            ))}
          </div>
        )}

        {/* ── the numbers ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Metric label="Followers" value={p.totalAudience > 0 ? fmt(p.totalAudience) : '—'} />
          <Metric label="Engagement" value={p.avgEngagement > 0 ? `${p.avgEngagement}%` : '—'} />
          <Metric label="Accounts" value={socials.length || '—'} />
          <Metric
            label="Their price"
            value={submission.proposedPrice != null
              ? `₹${Number(submission.proposedPrice).toLocaleString('en-IN')}`
              : 'At your fee'}
            tone={submission.proposedPrice != null
              && campaign?.budget > 0
              && submission.proposedPrice > campaign.budget ? 'warn' : undefined}
          />
        </div>

        {p.totalAudience > 0 && (
          <p className="text-[11px] text-muted mt-2">
            Measured from {socials.length} connected account{socials.length === 1 ? '' : 's'}
            {a.verification?.social ? ' · social verified' : ''}.
          </p>
        )}

        {/* ── per-platform breakdown, where it exists ── */}
        {socials.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
            {socials.map((s) => (
              <li key={`${s.platform}-${s.handle}`} className="text-xs text-muted">
                <span className="capitalize text-ink">{s.platform}</span>{' '}
                {fmt(s.followers)}
                {s.engagementRate > 0 ? ` · ${s.engagementRate}%` : ''}
              </li>
            ))}
          </ul>
        )}

        {/* ── the application ── */}
        {submission.pitch && (
          <div className="mt-4 rounded-xl2 border border-line bg-bg/50 p-3.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Their pitch</p>
            <p className="text-sm text-ink-soft mt-1.5 leading-relaxed whitespace-pre-line">
              {submission.pitch}
            </p>
          </div>
        )}

        {/* ── portfolio ── */}
        {(portfolio.length > 0 || submission.portfolioLinks?.length > 0
          || submission.attachments?.length > 0 || p.portfolioLink) && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Their work</p>

            {portfolio.length > 0 && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {portfolio.map((item) => (
                  <img
                    key={item.mediaUrl}
                    src={item.thumbnailUrl || item.mediaUrl}
                    alt={item.title || ''}
                    className="w-16 h-16 rounded-xl2 object-cover border border-line"
                  />
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-2.5">
              {p.portfolioLink && <WorkLink href={p.portfolioLink} label="Portfolio site" />}
              {(submission.portfolioLinks ?? []).map((l) => (
                <WorkLink key={l} href={l} label={hostOf(l)} />
              ))}
              {(submission.attachments ?? []).map((f) => (
                <WorkLink key={f.url} href={f.url} label={f.name || 'Attachment'} file />
              ))}
            </div>
          </div>
        )}

        {/* ── their answers ── */}
        {submission.answers?.length > 0 && campaign?.extras?.questions?.length > 0 && (
          <dl className="mt-4 space-y-2.5">
            {campaign.extras.questions.map((q) => {
              const ans = submission.answers.find((x) => x.key === q.key);
              const given = ans?.values?.length ? ans.values.join(', ') : ans?.value;
              if (!given) return null;
              return (
                <div key={q.key}>
                  <dt className="text-xs font-semibold text-muted">{q.prompt}</dt>
                  <dd className="text-sm text-ink mt-0.5 break-words">{given}</dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>

      {/* ── the decision ── */}
      <div className="border-t border-line bg-bg/40 px-4 sm:px-5 py-3.5">
        {decided ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted">{meta.blurb}</p>
            {a.status === 'selected' && a.deal && (
              <Link to={`/deals/${a.deal}`} className="btn-outline text-xs ml-auto">
                Open collaboration
              </Link>
            )}
          </div>
        ) : confirming ? (
          <div>
            <p className="text-sm font-semibold text-ink">
              {confirming === 'selected'
                ? `Select ${p.displayName || 'this creator'}?`
                : `Reject ${p.displayName || 'this creator'}?`}
            </p>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              {confirming === 'selected'
                ? 'They are told, and the collaboration opens for terms to be agreed. You can select more than one creator.'
                : 'They are told. This cannot be undone.'}
            </p>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={confirming === 'selected'
                ? 'Anything you want to say (optional)'
                : 'A short reason, if you want to give one (optional)'}
              className="w-full mt-2.5 rounded-xl2 border border-line bg-white px-3.5 py-2.5 text-sm
                         transition-colors focus:border-brand-400 focusable"
            />

            <div className="flex flex-wrap gap-2 mt-2.5">
              <button
                onClick={() => decide(confirming)}
                disabled={busy}
                className={confirming === 'selected' ? 'btn-cta text-xs' : 'btn-ghost text-xs !text-rose-600 hover:!bg-rose-50'}
              >
                {busy ? <Spinner className="w-3.5 h-3.5" />
                  : confirming === 'selected' ? 'Yes, select' : 'Yes, reject'}
              </button>
              <button onClick={() => setConfirming(null)} disabled={busy} className="btn-ghost text-xs">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {shortlisted ? (
              <button
                onClick={() => onDecide(a.creator, 'under_review')}
                disabled={busy}
                className="btn-ghost text-xs"
              >
                <X className="w-3.5 h-3.5" /> Remove from shortlist
              </button>
            ) : (
              <button
                onClick={() => onDecide(a.creator, 'shortlisted')}
                disabled={busy}
                className="btn-outline text-xs"
              >
                <Star className="w-3.5 h-3.5" /> Shortlist
              </button>
            )}

            {a.status === 'applied' && (
              <button
                onClick={() => onDecide(a.creator, 'under_review')}
                disabled={busy}
                className="btn-ghost text-xs"
              >
                Mark as reviewing
              </button>
            )}

            <div className="flex flex-wrap gap-2 ml-auto">
              <button
                onClick={() => setConfirming('rejected')}
                disabled={busy}
                className="btn-ghost text-xs !text-rose-600 hover:!bg-rose-50"
              >
                Reject
              </button>
              <button
                onClick={() => setConfirming('selected')}
                disabled={busy}
                className="btn-cta text-xs"
              >
                <Check className="w-3.5 h-3.5" /> Select
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.article>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="rounded-xl2 border border-line bg-white p-3 text-center min-w-0">
      <p className={`font-display font-extrabold text-base tnum ${tone === 'warn' ? 'text-money-700' : 'text-ink'}`}>
        {value}
      </p>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted mt-0.5 break-words leading-snug">
        {label}
      </p>
    </div>
  );
}

function WorkLink({ href, label, file }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex items-center gap-1.5 rounded-xl2 border border-line bg-white px-3 py-1.5
                 text-xs text-ink hover:border-brand-200 transition-colors focusable"
    >
      {file && <FileText className="w-3.5 h-3.5 text-muted" />}
      <span className="max-w-[180px] truncate">{label}</span>
    </a>
  );
}

/** "instagram.com" out of a long URL — the domain is the useful part. */
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
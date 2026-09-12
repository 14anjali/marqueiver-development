import { useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusPill, Money } from '../feedback';
import { Check, FileText } from '../icons';
import { Spinner } from '../../lib/ui-state';
import { statusMeta, normaliseStatus, canWithdraw } from './applicationStatus';

/**
 * Where a creator's application stands, and how it got there.
 *
 * ── Why a timeline and not a status ────────────────────────────────────────
 *
 * "Applied" on its own cannot tell a creator whether anything has happened. The
 * history the server keeps answers the question they are actually asking: has
 * the brand opened it, when, and did they say anything. A single mutable field
 * could not, which is why the history exists at all.
 *
 * Dates are absolute, with the time, because "2 days ago" stops being useful
 * the moment someone is deciding whether to chase.
 */

const when = (v) => (v
  ? new Date(v).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  : '');

export default function ApplicationStatus({ application, campaign, onWithdraw, withdrawing }) {
  const [confirming, setConfirming] = useState(false);
  const status = normaliseStatus(application?.status);
  const meta = statusMeta(status);
  const submission = application?.submission ?? {};
  const history = application?.history ?? [];

  return (
    <section className="rounded-xl3 border border-line bg-white shadow-flat overflow-hidden">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display font-bold text-lg text-ink">{meta.label}</h2>
            <p className="text-sm text-muted mt-1 leading-relaxed max-w-prose">{meta.blurb}</p>
          </div>
          <StatusPill status={meta.pill} label={meta.label} className="shrink-0" />
        </div>

        {status === 'selected' && application?.deal && (
          <Link to={`/deals/${application.deal}`} className="btn-cta text-sm mt-4">
            Open negotiation
          </Link>
        )}

        {/* ── how it got here ── */}
        {history.length > 0 && (
          <ol className="mt-6 relative">
            {history.map((entry, i) => {
              const m = statusMeta(entry.status);
              const last = i === history.length - 1;
              return (
                <li key={`${entry.status}-${entry.at}-${i}`} className="relative flex gap-3.5 pb-5 last:pb-0">
                  {!last && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[13px] top-7 bottom-0 w-px bg-line"
                    />
                  )}
                  <span
                    className={`relative z-10 w-7 h-7 rounded-full grid place-items-center shrink-0 ${
                      last ? 'bg-gradient-to-br from-brand-600 to-pink-600 text-white' : 'bg-bg text-muted'}`}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-sm font-medium text-ink">{m.label}</p>
                    <p className="text-xs text-muted mt-0.5 tnum">{when(entry.at)}</p>
                    {entry.message && (
                      <p className="text-sm text-ink-soft mt-2 leading-relaxed rounded-xl2 bg-bg border border-line px-3.5 py-2.5">
                        {entry.message}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {/* ── withdraw ── */}
        {canWithdraw(status) && onWithdraw && (
          <div className="mt-6 pt-5 border-t border-line">
            {confirming ? (
              <div>
                <p className="text-sm font-semibold text-ink">Withdraw this application?</p>
                <p className="text-xs text-muted mt-1 leading-relaxed max-w-prose">
                  The brand is told, and you cannot apply to this campaign again.
                </p>
                <div className="flex flex-wrap gap-2.5 mt-3">
                  <button
                    onClick={() => onWithdraw()}
                    disabled={withdrawing}
                    className="btn-ghost text-sm !text-rose-600 hover:!bg-rose-50"
                  >
                    {withdrawing ? <Spinner className="w-4 h-4" /> : 'Yes, withdraw'}
                  </button>
                  <button onClick={() => setConfirming(false)} disabled={withdrawing} className="btn-ghost text-sm">
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirming(true)} className="text-xs font-semibold text-muted hover:text-rose-600 focusable">
                Withdraw this application
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── what was sent ── */}
      {(submission.pitch || submission.portfolioLinks?.length || submission.attachments?.length
        || submission.answers?.length || submission.proposedPrice != null) && (
        <div className="border-t border-line bg-bg/40 p-5 sm:p-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">What you sent</h3>

          <div className="mt-3 space-y-4">
            {submission.pitch && (
              <p className="text-sm text-ink-soft leading-relaxed whitespace-pre-line">{submission.pitch}</p>
            )}

            {submission.proposedPrice != null && (
              <p className="text-sm text-ink">
                Your price: <Money amount={submission.proposedPrice} className="!text-sm" />
                {campaign?.budget > 0 && (
                  <span className="text-muted"> (campaign fee ₹{Number(campaign.budget).toLocaleString('en-IN')})</span>
                )}
              </p>
            )}

            {submission.portfolioLinks?.length > 0 && (
              <ul className="space-y-1">
                {submission.portfolioLinks.map((l) => (
                  <li key={l}>
                    <a
                      href={l}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-sm text-brand-700 hover:text-brand-800 break-all focusable"
                    >
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            )}

            {submission.attachments?.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {submission.attachments.map((f) => (
                  <li key={f.url}>
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl2 border border-line bg-white
                                 px-3 py-2 text-xs text-ink hover:border-brand-200 transition-colors focusable"
                    >
                      <FileText className="w-3.5 h-3.5 text-muted" />
                      <span className="max-w-[180px] truncate">{f.name || 'Attachment'}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}

            {submission.answers?.length > 0 && campaign?.extras?.questions?.length > 0 && (
              <dl className="space-y-3">
                {campaign.extras.questions.map((q) => {
                  const a = submission.answers.find((x) => x.key === q.key);
                  const given = a?.values?.length ? a.values.join(', ') : a?.value;
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
        </div>
      )}
    </section>
  );
}
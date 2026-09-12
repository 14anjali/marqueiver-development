import { useState } from 'react';
import { Check, Clock, FileText, Image as ImageIcon, Play, X } from '../icons';
import { api } from '../../lib/api';
import { Spinner, useToast } from '../../lib/ui-state';

/**
 * The agreed deliverables, what has been sent for each, and the brand's
 * decision on it.
 *
 * ── Why the agreed list leads ──────────────────────────────────────────────
 *
 * The page listed submissions. That answers "what has been sent" and never
 * "what is still owed" — the question both parties actually have. So the brief's
 * own lines lead, each with its history underneath, and a line nobody has
 * submitted against is visible as an empty one rather than absent.
 *
 * ── Every version is kept ──────────────────────────────────────────────────
 *
 * A resubmission is a new row, never a replacement. The first version and what
 * the brand said about it both stay readable, which is the only way "you asked
 * for this change and I made it" can be shown later. Older versions collapse so
 * the current one is what you see first, but nothing is dropped.
 *
 * ── Reviewing ──────────────────────────────────────────────────────────────
 *
 * Approve and Request a revision, each recording who decided, when, and what
 * they said. Feedback is required on a revision — the server requires it too —
 * because a revision with no reason costs the creator one of a fixed number of
 * rounds and tells them nothing about how to spend it.
 *
 * Approving here does NOT release money. That is the separate `completed`
 * transition, and the server refuses it until every line is approved. Two
 * decisions, two acts; the irreversible one is not a side effect of the other.
 */

const STAMP = {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
};
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', STAMP) : '');

const STATUS = {
  not_submitted: { label: 'Not submitted', pill: 'pill-quiet' },
  pending: { label: 'Awaiting review', pill: 'pill-wait' },
  approved: { label: 'Approved', pill: 'pill-done' },
  rejected: { label: 'Revision requested', pill: 'pill-warn' },
};

/**
 * A submitted image, falling back to its file chip.
 *
 * The same lesson the chat learned: a storage URL is signed and expires, and a
 * broken-image icon tells the reviewer neither what it was nor what to do. The
 * name and a link do both.
 */
function Preview({ f }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <FileLink f={f} />;
  return (
    <a href={f.url} target="_blank" rel="noopener noreferrer" className="focusable">
      <img
        src={f.url} alt={f.name || 'Submitted image'} loading="lazy"
        onError={() => setBroken(true)}
        className="h-24 rounded-xl2 border border-line object-cover"
      />
    </a>
  );
}

function FileLink({ f }) {
  const Icon = f.kind === 'image' ? ImageIcon : f.kind === 'video' ? Play : FileText;
  return (
    <a
      href={f.url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1 text-xs text-ink hover:bg-bg transition-colors focusable"
    >
      <Icon className="w-3 h-3 shrink-0" />
      <span className="truncate max-w-[12rem]">{f.name || 'File'}</span>
    </a>
  );
}

/** One submission: what was sent, and what came back. */
function Submission({ sub, role, dealId, onReviewed, isLatest }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState('');

  const content = (sub.files ?? []).filter((f) => f.role !== 'support');
  const support = (sub.files ?? []).filter((f) => f.role === 'support');
  const images = content.filter((f) => f.kind === 'image');

  const decided = sub.reviewStatus !== 'pending';
  const canReview = role === 'brand' && !decided && isLatest;

  async function decide(decision) {
    if (decision === 'revision' && !feedback.trim()) {
      toast.push('Say what needs to change', 'error');
      return;
    }
    setBusy(decision);
    try {
      await api.reviewSubmission(dealId, sub._id, {
        decision,
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
      });
      toast.push(decision === 'approved' ? 'Submission approved' : 'Revision requested', 'success');
      await onReviewed?.();
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className={`rounded-xl2 border p-3.5 ${decided ? 'border-line' : 'border-brand-200 bg-brand-50/30'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <span className="text-xs text-muted tnum">{when(sub.submittedAt)}</span>
        <span className="flex items-center gap-1.5">
          {sub.late && <span className="pill-warn">Late</span>}
          <span className={STATUS[sub.reviewStatus]?.pill ?? 'pill-quiet'}>
            {STATUS[sub.reviewStatus]?.label ?? sub.reviewStatus}
          </span>
        </span>
      </div>

      {/* Images preview in place; everything else is a named link, because a
          video thumbnail we cannot generate is worse than its file name. */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2.5">
          {images.map((f) => <Preview key={f.url} f={f} />)}
        </div>
      )}

      {content.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {content.filter((f) => f.kind !== 'image').map((f) => <FileLink key={f.url} f={f} />)}
        </div>
      )}

      {(sub.urls ?? []).length > 0 && (
        <ul className="space-y-1 mb-2">
          {sub.urls.map((u) => (
            <li key={u}>
              <a
                href={u} target="_blank" rel="noopener noreferrer"
                className="text-sm text-brand-600 hover:text-brand-700 underline break-all focusable"
              >
                {u}
              </a>
            </li>
          ))}
        </ul>
      )}

      {sub.caption && (
        <div className="rounded-lg bg-bg border border-line p-2.5 mb-2">
          <p className="text-[11px] font-semibold text-muted mb-1">Caption</p>
          <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed break-words">{sub.caption}</p>
        </div>
      )}

      {support.length > 0 && (
        <div className="mb-2">
          <p className="text-[11px] font-semibold text-muted mb-1">Supporting files</p>
          <div className="flex flex-wrap gap-1.5">
            {support.map((f) => <FileLink key={f.url} f={f} />)}
          </div>
        </div>
      )}

      {sub.note && (
        <p className="text-sm text-muted leading-relaxed break-words">{sub.note}</p>
      )}

      {/* ── the decision, once it exists ──────────────────────────────── */}
      {decided && (
        <div className="mt-2.5 pt-2.5 border-t border-line">
          <p className="text-sm text-ink inline-flex items-center gap-1.5">
            {sub.reviewStatus === 'approved'
              ? <><Check className="w-3.5 h-3.5 text-jade-700" /> Approved</>
              : <><X className="w-3.5 h-3.5 text-rose-500" /> Revision requested</>}
            <span className="text-xs text-muted tnum">· {when(sub.review?.at ?? sub.reviewedAt)}</span>
          </p>
          {(sub.review?.feedback || sub.reviewNote) && (
            <p className="text-sm text-ink bg-bg rounded-lg p-2.5 mt-1.5 leading-relaxed break-words">
              <span className="font-medium">Brand’s feedback: </span>
              {sub.review?.feedback || sub.reviewNote}
            </p>
          )}
        </div>
      )}

      {/* ── reviewing it ──────────────────────────────────────────────── */}
      {canReview && (
        <div className="mt-3 pt-3 border-t border-line">
          {asking ? (
            <>
              <label htmlFor={`fb-${sub._id}`} className="field-label">What needs to change</label>
              <textarea
                id={`fb-${sub._id}`}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Be specific — this is what the creator works from, and it uses one of the agreed revision rounds."
                className="field resize-none"
              />
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-2">
                <button onClick={() => setAsking(false)} disabled={Boolean(busy)} className="btn-ghost">
                  Back
                </button>
                <button
                  onClick={() => decide('revision')}
                  disabled={Boolean(busy) || !feedback.trim()}
                  className="btn-outline"
                >
                  {busy === 'revision' ? <><Spinner className="w-4 h-4" /> Sending…</> : 'Send revision request'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => decide('approved')} disabled={Boolean(busy)} className="btn-cta">
                {busy === 'approved' ? <><Spinner className="w-4 h-4" /> Approving…</> : 'Approve'}
              </button>
              <button onClick={() => setAsking(true)} disabled={Boolean(busy)} className="btn-outline">
                Request a revision
              </button>
            </div>
          )}
          <p className="text-[11px] text-muted mt-2 leading-relaxed">
            Approving records your decision. Payment is released separately, once every
            deliverable is approved.
          </p>
        </div>
      )}
    </div>
  );
}

/** One agreed line, with its history. */
function DeliverableRow({ d, role, dealId, onReviewed, onSubmit }) {
  const [showAll, setShowAll] = useState(false);
  const history = d.submissions ?? [];
  const visible = showAll ? history : history.slice(0, 1);

  return (
    <div className="border border-line rounded-xl2 p-3.5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{d.label}</p>
          {d.notes && <p className="text-xs text-muted mt-0.5 leading-relaxed">{d.notes}</p>}
        </div>
        <span className={STATUS[d.status]?.pill ?? 'pill-quiet'}>
          {STATUS[d.status]?.label ?? d.status}
        </span>
      </div>

      {history.length === 0 ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted">
            {role === 'creator' ? 'Nothing submitted for this yet.' : 'The creator has not submitted this yet.'}
          </p>
          {role === 'creator' && onSubmit && (
            <button onClick={() => onSubmit(d)} className="btn-outline !py-1.5 !px-3 text-xs">
              Submit this
            </button>
          )}
        </div>
      ) : (
        // Only the newest version is reviewable — deciding a superseded one
        // would rule on something the creator has already replaced.
        <div className="space-y-2.5">
          {visible.map((s, i) => (
            <Submission
              key={s._id ?? i}
              sub={s}
              role={role}
              dealId={dealId}
              onReviewed={onReviewed}
              isLatest={s._id === history[0]?._id}
            />
          ))}
          {history.length > 1 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="text-xs font-medium text-brand-600 hover:text-brand-700 focusable px-1 py-1"
            >
              {showAll
                ? 'Hide earlier versions'
                : `Show ${history.length - 1} earlier version${history.length === 2 ? '' : 's'}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function DeliverablesPanel({
  deal, role, progress, onReviewed, onSubmit,
}) {
  const rows = progress?.deliverables ?? [];
  const untagged = progress?.untagged ?? [];
  const dealId = deal._id ?? deal.id;

  if (!rows.length && !untagged.length) {
    return (
      <section className="card p-5">
        <h2 className="font-display font-bold text-ink text-sm mb-2">Deliverables</h2>
        <p className="text-sm text-muted leading-relaxed">
          The agreed brief has no itemised deliverables, and nothing has been submitted yet.
        </p>
      </section>
    );
  }

  const left = progress?.outstanding ?? [];
  const revisions = progress?.revisions;

  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="font-display font-bold text-ink text-sm">Deliverables</h2>
        {rows.length > 0 && (
          <span className="text-xs text-muted tnum">
            {rows.length - left.length} of {rows.length} approved
          </span>
        )}
      </div>

      {/* The one line that says whether the money can move yet. */}
      {progress?.allApproved ? (
        <p className="text-xs text-jade-700 inline-flex items-center gap-1.5 mb-3">
          <Check className="w-3.5 h-3.5" />
          Every deliverable is approved. The brand can release the payment.
        </p>
      ) : left.length > 0 && (
        <p className="text-xs text-muted inline-flex items-start gap-1.5 mb-3 leading-relaxed">
          <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Payment is released once every deliverable is approved. Still open: {left.join(', ')}.
        </p>
      )}

      <div className="space-y-3">
        {rows.map((d) => (
          <DeliverableRow
            key={d.key}
            d={d}
            role={role}
            dealId={dealId}
            onReviewed={onReviewed}
            onSubmit={onSubmit}
          />
        ))}
      </div>

      {/*
        Submissions from before deliverables were itemised, or against a line an
        amendment has since changed. Shown rather than dropped — a submission
        nobody can see is a submission that did not happen.
      */}
      {untagged.length > 0 && (
        <div className="mt-4 pt-4 border-t border-line">
          <p className="text-xs font-semibold text-muted mb-2">Other submissions</p>
          <div className="space-y-2.5">
            {untagged.map((s, i) => (
              <Submission
                key={s._id ?? i}
                sub={s}
                role={role}
                dealId={dealId}
                onReviewed={onReviewed}
                isLatest={i === 0}
              />
            ))}
          </div>
        </div>
      )}

      {revisions && revisions.used > 0 && (
        <p className="text-[11px] text-muted mt-3">
          {revisions.used} of {revisions.allowed} agreed revision rounds used.
        </p>
      )}
    </section>
  );
}
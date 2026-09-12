import { Clock, Wallet, FileText, Lock, Handshake } from '../icons';
import { FIELD_LABEL } from './ChangeRequestPanel';

/**
 * Everything that has happened to this collaboration, in one order.
 *
 * ── Why the timeline alone was not a history ───────────────────────────────
 *
 * `deal.timeline` records state transitions and nothing else. So a brand whose
 * card was declined saw a timeline that said "escrow pending" and stopped, with
 * the failure, the retry and the eventual verification recorded in a different
 * collection that nothing on the page read in sequence. Accepted amendments
 * were invisible here too, which is the worst of the three: the terms changed
 * and the record of the collaboration did not mention it.
 *
 * Four sources, merged and sorted by time:
 *
 *   transitions    `deal.timeline`
 *   payments       each transaction's own `history[]`, so a payment that went
 *                  pending → initiated → failed → verified reads as four events,
 *                  because that is four things that happened
 *   terms          accepted amendments, and change requests with their answers
 *   deliverables   submissions
 *
 * Merging is done here rather than on the server because each source is already
 * exposed for its own reasons and each has its own access rules; one combined
 * endpoint would be a second place for "who may see what" to be decided.
 */

const STAMP = {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
};
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', STAMP) : '');

const PAYMENT_WORD = {
  pending: 'Payment order created',
  initiated: 'Payment started',
  processing: 'Payment processing',
  verified: 'Payment verified',
  success: 'Payment verified',
  failed: 'Payment failed',
  reversed: 'Payment reversed',
};

const TONE = {
  state: 'wash text-brand-600',
  money: 'bg-money-50 text-money-700 border border-money-100',
  terms: 'bg-jade-50 text-jade-700',
  work: 'bg-bg text-muted border border-line',
  bad: 'bg-rose-50 text-rose-600',
};

const ICON = {
  state: Clock, money: Wallet, terms: Lock, work: FileText, deal: Handshake,
};

/**
 * First letter up, the rest left alone.
 *
 * Not the `capitalize` CSS class, which title-cases every word: the state names
 * need it (`escrow_pending` → "Escrow pending") and the payment lines do not, and
 * with one class over both the history read "Payment Order Created · By Brand"
 * like a press release.
 */
const sentence = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);

/** `{ field: { from, to } }` → "Deadline, Included revisions". */
const fieldNames = (changes = {}) => Object.keys(changes)
  .map((k) => FIELD_LABEL[k] ?? k)
  .join(', ');

export function activityEvents({ deal, payments = [] }) {
  const out = [];

  for (const t of deal?.timeline ?? []) {
    out.push({
      kind: 'state',
      at: t.at,
      title: sentence((t.to ?? '').replace(/_/g, ' ')),
      note: t.note,
      by: t.byRole,
    });
  }

  /*
    Each state a payment passed through, not just where it ended up. A payment
    that failed and then succeeded is two facts, and the first one is the reason
    the collaboration started a day late.
  */
  for (const p of payments) {
    const steps = p.history?.length
      ? p.history
      : [{ status: p.status, at: p.createdAt }];
    for (const h of steps) {
      out.push({
        kind: h.status === 'failed' ? 'bad' : 'money',
        at: h.at ?? p.createdAt,
        title: PAYMENT_WORD[h.status] ?? `Payment ${h.status}`,
        note: [p.tranche ? `${p.tranche} tranche` : null, h.note].filter(Boolean).join(' · '),
        by: h.by,
        amount: p.amount,
      });
    }
  }

  for (const a of deal?.termsAmendments ?? []) {
    out.push({
      kind: 'terms',
      at: a.acceptedAt,
      title: `Terms amended — ${fieldNames(a.changes)}`,
      note: a.reason,
      by: a.proposedByRole,
    });
  }

  for (const c of deal?.changeRequests ?? []) {
    out.push({
      kind: 'terms',
      at: c.proposedAt,
      title: `Change requested — ${fieldNames(c.changes)}`,
      note: c.reason,
      by: c.proposedByRole,
    });
    // An answered request is a second event: the answer is what the other party
    // needs to be able to point at later.
    if (c.respondedAt && c.status !== 'pending') {
      out.push({
        kind: c.status === 'accepted' ? 'terms' : 'state',
        at: c.respondedAt,
        title: `Change request ${c.status}`,
        note: c.responseNote,
      });
    }
  }

  (deal?.workSubmissions ?? []).forEach((s, i) => {
    out.push({
      kind: 'work',
      at: s.submittedAt,
      title: `Deliverable submitted${deal.workSubmissions.length > 1 ? ` (${i + 1})` : ''}${s.late ? ' · late' : ''}`,
      note: s.note,
      by: 'creator',
    });
  });

  return out
    .filter((e) => e.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

export default function ActivityHistory({ deal, payments = [] }) {
  const events = activityEvents({ deal, payments });

  return (
    <section className="card p-5">
      <h2 className="font-display font-bold text-ink text-sm mb-3">Activity history</h2>

      {!events.length ? (
        <p className="text-sm text-muted">Nothing has happened yet.</p>
      ) : (
        <ol className="space-y-3">
          {events.map((e, i) => {
            const Icon = ICON[e.kind] ?? Clock;
            return (
              <li key={i} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`w-7 h-7 rounded-full grid place-items-center shrink-0 ${TONE[e.kind] ?? TONE.state}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm text-ink">
                    <span className="font-medium">{e.title}</span>
                    {e.by && <span className="text-muted"> · by {e.by}</span>}
                  </div>
                  {e.note && <div className="text-xs text-muted mt-0.5 leading-relaxed break-words">{e.note}</div>}
                  <div className="text-xs text-muted tnum mt-0.5">{when(e.at)}</div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
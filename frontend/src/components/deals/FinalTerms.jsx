import { Money } from '../feedback';
import { Lock } from '../icons';
import ProposalTerms from './ProposalTerms';

/**
 * The Final Terms summary — what both parties are bound to.
 *
 * ── The money is shown three ways, on purpose ──────────────────────────────
 *
 * Gross, commission, net. A creator reading "50% advance" needs to know whether
 * it is half of the headline figure or half of what actually lands in their
 * account, and those differ by the platform's 12.5% (Policy 14.1, deducted from
 * the collaboration value rather than added to it). Showing only the split
 * would put a number in front of them that is wrong in the direction that costs
 * them money, at the moment they are deciding whether to accept.
 *
 * The two tranches are computed on the creator's net, so every figure in the
 * creator column is a figure they will actually receive.
 *
 * ── Advance and balance come from the server ───────────────────────────────
 *
 * Frozen at acceptance alongside the commission rate (Policy 14.7/14.8), not
 * recomputed here. A rate change tomorrow must not restate what the creator was
 * told they would be paid — and a number the UI derives independently will
 * eventually disagree with the number the payment path uses.
 *
 * ── What is not yet true ───────────────────────────────────────────────────
 *
 * The schedule is agreed and recorded; the payment path still raises a single
 * order for the full amount. The copy says so rather than implying two charges
 * already happen.
 */

const when = (d) => (d ? new Date(d).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
}) : '');

function Row({ label, value, sub, strong, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-line last:border-0">
      <div className="min-w-0">
        <div className={`text-sm ${strong ? 'font-semibold text-ink' : 'text-muted'}`}>{label}</div>
        {sub && <div className="text-[11px] text-muted mt-0.5 leading-relaxed">{sub}</div>}
      </div>
      <div className={`shrink-0 text-right ${tone === 'muted' ? 'text-muted' : ''}`}>{value}</div>
    </div>
  );
}

export default function FinalTerms({
  deal, role, amendments = [], binding, onRequestChange, canRequestChange,
}) {
  const agreed = deal?.agreedTerms;
  if (!agreed?.lockedAt) return null;

  /**
   * The readout shows what is in force, not what was first agreed.
   *
   * It showed `agreedTerms` — so after an accepted amendment the headline said
   * "Due 27 Oct, 3 revisions" while the amendment beneath it said 10 Nov and 4.
   * The top of this card is where someone looks to answer "what am I bound to",
   * and it was answering with superseded figures. The original is not lost: the
   * amended fields are marked, and every previous value is still in the list
   * below.
   */
  const inForce = binding ?? agreed;
  const amended = amendments.length > 0;

  /*
    Every figure below is read, never computed. The server froze all of them at
    acceptance alongside the commission rate, and a summary that derives a
    creator's payment independently will eventually disagree with the payout
    that actually runs — which is the same drift the rate snapshot exists to
    prevent.
  */
  const sched = deal.escrow?.schedule ?? {};
  const pct = sched.advancePct ?? 50;
  const gross = agreed.amount ?? 0;
  const ratePct = sched.commissionPct ?? deal.commission?.ratePct ?? null;
  const commission = sched.commission ?? null;
  const net = sched.creatorNet ?? null;
  const creatorAdvance = sched.creatorAdvance ?? null;
  const creatorBalance = sched.creatorBalance ?? null;

  const isCreator = role === 'creator';

  return (
    <section className="card overflow-hidden">
      <header className="px-5 py-4 border-b border-line bg-jade-50/50 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display font-bold text-ink inline-flex items-center gap-2">
          <Lock className="w-4 h-4 text-jade-700" /> Final terms
        </h3>
        <span className="pill-done">
          Locked{agreed.fromOfferSeq ? ` · from V${agreed.fromOfferSeq}` : ''}
        </span>
      </header>

      <div className="p-5 space-y-5">
        <p className="text-xs text-muted leading-relaxed">
          Agreed {when(agreed.lockedAt)}.
          {amended
            ? ' Amended since, by agreement — every change is recorded below.'
            : ' Neither of you can change these on your own — a change needs a request the other party accepts.'}
        </p>

        {/* ── payment ─────────────────────────────────────────────── */}
        <div className="panel-money">
          <h4 className="font-display font-bold text-money-700 text-sm mb-1">
            {isCreator ? 'What you are paid' : 'What you pay'}
          </h4>
          <p className="text-[11px] text-money-800/80 mb-3 leading-relaxed">
            {isCreator
              ? 'The platform fee is deducted from the collaboration value, not added to it.'
              : 'The creator receives this less the platform fee — nothing is added on top.'}
          </p>

          <Row label="Collaboration value" value={<Money amount={gross} className="text-sm" />} strong />

          {commission != null && (
            <Row
              label={`Platform fee (${ratePct}%)`}
              value={<span className="text-sm text-muted">− <Money amount={commission} className="text-sm" /></span>}
              tone="muted"
            />
          )}

          {net != null && (
            <Row
              label="Creator payment"
              value={<Money amount={net} className="text-base" />}
              strong
            />
          )}

          <div className="mt-3 pt-3 border-t border-money-100 space-y-0">
            <Row
              label={`${pct}% advance`}
              sub="Paid into escrow before work starts. Chat opens once it is confirmed."
              value={isCreator
                ? <Money amount={creatorAdvance ?? 0} className="text-sm" />
                : <Money amount={sched.advance?.amount ?? 0} className="text-sm" />}
            />
            <Row
              label={`Remaining ${100 - pct}%`}
              sub="Released after the work is approved."
              value={isCreator
                ? <Money amount={creatorBalance ?? 0} className="text-sm" />
                : <Money amount={sched.balance?.amount ?? 0} className="text-sm" />}
            />
          </div>

          {/*
            Half of this is now true and half is not, and the copy says which.
            The advance is charged for real — `createPaymentSession` raises an
            order for `escrow.schedule.advance.amount`. Collecting the balance
            is not built, so a collaboration cannot complete yet, and claiming
            otherwise would be a promise about money nobody can keep.
          */}
          <p className="text-[11px] text-money-800/80 mt-3 leading-relaxed">
            The advance is collected before work starts. Collecting the remaining 50% is
            not switched on yet, so a collaboration cannot be closed out until it is.
          </p>
        </div>

        {/* ── the rest of the terms, as they stand now ────────────── */}
        {amended && (
          <p className="text-xs text-muted leading-relaxed -mb-2">
            Showing the terms in force. Anything marked “changed” was amended after the
            agreement — the original value is in the list below.
          </p>
        )}
        <ProposalTerms terms={inForce} changedFrom={amended ? agreed : undefined} />

        {/* ── accepted changes ────────────────────────────────────── */}
        {amendments.length > 0 && (
          <div className="border-t border-line pt-4">
            <h4 className="text-sm font-semibold text-ink mb-1">Accepted changes</h4>
            <p className="text-xs text-muted mb-3 leading-relaxed">
              The agreement above is the original. These were agreed afterwards and apply
              on top of it.
            </p>
            <ol className="space-y-3">
              {amendments.map((a, i) => (
                <li key={a._id ?? i} className="rounded-xl2 border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-ink">
                      {a.source === 'additional_terms' ? 'Paid additional scope'
                        : a.source === 'admin' ? 'Applied by support'
                        : `Requested by the ${a.proposedByRole}`}
                    </span>
                    <span className="text-[11px] text-muted">{when(a.acceptedAt)}</span>
                  </div>
                  {a.reason && (
                    <p className="text-xs text-muted mt-1 leading-relaxed break-words">{a.reason}</p>
                  )}
                  <dl className="mt-2 space-y-1">
                    {Object.entries(a.changes ?? {}).map(([field, c]) => (
                      <div key={field} className="text-xs">
                        <dt className="inline text-muted capitalize">
                          {field.replace(/([A-Z])/g, ' $1').toLowerCase()}:{' '}
                        </dt>
                        <dd className="inline text-ink break-words">
                          <span className="line-through text-muted">{fmtVal(c.from)}</span>
                          {' → '}
                          <span className="font-semibold">{fmtVal(c.to)}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ol>
          </div>
        )}

        {canRequestChange && (
          <div className="border-t border-line pt-4">
            <button onClick={onRequestChange} className="btn-outline">
              Request a change
            </button>
            <p className="text-xs text-muted mt-2 leading-relaxed">
              Nothing changes unless the {role === 'brand' ? 'creator' : 'brand'} accepts.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/** A term value in one line — objects and lists summarised rather than dumped. */
function fmtVal(v) {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) {
    return v.map((i) => (typeof i === 'object' && i
      ? `${i.quantity ?? 1} × ${i.contentType ?? ''}`.trim()
      : String(i))).join(', ') || '—';
  }
  if (typeof v === 'object') {
    if (v.licenceType) {
      return [v.licenceType, v.durationMonths ? `${v.durationMonths}m` : null]
        .filter(Boolean).join(' · ');
    }
    return Object.values(v).flat().filter(Boolean).join(', ') || '—';
  }
  // A date arrives as an ISO string; anything else is shown as written.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return String(v);
}
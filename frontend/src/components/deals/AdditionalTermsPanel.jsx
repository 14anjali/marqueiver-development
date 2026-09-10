import { useState } from 'react';
import { Modal, ConfirmDialog } from '../overlay';
import { Money, StatusPill } from '../feedback';
import { api } from '../../lib/api';
import { openCashfreeCheckout } from '../../lib/cashfree';
import { Spinner, useToast } from '../../lib/ui-state';
import { rupee } from '../../lib/normalize';

/**
 * Policy 5.5 option B — paying for further revisions.
 *
 * The backend for this shipped with no interface at all: a brand whose included
 * revisions ran out reached `resolution` and had no way to offer more money, and
 * a creator had no way to see or answer an offer. The flow existed only as
 * endpoints.
 *
 * Three states, three different people acting:
 *
 *   proposed  → the creator answers
 *   accepted  → the brand pays
 *   funded    → the rounds exist and work restarts
 *
 * The creator is always shown their NET, not the headline. Accepting "₹5,000
 * for two more rounds" is not an informed decision if ₹4,375 is what arrives.
 */
export default function AdditionalTermsPanel({ deal, role, onUpdated }) {
  const [proposing, setProposing] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ amount: '', revisionsAdded: 1, scopeNote: '' });
  const [declineReason, setDeclineReason] = useState('');
  const toast = useToast();

  const at = deal.additionalTerms;
  const status = at?.status ?? 'none';
  const dealId = deal._id ?? deal.id;

  // Only offered where the state machine accepts it.
  const canPropose = role === 'brand' && deal.state === 'resolution'
    && ['none', 'declined'].includes(status);

  if (!canPropose && status === 'none') return null;

  const amount = Number(form.amount);
  const formValid = amount > 0 && form.revisionsAdded >= 1;

  async function propose(e) {
    e?.preventDefault();
    if (!formValid) return;
    setBusy(true);
    try {
      const { data } = await api.proposeAdditionalTerms(dealId, {
        amount,
        revisionsAdded: Number(form.revisionsAdded),
        scopeNote: form.scopeNote.trim() || undefined,
      });
      onUpdated?.(data.deal);
      toast.push('Offer sent to the creator', 'success');
      setProposing(false);
      setForm({ amount: '', revisionsAdded: 1, scopeNote: '' });
    } catch (err) { toast.push(err.message, 'error'); }
    finally { setBusy(false); }
  }

  async function respond(accept) {
    setBusy(true);
    try {
      const { data } = await api.respondToAdditionalTerms(dealId, accept, declineReason.trim() || undefined);
      onUpdated?.(data.deal);
      toast.push(accept ? 'Accepted — waiting for payment' : 'Offer declined', 'success');
      setDeclining(false);
      setDeclineReason('');
    } catch (err) { toast.push(err.message, 'error'); }
    finally { setBusy(false); }
  }

  async function pay() {
    setBusy(true);
    try {
      const { data } = await api.startAdditionalTermsPayment(dealId);
      if (data.gateway === 'mock') {
        toast.push('Mock mode: simulating a successful payment', 'info');
      } else {
        const result = await openCashfreeCheckout(data.paymentSessionId);
        if (!result.ok) { toast.push(result.message, 'error'); setBusy(false); return; }
      }
      // The webhook adds the rounds and restarts the work; this only refreshes.
      toast.push('Payment received — the extra revisions are now part of the deal', 'success');
      onUpdated?.(null);
    } catch (err) { toast.push(err.message, 'error'); }
    finally { setBusy(false); }
  }

  const rounds = at?.revisionsAdded ?? 0;
  const roundWord = `${rounds} more revision${rounds === 1 ? '' : 's'}`;

  return (
    <>
      <section className={status === 'none' ? 'card p-5' : 'panel-money'}>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <h3 className="font-display font-bold text-ink text-sm">Extra revisions</h3>
          {status !== 'none' && (
            <StatusPill status={{
              proposed: 'pending_review',
              accepted: 'escrow_pending',
              declined: 'declined',
              funded: 'completed',
            }[status]} />
          )}
        </div>

        {/* ── nothing proposed: the brand can offer ─────────────────────── */}
        {status === 'none' || status === 'declined' ? (
          <>
            <p className="text-sm text-muted leading-relaxed mt-1">
              The {deal.terms?.revisionsAllowed ?? 3} included revisions are used
              up. Further work is new scope — offer a fee and the creator can
              accept or decline it.
            </p>
            {status === 'declined' && at?.declineReason && (
              <p className="text-sm text-ink bg-white/70 rounded-lg p-2.5 mt-3 leading-relaxed">
                <span className="font-medium">They declined: </span>{at.declineReason}
              </p>
            )}
            {canPropose && (
              <button onClick={() => setProposing(true)} className="btn-money mt-4 w-full sm:w-auto">
                {status === 'declined' ? 'Make another offer' : 'Offer extra revisions'}
              </button>
            )}
          </>
        ) : null}

        {/* ── proposed: the creator answers ─────────────────────────────── */}
        {status === 'proposed' && (
          <>
            <div className="flex items-baseline justify-between mt-2 mb-1">
              <span className="text-sm text-money-700">{roundWord} for</span>
              <Money amount={at.amount} className="text-xl" />
            </div>
            {at.scopeNote && (
              <p className="text-sm text-ink bg-white/70 rounded-lg p-2.5 mt-2 leading-relaxed">
                {at.scopeNote}
              </p>
            )}

            {role === 'creator' ? (
              <>
                <p className="text-xs text-muted mt-3">
                  After the {at.commissionPct ?? 12.5}% platform commission you would
                  receive about{' '}
                  <span className="font-semibold text-ink">
                    {rupee(Math.round(at.amount * (1 - (at.commissionPct ?? 12.5) / 100)))}
                  </span>. Nothing starts until the brand has paid.
                </p>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => respond(true)} disabled={busy} className="btn-cta flex-1">
                    {busy ? <Spinner className="w-4 h-4" /> : 'Accept'}
                  </button>
                  <button onClick={() => setDeclining(true)} disabled={busy} className="btn-ghost text-rose-500">
                    Decline
                  </button>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted mt-3">
                Waiting for the creator to accept or decline. They can refuse —
                extra revisions are not something you can require.
              </p>
            )}
          </>
        )}

        {/* ── accepted: the brand pays ──────────────────────────────────── */}
        {status === 'accepted' && (
          <>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-sm text-money-700">{roundWord} agreed</span>
              <Money amount={at.amount} className="text-xl" />
            </div>
            {role === 'brand' ? (
              <>
                <p className="text-xs text-muted mt-3">
                  The creator has accepted. The revisions are added and work
                  restarts once this is in escrow.
                </p>
                <button onClick={pay} disabled={busy} className="btn-money mt-4 w-full">
                  {busy ? <><Spinner className="w-4 h-4" /> Opening checkout…</> : `Pay ${rupee(at.amount)} into escrow`}
                </button>
              </>
            ) : (
              <p className="text-xs text-muted mt-3">
                You have accepted. Work restarts as soon as the brand pays —
                you will be notified.
              </p>
            )}
          </>
        )}

        {/* ── funded ────────────────────────────────────────────────────── */}
        {status === 'funded' && (
          <p className="text-sm text-muted mt-1 leading-relaxed">
            <Money amount={at.amount} className="text-sm" /> paid for {roundWord}.
            They are part of the agreed scope and the collaboration is back in
            progress.
          </p>
        )}
      </section>

      {/* ── the brand's offer form ───────────────────────────────────────── */}
      <Modal
        open={proposing}
        onClose={busy ? undefined : () => setProposing(false)}
        dismissible={!busy}
        title="Offer extra revisions"
        description="The creator can accept or decline. Nothing changes until they accept and the money is in escrow."
      >
        <form onSubmit={propose}>
          <label htmlFor="at-rounds" className="field-label">How many more revisions</label>
          <input
            id="at-rounds" type="number" min="1" max="10"
            value={form.revisionsAdded}
            onChange={(e) => setForm((f) => ({ ...f, revisionsAdded: e.target.value }))}
            className="field tnum"
          />

          <label htmlFor="at-amount" className="field-label mt-4">Fee</label>
          <input
            id="at-amount" type="number" min="1" inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="0"
            className="field tnum"
          />
          <p className="text-xs text-muted mt-1.5">
            {amount > 0
              ? <>The creator receives about <span className="font-medium text-ink">{rupee(Math.round(amount * 0.875))}</span> after commission.</>
              : 'Paid into escrow and released with the rest on approval.'}
          </p>

          <label htmlFor="at-scope" className="field-label mt-4">
            What changes <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="at-scope" rows={3} maxLength={2000}
            value={form.scopeNote}
            onChange={(e) => setForm((f) => ({ ...f, scopeNote: e.target.value }))}
            placeholder="Be specific — this becomes part of the agreed scope."
            className="field resize-none"
          />

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
            <button type="button" onClick={() => setProposing(false)} disabled={busy} className="btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={busy || !formValid} className="btn-money">
              {busy ? <><Spinner className="w-4 h-4" /> Sending…</> : 'Send offer'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── the creator's decline ────────────────────────────────────────── */}
      <ConfirmDialog
        open={declining}
        onClose={() => { setDeclining(false); setDeclineReason(''); }}
        onConfirm={() => respond(false)}
        busy={busy}
        tone="danger"
        title="Decline the extra revisions?"
        description="The collaboration stays in resolution. The brand can make a different offer, or choose another way to close it out."
        confirmLabel="Decline"
      >
        <label htmlFor="at-decline" className="field-label">
          Reason <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="at-decline" value={declineReason}
          onChange={(e) => setDeclineReason(e.target.value)}
          placeholder="e.g. The fee does not cover a reshoot."
          maxLength={1000}
          className="field"
        />
        <p className="text-xs text-muted mt-1.5">
          Shown to the brand. A reason usually gets a better second offer.
        </p>
      </ConfirmDialog>
    </>
  );
}

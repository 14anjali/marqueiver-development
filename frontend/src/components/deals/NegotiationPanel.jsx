import { useCallback, useEffect, useState } from 'react';
import { Handshake, Check, Clock } from '../icons';
import ProposalTerms from './ProposalTerms';
import ProposalComposer from './ProposalComposer';
import { api } from '../../lib/api';
import { Spinner, useToast } from '../../lib/ui-state';
import { rupee } from '../../lib/normalize';

/**
 * The proposal stage: the same one for both routes into a collaboration.
 *
 * Proposal V1 → counter V2 → … → one version accepted → both parties confirm →
 * final terms locked. Every version is a separate immutable record; countering
 * writes a new one and never touches the one it answers.
 *
 * ── This panel did not work at all ─────────────────────────────────────────
 *
 * Three bugs, none of which produced a visible error:
 *
 *  1. `OPEN_STATES = ['negotiating']`. The state is `negotiation` — the `-ing`
 *     spelling is one of the invented names `lib/chart-theme.js` already
 *     records as never having existed. So `isOpen` was false for every deal
 *     that has ever existed, and the entire action set — send, accept, reject,
 *     counter — rendered for nobody.
 *  2. It read `deal.offers`. That path was removed from the Deal schema when
 *     offers moved to their own collection, so the history was permanently
 *     empty and the accepted proposal was never found, which meant the confirm
 *     step never appeared either.
 *  3. Behind both, the API call it would have made was broken anyway: the
 *     route handed `postOffer` a deal id where it expected a thread id.
 *
 * Offers now come from `GET /deals/:id/negotiation`, which is the collection
 * the rest of the system actually writes to.
 */

const STATUS_STYLE = {
  proposed: 'pill-live',
  accepted: 'pill-done',
  rejected: 'pill bg-rose-50 text-rose-600',
  expired: 'pill-quiet',
};

const when = (d) => (d ? new Date(d).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
}) : '');

export default function NegotiationPanel({ deal, role, onUpdated }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [composing, setComposing] = useState(false);
  const [offers, setOffers] = useState(null);
  const [openHistory, setOpenHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.getNegotiation(deal._id);
      setOffers(data?.offers ?? []);
    } catch {
      // A collaboration that has not reached negotiation has no thread, and
      // that is a normal answer rather than a failure worth shouting about.
      setOffers([]);
    }
  }, [deal._id]);

  useEffect(() => { load(); }, [load]);

  const sorted = [...(offers ?? [])].sort((a, b) => b.seq - a.seq);
  const live = sorted.filter((o) => (o.effectiveStatus ?? o.status) === 'proposed');
  const forMe = live.filter((o) => o.byRole !== role);
  const mine = live.filter((o) => o.byRole === role);
  const accepted = sorted.find((o) => o.status === 'accepted');
  const latest = sorted[0];

  const isOpen = deal.state === 'negotiation';
  const locked = Boolean(deal.agreedTerms?.lockedAt);
  const myConfirm = deal.termsConfirmation?.[role]?.at;
  const theirConfirm = deal.termsConfirmation?.[role === 'brand' ? 'creator' : 'brand']?.at;

  /**
   * Every action here can change both the deal and the proposal list, and the
   * three endpoints return different shapes — an offer, `{ deal, offer, thread }`,
   * `{ deal, agreed }`. Rather than decoding which is which, the deal is taken
   * from the response when it is there and re-fetched by the parent when it is
   * not (`onUpdated(null)`, the convention AdditionalTermsPanel already uses).
   * A stale panel after accepting reads as the action having failed.
   */
  async function run(key, fn, message) {
    setBusy(key);
    try {
      const { data } = await fn();
      const nextDeal = data?.deal ?? (data?._id === deal._id ? data : null);
      await load();
      onUpdated?.(nextDeal);
      toast.push(message ?? 'Updated', 'success');
      setComposing(false);
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  const accept = (o) => run(`accept${o._id}`, () => api.acceptOffer(deal._id, o._id),
    `Proposal V${o.seq} accepted — both of you now confirm to make it final`);
  const reject = (o) => run(`reject${o._id}`, () => api.rejectOffer(deal._id, o._id),
    `Proposal V${o.seq} declined`);
  const confirm = () => run('confirm', () => api.confirmTerms(deal._id), 'Confirmed');
  const sendProposal = (terms) => run('send', () => api.createOffer(deal._id, terms), 'Proposal sent');

  const nextVersion = (sorted[0]?.seq ?? 0) + 1;

  /** The version a counter starts from: the one being answered, else the latest. */
  const basis = forMe[0] ?? latest ?? null;

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="font-display font-bold text-ink flex items-center gap-2">
          <Handshake className="w-5 h-5 text-brand-600" /> Proposal
        </h3>
        <span className={forMe.length || (accepted && !myConfirm && isOpen) ? 'pill-live' : 'pill-quiet'}>
          {locked ? 'Final terms accepted'
            : !isOpen ? 'Not open'
            : accepted && !myConfirm ? 'Your confirmation needed'
            : accepted ? 'Waiting on their confirmation'
            : forMe.length ? `V${forMe[0].seq} needs your answer`
            : mine.length ? `V${mine[0].seq} sent — waiting`
            : 'No proposal yet'}
        </span>
      </div>

      {offers === null ? (
        <div className="py-6 grid place-items-center" role="status" aria-live="polite">
          <span className="sr-only">Loading proposals…</span>
          <Spinner className="w-5 h-5" />
        </div>
      ) : (
        <>
          {/*
            The locked terms are NOT repeated here.
            `FinalTerms` above owns that document now — it carries the payment
            schedule, the accepted amendments and the route to a change request,
            none of which this panel knows about. While both rendered, the page
            showed the same terms twice and this copy still said "a change needs
            a new collaboration", which stopped being true the moment change
            requests existed. What belongs here is how those terms were reached.
          */}
          {locked && (
            <p className="text-sm text-muted leading-relaxed">
              These terms are agreed and locked — the summary above is the document
              both of you are bound to. Below is how you got there.
            </p>
          )}

          {/* ── accepted, awaiting confirmation ───────────────────────── */}
          {accepted && !locked && (
            <div className="rounded-xl2 border border-line bg-bg/50 p-4">
              <p className="text-sm font-semibold text-ink">
                Proposal V{accepted.seq} accepted — not final yet
              </p>
              <p className="text-xs text-muted mt-1 leading-relaxed">
                Accepting settles which version is on the table. Both of you confirm it
                separately, and only the second confirmation locks the terms.
              </p>

              <div className="mt-3.5"><ProposalTerms terms={accepted} compact /></div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {myConfirm ? (
                  <span className="pill-done"><Check className="w-3 h-3" /> You confirmed</span>
                ) : (
                  <button onClick={confirm} disabled={!!busy} className="btn-cta">
                    {busy === 'confirm' ? <Spinner className="w-4 h-4" /> : 'Confirm final terms'}
                  </button>
                )}
                <span className={theirConfirm ? 'pill-done' : 'pill-quiet'}>
                  {theirConfirm ? 'They confirmed' : 'Waiting on them'}
                </span>
              </div>
            </div>
          )}

          {/* ── a proposal waiting on you ─────────────────────────────── */}
          {isOpen && !accepted && forMe.length > 0 && (
            <div className="space-y-3">
              {forMe.map((o) => (
                <div key={o._id} className="rounded-xl2 border border-brand-200 bg-brand-50/40 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">
                      Proposal V{o.seq} from the {o.byRole}
                    </p>
                    <span className="text-xs text-muted">
                      {o.expiresAt ? `expires ${when(o.expiresAt)}` : when(o.createdAt)}
                    </span>
                  </div>

                  {/* Against the version before it, so what moved is visible. */}
                  <div className="mt-3">
                    <ProposalTerms
                      terms={o}
                      changedFrom={sorted.find((p) => p.seq === o.seq - 1)}
                    />
                  </div>

                  {o.note && (
                    <p className="text-xs text-muted mt-3 leading-relaxed border-t border-brand-100 pt-3 break-words">
                      “{o.note}”
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 mt-4">
                    <button onClick={() => accept(o)} disabled={!!busy} className="btn-cta">
                      {busy === `accept${o._id}` ? <Spinner className="w-4 h-4" /> : 'Accept these terms'}
                    </button>
                    <button onClick={() => setComposing(true)} disabled={!!busy} className="btn-outline">
                      Counter with V{nextVersion}
                    </button>
                    <button
                      onClick={() => reject(o)} disabled={!!busy}
                      className="btn-ghost text-rose-500 border-rose-200"
                    >
                      {busy === `reject${o._id}` ? <Spinner className="w-4 h-4" /> : 'Decline this version'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── your own outstanding proposal ─────────────────────────── */}
          {isOpen && !accepted && mine.length > 0 && forMe.length === 0 && (
            <div className="rounded-xl2 border border-line p-4">
              <p className="text-sm font-semibold text-ink">
                V{mine[0].seq} sent — waiting for the {role === 'brand' ? 'creator' : 'brand'}
              </p>
              <div className="mt-3"><ProposalTerms terms={mine[0]} compact /></div>
              <p className="text-xs text-muted mt-3 leading-relaxed">
                A proposal cannot be withdrawn once sent. If the terms have changed, wait for
                their answer — or set an expiry on the next one.
              </p>
            </div>
          )}

          {isOpen && !accepted && !live.length && (
            <div className="rounded-xl2 border border-line border-dashed p-5 text-center">
              <p className="text-sm text-ink font-medium">No proposal on the table</p>
              <p className="text-xs text-muted mt-1 leading-relaxed max-w-sm mx-auto">
                Every version stays on the record, so send what you actually want rather than
                an opening you plan to walk back.
              </p>
            </div>
          )}

          {/*
            Only when there is nothing waiting on you. With a proposal on the
            table this rendered a second "Send V3" directly beneath "Counter
            with V3" — two buttons, same drawer, same result, and the reader
            left to work out whether they differed.
          */}
          {isOpen && !accepted && forMe.length === 0 && (
            <div className="mt-4">
              <button onClick={() => setComposing(true)} disabled={!!busy} className="btn-outline">
                {sorted.length ? `Send V${nextVersion}` : 'Send a proposal'}
              </button>
            </div>
          )}

          {/* ── version history ───────────────────────────────────────── */}
          {sorted.length > 0 && (
            <div className="mt-6 border-t border-line pt-4">
              <button
                onClick={() => setOpenHistory((v) => !v)}
                aria-expanded={openHistory}
                className="text-sm font-semibold text-ink focusable inline-flex items-center gap-2"
              >
                Version history
                <span className="pill-quiet">{sorted.length}</span>
              </button>

              {openHistory && (
                <ol className="mt-3.5 space-y-4">
                  {sorted.map((o) => {
                    const prev = sorted.find((p) => p.seq === o.seq - 1);
                    const status = o.effectiveStatus ?? o.status;
                    return (
                      <li key={o._id || o.seq} className="flex items-start gap-3">
                        <span className="w-8 h-8 rounded-full bg-bg border border-line text-muted grid place-items-center shrink-0 text-[11px] font-bold">
                          V{o.seq}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="money text-sm">{rupee(o.amount)}</span>
                            <span className="text-xs text-muted">from the {o.byRole}</span>
                            <span className={STATUS_STYLE[status] || 'pill-quiet'}>{status}</span>
                          </div>
                          <div className="text-[11px] text-muted/80 mt-0.5 inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {when(o.createdAt)}
                            {o.reconstructed && ' · reconstructed from the original terms'}
                          </div>
                          <div className="mt-2 rounded-xl2 border border-line p-3">
                            <ProposalTerms terms={o} changedFrom={prev} compact />
                          </div>
                          {o.note && (
                            <p className="text-xs text-muted mt-1.5 leading-relaxed break-words">“{o.note}”</p>
                          )}
                          {o.rejectionNote && (
                            <p className="text-xs text-rose-700 mt-1.5 leading-relaxed break-words">
                              Declined: {o.rejectionNote}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}
        </>
      )}

      <ProposalComposer
        open={composing}
        onClose={() => setComposing(false)}
        basedOn={basis}
        nextVersion={nextVersion}
        onSend={sendProposal}
        busy={busy === 'send'}
      />
    </div>
  );
}
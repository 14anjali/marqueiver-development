import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import AppShell from '../components/AppShell';
import NegotiationPanel from '../components/deals/NegotiationPanel';
import CancellationDialog from '../components/deals/CancellationDialog';
import SubmitWorkDialog from '../components/deals/SubmitWorkDialog';
import AdditionalTermsPanel from '../components/deals/AdditionalTermsPanel';
import FinalTerms from '../components/deals/FinalTerms';
import ChangeRequestPanel from '../components/deals/ChangeRequestPanel';
import AdvancePayment from '../components/deals/AdvancePayment';
import DealChat from '../components/deals/DealChat';
import WorkspaceHeader from '../components/deals/WorkspaceHeader';
import CollaborationFiles from '../components/deals/CollaborationFiles';
import ActivityHistory from '../components/deals/ActivityHistory';
import { MESSAGING_ALLOWED_STATES, MESSAGING_LOCK_REASON } from '../components/deals/messagingLock';
import { Modal } from '../components/overlay';
import { StatusPill, Money, Progress, SkeletonCard, SuccessMark } from '../components/feedback';
import { ChevLeft, Star, Check } from '../components/icons';
import { api } from '../lib/api';
import { openCashfreeCheckout } from '../lib/cashfree';
import { useAuth } from '../lib/auth';
import { ErrorBlock, Spinner, useToast } from '../lib/ui-state';
import { rupee } from '../lib/normalize';
import { rise, stagger, page, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * One collaboration, end to end.
 *
 * The most consequential screen in the product, and three things were wrong
 * with it beyond the visual treatment:
 *
 *  1. **"Submit work" filed a hardcoded fake link.** The handler posted
 *     `urls: ['https://drive.example.com/deliverable.mp4']` for every creator,
 *     every time, and started the brand's seven-day review clock on it. There
 *     was no way to submit real work. It now opens SubmitWorkDialog.
 *
 *  2. **The paid-revisions flow had no interface.** The backend supports
 *     Policy 5.5 option B — a brand offering to pay for further revisions — and
 *     nothing on this page exposed it, so a deal that exhausted its revisions
 *     reached `resolution` and stopped.
 *
 *  3. **The stepper vanished on four states.** `STEPS` listed the happy path
 *     only, so `indexOf` returned -1 for `revision`, `resolution`, `disputed`
 *     and `cancelled` and the whole progress indicator disappeared at exactly
 *     the moments a party most wants to know where they are.
 *
 * ── The workspace ──────────────────────────────────────────────────────────
 *
 * This page is now the collaboration workspace both parties work in, which
 * means it has to answer four questions without being read end to end: what is
 * done, what is pending, what *I* must do next, and what is locked. Those are
 * answered at the top — `WorkspaceHeader` names the campaign and both parties,
 * and the stepper inside it carries the stage states and the one line saying
 * whose move it is.
 *
 * Everything below is the detail, in the order somebody actually needs it: the
 * actions available, the terms in force, the negotiation that produced them,
 * the deliverables, then the history. Requirements are not given a section of
 * their own — they are the terms, and `FinalTerms`/`NegotiationPanel` already
 * render them. A second readout of the same brief is a second thing to keep in
 * agreement with the agreement.
 */

/**
 * Which transitions each role can trigger from each state. The backend machine
 * is authoritative; this only decides which buttons to show.
 *
 * Deliberately absent: funding (Policy 6.2 makes activation webhook-only),
 * cancellation (its own dialog, because Policy 28 requires the consequence to
 * be shown first) and revision requests (they post to /request-revision, which
 * enforces the cap and diverts to Resolution when exhausted).
 */
const ACTIONS = {
  brand: {
    invitation: [['declined', 'Decline']],
    negotiation: [['declined', 'Decline']],
    submitted: [['completed', 'Approve and release payment']],
  },
  creator: {
    invitation: [['negotiation', 'Accept and negotiate'], ['declined', 'Decline']],
    negotiation: [['declined', 'Decline']],
    in_progress: [['submitted', 'Submit work']],
    revision: [['submitted', 'Resubmit work']],
  },
};

/*
  The progress indicator lives in `components/deals/CollaborationStepper.jsx`.

  This page had its own: a seven-segment bar plus a `STEP_FOR` table mapping the
  off-path states onto whichever segment they branched from. That answered "how
  far along is this" and could not answer the three questions that matter more —
  whose move it is, what is locked, and why. The stepper answers all four, from
  the same deal state plus the payment record, and the off-path states are drawn
  as what they are rather than pushed onto a line they left.
*/

/**
 * Date + time, with the month spelled. The numeric `en-IN` default rendered
 * "1/9/2026", which is ambiguous to half the people reading it and disagrees
 * with the spelled-month dates used everywhere else in the app.
 */
const STAMP = {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
};

export default function DealDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const reduced = usePrefersReducedMotion();

  const [deal, setDeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewHover, setReviewHover] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);

  const role = user?.role === 'creator' ? 'creator' : 'brand';

  /**
   * The agreement, the terms in force now, and every change asked for.
   *
   * Loaded next to the deal rather than derived from it: `agreedTerms` alone
   * cannot say what applies today once an amendment exists, and a page that
   * reconstructs that itself will sooner or later quote stale terms as binding.
   * A collaboration with no locked terms simply answers "not locked".
   */
  const [terms, setTerms] = useState(null);
  const [requestingChange, setRequestingChange] = useState(false);

  /** Proposal versions, so a message can point at one. */
  const [negotiationOffers, setNegotiationOffers] = useState([]);

  /**
   * The payment record and the thread, fetched once for the whole workspace.
   *
   * Three things read the payments — the stepper (the one status the deal alone
   * cannot express is "verified, but not started"), the advance panel and the
   * activity history — and two read the messages: the chat and the files list.
   * Each component fetching for itself means the same request two or three times
   * and, worse, two lists on screen that can disagree after a send.
   */
  const [payments, setPayments] = useState([]);
  const [messages, setMessages] = useState(null);

  const loadPayments = async () => {
    try {
      const { data } = await api.paymentRecords(id);
      setPayments(data ?? []);
    } catch { setPayments([]); }
  };

  /** At most one request is ever open — the server refuses a second. */
  const pendingChange = (terms?.changeRequests ?? []).find((c) => c.status === 'pending') ?? null;

  const loadTerms = async () => {
    try {
      const { data } = await api.termsHistory(id);
      setTerms(data);
    } catch { setTerms(null); }
  };

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.getDeal(id);
      setDeal(data);
      loadTerms();
      loadPayments();
      api.getNegotiation(id)
        .then((n) => setNegotiationOffers(n.data?.offers ?? []))
        .catch(() => setNegotiationOffers([]));

      /*
        Messaging is gated on the server, so this is not the lock — a locked
        collaboration simply has nothing to list, and asking would be refused.
      */
      if (MESSAGING_ALLOWED_STATES.includes(data.state)) {
        api.listMessages(id)
          .then((m) => setMessages(m.data ?? []))
          .catch(() => setMessages([]));
      } else {
        setMessages([]);
      }
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function doTransition(to, label) {
    // Submitting work opens the dialog rather than posting a placeholder.
    if (to === 'submitted' && role === 'creator') { setShowSubmit(true); return; }

    setBusy(to);
    try {
      if (to === 'escrow_pending' && role === 'brand') {
        const { data } = await api.createPaymentSession(id);
        if (data.gateway === 'mock') {
          toast.push('Mock mode: simulating a successful payment', 'info');
        } else {
          const result = await openCashfreeCheckout(data.paymentSessionId);
          if (!result.ok) { toast.push(result.message, 'error'); setBusy(''); return; }
        }
      }
      await api.transitionDeal(id, { to, note: label });
      toast.push(label, 'success');
      await load();
    } catch (e) { toast.push(e.message, 'error'); }
    finally { setBusy(''); }
  }


  async function submitReview() {
    if (!reviewRating) return;
    setReviewBusy(true);
    try {
      await api.createReview(id, { rating: reviewRating, text: reviewText || undefined });
      setReviewSubmitted(true);
    } catch (e) {
      if (e.status === 409) { setReviewSubmitted(true); toast.push('You have already reviewed this collaboration', 'info'); }
      else toast.push(e.message, 'error');
    } finally { setReviewBusy(false); }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="max-w-[1000px] mx-auto px-4 sm:px-6 py-6" role="status" aria-live="polite">
          <span className="sr-only">Loading collaboration…</span>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
            <div className="space-y-4"><SkeletonCard /><SkeletonCard /></div>
            <div className="space-y-4"><SkeletonCard /></div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error || !deal) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto py-10 px-4">
          <ErrorBlock
            error={error ?? { message: 'The server returned an unexpected response for this collaboration.' }}
            onRetry={load}
          />
        </div>
      </AppShell>
    );
  }

  const actions = ACTIONS[role]?.[deal.state] || [];
  const escrowFunded = Boolean(deal.escrow?.funded);
  const released = Boolean(deal.escrow?.releasedAt);

  /**
   * What is actually held, which is not the agreed total.
   *
   * The escrow card read `deal.escrow.amount` — the whole collaboration value —
   * and said "Funded: yes". Under the 50/50 schedule only the advance has been
   * collected, so a brand in `submitted` was being told ₹62,000 was held when
   * ₹31,000 was, and a creator was being told the same. The schedule is the
   * record of what was charged; this reads it, and says plainly that the balance
   * is not collected yet.
   */
  const sched = deal.escrow?.schedule;
  // Once the escrow is released the question is no longer what is held, so the
  // tranche wording stops: "Held in escrow" next to "Released: yes" is two
  // answers to the same question.
  const balanceOwed = (sched?.balance?.amount ?? 0) > 0 && !sched?.balance?.funded && !released;
  const heldAmount = balanceOwed && sched?.advance?.funded
    ? sched.advance.amount
    : (deal.escrow?.amount ?? deal.terms?.amount);
  const revisionsUsed = deal.revisionCount ?? 0;
  const revisionsAllowed = deal.terms?.revisionsAllowed ?? 3;
  /**
   * The same gate the server enforces, and the same reasons.
   *
   * `messaging.policy.js` owns both; this mirrors it so the page can explain
   * the lock rather than showing one sentence for four different states. The
   * server is still the authority — calling the API directly is refused there.
   */
  /** The advance panel owns the money story in the states it covers. */
  const showAdvancePanel = Boolean(terms?.locked)
    && ['accepted', 'escrow_pending', 'in_progress'].includes(deal.state);

  const chatLocked = !MESSAGING_ALLOWED_STATES.includes(deal.state);
  const chatLockReason = MESSAGING_LOCK_REASON[deal.state]
    ?? 'Messaging is not available for this collaboration yet.';

  return (
    <AppShell>
      <motion.div
        variants={withReducedMotion(page, reduced)}
        initial="hidden" animate="visible"
        className="max-w-[1000px] mx-auto px-4 sm:px-6 py-5 sm:py-6"
      >
        <div className="flex items-center justify-between gap-4 mb-4">
          <button
            onClick={() => nav('/deals')}
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink transition-colors focusable px-1 py-1"
          >
            <ChevLeft className="w-4 h-4" /> Back to deals
          </button>
          {!['completed', 'cancelled', 'declined'].includes(deal.state) && (
            <button
              onClick={() => setShowCancel(true)}
              className="text-sm font-medium text-muted hover:text-rose-600 transition-colors focusable px-2 py-1"
            >
              Cancel collaboration
            </button>
          )}
        </div>

        <motion.div
          variants={withReducedMotion(stagger, reduced)}
          initial="hidden" animate="visible"
          className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5"
        >
          <div className="space-y-4 min-w-0">
            {/* ── who, what, where it is, whose move ─────────────────── */}
            <motion.section variants={withReducedMotion(rise, reduced)}>
              <WorkspaceHeader deal={deal} role={role} payments={payments} binding={terms?.bindingTerms} />
            </motion.section>

            {/* Revisions, where the parties can see them rather than
                discovering the cap when they hit it. */}
            {revisionsUsed > 0 && (
              <motion.section variants={withReducedMotion(rise, reduced)} className="card p-5">
                <Progress
                  value={revisionsUsed}
                  max={revisionsAllowed}
                  tone={revisionsUsed >= revisionsAllowed ? 'money' : 'brand'}
                  label={`${revisionsUsed} of ${revisionsAllowed} revisions used`}
                />
                {revisionsUsed >= revisionsAllowed && (
                  <p className="text-xs text-money-700 mt-2">
                    Included revisions are used up. Further work needs agreed additional terms.
                  </p>
                )}
              </motion.section>
            )}

            {/* ── actions ────────────────────────────────────────────── */}
            {actions.length > 0 && (
              <motion.section variants={withReducedMotion(rise, reduced)} className="card p-5">
                <h2 className="font-display font-bold text-ink text-sm mb-3">What you can do now</h2>
                <div className="flex flex-wrap gap-2">
                  {actions.map(([to, label]) => {
                    const primary = ['completed', 'submitted', 'negotiation'].includes(to);
                    return (
                      <button
                        key={to}
                        onClick={() => doTransition(to, label)}
                        disabled={Boolean(busy)}
                        className={to === 'declined'
                          ? 'btn-ghost text-rose-500 border-rose-200'
                          : primary ? 'btn-cta' : 'btn-outline'}
                      >
                        {busy === to ? <Spinner className="w-4 h-4" /> : label}
                      </button>
                    );
                  })}
                </div>
                {deal.state === 'submitted' && role === 'brand' && (
                  <p className="text-xs text-muted mt-3 leading-relaxed">
                    Approving releases the escrow to the creator. If it is not
                    right, request a revision instead — you have{' '}
                    {Math.max(0, revisionsAllowed - revisionsUsed)} left.
                  </p>
                )}
              </motion.section>
            )}

            {/* Once terms are locked, this is the document both parties are
                bound to — shown above the negotiation that produced it. */}
            {terms?.locked && (
              <motion.div variants={withReducedMotion(rise, reduced)}>
                <FinalTerms
                  deal={deal}
                  role={role}
                  amendments={terms.amendments}
                  binding={terms.bindingTerms}
                  canRequestChange={terms.canRequest && !pendingChange}
                  onRequestChange={() => setRequestingChange(true)}
                />
              </motion.div>
            )}

            {/* A live request sits between the terms and the history — it is the
                one thing on this page waiting on somebody. */}
            {pendingChange && (
              <motion.div variants={withReducedMotion(rise, reduced)}>
                <ChangeRequestPanel
                  deal={deal}
                  role={role}
                  binding={terms?.bindingTerms}
                  pending={pendingChange}
                  onChanged={load}
                />
              </motion.div>
            )}

            <motion.div variants={withReducedMotion(rise, reduced)}>
              <NegotiationPanel deal={deal} role={role} onUpdated={(d) => (d ? setDeal(d) : load())} />
            </motion.div>

            <motion.div variants={withReducedMotion(rise, reduced)}>
              <AdditionalTermsPanel
                deal={deal}
                role={role}
                onUpdated={(d) => (d ? setDeal(d) : load())}
              />
            </motion.div>

            {/* ── deliverables ───────────────────────────────────────── */}
            {deal.workSubmissions?.length > 0 && (
              <motion.section variants={withReducedMotion(rise, reduced)} className="card p-5">
                <h2 className="font-display font-bold text-ink text-sm mb-3">Deliverables</h2>
                <div className="space-y-3">
                  {deal.workSubmissions.map((s, i) => (
                    <div key={i} className="border border-line rounded-xl2 p-3.5">
                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <span className="text-xs text-muted tnum">
                          {new Date(s.submittedAt).toLocaleString('en-IN', STAMP)}
                        </span>
                        <span className="flex items-center gap-1.5">
                          {s.late && <span className="pill-warn">Late</span>}
                          <StatusPill status={
                            s.reviewStatus === 'approved' ? 'completed'
                              : s.reviewStatus === 'rejected' ? 'revision'
                                : 'submitted'
                          } />
                        </span>
                      </div>
                      <ul className="space-y-1">
                        {(s.urls || []).map((u) => (
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
                      {s.note && <p className="text-sm text-muted mt-2 leading-relaxed">{s.note}</p>}
                      {s.reviewNote && (
                        <p className="text-sm text-ink bg-bg rounded-lg p-2.5 mt-2 leading-relaxed">
                          <span className="font-medium">Brand’s note: </span>{s.reviewNote}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </motion.section>
            )}

            {/*
              State transitions, payments, amendments, change requests and
              submissions, in one order. This was `deal.timeline` alone, which
              records transitions and nothing else — so a failed payment, a
              retry and an accepted amendment left no trace on the page that is
              supposed to be the record of the collaboration.
            */}
            <motion.section variants={withReducedMotion(rise, reduced)}>
              <ActivityHistory deal={deal} payments={payments} />
            </motion.section>

            {/* ── review ─────────────────────────────────────────────── */}
            {deal.state === 'completed' && (
              <motion.section variants={withReducedMotion(rise, reduced)} className="card p-5">
                <h2 className="font-display font-bold text-ink text-sm mb-3">
                  {role === 'brand' ? 'Rate this creator' : 'Rate this brand'}
                </h2>
                {reviewSubmitted ? (
                  <div className="flex items-center gap-3">
                    <SuccessMark className="w-10 h-10" />
                    <p className="text-sm text-ink">
                      Thanks — your review is in. It appears on their profile once
                      both sides have rated.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-1 mb-3" onMouseLeave={() => setReviewHover(0)}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => setReviewRating(n)}
                          onMouseEnter={() => setReviewHover(n)}
                          aria-label={`${n} star${n === 1 ? '' : 's'}`}
                          aria-pressed={reviewRating === n}
                          className="focusable p-0.5 transition-transform hover:scale-110"
                        >
                          <Star
                            className={`w-7 h-7 transition-colors ${
                              n <= (reviewHover || reviewRating) ? 'text-money-500' : 'text-line'}`}
                          />
                        </button>
                      ))}
                      {reviewRating > 0 && (
                        <span className="self-center ml-2 text-sm text-muted">
                          {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][reviewRating]}
                        </span>
                      )}
                    </div>
                    <textarea
                      value={reviewText}
                      onChange={(e) => setReviewText(e.target.value)}
                      rows={3}
                      maxLength={1000}
                      placeholder="How was the collaboration? (optional)"
                      className="field resize-none mb-1"
                    />
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <span className="text-xs text-muted">
                        {reviewRating ? 'Reviews are published once both sides have rated.' : 'Pick a rating to continue.'}
                      </span>
                      <span className="text-xs text-muted tnum">{reviewText.length}/1000</span>
                    </div>
                    <button onClick={submitReview} disabled={reviewBusy || !reviewRating} className="btn-cta">
                      {reviewBusy ? <><Spinner className="w-4 h-4" /> Submitting…</> : 'Submit review'}
                    </button>
                  </>
                )}
              </motion.section>
            )}
          </div>

          {/* ── right column ─────────────────────────────────────────── */}
          <div className="space-y-4">
            {/*
              Shown only when the advance panel is not.

              While both rendered, the page stacked two money boxes telling the
              same story — and this one led with "Amount ₹62,000" when what the
              brand owed right now was ₹31,000. `AdvancePayment` carries the
              whole schedule, the live payment state and the retry; this stays
              for the states it does not cover, where the question really is
              just "is the money held".
            */}
            {!showAdvancePanel && (
            <motion.section variants={withReducedMotion(rise, reduced)} className="panel-money">
              <h2 className="font-display font-bold text-money-700 text-sm mb-3">Escrow</h2>
              <div className="flex justify-between items-baseline py-1.5">
                <span className="text-sm text-muted">{balanceOwed ? 'Held in escrow' : 'Amount'}</span>
                <Money amount={heldAmount} />
              </div>
              {balanceOwed && (
                <div className="flex justify-between items-baseline py-1.5 text-sm">
                  <span className="text-muted">Remaining 50%</span>
                  <span className="text-muted">Not collected yet</span>
                </div>
              )}
              <div className="flex justify-between items-center py-1.5 text-sm">
                <span className="text-muted">Funded</span>
                <span className={escrowFunded ? 'text-jade-700 font-medium inline-flex items-center gap-1' : 'text-muted'}>
                  {escrowFunded ? <><Check className="w-3.5 h-3.5" /> Yes</> : 'Not yet'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1.5 text-sm">
                <span className="text-muted">Released</span>
                <span className={released ? 'text-jade-700 font-medium inline-flex items-center gap-1' : 'text-muted'}>
                  {released ? <><Check className="w-3.5 h-3.5" /> Yes</> : 'Held'}
                </span>
              </div>
              <p className="text-xs text-muted mt-3 leading-relaxed">
                {released
                  ? 'Paid out to the creator’s wallet.'
                  : escrowFunded
                    ? 'Held by Marqueiver until the work is approved.'
                    : 'Work starts once the advance is confirmed by the payment partner.'}
              </p>
            </motion.section>
            )}

            {/* The one step between agreed terms and work starting. */}
            {showAdvancePanel && (
              <motion.div variants={withReducedMotion(rise, reduced)}>
                <AdvancePayment
                  deal={deal}
                  role={role}
                  records={payments}
                  onReload={loadPayments}
                  onUpdated={(d) => (d ? setDeal(d) : load())}
                />
              </motion.div>
            )}

            <motion.div variants={withReducedMotion(rise, reduced)}>
              <DealChat
                deal={deal}
                role={role}
                locked={chatLocked}
                lockReason={chatLockReason}
                offers={negotiationOffers}
                terms={terms}
                messages={chatLocked ? [] : messages}
                onSent={(m) => setMessages((list) => [...(list ?? []), m])}
              />
            </motion.div>

            {/* Every attachment and deliverable link, so nobody has to scroll a
                month of messages to find a reference image. */}
            <motion.div variants={withReducedMotion(rise, reduced)}>
              <CollaborationFiles deal={deal} messages={messages ?? []} locked={chatLocked} />
            </motion.div>
          </div>
        </motion.div>
      </motion.div>

      {/* The change-request composer. Mounted once, alongside the other
          dialogs, and only when there are locked terms to change. */}
      {terms?.locked && (
        <ChangeRequestPanel
          open={requestingChange}
          onClose={() => setRequestingChange(false)}
          deal={deal}
          role={role}
          binding={terms.bindingTerms}
          pending={null}
          onChanged={load}
        />
      )}

      {showCancel && (
        <CancellationDialog
          deal={deal} role={role}
          onClose={() => setShowCancel(false)}
          onCancelled={(updated) => setDeal(updated)}
        />
      )}

      {showSubmit && (
        <SubmitWorkDialog
          deal={deal}
          isResubmission={deal.state === 'revision'}
          onClose={() => setShowSubmit(false)}
          onDone={() => { setShowSubmit(false); load(); }}
        />
      )}
    </AppShell>
  );
}
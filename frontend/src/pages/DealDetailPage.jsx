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
import { Modal } from '../components/overlay';
import { StatusPill, Money, Steps, Progress, SkeletonCard, SuccessMark } from '../components/feedback';
import { ChevLeft, Clock, Send, Star, Check } from '../components/icons';
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

/** The happy path, for the progress indicator. */
const STEPS = ['invitation', 'negotiation', 'accepted', 'escrow_pending', 'in_progress', 'submitted', 'completed'];
const STEP_LABEL = ['Invited', 'Negotiating', 'Terms agreed', 'Awaiting payment', 'In progress', 'In review', 'Complete'];

/**
 * Where a state sits on the happy path.
 *
 * States off the path map to the step they are effectively at, so the indicator
 * keeps working instead of disappearing. `revision` is back at "in progress"
 * because that is what is happening; `resolution` and `disputed` sit at review,
 * which is where they branched from.
 */
const STEP_FOR = {
  revision: 4, resolution: 5, disputed: 5, declined: 0, cancelled: 0,
};
const stepIndex = (state) => {
  const direct = STEPS.indexOf(state);
  return direct >= 0 ? direct : (STEP_FOR[state] ?? 0);
};

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
  const [messages, setMessages] = useState([]);
  const [msg, setMsg] = useState('');
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
      try { const m = await api.listMessages(id); setMessages(m.data || []); } catch { /* chat may be locked */ }
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

  async function send() {
    if (!msg.trim()) return;
    const text = msg; setMsg('');
    try { const { data } = await api.sendMessage(id, text); setMessages((m) => [...m, data]); }
    catch (e) { setMsg((cur) => cur || text); toast.push(e.message, 'error'); }
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
  const revisionsUsed = deal.revisionCount ?? 0;
  const revisionsAllowed = deal.terms?.revisionsAllowed ?? 3;
  const chatLocked = ['invitation', 'negotiation', 'accepted', 'escrow_pending'].includes(deal.state);

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
            {/* ── header ─────────────────────────────────────────────── */}
            <motion.section variants={withReducedMotion(rise, reduced)} className="card-edge p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h1 className="font-display font-extrabold text-xl text-ink">{deal.title}</h1>
                  <p className="text-muted text-sm mt-1 flex items-center gap-1.5 flex-wrap">
                    {deal.contentTypes?.join(', ') || 'Campaign'}
                    <span className="text-line">·</span>
                    <Money amount={deal.terms?.amount} className="text-sm" />
                  </p>
                </div>
                <StatusPill status={deal.state} />
              </div>

              <Steps steps={STEP_LABEL} current={stepIndex(deal.state)} className="mt-5" />

              {/* Revisions, where the parties can see them rather than
                  discovering the cap when they hit it. */}
              {revisionsUsed > 0 && (
                <div className="mt-4 pt-4 border-t border-line">
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
                </div>
              )}
            </motion.section>

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

            {/* ── timeline ───────────────────────────────────────────── */}
            <motion.section variants={withReducedMotion(rise, reduced)} className="card p-5">
              <h2 className="font-display font-bold text-ink text-sm mb-3">Timeline</h2>
              {!deal.timeline?.length ? (
                <p className="text-sm text-muted">Nothing has happened yet.</p>
              ) : (
                <ol className="space-y-3">
                  {deal.timeline.map((t, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="w-7 h-7 rounded-full wash text-brand-600 grid place-items-center shrink-0" aria-hidden="true">
                        <Clock className="w-3.5 h-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm text-ink">
                          <span className="font-medium">{(t.to ?? '').replace(/_/g, ' ')}</span>
                          {t.byRole && <span className="text-muted"> · by {t.byRole}</span>}
                        </div>
                        {t.note && <div className="text-xs text-muted mt-0.5 leading-relaxed">{t.note}</div>}
                        <div className="text-xs text-muted tnum mt-0.5">
                          {t.at ? new Date(t.at).toLocaleString('en-IN', STAMP) : ''}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
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
            <motion.section variants={withReducedMotion(rise, reduced)} className="panel-money">
              <h2 className="font-display font-bold text-money-700 text-sm mb-3">Escrow</h2>
              <div className="flex justify-between items-baseline py-1.5">
                <span className="text-sm text-muted">Amount</span>
                <Money amount={deal.escrow?.amount ?? deal.terms?.amount} />
              </div>
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

            <motion.section variants={withReducedMotion(rise, reduced)} className="card p-5 flex flex-col h-[26rem]">
              <h2 className="font-display font-bold text-ink text-sm mb-3">Messages</h2>
              {chatLocked ? (
                <div className="flex-1 grid place-items-center text-center px-4">
                  <p className="text-sm text-muted leading-relaxed">
                    Chat opens once the advance payment is confirmed. Until then,
                    terms are exchanged as offers so both sides keep a record.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto space-y-2 no-scrollbar">
                    {!messages.length ? (
                      <p className="text-xs text-muted text-center py-6">No messages yet.</p>
                    ) : messages.map((m, i) => (
                      <div
                        key={m._id ?? i}
                        className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                          m.senderRole === role ? 'ml-auto bg-brand-600 text-white' : 'bg-bg text-ink'}`}
                      >
                        {m.body}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <input
                      value={msg}
                      onChange={(e) => setMsg(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && send()}
                      placeholder="Type a message…"
                      aria-label="Message"
                      className="field flex-1"
                    />
                    <button onClick={send} disabled={!msg.trim()} className="btn-brand px-3.5" aria-label="Send">
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </motion.section>
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
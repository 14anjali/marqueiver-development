import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import NegotiationPanel from '../components/deals/NegotiationPanel';
import { ChevLeft, Check, Clock, Send, Star } from '../components/icons';
import { api } from '../lib/api';
import { openCashfreeCheckout } from '../lib/cashfree';
import { useAuth } from '../lib/auth';
import { LoadingBlock, ErrorBlock, Spinner, useToast } from '../lib/ui-state';
import { rupee } from '../lib/normalize';
import CancellationDialog from '../components/deals/CancellationDialog';

/**
 * Which transitions each role can trigger from each state. Mirrors the backend
 * machine (Policy 5.1 vocabulary) — the backend is authoritative; this only
 * decides which buttons to show.
 *
 * Deliberately absent:
 *  - No "Fund escrow" transition. Policy 6.2 makes activation webhook-only, so
 *    funding goes through Checkout and the deal moves when the processor
 *    confirms.
 *  - No cancel button after `accepted` for either party. Policy 7 makes the
 *    outcome stage-dependent and the consequence must be shown before
 *    confirming, so cancellation has its own flow rather than a bare
 *    transition (see CancellationDialog — TODO, Phase 5 UI).
 *  - No "Request changes" transition. Policy 5.4 caps revisions at the agreed
 *    rounds, so it posts to /request-revision, which enforces the cap and
 *    diverts to Resolution when exhausted.
 */
const ACTIONS = {
  brand: {
    invitation: [['declined', 'Decline']],
    negotiation: [['declined', 'Decline']],
    accepted: [],
    escrow_pending: [],
    in_progress: [],
    submitted: [['completed', 'Approve & release payment']],
    revision: [],
    resolution: [],
  },
  creator: {
    invitation: [['negotiation', 'Accept & negotiate'], ['declined', 'Decline']],
    negotiation: [['declined', 'Decline']],
    accepted: [],
    escrow_pending: [],
    in_progress: [['submitted', 'Submit work']],
    revision: [['submitted', 'Resubmit work']],
    resolution: [],
  },
};

// Policy 5.1 lifecycle, for the progress indicator.
const STEPS = ['invitation', 'negotiation', 'accepted', 'escrow_pending', 'in_progress', 'submitted', 'completed'];

const STATE_LABEL = {
  invitation: 'Invitation',
  negotiation: 'Negotiation',
  accepted: 'Terms agreed',
  escrow_pending: 'Awaiting escrow funding',
  in_progress: 'In progress',
  submitted: 'In review',
  revision: 'Revision requested',
  resolution: 'Resolution',
  disputed: 'Disputed',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export default function DealDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [deal, setDeal] = useState(null);
  const [showCancel, setShowCancel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [messages, setMessages] = useState([]);
  const [msg, setMsg] = useState('');
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);

  const role = user?.role === 'creator' ? 'creator' : 'brand';

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.getDeal(id);
      setDeal(data);
      try { const m = await api.listMessages(id); setMessages(m.data || []); } catch { /* ignore */ }
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function doTransition(to, label) {
    setBusy(to);
    try {
      if (to === 'submitted' && role === 'creator') {
        await api.submitWork(id, { urls: ['https://drive.example.com/deliverable.mp4'], note: 'Submitting deliverables' });
      } else if (to === 'escrow_pending' && role === 'brand') {
        // Real Cashfree Checkout — a payment session is created server-side,
        // the brand actually pays in the modal, and only on success do we
        // call the normal transition (which reuses that same paid order
        // rather than creating a second one).
        const { data } = await api.createPaymentSession(id);
        if (data.gateway === 'mock') {
          // Dev/mock mode — no real Cashfree credentials configured, so
          // there's no real session to open a checkout for. Skip straight to
          // confirming funded, same as every other mock-mode integration in
          // this app (Instagram/Facebook/YouTube sync, OTP, etc).
          toast.push('Mock mode: simulating a successful Cashfree payment', 'info');
        } else {
          const result = await openCashfreeCheckout(data.paymentSessionId);
          if (!result.ok) { toast.push(result.message, 'error'); setBusy(''); return; }
        }
        await api.transitionDeal(id, { to, note: label });
      } else {
        await api.transitionDeal(id, { to, note: label });
      }
      toast.push(label + ' ✓', 'success');
      await load();
    } catch (e) { toast.push(e.message, 'error'); } finally { setBusy(''); }
  }

  async function send() {
    if (!msg.trim()) return;
    const text = msg; setMsg('');
    try { const { data } = await api.sendMessage(id, text); setMessages((m) => [...m, data]); }
    catch (e) { toast.push(e.message, 'error'); }
  }

  async function submitReview() {
    if (!reviewRating) { toast.push('Pick a star rating first', 'error'); return; }
    setReviewBusy(true);
    try {
      await api.createReview(id, { rating: reviewRating, text: reviewText || undefined });
      setReviewSubmitted(true);
      toast.push('Review submitted ✓', 'success');
    } catch (e) {
      if (e.status === 409) { setReviewSubmitted(true); toast.push("You've already reviewed this deal", 'info'); }
      else toast.push(e.message, 'error');
    } finally { setReviewBusy(false); }
  }

  if (loading) return <AppShell><LoadingBlock /></AppShell>;
  if (error) return <AppShell><div className="max-w-2xl mx-auto py-10"><ErrorBlock error={error} onRetry={load} /></div></AppShell>;
  if (!deal) return <AppShell><div className="max-w-2xl mx-auto py-10"><ErrorBlock error={{ message: 'Received an unexpected response from the server.' }} onRetry={load} /></div></AppShell>;

  const actions = ACTIONS[role]?.[deal.state] || [];
  const stepIdx = STEPS.indexOf(deal.state);

  return (
    <AppShell>
      <div className="max-w-[1000px] mx-auto px-6 py-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <button onClick={() => nav('/deals')} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevLeft className="w-4 h-4" /> Back to deals</button>
          {/* Policy 7 — cancellation is its own flow, not a bare transition,
              because Policy 28 requires the consequence to be shown first. */}
          {!['completed', 'cancelled', 'declined'].includes(deal.state) && (
            <button
              onClick={() => setShowCancel(true)}
              className="text-sm font-medium text-muted hover:text-rose-600 transition-colors
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded-lg px-2 py-1"
            >
              Cancel collaboration
            </button>
          )}
        </div>

        {showCancel && (
          <CancellationDialog
            deal={deal}
            role={role}
            onClose={() => setShowCancel(false)}
            onCancelled={(updated) => setDeal(updated)}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          <div className="space-y-5">
            {/* header */}
            <div className="card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="font-display font-extrabold text-xl text-ink">{deal.title}</h1>
                  <p className="text-muted text-sm mt-1">{deal.contentTypes?.join(', ') || 'Campaign'} · {rupee(deal.terms?.amount)}</p>
                </div>
                <span className="pill-live">{STATE_LABEL[deal.state] ?? deal.state}</span>
              </div>

              {/* progress stepper */}
              {stepIdx >= 0 && (
                <div className="flex items-center mt-5">
                  {STEPS.map((s, i) => (
                    <div key={s} className="flex items-center flex-1 last:flex-none">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        i < stepIdx ? 'bg-emerald-500 text-white' : i === stepIdx ? 'bg-brand-600 text-white' : 'bg-bg text-muted border border-line'}`}>
                        {i < stepIdx ? <Check className="w-3.5 h-3.5" /> : i + 1}
                      </div>
                      {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 mx-1 ${i < stepIdx ? 'bg-emerald-500' : 'bg-line'}`} />}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-between mt-2 text-[10px] text-muted"><span>Invited</span><span>Funded</span><span>Working</span><span>Done</span></div>
            </div>

            {/* actions */}
            {actions.length > 0 && (
              <div className="card p-5">
                <h3 className="font-display font-bold text-ink mb-3">Actions available to you</h3>
                <div className="flex flex-wrap gap-2">
                  {actions.map(([to, label]) => {
                    const danger = to === 'cancelled';
                    const primary = ['completed', 'submitted', 'negotiation'].includes(to);
                    return (
                      <button key={to} onClick={() => doTransition(to, label)} disabled={!!busy}
                        className={danger ? 'btn-ghost text-rose-500 border-rose-200' : primary ? 'btn-cta' : 'btn-outline'}>
                        {busy === to ? <Spinner /> : label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted mt-3">Funding opens a real Cashfree payment. Release and refunds are handled internally and recorded in the ledger.</p>
              </div>
            )}

            {/* negotiation workspace (§12) — offers, history, and the
                accept/counter/reject actions live here rather than in the
                generic transition buttons above. */}
            <NegotiationPanel deal={deal} role={role} onUpdated={setDeal} />

            {/* timeline */}
            <div className="card p-5">
              <h3 className="font-display font-bold text-ink mb-3">Timeline</h3>
              <div className="space-y-3">
                {(deal.timeline || []).map((t, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><Clock className="w-3.5 h-3.5" /></span>
                    <div>
                      <div className="text-sm text-ink"><span className="capitalize font-medium">{t.to?.replace('_', ' ')}</span> {t.byRole && <span className="text-muted">· by {t.byRole}</span>}</div>
                      <div className="text-xs text-muted">{t.at ? new Date(t.at).toLocaleString() : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* review — only once the deal is completed */}
            {deal.state === 'completed' && (
              <div className="card p-5">
                <h3 className="font-display font-bold text-ink mb-3">
                  {role === 'brand' ? 'Rate this creator' : 'Rate this brand'}
                </h3>
                {reviewSubmitted ? (
                  <p className="text-sm text-emerald-600 inline-flex items-center gap-1.5"><Check className="w-4 h-4" /> Thanks — your review has been submitted.</p>
                ) : (
                  <>
                    <div className="flex gap-1 mb-3">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} onClick={() => setReviewRating(n)} aria-label={`${n} star`}>
                          <Star className="w-7 h-7" fill={n <= reviewRating ? '#F5A623' : '#E5E7EB'} />
                        </button>
                      ))}
                    </div>
                    <textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)} rows={3}
                      placeholder="How was the collaboration? (optional)"
                      className="w-full border border-line rounded-lg px-3 py-2 text-sm mb-3" />
                    <button onClick={submitReview} disabled={reviewBusy} className="btn-cta">
                      {reviewBusy ? <Spinner className="w-4 h-4" /> : 'Submit review'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* right: escrow + chat */}
          <div className="space-y-5">
            <div className="card p-5">
              <h3 className="font-display font-bold text-ink mb-3">Escrow</h3>
              <div className="flex justify-between py-1.5 text-sm"><span className="text-muted">Amount</span><span className="font-bold text-ink">{rupee(deal.terms?.amount)}</span></div>
              <div className="flex justify-between py-1.5 text-sm"><span className="text-muted">Funded</span><span className={deal.escrow?.funded ? 'text-emerald-600 font-medium' : 'text-muted'}>{deal.escrow?.funded ? 'Yes' : 'Not yet'}</span></div>
              <div className="flex justify-between py-1.5 text-sm"><span className="text-muted">Released</span><span className={deal.escrow?.releasedAt ? 'text-emerald-600 font-medium' : 'text-muted'}>{deal.escrow?.releasedAt ? 'Yes' : 'Held'}</span></div>
            </div>

            <div className="card p-5 flex flex-col h-96">
              <h3 className="font-display font-bold text-ink mb-3">Messages</h3>
              <div className="flex-1 overflow-y-auto space-y-2 no-scrollbar">
                {messages.length === 0 ? <p className="text-xs text-muted text-center py-6">No messages yet. Say hello 👋</p>
                  : messages.map((m, i) => (
                    <div key={i} className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${m.senderRole === role ? 'ml-auto bg-brand-600 text-white' : 'bg-bg text-ink'}`}>{m.body}</div>
                  ))}
              </div>
              <div className="flex gap-2 mt-3">
                <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder="Type a message…" className="flex-1 border border-line rounded-lg px-3 py-2 text-sm" />
                <button onClick={send} className="btn-brand px-3"><Send className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

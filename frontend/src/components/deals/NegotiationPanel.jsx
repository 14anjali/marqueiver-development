import { useState } from 'react';
import { Handshake, Check, Clock } from '../icons';
import { api } from '../../lib/api';
import { Spinner, useToast } from '../../lib/ui-state';
import { rupee } from '../../lib/normalize';

/**
 * Negotiation workspace (scope §12).
 *
 * Everything required by §12 is rendered from backend data — current offer,
 * proposed amount, deliverables, deadline, terms, accept/counter/reject
 * actions, full offer history with who proposed what and when, and a clear
 * current-state indicator. Nothing here is hardcoded.
 *
 * The panel is only shown while terms are actually open (`invited` /
 * `negotiating`); once a deal is accepted the history stays visible but the
 * actions disappear, because reopening agreed terms is an unresolved question
 * in scope §15.
 */

const OPEN_STATES = ['negotiating'];

const STATUS_STYLE = {
  proposed: 'pill-live',
  accepted: 'pill-done',
  rejected: 'pill bg-rose-50 text-rose-600',
  expired: 'pill-quiet',
};

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export default function NegotiationPanel({ deal, role, onUpdated }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [countering, setCountering] = useState(false);
  const [form, setForm] = useState({
    amount: deal.terms?.amount ?? 0,
    deliverables: deal.terms?.deliverables ?? '',
    deadline: deal.terms?.deadline ? new Date(deal.terms.deadline).toISOString().slice(0, 10) : '',
    expiresAt: '',
    note: '',
  });

  const offers = [...(deal.offers || [])].sort((a, b) => b.seq - a.seq);
  // §4 — multiple offers may be open at once, from either party.
  const pending = offers.filter((o) => o.status === 'proposed');
  const forMe = pending.filter((o) => o.byRole !== role);
  const mine = pending.filter((o) => o.byRole === role);
  const isOpen = OPEN_STATES.includes(deal.state);

  const accepted = offers.find((o) => o.status === 'accepted');
  const myConfirm = deal.termsConfirmation?.[role]?.at;
  const theirConfirm = deal.termsConfirmation?.[role === 'brand' ? 'creator' : 'brand']?.at;

  async function run(key, fn) {
    setBusy(key);
    try {
      const { data } = await fn();
      onUpdated(data);
      toast.push('Updated', 'success');
      setCountering(false);
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  const accept = (id) => run('accept' + id, () => api.acceptOffer(deal._id, id));
  const reject = (id) => run('reject' + id, () => api.rejectOffer(deal._id, id));
  const confirm = () => run('confirm', () => api.confirmTerms(deal._id));
  const counter = () => {
    const amount = Number(form.amount);
    if (!amount || amount < 0) { toast.push('Enter a valid amount', 'error'); return; }
    return run('counter', () => api.createOffer(deal._id, {
      amount,
      deliverables: form.deliverables,
      deadline: form.deadline || undefined,
      expiresAt: form.expiresAt || undefined,
      note: form.note || undefined,
    }));
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h3 className="font-display font-bold text-ink flex items-center gap-2">
          <Handshake className="w-5 h-5 text-brand-600" /> Negotiation
        </h3>
        {/* §12 — clear current-state indicator. */}
        <span className={forMe.length || (accepted && !myConfirm) ? 'pill-live' : 'pill-quiet'}>
          {!isOpen ? (deal.termsConfirmation?.agreedAt ? 'Terms agreed' : deal.state)
            : accepted && !myConfirm ? 'Your confirmation needed'
            : forMe.length ? `${forMe.length} offer${forMe.length > 1 ? 's' : ''} to review`
            : mine.length ? 'Waiting on the other party'
            : 'No open offers'}
        </span>
      </div>

      {/* §5 — an accepted offer still needs BOTH parties to confirm before
          terms are agreed and locked. */}
      {accepted && !deal.termsConfirmation?.agreedAt && (
        <div className="wash p-4 mb-4">
          <div className="text-xs text-muted">Accepted offer #{accepted.seq} — awaiting confirmation</div>
          <div className="money-lg mt-1">{rupee(accepted.amount)}</div>
          <p className="text-sm text-muted mt-1">
            {accepted.deliverables || 'No deliverables specified'}
            {accepted.deadline ? `, due ${fmtDate(accepted.deadline)}` : ''}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {myConfirm ? (
              <span className="pill-done"><Check className="w-3 h-3" /> You confirmed</span>
            ) : (
              <button onClick={confirm} disabled={!!busy} className="btn-cta">
                {busy === 'confirm' ? <Spinner /> : 'Confirm terms'}
              </button>
            )}
            <span className={theirConfirm ? 'pill-done' : 'pill-quiet'}>
              {theirConfirm ? 'Other party confirmed' : 'Waiting on the other party'}
            </span>
          </div>
          <p className="text-xs text-muted mt-3">
            Once both sides confirm, the amount, deliverables, deadline and revision limit are locked.
          </p>
        </div>
      )}

      {/* Offers awaiting your response. There may be several at once (§4). */}
      {isOpen && forMe.length > 0 && (
        <div className="space-y-3">
          {forMe.map((o) => (
            <div key={o._id} className="wash p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-muted">Offer #{o.seq} from the {o.byRole}</span>
                <span className="text-xs text-muted">
                  {o.expiresAt ? `expires ${fmtDate(o.expiresAt)}` : fmtDate(o.createdAt)}
                </span>
              </div>
              <div className="money-lg mt-1">{rupee(o.amount)}</div>
              <dl className="mt-3 space-y-1.5 text-sm">
                <Term label="Deliverables" value={o.deliverables || '—'} />
                <Term label="Deadline" value={fmtDate(o.deadline)} />
                <Term label="Revisions allowed" value={o.revisionsAllowed ?? '—'} />
                {o.note && <Term label="Note" value={o.note} />}
              </dl>
              <div className="flex flex-wrap gap-2 mt-4">
                <button onClick={() => accept(o._id)} disabled={!!busy} className="btn-cta">
                  {busy === 'accept' + o._id ? <Spinner /> : 'Accept'}
                </button>
                <button onClick={() => reject(o._id)} disabled={!!busy} className="btn-ghost text-rose-500 border-rose-200">
                  Decline this offer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Your own open offers. They cannot be withdrawn (§4). */}
      {isOpen && mine.length > 0 && (
        <p className="text-sm text-muted mt-3">
          You have {mine.length} offer{mine.length > 1 ? 's' : ''} awaiting a response. Offers cannot be
          withdrawn once sent — send a different one if the terms have changed.
        </p>
      )}

      {isOpen && (
        <div className="mt-4">
          {!countering ? (
            <button onClick={() => setCountering(true)} className="btn-outline">
              {pending.length ? 'Send another offer' : 'Send an offer'}
            </button>
          ) : (
            <div className="mt-2 border-t border-line pt-4 space-y-3">
              <Field label="Amount (₹)">
                <input
                  type="number" min="0" value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="field tnum"
                />
              </Field>
              <Field label="Deliverables">
                <input
                  value={form.deliverables}
                  onChange={(e) => setForm({ ...form, deliverables: e.target.value })}
                  placeholder="2 reels, 3 stories"
                  className="field"
                />
              </Field>
              <Field label="Deadline">
                <input
                  type="date" value={form.deadline}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  className="field"
                />
              </Field>
              <Field label="Offer expires (optional)">
                <input
                  type="date" value={form.expiresAt}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                  className="field"
                />
              </Field>
              <Field label="Note (optional)">
                <textarea
                  rows={2} value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="Why you are proposing these terms"
                  className="field"
                />
              </Field>
              <div className="flex gap-2">
                <button onClick={counter} disabled={!!busy} className="btn-cta">
                  {busy === 'counter' ? <Spinner /> : 'Send offer'}
                </button>
                <button onClick={() => setCountering(false)} className="btn-ghost">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* §11/§12 — full history: who offered what, and when. Nothing is dropped. */}
      {offers.length > 0 && (
        <div className="mt-6 border-t border-line pt-4">
          <h4 className="text-sm font-semibold text-ink mb-3">Offer history</h4>
          <ol className="space-y-3">
            {offers.map((o) => (
              <li key={o._id || o.seq} className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-full bg-bg border border-line text-muted flex items-center justify-center shrink-0 text-[11px] font-bold tnum">
                  {o.seq}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="money text-sm">{rupee(o.amount)}</span>
                    <span className="text-xs text-muted">from the {o.byRole}</span>
                    <span className={STATUS_STYLE[o.status] || 'pill-quiet'}>{o.status}</span>
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {o.deliverables || 'No deliverables specified'}
                    {o.deadline ? ` · due ${fmtDate(o.deadline)}` : ''}
                  </div>
                  <div className="text-[11px] text-muted/80 mt-0.5 inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {o.createdAt ? new Date(o.createdAt).toLocaleString() : ''}
                    {o.reconstructed && ' · reconstructed from the original terms'}
                  </div>
                  {o.note && <p className="text-xs text-muted mt-1">{o.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Term({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink font-medium text-right">{value}</dd>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Money } from '../feedback';
import { Lock, Check, Clock } from '../icons';
import { api } from '../../lib/api';
import { openCashfreeCheckout } from '../../lib/cashfree';
import { Spinner, useToast } from '../../lib/ui-state';

/**
 * The advance that starts the collaboration.
 *
 * ── Why this is its own panel ──────────────────────────────────────────────
 *
 * Paying the advance is the single step between agreed terms and work
 * beginning, and until it clears nothing else on the page can happen: no chat,
 * no submission, no deadline running. A button tucked into a row of state
 * transitions reads as one option among several. It is not.
 *
 * ── The five states are the gateway's, not ours ────────────────────────────
 *
 *   pending     the order exists; nobody has opened checkout
 *   initiated   the brand opened checkout — reported by the browser
 *   processing  the gateway is settling it
 *   verified    the gateway confirmed it. Only this unlocks anything.
 *   failed      refused, or did not complete
 *
 * `initiated` is the one the browser reports, and it is worth showing precisely
 * because it is not proof: a creator watching this panel should be able to tell
 * "they have started paying" from "the money has arrived", and those are
 * different facts with different consequences.
 */

const STATE_LABEL = {
  pending: 'Not started',
  initiated: 'Payment started',
  processing: 'Processing',
  verified: 'Verified',
  failed: 'Failed',
  // Legacy spelling on rows written before the states were named.
  success: 'Verified',
};

const STATE_PILL = {
  pending: 'pill-quiet',
  initiated: 'pill-live',
  processing: 'pill-live',
  verified: 'pill-done',
  success: 'pill-done',
  failed: 'pill bg-rose-50 text-rose-600',
};

const when = (d) => (d ? new Date(d).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
}) : '');

/** The attempt that matters: the latest advance payment. */
const latestAdvance = (records = []) => [...records]
  .filter((t) => t.type === 'escrow_fund' && t.tranche !== 'balance')
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] ?? null;

export default function AdvancePayment({ deal, role, onUpdated }) {
  const toast = useToast();
  const [records, setRecords] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.paymentRecords(deal._id);
      setRecords(data ?? []);
    } catch { setRecords([]); }
  }, [deal._id]);

  useEffect(() => { load(); }, [load]);

  const sched = deal.escrow?.schedule ?? {};
  const pct = sched.advancePct ?? 50;
  const isBrand = role === 'brand';
  const advanceFunded = Boolean(sched.advance?.funded ?? deal.escrow?.funded);

  const current = latestAdvance(records ?? []);
  const state = current?.status ?? 'pending';
  const failed = state === 'failed';
  const attempts = (records ?? []).filter((t) => t.type === 'escrow_fund' && t.tranche !== 'balance').length;

  /**
   * Paying and retrying are the same call — a fresh order against the same
   * collaboration. There is no separate "retry" endpoint, because a retry is
   * not a different act; treating it as one is how the two paths drift apart.
   */
  async function pay() {
    setBusy('pay');
    try {
      const { data } = await api.createPaymentSession(deal._id);
      if (data.gateway === 'mock') {
        toast.push('Mock mode: no real payment was taken', 'info');
      } else {
        // Tell the server checkout is open before handing the browser over, so
        // the creator sees "payment started" even if the brand never returns.
        await api.markPaymentInitiated(deal._id).catch(() => {});
        const result = await openCashfreeCheckout(data.paymentSessionId);
        if (!result.ok) { toast.push(result.message, 'error'); setBusy(''); await load(); return; }
      }
      /*
        Deliberately NOT marking anything paid here. The browser returning from
        checkout is not confirmation — the signature-verified webhook is, and it
        may land a moment later. So this refreshes and shows whatever is true.
      */
      toast.push('Payment submitted — waiting for the gateway to confirm it', 'info');
      await load();
      onUpdated?.(null);
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  if (advanceFunded) {
    return (
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display font-bold text-ink inline-flex items-center gap-2">
            <Check className="w-4 h-4 text-jade-700" /> Advance paid
          </h3>
          <span className="pill-done">Verified</span>
        </div>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          The {pct}% advance is in escrow{sched.advance?.fundedAt ? ` since ${when(sched.advance.fundedAt)}` : ''}.
          The collaboration is active and messaging is open.
        </p>
        <p className="text-xs text-muted mt-2.5 leading-relaxed">
          The remaining {100 - pct}% is released after the work is approved. Collecting it is
          not switched on yet.
        </p>
      </section>
    );
  }

  return (
    <section className="card overflow-hidden">
      <header className="px-5 py-4 border-b border-line bg-money-50/60 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display font-bold text-ink inline-flex items-center gap-2">
          <Lock className="w-4 h-4 text-money-700" /> Advance payment
        </h3>
        <span className={STATE_PILL[state] ?? 'pill-quiet'}>{STATE_LABEL[state] ?? state}</span>
      </header>

      <div className="p-5 space-y-4">
        <p className="text-sm text-muted leading-relaxed">
          {isBrand
            ? `The collaboration starts once the ${pct}% advance is in escrow and the payment partner confirms it. Until then messaging stays locked.`
            : `The brand pays a ${pct}% advance into escrow before work starts. Messaging opens when the payment partner confirms it — nothing is needed from you.`}
        </p>

        {/* The three figures, read from the frozen schedule — never recomputed. */}
        <dl className="rounded-xl2 border border-line divide-y divide-line">
          <Row
            label={isBrand ? 'Total collaboration value' : 'Total creator fee'}
            value={isBrand ? deal.escrow?.amount : sched.creatorNet}
            strong
          />
          <Row
            label={`${pct}% advance`}
            value={isBrand ? sched.advance?.amount : sched.creatorAdvance}
            sub={isBrand ? 'Due now' : 'Released to you when work starts'}
            strong
          />
          <Row
            label={`Remaining ${100 - pct}%`}
            value={isBrand ? sched.balance?.amount : sched.creatorBalance}
            sub="After the work is approved"
          />
        </dl>

        {failed && (
          <div className="rounded-xl2 border border-rose-200 bg-rose-50 p-3.5">
            <p className="text-sm font-semibold text-rose-800">The payment did not go through</p>
            <p className="text-xs text-rose-800/90 mt-1 leading-relaxed">
              {deal.escrow?.lastFailure?.reason || 'The payment partner refused the payment.'}
              {' '}The collaboration has not started and nothing has been charged.
            </p>
            {deal.escrow?.needsAdminReview && (
              <p className="text-xs text-rose-800/90 mt-2 leading-relaxed">
                This has failed {attempts} times, so our team is looking at it. You can still
                try again.
              </p>
            )}
          </div>
        )}

        {isBrand ? (
          <button onClick={pay} disabled={!!busy} className="btn-money w-full py-3">
            {busy === 'pay'
              ? <><Spinner className="w-4 h-4" /> Opening checkout…</>
              : failed ? 'Try the payment again'
              : state === 'initiated' ? 'Continue the payment'
              : <>Pay the advance{sched.advance?.amount > 0 && <> · <Money amount={sched.advance.amount} className="text-sm" /></>}</>}
          </button>
        ) : (
          <p className="text-xs text-muted leading-relaxed">
            {failed
              ? 'The brand has been told the payment failed and can try again.'
              : state === 'initiated' || state === 'processing'
                ? 'The brand has started the payment. You will be notified when it clears.'
                : 'Waiting for the brand to pay the advance.'}
          </p>
        )}

        {/* ── payment record ──────────────────────────────────────────── */}
        {records?.length > 0 && (
          <div className="border-t border-line pt-4">
            <h4 className="text-sm font-semibold text-ink mb-2.5">Payment record</h4>
            <ol className="space-y-2.5">
              {records.map((t) => (
                <li key={t._id} className="text-xs">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-ink">
                      <Money amount={t.amount} className="text-xs" />
                      {t.tranche ? ` · ${t.tranche}` : ''}
                      {t.meta?.attempt > 1 ? ` · attempt ${t.meta.attempt}` : ''}
                    </span>
                    <span className={STATE_PILL[t.status] ?? 'pill-quiet'}>
                      {STATE_LABEL[t.status] ?? t.status}
                    </span>
                  </div>
                  {/* Every state this payment passed through, and who moved it. */}
                  {t.history?.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {t.history.map((h, i) => (
                        <li key={i} className="text-[11px] text-muted inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 shrink-0" />
                          {STATE_LABEL[h.status] ?? h.status} · {when(h.at)}
                          {h.by ? ` · ${h.by}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

function Row({ label, value, sub, strong }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3.5 py-2.5">
      <div className="min-w-0">
        <div className={`text-sm ${strong ? 'font-semibold text-ink' : 'text-muted'}`}>{label}</div>
        {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
      </div>
      <div className="shrink-0">
        {value != null ? <Money amount={value} className="text-sm" /> : <span className="text-muted text-sm">—</span>}
      </div>
    </div>
  );
}
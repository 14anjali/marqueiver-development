import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { ErrorBlock } from '../../../lib/ui-state';
import { Money, Skeleton, StatusPill } from '../../feedback';
import { Wallet } from '../../icons';
import { SectionCard } from '../shared';

/**
 * What this brand owes, what is held in escrow, and what has been settled.
 *
 * ── Derived, not stored ────────────────────────────────────────────────────
 *
 * Every number here comes from two endpoints that already exist:
 * `GET /api/deals` (the brand's own collaborations) and
 * `GET /api/payments/transactions` (the ledger). Nothing new is persisted and
 * no aggregate endpoint was added — a second source of truth for money is how
 * a ledger and a summary end up disagreeing.
 *
 * ── The pay action deliberately leaves ─────────────────────────────────────
 *
 * "Pay now" is a link to the deal, not a checkout launched from here. Escrow
 * funding is a sequence — `POST /deals/:id/payment-session` → Cashfree hosted
 * checkout → the gateway's webhook confirms and activates the deal — and it
 * lives in `DealDetailPage`. Duplicating it here would mean two copies of that
 * sequence to keep in step, and the failure mode if they ever drifted is a
 * brand whose money left but whose collaboration never started.
 *
 * ── States ─────────────────────────────────────────────────────────────────
 *
 * `escrow_pending` is the only state where the brand owes money: terms are
 * agreed and the 48-hour funding window is running. `fundingOverdue` means
 * that window closed and Policy A50 hands the decision to an admin — so the
 * row says so instead of offering a pay button that the server would refuse.
 */

const DUE_STATE = 'escrow_pending';

/** Deal states where money is already in escrow but not yet settled. */
const IN_ESCROW = new Set(['in_progress', 'submitted', 'revision', 'resolution', 'disputed']);

const TYPE_LABEL = {
  escrow_fund: 'Funded into escrow',
  escrow_release: 'Released to creator',
  refund: 'Refunded to you',
  payout: 'Payout',
  fee: 'Platform fee',
};

const TXN_STATUS = {
  success: { status: 'completed', label: 'Paid' },
  pending: { status: 'escrow_pending', label: 'Pending' },
  failed: { status: 'disputed', label: 'Failed' },
  reversed: { status: 'cancelled', label: 'Reversed' },
};

const dateOf = (v) => (v
  ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '');

export default function CampaignPayments() {
  const [deals, setDeals] = useState(null);
  const [txns, setTxns] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    Promise.all([api.myDeals(), api.transactions()])
      .then(([d, t]) => {
        if (!alive) return;
        setDeals(d.data ?? []);
        setTxns(t.data ?? []);
      })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [nonce]);

  const groups = useMemo(() => {
    if (!deals) return null;
    return {
      due: deals.filter((d) => d.state === DUE_STATE),
      escrow: deals.filter((d) => IN_ESCROW.has(d.state) && d.escrow?.funded),
      settled: deals.filter((d) => d.state === 'completed' || d.escrow?.releasedAt),
    };
  }, [deals]);

  const totals = useMemo(() => {
    if (!groups || !txns) return null;
    const paid = txns.filter((t) => t.status === 'success');
    return {
      due: groups.due.reduce((s, d) => s + (Number(d.terms?.amount) || 0), 0),
      inEscrow: groups.escrow.reduce((s, d) => s + (Number(d.escrow?.amount) || 0), 0),
      released: paid.filter((t) => t.type === 'escrow_release').reduce((s, t) => s + (t.amount || 0), 0),
      refunded: paid.filter((t) => t.type === 'refund').reduce((s, t) => s + (t.amount || 0), 0),
    };
  }, [groups, txns]);

  // Both requests are awaited together: showing the totals before the deals
  // arrive would flash a "Due now ₹0" that then jumps.
  const loading = !deals || !txns;

  if (error) {
    return (
      <SectionCard title="Campaign payments">
        <ErrorBlock error={error} onRetry={() => setNonce((n) => n + 1)} />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Campaign payments"
        description="What you owe, what is held in escrow, and what has been settled."
        actions={<Link to="/deals" className="btn-outline text-sm">Open deals</Link>}
      >
        {loading ? (
          <div aria-busy="true" aria-live="polite" aria-label="Loading campaign payments" className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl2" />)}
            </div>
            <Skeleton className="h-16 w-full rounded-xl2" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Total label="Due now" amount={totals.due} tone={totals.due > 0 ? 'warn' : 'money'} />
              <Total label="In escrow" amount={totals.inEscrow} />
              <Total label="Released" amount={totals.released} />
              <Total label="Refunded" amount={totals.refunded} />
            </div>

            <div className="mt-6 space-y-6">
              <Group
                title="Awaiting payment"
                blurb="Terms are agreed. The collaboration starts once the money is in escrow."
                deals={groups.due}
                empty="Nothing is awaiting payment."
                showPay
              />
              <Group
                title="Held in escrow"
                blurb="Paid and held by Marqueiver. It reaches the creator when you approve the work."
                deals={groups.escrow}
                empty="Nothing is currently held in escrow."
              />
              <Group
                title="Settled"
                blurb="Released to the creator, or returned to you."
                deals={groups.settled}
                empty="No settled collaborations yet."
                limit={5}
              />
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Payment history"
        description="Every escrow funding, release and refund on your account, with its gateway reference."
      >
        {loading ? (
          <div aria-busy="true" aria-live="polite" aria-label="Loading payment history" className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <Skeleton className="h-4 w-40 max-w-full rounded" />
                <Skeleton className="h-4 w-20 rounded ml-auto" />
              </div>
            ))}
          </div>
        ) : !txns.length ? (
          <div className="rounded-xl2 border border-dashed border-line bg-bg/60 p-8 text-center">
            <span className="w-12 h-12 rounded-xl2 bg-white border border-line grid place-items-center mx-auto">
              <Wallet className="w-5 h-5 text-brand-400" />
            </span>
            <p className="font-display font-bold text-ink mt-4">No payments yet</p>
            <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-sm mx-auto">
              When you fund your first collaboration into escrow it appears here, with every
              release and refund that follows.
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {txns.slice(0, 50).map((t) => {
                const s = TXN_STATUS[t.status] ?? { status: 'pending_review', label: t.status };
                return (
                  <li key={t._id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-ink truncate">{TYPE_LABEL[t.type] ?? t.type}</p>
                      <p className="text-xs text-muted">
                        {dateOf(t.createdAt)}
                        {t.gateway && t.gateway !== 'mock' && ` · ${t.gateway}`}
                      </p>
                      {/*
                        The gateway reference is what a brand quotes to its bank
                        or to support. Shown only when the gateway actually
                        returned one — a mock run has no reference worth citing.
                      */}
                      {t.gatewayRef && t.gateway !== 'mock' && (
                        <p className="text-[11px] text-muted mt-0.5 font-mono break-all">{t.gatewayRef}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Money amount={t.amount} className="!text-sm" />
                      <StatusPill status={s.status} label={s.label} />
                    </div>
                  </li>
                );
              })}
            </ul>

            {txns.length > 50 && (
              <p className="text-xs text-muted mt-3">Showing the 50 most recent of {txns.length}.</p>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}

function Group({ title, blurb, deals, empty, showPay = false, limit }) {
  const shown = limit ? deals.slice(0, limit) : deals;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display font-bold text-ink">{title}</p>
        <span className="text-xs text-muted tnum">{deals.length}</span>
      </div>
      <p className="text-xs text-muted mt-0.5 leading-relaxed">{blurb}</p>

      {!deals.length ? (
        <p className="text-sm text-muted mt-3 rounded-xl2 border border-dashed border-line bg-bg/60 px-4 py-5">
          {empty}
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {shown.map((d) => <DealRow key={d._id} deal={d} showPay={showPay} />)}
        </ul>
      )}

      {limit && deals.length > limit && (
        <p className="text-xs text-muted mt-2.5">
          Showing {limit} of {deals.length}. <Link to="/deals" className="text-brand-700 font-semibold">See all</Link>
        </p>
      )}
    </div>
  );
}

function DealRow({ deal: d, showPay }) {
  const amount = Number(d.escrow?.amount) || Number(d.terms?.amount) || 0;
  // A50 — once the funding window has passed, funding is blocked until an admin
  // acts, so offering "Pay now" here would send the brand to a refusal.
  const overdue = showPay && d.fundingOverdue;

  return (
    <li className="rounded-xl2 border border-line bg-white p-3.5 hover:border-brand-200 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink truncate">{d.title || 'Collaboration'}</p>
          <p className="text-xs text-muted mt-0.5">
            {d.escrow?.fundedAt
              ? `Funded ${dateOf(d.escrow.fundedAt)}`
              : d.escrowFundingDeadline
                ? `Payment due by ${dateOf(d.escrowFundingDeadline)}`
                : dateOf(d.updatedAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Money amount={amount} className="!text-sm" />
          <StatusPill status={d.state} />
        </div>
      </div>

      {showPay && (
        <div className="mt-3 pt-3 border-t border-line flex flex-wrap items-center gap-2.5">
          {overdue ? (
            <p className="text-xs text-rose-600 leading-relaxed">
              The funding window has passed. A Marqueiver admin has to reopen this collaboration
              before it can be paid.
            </p>
          ) : (
            <>
              <Link to={`/deals/${d._id}`} className="btn-money text-xs">Pay now</Link>
              <span className="text-[11px] text-muted">
                Opens the collaboration, where payment is taken on Cashfree&apos;s secure checkout.
              </span>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Total({ label, amount, tone = 'money' }) {
  return (
    <div className={`rounded-xl2 p-4 text-center ${
      tone === 'warn' ? 'border border-rose-100 bg-rose-50/60' : 'panel-money'}`}
    >
      <p className={`text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide sm:tracking-wider
                     break-words leading-snug ${tone === 'warn' ? 'text-rose-600' : 'text-money-700'}`}
      >
        {label}
      </p>
      <p className="font-display font-extrabold text-lg text-ink mt-1">
        <Money amount={amount} className="!text-lg" />
      </p>
    </div>
  );
}
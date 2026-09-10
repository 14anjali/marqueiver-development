import { useState, useEffect } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import AppPage from '../components/AppPage';
import { Modal } from '../components/overlay';
import { Money, AnimatedNumber, StatusPill, SuccessMark, Progress } from '../components/feedback';
import { Wallet, Check } from '../components/icons';
import { api } from '../lib/api';
import { Spinner, useToast, EmptyBlock } from '../lib/ui-state';
import { rupee } from '../lib/normalize';
import { TOKEN, axis, grid, tooltip, rupeeAxis } from '../lib/chart-theme';

/**
 * Wallet, earnings and withdrawals.
 *
 * The most consequential screen a creator has, and the withdrawal flow was a
 * hand-rolled overlay with no focus trap, no Escape, no validation until submit,
 * and a bare "Enter a valid amount" toast that did not say what was wrong. It
 * now runs through the shared `Modal` and validates as you type.
 *
 * The balance tile keeps its gradient — it is the one figure on the page a
 * creator opens this screen to see. Everything else is ochre or quiet, because
 * three competing gradients is how a page stops having a subject.
 */

const TYPE_LABEL = {
  escrow_fund: 'Escrow funded',
  escrow_release: 'Payment released',
  refund: 'Refund',
  payout: 'Withdrawal',
  fee: 'Platform fee',
};

/** Transaction status → the shared pill vocabulary. */
const TXN_STATUS = {
  success: 'completed',
  pending: 'escrow_pending',
  failed: 'disputed',
  reversed: 'cancelled',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function WithdrawModal({ wallet, hasPayoutMethod, onClose, onDone }) {
  const [step, setStep] = useState(hasPayoutMethod ? 'amount' : 'method');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState({
    type: 'bank', accountHolderName: '', bankAccount: '', ifsc: '', vpa: '',
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const toast = useToast();

  const balance = wallet?.balance ?? 0;
  const amt = Number(amount);

  /**
   * Validated as the amount is typed, with the specific reason.
   *
   * "Enter a valid amount within your balance" covers four different mistakes
   * and tells you which one you made only by elimination.
   */
  const amountError = amount === '' ? null
    : !Number.isFinite(amt) ? 'Enter a number.'
      : amt <= 0 ? 'Enter an amount greater than zero.'
        : amt > balance ? `That is more than your balance of ${rupee(balance)}.`
          : null;
  const amountValid = amount !== '' && !amountError;

  const methodValid = method.accountHolderName.trim().length > 1 && (
    method.type === 'bank'
      ? method.bankAccount.trim().length >= 6 && /^[A-Z]{4}0[A-Z0-9]{6}$/i.test(method.ifsc.trim())
      : /^[\w.\-]{2,}@[\w.\-]{2,}$/.test(method.vpa.trim())
  );

  async function saveMethod() {
    setBusy(true);
    try { await api.setPayoutMethod(method); setStep('amount'); }
    catch (e) { toast.push(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function submitWithdraw() {
    if (!amountValid) return;
    setBusy(true);
    try {
      await api.withdraw(amt);
      // Held on a success state rather than closing instantly: money left the
      // wallet, and the confirmation is the point.
      setDone(true);
      setTimeout(onDone, 1400);
    } catch (e) { toast.push(e.message, 'error'); setBusy(false); }
  }

  if (done) {
    return (
      <Modal open onClose={onDone} dismissible={false} size="sm">
        <div className="text-center py-4">
          <SuccessMark className="w-14 h-14 mx-auto mb-4" />
          <h2 className="font-display font-extrabold text-lg text-ink">Withdrawal started</h2>
          <p className="text-sm text-muted mt-2 leading-relaxed">
            <Money amount={amt} /> is on its way to your{' '}
            {method.type === 'upi' ? 'UPI ID' : 'bank account'}. Cashfree usually
            settles within one working day.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      size="sm"
      title={step === 'method' ? 'Add a payout method' : 'Withdraw'}
      description={step === 'method'
        ? 'Where the money should go. Stored against your account and never shown to brands.'
        : undefined}
    >
      {step === 'method' ? (
        <form onSubmit={(e) => { e.preventDefault(); methodValid && saveMethod(); }}>
          <div className="flex rounded-lg border border-line overflow-hidden text-sm mb-4" role="tablist">
            {['bank', 'upi'].map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={method.type === t}
                onClick={() => setMethod((m) => ({ ...m, type: t }))}
                className={`flex-1 py-2.5 font-semibold uppercase tracking-wide transition-colors ${
                  method.type === t ? 'bg-brand-600 text-white' : 'text-muted hover:bg-bg'}`}
              >
                {t}
              </button>
            ))}
          </div>

          <label htmlFor="holder" className="field-label">Account holder name</label>
          <input
            id="holder" value={method.accountHolderName}
            onChange={(e) => setMethod((m) => ({ ...m, accountHolderName: e.target.value }))}
            placeholder="As it appears on the account" className="field mb-3"
          />

          {method.type === 'bank' ? (
            <>
              <label htmlFor="acct" className="field-label">Account number</label>
              <input
                id="acct" value={method.bankAccount} inputMode="numeric"
                onChange={(e) => setMethod((m) => ({ ...m, bankAccount: e.target.value }))}
                className="field mb-3"
              />
              <label htmlFor="ifsc" className="field-label">IFSC</label>
              <input
                id="ifsc" value={method.ifsc}
                onChange={(e) => setMethod((m) => ({ ...m, ifsc: e.target.value.toUpperCase() }))}
                placeholder="ABCD0123456" maxLength={11} className="field"
              />
              <p className="text-xs text-muted mt-1.5">Eleven characters — four letters, a zero, then six.</p>
            </>
          ) : (
            <>
              <label htmlFor="vpa" className="field-label">UPI ID</label>
              <input
                id="vpa" value={method.vpa}
                onChange={(e) => setMethod((m) => ({ ...m, vpa: e.target.value }))}
                placeholder="name@bank" className="field"
              />
            </>
          )}

          <button type="submit" disabled={busy || !methodValid} className="btn-cta w-full mt-5">
            {busy ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save and continue'}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); submitWithdraw(); }}>
          <div className="panel-money mb-4 flex items-baseline justify-between">
            <span className="text-xs text-money-700">Available</span>
            <Money amount={balance} className="text-lg" />
          </div>

          <label htmlFor="amt" className="field-label">Amount</label>
          <input
            id="amt" value={amount} onChange={(e) => setAmount(e.target.value)}
            type="number" inputMode="decimal" min="1" max={balance}
            placeholder="0" autoFocus
            aria-invalid={Boolean(amountError)}
            aria-describedby="amt-msg"
            className={`field tnum ${amountError ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : ''}`}
          />
          <div id="amt-msg" className="flex justify-between items-baseline gap-3 mt-1.5 mb-2">
            <span className={`text-xs ${amountError ? 'text-rose-600' : 'text-muted'}`}>
              {amountError ?? 'Cashfree settles to your account, usually within a working day.'}
            </span>
            {balance > 0 && (
              <button
                type="button"
                onClick={() => setAmount(String(balance))}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 shrink-0 focusable"
              >
                Withdraw all
              </button>
            )}
          </div>

          {amountValid && (
            <Progress
              value={amt} max={balance} tone="money"
              label="Share of your balance" className="mb-4"
            />
          )}

          <button type="submit" disabled={busy || !amountValid} className="btn-money w-full">
            {busy ? <><Spinner className="w-4 h-4" /> Starting…</> : `Withdraw ${amountValid ? rupee(amt) : ''}`}
          </button>
          <button
            type="button" onClick={() => setStep('method')}
            className="text-xs text-muted hover:text-ink w-full text-center mt-3 focusable py-1"
          >
            Change payout method
          </button>
        </form>
      )}
    </Modal>
  );
}

export default function EarningsPage() {
  const [summary, setSummary] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [profile, setProfile] = useState(null);
  const [txns, setTxns] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showWithdraw, setShowWithdraw] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [e, t, w, p, a] = await Promise.all([
        api.earnings(), api.transactions(), api.getWallet(), api.myProfile(), api.analytics(),
      ]);
      setSummary(e.data); setTxns(t.data || []); setWallet(w.data); setProfile(p.data); setAnalytics(a.data);
    } catch (err) { setError(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const chartData = (analytics?.earningsByMonth || []).map((d) => ({ name: MONTHS[d.month - 1], amount: d.total }));
  const balance = wallet?.balance ?? 0;
  const payout = profile?.payoutMethod;

  return (
    <>
      <AppPage
        title="Wallet and earnings"
        description="Released escrow lands in your wallet immediately. Withdrawals go to your bank or UPI through Cashfree."
        width="max-w-[900px]"
        loading={loading}
        error={error}
        onRetry={load}
        isEmpty={false}
        actions={wallet && (
          <button
            onClick={() => setShowWithdraw(true)}
            disabled={!balance}
            className="btn-money"
            title={balance ? undefined : 'Nothing to withdraw yet'}
          >
            <Wallet className="w-4 h-4" /> Withdraw
          </button>
        )}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-5">
          {/* The one figure this page exists for. */}
          <div className="rounded-xl2 p-5 text-white shadow-raised bg-gradient-to-br from-brand-600 via-brand-700 to-pink-500">
            <div className="text-xs text-white/80">Wallet balance</div>
            <div className="font-display font-extrabold text-3xl mt-1 tnum">
              <AnimatedNumber value={balance} format={rupee} />
            </div>
            <div className="text-[11px] text-white/70 mt-1">Available to withdraw</div>
          </div>

          <div className="card p-5">
            <div className="text-xs text-muted">Earned, lifetime</div>
            <div className="font-display font-extrabold text-2xl text-ink mt-1 tnum">
              <AnimatedNumber value={summary?.totalEarned ?? 0} format={rupee} />
            </div>
            <div className="text-[11px] text-muted mt-1">
              Across {summary?.completedDeals ?? 0} completed collaboration{summary?.completedDeals === 1 ? '' : 's'}
            </div>
          </div>

          <div className="panel-money">
            <div className="text-xs text-money-700">Held in escrow</div>
            <div className="font-display font-extrabold text-2xl text-money-700 mt-1 tnum">
              <AnimatedNumber value={summary?.pendingPayout ?? 0} format={rupee} />
            </div>
            <div className="text-[11px] text-muted mt-1">Releases when work is approved</div>
          </div>
        </div>

        {chartData.length > 0 && (
          <section className="card p-4 sm:p-5 mb-5">
            <h2 className="font-display font-bold text-ink text-sm mb-3">Earnings by month</h2>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                <defs>
                  <linearGradient id="earn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={TOKEN.brand} stopOpacity={0.32} />
                    <stop offset="95%" stopColor={TOKEN.brand} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...grid} />
                <XAxis dataKey="name" {...axis} />
                <YAxis {...axis} tickFormatter={rupeeAxis} width={52} />
                <Tooltip {...tooltip} formatter={(v) => [rupee(v), 'Earned']} />
                <Area
                  type="monotone" dataKey="amount" stroke={TOKEN.brand} strokeWidth={2}
                  fill="url(#earn)" isAnimationActive={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </section>
        )}

        {payout?.type ? (
          <div className="card p-4 mb-5 flex items-center gap-3">
            <span className="w-9 h-9 rounded-full bg-jade-50 text-jade-600 grid place-items-center shrink-0" aria-hidden="true">
              <Check className="w-4 h-4" />
            </span>
            <div className="flex-1 text-sm min-w-0">
              <span className="font-medium text-ink">Paying out to </span>
              <span className="text-muted">
                {payout.type === 'upi'
                  ? payout.vpa
                  : `account ending ${payout.bankAccount?.slice(-4)}`}
              </span>
            </div>
            <button onClick={() => setShowWithdraw(true)} className="text-xs font-medium text-brand-600 hover:text-brand-700 shrink-0 focusable px-2 py-1">
              Change
            </button>
          </div>
        ) : (
          <div className="wash p-4 mb-5 text-sm text-ink flex items-center gap-3 flex-wrap">
            <span className="flex-1 min-w-[200px]">
              No payout method yet — add one so your balance can reach you.
            </span>
            <button onClick={() => setShowWithdraw(true)} className="btn-outline text-sm">
              Add payout method
            </button>
          </div>
        )}

        <section className="card p-4 sm:p-5">
          <h2 className="font-display font-bold text-ink text-sm mb-1">Transactions</h2>
          {!txns.length ? (
            <EmptyBlock
              title="No transactions yet"
              sub="Payments appear here once a collaboration reaches escrow funding or release."
            />
          ) : (
            <div className="divide-y divide-line -mx-1">
              {txns.map((t) => (
                <div key={t._id} className="flex items-center gap-3 py-3 px-1">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink">{TYPE_LABEL[t.type] || t.type}</div>
                    <div className="text-xs text-muted tnum mt-0.5">
                      {new Date(t.createdAt).toLocaleString('en-IN')}
                    </div>
                  </div>
                  <StatusPill status={TXN_STATUS[t.status] ?? t.status} />
                  {/* Credits and debits read differently at a glance. */}
                  <span className={`font-display font-bold tnum text-sm w-24 text-right shrink-0 ${
                    t.type === 'payout' || t.type === 'fee' ? 'text-muted' : 'text-ink'}`}
                  >
                    {t.type === 'payout' || t.type === 'fee' ? '−' : '+'}{rupee(t.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </AppPage>

      {showWithdraw && wallet && (
        <WithdrawModal
          wallet={wallet}
          hasPayoutMethod={Boolean(payout?.type)}
          onClose={() => setShowWithdraw(false)}
          onDone={() => { setShowWithdraw(false); load(); }}
        />
      )}
    </>
  );
}

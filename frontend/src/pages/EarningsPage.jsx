import { useState, useEffect } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import AppShell from '../components/AppShell';
import { Wallet, X, Check } from '../components/icons';
import { api } from '../lib/api';
import { LoadingBlock, ErrorBlock, EmptyBlock, Spinner, useToast } from '../lib/ui-state';
import { rupee } from '../lib/normalize';

const TYPE_LABEL = {
  escrow_fund: 'Escrow funded', escrow_release: 'Payment released',
  refund: 'Refund', payout: 'Withdrawal', fee: 'Platform fee',
};
const STATUS_STYLE = {
  success: 'bg-emerald-50 text-emerald-600', pending: 'bg-amber-50 text-amber-600',
  failed: 'bg-rose-50 text-rose-600', reversed: 'bg-slate-100 text-slate-600',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function WithdrawModal({ wallet, hasPayoutMethod, onClose, onDone }) {
  const [step, setStep] = useState(hasPayoutMethod ? 'amount' : 'method');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState({ type: 'bank', accountHolderName: '', bankAccount: '', ifsc: '', vpa: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function saveMethod() {
    setBusy(true);
    try { await api.setPayoutMethod(method); setStep('amount'); }
    catch (e) { toast.push(e.message, 'error'); } finally { setBusy(false); }
  }
  async function submitWithdraw() {
    const amt = Number(amount);
    if (!amt || amt > wallet.balance) { toast.push('Enter a valid amount within your balance', 'error'); return; }
    setBusy(true);
    try { await api.withdraw(amt); toast.push('Withdrawal initiated ✓', 'success'); onDone(); }
    catch (e) { toast.push(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-lg text-ink">{step === 'method' ? 'Add payout method' : 'Withdraw'}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>
        {step === 'method' ? (
          <div className="space-y-3">
            <div className="flex rounded-lg border border-line overflow-hidden text-sm">
              {['bank', 'upi'].map((t) => (
                <button key={t} onClick={() => setMethod((m) => ({ ...m, type: t }))}
                  className={`flex-1 py-2 font-medium uppercase transition ${method.type === t ? 'bg-brand-600 text-white' : 'text-muted hover:bg-bg'}`}>{t}</button>
              ))}
            </div>
            <input value={method.accountHolderName} onChange={(e) => setMethod((m) => ({ ...m, accountHolderName: e.target.value }))}
              placeholder="Account holder name" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            {method.type === 'bank' ? (
              <>
                <input value={method.bankAccount} onChange={(e) => setMethod((m) => ({ ...m, bankAccount: e.target.value }))}
                  placeholder="Bank account number" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
                <input value={method.ifsc} onChange={(e) => setMethod((m) => ({ ...m, ifsc: e.target.value }))}
                  placeholder="IFSC code" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </>
            ) : (
              <input value={method.vpa} onChange={(e) => setMethod((m) => ({ ...m, vpa: e.target.value }))}
                placeholder="UPI ID (e.g. name@bank)" className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            )}
            <button onClick={saveMethod} disabled={busy} className="btn-cta w-full">{busy ? <Spinner className="w-4 h-4" /> : 'Save & continue'}</button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-muted">Available balance: <span className="font-semibold text-ink">{rupee(wallet.balance)}</span></div>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="Amount (₹)"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            <button onClick={submitWithdraw} disabled={busy} className="btn-cta w-full">{busy ? <Spinner className="w-4 h-4" /> : `Withdraw ${amount ? rupee(amount) : ''}`}</button>
            <button onClick={() => setStep('method')} className="text-xs text-muted hover:text-ink w-full text-center">Change payout method</button>
          </div>
        )}
      </div>
    </div>
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

  return (
    <AppShell>
      <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <h1 className="font-display font-extrabold text-2xl text-ink">Wallet & Earnings</h1>
          {wallet && <button onClick={() => setShowWithdraw(true)} disabled={!wallet.balance} className="btn-cta disabled:opacity-40"><Wallet className="w-4 h-4" /> Withdraw</button>}
        </div>
        <p className="text-muted text-sm mb-5">Escrow releases credit your wallet instantly; withdrawals go to your bank/UPI via Cashfree.</p>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={load} /> : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="card p-5 bg-gradient-to-br from-brand-600 to-pink-500 text-white">
                <div className="text-xs text-white/80">Wallet Balance</div>
                <div className="font-display font-extrabold text-3xl mt-1">{rupee(wallet?.balance)}</div>
                <div className="text-[11px] text-white/70 mt-1">Available to withdraw</div>
              </div>
              <div className="card p-5">
                <div className="text-xs text-muted">Total earned (lifetime)</div>
                <div className="font-display font-extrabold text-2xl text-emerald-600 mt-1">{rupee(summary?.totalEarned)}</div>
              </div>
              <div className="card p-5">
                <div className="text-xs text-muted">Pending in escrow</div>
                <div className="font-display font-extrabold text-2xl text-pink-500 mt-1">{rupee(summary?.pendingPayout)}</div>
              </div>
            </div>

            {chartData.length > 0 && (
              <div className="card p-5 mb-6">
                <h3 className="font-display font-bold text-ink mb-3">Earnings by month</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="earn" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#7C3AED" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EAECF0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v / 1000}k`} />
                    <Tooltip formatter={(v) => rupee(v)} contentStyle={{ borderRadius: 8, border: '1px solid #EAECF0', fontSize: 12 }} />
                    <Area isAnimationActive={false} type="monotone" dataKey="amount" stroke="#7C3AED" strokeWidth={2} fill="url(#earn)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {profile?.payoutMethod?.type && (
              <div className="card p-4 mb-6 flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center"><Check className="w-4 h-4" /></span>
                <div className="flex-1 text-sm">
                  <span className="font-medium text-ink">Payout method: </span>
                  <span className="text-muted uppercase">{profile.payoutMethod.type}</span>
                  {profile.payoutMethod.type === 'upi' ? <span className="text-muted"> · {profile.payoutMethod.vpa}</span> : <span className="text-muted"> · ...{profile.payoutMethod.bankAccount?.slice(-4)}</span>}
                </div>
                <button onClick={() => setShowWithdraw(true)} className="text-xs text-brand-600 font-medium">Change</button>
              </div>
            )}

            <div className="card p-5">
              <h3 className="font-display font-bold text-ink mb-3">Transaction history</h3>
              {!txns.length ? (
                <EmptyBlock title="No transactions yet" sub="Payments appear here once a deal reaches escrow funding or release." />
              ) : (
                <div className="divide-y divide-line">
                  {txns.map((t) => (
                    <div key={t._id} className="flex items-center gap-3 py-3">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-ink">{TYPE_LABEL[t.type] || t.type}</div>
                        <div className="text-xs text-muted">{new Date(t.createdAt).toLocaleString('en-IN')}</div>
                      </div>
                      <span className={`pill capitalize ${STATUS_STYLE[t.status] || 'bg-bg text-muted'}`}>{t.status}</span>
                      <span className="font-semibold text-ink w-24 text-right">{rupee(t.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {showWithdraw && wallet && (
          <WithdrawModal wallet={wallet} hasPayoutMethod={!!profile?.payoutMethod?.type}
            onClose={() => setShowWithdraw(false)} onDone={() => { setShowWithdraw(false); load(); }} />
        )}
      </div>
    </AppShell>
  );
}

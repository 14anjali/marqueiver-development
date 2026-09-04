import { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell';
import { api } from '../../lib/api';
import { LoadingBlock, ErrorBlock } from '../../lib/ui-state';
import { rupee } from '../../lib/normalize';

const StatCard = ({ label, value, accent }) => (
  <div className="card p-5">
    <div className="text-sm text-muted">{label}</div>
    <div className={`font-display font-extrabold text-2xl mt-1 ${accent || 'text-ink'}`}>{value}</div>
  </div>
);

export default function AdminWallets() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.adminWallets(); setData(data); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <AdminShell>
      <div className="max-w-[1000px] mx-auto px-4 sm:px-6 py-6">
        <h1 className="font-display font-extrabold text-2xl text-ink mb-1">Wallets</h1>
        <p className="text-muted text-sm mb-5">Internal wallet ledger — funds held before creators withdraw via Cashfree.</p>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={load} /> : !data ? (
          <ErrorBlock error={{ message: 'Received an unexpected response from the server.' }} onRetry={load} />
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <StatCard label="Total held (unwithdrawn)" value={rupee(data.totalBalance)} accent="text-brand-600" />
              <StatCard label="Lifetime credited" value={rupee(data.totalCredited)} accent="text-emerald-600" />
              <StatCard label="Lifetime withdrawn" value={rupee(data.totalWithdrawn)} accent="text-pink-600" />
              <StatCard label="Active wallets" value={data.walletCount} />
            </div>

            <div className="card p-5">
              <h3 className="font-display font-bold text-ink mb-3">Top balances</h3>
              {!data.topWallets?.length ? <p className="text-sm text-muted">No wallets yet.</p> : (
                <div className="divide-y divide-line">
                  {data.topWallets.map((w) => (
                    <div key={w._id} className="flex items-center justify-between py-2.5 text-sm">
                      <span className="text-ink">{w.user?.phone || w.user?.email || 'Unknown'}</span>
                      <span className="font-semibold text-ink">{rupee(w.balance)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}

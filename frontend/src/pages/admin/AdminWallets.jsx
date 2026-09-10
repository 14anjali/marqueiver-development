import { useState, useEffect } from 'react';
import AdminPage from '../../components/AdminPage';
import { AdminList, AdminRow } from '../../components/AdminPage';
import { AnimatedNumber, Money, Progress } from '../../components/feedback';
import { api } from '../../lib/api';
import { rupee } from '../../lib/normalize';

/**
 * The internal wallet ledger — money held before creators withdraw it.
 *
 * Ochre is money everywhere in this system, so the figure that is actually
 * *ours to hold* gets the money surface and the money type, and the historical
 * totals beside it do not. Before, all four tiles looked identical and the one
 * that represents a live liability was indistinguishable from two numbers that
 * only ever go up.
 *
 * The withdrawn/credited ratio is drawn as a bar because that is the shape of
 * the question someone opens this page with — how much of what we have taken in
 * is still sitting here.
 */

/**
 * A figure tile.
 *
 * `money` marks the one that is a liability rather than a statistic. Figures
 * count up on load: these change between visits, and the movement is the
 * information.
 */
const Tile = ({ label, value, sub, money = false, isCount = false }) => (
  <div className={money ? 'panel-money' : 'card p-4'}>
    <div className="text-xs text-muted">{label}</div>
    <div className={`mt-1.5 font-display font-extrabold text-xl sm:text-2xl tnum ${money ? 'text-money-700' : 'text-ink'}`}>
      {isCount
        ? <AnimatedNumber value={value ?? 0} />
        : <AnimatedNumber value={value ?? 0} format={(n) => rupee(n)} />}
    </div>
    {sub && <div className="text-[11px] text-muted mt-1 leading-snug">{sub}</div>}
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

  // A malformed response is a different failure from a network one, and the
  // page must not render `undefined` into money tiles.
  const shapeError = !loading && !error && !data
    ? { message: 'The server returned an unexpected response for wallets.' }
    : null;

  const credited = data?.totalCredited ?? 0;
  const withdrawn = data?.totalWithdrawn ?? 0;

  return (
    <AdminPage
      title="Wallets"
      description="Funds held on the platform before creators withdraw them through Cashfree. Held balances are a liability, not revenue."
      loading={loading}
      error={error ?? shapeError}
      onRetry={load}
      isEmpty={false}
      skeletonRows={3}
    >
      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
            <Tile
              label="Held, not yet withdrawn"
              value={data.totalBalance}
              sub="Owed to creators"
              money
            />
            <Tile label="Lifetime credited" value={credited} />
            <Tile label="Lifetime withdrawn" value={withdrawn} />
            <Tile label="Active wallets" value={data.walletCount} isCount />
          </div>

          {credited > 0 && (
            <div className="card p-4 mb-5">
              <Progress
                value={withdrawn}
                max={credited}
                tone="money"
                label="Withdrawn against lifetime credited"
              />
              <p className="text-xs text-muted mt-2.5">
                <Money amount={credited - withdrawn} /> is still on the platform.
              </p>
            </div>
          )}

          <h2 className="font-display font-bold text-ink mb-2.5 text-sm">Largest balances</h2>
          {!data.topWallets?.length ? (
            <div className="card p-5 text-sm text-muted">
              No wallets carry a balance yet.
            </div>
          ) : (
            <AdminList>
              {data.topWallets.map((w) => (
                <AdminRow key={w._id}>
                  <span className="flex-1 text-sm text-ink truncate">
                    {w.user?.phone || w.user?.email || 'Unknown account'}
                  </span>
                  <Money amount={w.balance} className="text-sm shrink-0" />
                </AdminRow>
              ))}
            </AdminList>
          )}
        </>
      )}
    </AdminPage>
  );
}

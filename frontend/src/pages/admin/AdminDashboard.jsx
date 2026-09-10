import { useState, useEffect } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, LabelList,
} from 'recharts';
import AdminPage from '../../components/AdminPage';
import { AnimatedNumber } from '../../components/feedback';
import { api } from '../../lib/api';
import { rupee } from '../../lib/normalize';
import { TOKEN, axis, grid, tooltip, line, bar, rupeeAxis, stateLabel } from '../../lib/chart-theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Platform overview.
 *
 * Two changes worth naming, both information design rather than decoration:
 *
 *  1. **Deals-by-state was a twelve-slice pie.** It is now ordered horizontal
 *     bars in one hue. Magnitude belongs on a common baseline, and the pie
 *     forced identity into colour across twelve categories — three of which
 *     were misspelled state names that never rendered at all. See
 *     lib/chart-theme.js for why a status palette was rejected here.
 *
 *  2. **Six identical tiles.** Open disputes and the verification queue are
 *     work waiting to be done; total users is a statistic. They no longer look
 *     the same, and a non-zero dispute count is the one thing on the page that
 *     announces itself.
 */

/**
 * A figure.
 *
 * `alert` is for counts that mean somebody has to act. It engages only when the
 * count is non-zero — a permanently red tile stops being read.
 */
const Tile = ({ label, value, format, alert = false, money = false, sub }) => {
  const live = alert && Number(value) > 0;
  return (
    <div className={`p-4 rounded-xl2 border transition-colors ${
      live ? 'border-rose-200 bg-rose-50/60'
        : money ? 'border-money-100 bg-money-50/50'
          : 'border-line bg-white shadow-card'}`}
    >
      <div className={`text-xs ${live ? 'text-rose-600 font-medium' : 'text-muted'}`}>{label}</div>
      <div className={`mt-1 font-display font-extrabold text-2xl tnum ${
        live ? 'text-rose-600' : money ? 'text-money-700' : 'text-ink'}`}
      >
        <AnimatedNumber value={Number(value) || 0} format={format} />
      </div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
};

/** A chart in a panel, with its own empty state so a blank box never ships. */
const Panel = ({ title, hint, empty, children }) => (
  <section className="card p-4 sm:p-5">
    <h2 className="font-display font-bold text-ink text-sm">{title}</h2>
    {hint && <p className="text-xs text-muted mt-0.5 mb-3">{hint}</p>}
    {empty
      ? <p className="text-sm text-muted py-10 text-center">{empty}</p>
      : <div className={hint ? '' : 'mt-3'}>{children}</div>}
  </section>
);

export default function AdminDashboard() {
  const [overview, setOverview] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [o, a] = await Promise.all([api.adminOverview(), api.adminAnalytics()]);
      setOverview(o.data); setAnalytics(a.data);
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // A 200 with an unexpected body must not crash the page reading into it.
  const shapeError = !loading && !error && (!overview || !analytics)
    ? { message: 'The server returned an unexpected response for the dashboard.' }
    : null;

  const usersChart = (analytics?.usersByMonth || []).map((d) => ({ name: MONTHS[d.month - 1], users: d.value }));
  const gmvChart = (analytics?.gmvByMonth || []).map((d) => ({ name: MONTHS[d.month - 1], gmv: d.value }));

  // Ordered by count: a magnitude chart that is not sorted makes the reader do
  // the sorting.
  const stateData = (analytics?.dealsByState || [])
    .map((d) => ({ name: stateLabel(d.state), value: d.count }))
    .sort((a, b) => b.value - a.value);

  const txnData = (analytics?.transactionsByType || [])
    .map((t) => ({ name: stateLabel(t.type), total: t.total }))
    .sort((a, b) => b.total - a.total);

  return (
    <AdminPage
      title="Platform overview"
      description="Live figures across the marketplace. Disputes and the verification queue are work waiting on someone."
      loading={loading}
      error={error ?? shapeError}
      onRetry={load}
      isEmpty={false}
      width="max-w-[1400px]"
      skeletonRows={2}
    >
      {overview && analytics && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
            <Tile label="Total users" value={overview.totalUsers} />
            <Tile
              label="Creators / brands"
              value={overview.creators}
              format={(n) => `${n.toLocaleString('en-IN')} / ${(overview.brands ?? 0).toLocaleString('en-IN')}`}
            />
            <Tile label="Active deals" value={overview.activeDeals} />
            <Tile label="Open disputes" value={overview.openDisputes} alert sub={overview.openDisputes > 0 ? 'Needs a decision' : 'None open'} />
            <Tile label="Verification queue" value={overview.verificationQueue} alert sub={overview.verificationQueue > 0 ? 'Waiting on review' : 'Clear'} />
            <Tile label="Platform GMV" value={overview.gmv} format={rupee} money sub="Released escrow" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <Panel
              title="User growth"
              hint="New accounts per month"
              empty={!usersChart.length && 'Not enough history yet — this fills in after the first full month.'}
            >
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={usersChart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid {...grid} />
                  <XAxis dataKey="name" {...axis} />
                  <YAxis {...axis} allowDecimals={false} width={40} />
                  <Tooltip {...tooltip} />
                  <Line dataKey="users" name="New users" {...line(TOKEN.brand)} />
                </LineChart>
              </ResponsiveContainer>
            </Panel>

            <Panel
              title="GMV by month"
              hint="Escrow released to creators"
              empty={!gmvChart.length && 'No escrow has been released yet.'}
            >
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={gmvChart} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                  <CartesianGrid {...grid} />
                  <XAxis dataKey="name" {...axis} />
                  <YAxis {...axis} tickFormatter={rupeeAxis} width={52} />
                  <Tooltip {...tooltip} formatter={(v) => [rupee(v), 'Released']} />
                  <Line dataKey="gmv" name="GMV" {...line(TOKEN.money)} />
                </LineChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel
              title="Deals by state"
              hint="Ordered by count. State names come from the deal state machine."
              empty={!stateData.length && 'No deals yet.'}
            >
              <ResponsiveContainer width="100%" height={Math.max(200, stateData.length * 34)}>
                <BarChart data={stateData} layout="vertical" margin={{ left: 4, right: 32 }}>
                  <CartesianGrid {...grid} vertical horizontal={false} />
                  <XAxis type="number" {...axis} allowDecimals={false} hide />
                  <YAxis type="category" dataKey="name" {...axis} width={132} />
                  <Tooltip {...tooltip} formatter={(v) => [v, 'Deals']} />
                  <Bar dataKey="value" {...bar(TOKEN.brand)}>
                    {/* Direct labels, so the count is read rather than estimated. */}
                    <LabelList dataKey="value" position="right" style={{ fill: TOKEN.muted, fontSize: 11 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel
              title="Transaction volume"
              hint="Total value by transaction type"
              empty={!txnData.length && 'No transactions yet.'}
            >
              <ResponsiveContainer width="100%" height={Math.max(200, txnData.length * 34)}>
                <BarChart data={txnData} layout="vertical" margin={{ left: 4, right: 56 }}>
                  <CartesianGrid {...grid} vertical horizontal={false} />
                  <XAxis type="number" {...axis} tickFormatter={rupeeAxis} hide />
                  <YAxis type="category" dataKey="name" {...axis} width={132} />
                  <Tooltip {...tooltip} formatter={(v) => [rupee(v), 'Total']} />
                  <Bar dataKey="total" {...bar(TOKEN.money)}>
                    <LabelList dataKey="total" position="right" formatter={rupeeAxis} style={{ fill: TOKEN.muted, fontSize: 11 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>
        </>
      )}
    </AdminPage>
  );
}

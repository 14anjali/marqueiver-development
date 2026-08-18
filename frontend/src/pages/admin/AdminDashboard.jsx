import { useState, useEffect } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, BarChart, Bar, Legend } from 'recharts';
import AdminShell from '../../components/AdminShell';
import { api } from '../../lib/api';
import { LoadingBlock, ErrorBlock } from '../../lib/ui-state';
import { rupee } from '../../lib/normalize';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATE_COLORS = {
  invited: '#94A3B8', negotiating: '#F59E0B', accepted: '#3B82F6', escrow_funded: '#7C3AED',
  in_progress: '#6366F1', submitted: '#06B6D4', revision: '#FB923C', completed: '#10B981',
  disputed: '#EF4444', cancelled: '#CBD5E1',
};

const StatCard = ({ label, value, accent }) => (
  <div className="card p-5">
    <div className="text-sm text-muted">{label}</div>
    <div className={`font-display font-extrabold text-3xl mt-1 ${accent || 'text-ink'}`}>{value}</div>
  </div>
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

  if (loading) return <AdminShell><LoadingBlock label="Loading platform data…" /></AdminShell>;
  if (error) return <AdminShell><div className="max-w-2xl mx-auto py-10"><ErrorBlock error={error} onRetry={load} /></div></AdminShell>;
  // Defensive: a 200 response with an unexpected/empty body (misconfigured
  // proxy, stale cache, etc.) should not crash the page reading into it.
  if (!overview || !analytics) return <AdminShell><div className="max-w-2xl mx-auto py-10"><ErrorBlock error={{ message: 'Received an unexpected response from the server.' }} onRetry={load} /></div></AdminShell>;

  const usersChart = (analytics.usersByMonth || []).map((d) => ({ name: MONTHS[d.month - 1], users: d.value }));
  const gmvChart = (analytics.gmvByMonth || []).map((d) => ({ name: MONTHS[d.month - 1], gmv: d.value }));
  const stateData = (analytics.dealsByState || []).map((d) => ({ name: d.state.replace('_', ' '), value: d.count, color: STATE_COLORS[d.state] || '#94A3B8' }));
  const txnTypeData = (analytics.transactionsByType || []).map((t) => ({ name: t.type.replace('_', ' '), total: t.total }));

  return (
    <AdminShell>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        <h1 className="font-display font-extrabold text-2xl text-ink mb-1">Platform Overview</h1>
        <p className="text-muted text-sm mb-5">Real-time metrics across the whole marketplace.</p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total Users" value={overview.totalUsers} accent="text-brand-600" />
          <StatCard label="Creators / Brands" value={`${overview.creators} / ${overview.brands}`} />
          <StatCard label="Active Deals" value={overview.activeDeals} accent="text-emerald-600" />
          <StatCard label="Open Disputes" value={overview.openDisputes} accent={overview.openDisputes > 0 ? 'text-rose-600' : 'text-ink'} />
          <StatCard label="Verification Queue" value={overview.verificationQueue} accent="text-amber-600" />
          <StatCard label="Platform GMV" value={rupee(overview.gmv)} accent="text-pink-600" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
          <div className="card p-5">
            <h3 className="font-display font-bold text-ink mb-3">User growth</h3>
            {usersChart.length === 0 ? <p className="text-sm text-muted">Not enough history yet.</p> : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={usersChart}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EAECF0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #EAECF0', fontSize: 12 }} />
                  <Line isAnimationActive={false} type="monotone" dataKey="users" stroke="#7C3AED" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="card p-5">
            <h3 className="font-display font-bold text-ink mb-3">GMV by month (released escrow)</h3>
            {gmvChart.length === 0 ? <p className="text-sm text-muted">Not enough history yet.</p> : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={gmvChart}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EAECF0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v / 1000}k`} />
                  <Tooltip formatter={(v) => rupee(v)} contentStyle={{ borderRadius: 8, border: '1px solid #EAECF0', fontSize: 12 }} />
                  <Line isAnimationActive={false} type="monotone" dataKey="gmv" stroke="#EC4899" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card p-5">
            <h3 className="font-display font-bold text-ink mb-3">Deals by state</h3>
            {stateData.length === 0 ? <p className="text-sm text-muted">No deals yet.</p> : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie isAnimationActive={false} data={stateData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={95} paddingAngle={2}>
                    {stateData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #EAECF0', fontSize: 12 }} />
                  <Legend verticalAlign="bottom" height={48} wrapperStyle={{ fontSize: 11, textTransform: 'capitalize' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="card p-5">
            <h3 className="font-display font-bold text-ink mb-3">Transaction volume by type</h3>
            {txnTypeData.length === 0 ? <p className="text-sm text-muted">No transactions yet.</p> : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={txnTypeData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#EAECF0" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v / 1000}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} width={90} className="capitalize" />
                  <Tooltip formatter={(v) => rupee(v)} contentStyle={{ borderRadius: 8, border: '1px solid #EAECF0', fontSize: 12 }} />
                  <Bar isAnimationActive={false} dataKey="total" fill="#7C3AED" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

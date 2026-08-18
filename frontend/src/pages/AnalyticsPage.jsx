import { useState, useEffect } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import AppShell from '../components/AppShell';
import { Platform } from '../components/icons';
import { api } from '../lib/api';
import { LoadingBlock, ErrorBlock, EmptyBlock } from '../lib/ui-state';
import { rupee } from '../lib/normalize';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PIE_COLORS = ['#7C3AED', '#EC4899', '#F59E0B', '#10B981', '#0EA5E9', '#6366F1'];

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.analytics(); setData(data); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const dealsChart = (data?.dealsByMonth || []).map((d) => ({ name: MONTHS[d.month - 1], deals: d.count }));
  const earningsChart = (data?.earningsByMonth || []).map((d) => ({ name: MONTHS[d.month - 1], amount: d.total }));
  const platformPie = (data?.platformBreakdown || []).map((p) => ({ name: p.platform, value: p.followers }));

  return (
    <AppShell>
      <div className="max-w-[1000px] mx-auto px-4 sm:px-6 py-6">
        <h1 className="font-display font-extrabold text-2xl text-ink mb-1">Analytics</h1>
        <p className="text-muted text-sm mb-5">Real data from your connected accounts and deal history.</p>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={load} /> : !data ? (
          <ErrorBlock error={{ message: 'Received an unexpected response from the server.' }} onRetry={load} />
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Total audience" value={(data.totalAudience ?? 0).toLocaleString('en-IN')} />
              <StatCard label="Avg. engagement" value={`${data.avgEngagement ?? 0}%`} />
              <StatCard label="Creator score" value={`${data.creatorScore ?? 0}/100`} />
              <StatCard label="Avg. rating" value={data.reviews?.count ? `${data.reviews.average.toFixed(1)} ★ (${data.reviews.count})` : '—'} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-5">
              <div className="card p-5">
                <h3 className="font-display font-bold text-ink mb-3">Platform breakdown</h3>
                {!data.platformBreakdown?.length ? (
                  <EmptyBlock title="No social accounts connected" sub="Connect Instagram or another platform from onboarding to see your reach here." />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {data.platformBreakdown.map((p) => (
                      <div key={p.platform} className="flex items-center gap-3 p-3 rounded-lg border border-line">
                        <Platform name={p.platform} className="w-8 h-8" />
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-ink capitalize">{p.platform}</div>
                          <div className="text-xs text-muted">{(p.followers ?? 0).toLocaleString('en-IN')} followers · {p.engagementRate ?? 0}% eng.</div>
                        </div>
                        <span className="pill bg-bg text-muted capitalize">{p.dataSource === 'connected' ? 'live' : 'self-reported'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {platformPie.length > 0 && (
                <div className="card p-5 flex flex-col items-center">
                  <h3 className="font-display font-bold text-ink mb-2 self-start text-sm">Audience share</h3>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie isAnimationActive={false} data={platformPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                        {platformPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => v.toLocaleString('en-IN')} contentStyle={{ borderRadius: 8, border: '1px solid #EAECF0', fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-2 justify-center mt-2">
                    {platformPie.map((p, i) => (
                      <span key={p.name} className="inline-flex items-center gap-1 text-[10px] text-muted capitalize">
                        <span className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />{p.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="card p-5">
                <h3 className="font-display font-bold text-ink mb-3">Deals by month</h3>
                {!dealsChart.length ? <p className="text-sm text-muted">Not enough history yet.</p> : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={dealsChart}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EAECF0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #EAECF0', fontSize: 12 }} />
                      <Bar isAnimationActive={false} dataKey="deals" fill="#7C3AED" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="card p-5">
                <h3 className="font-display font-bold text-ink mb-3">Earnings by month</h3>
                {!earningsChart.length ? <p className="text-sm text-muted">Not enough history yet.</p> : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={earningsChart}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EAECF0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v / 1000}k`} />
                      <Tooltip formatter={(v) => rupee(v)} contentStyle={{ borderRadius: 8, border: '1px solid #EAECF0', fontSize: 12 }} />
                      <Bar isAnimationActive={false} dataKey="amount" fill="#EC4899" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <p className="text-xs text-muted">
              Follower-growth-over-time isn't shown because we don't yet store a daily snapshot of your
              social stats — only your current numbers and real deal/earnings history are available.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-display font-extrabold text-xl text-ink mt-1">{value}</div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { SectionTitle } from '../components/ui';
import { Users, Handshake, Mail, Send, ChevRight, Star } from '../components/icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LoadingBlock } from '../lib/ui-state';
import { rupee } from '../lib/normalize';

const StatCard = ({ label, value, sub, accent }) => (
  <div className="card p-5">
    <div className="text-sm text-muted">{label}</div>
    <div className={`font-display font-extrabold text-3xl mt-1 ${accent || 'text-ink'}`}>{value}</div>
    {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
  </div>
);

export default function DashboardPage() {
  const { user } = useAuth();
  const isBrand = user?.role !== 'creator';
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState([]);
  const [earnings, setEarnings] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [d, e] = await Promise.allSettled([
          api.myDeals(),
          isBrand ? Promise.resolve(null) : api.earnings(),
        ]);
        if (d.status === 'fulfilled') setDeals(d.value.data || []);
        if (e.status === 'fulfilled' && e.value) setEarnings(e.value.data);
      } catch { /* offline — show zeros */ } finally { setLoading(false); }
    })();
  }, [isBrand]);

  const active = deals.filter((d) => ['escrow_funded', 'in_progress', 'submitted', 'revision'].includes(d.state)).length;
  const completed = deals.filter((d) => d.state === 'completed').length;
  const creatorsReached = new Set(deals.map((d) => d.creator)).size;

  return (
    <AppShell>
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display font-extrabold text-2xl text-ink">Welcome back{user?.role ? `, ${user.role}` : ''} 👋</h1>
            <p className="text-muted text-sm mt-1">Here's what's happening with your {isBrand ? 'campaigns' : 'collaborations'}.</p>
          </div>
          <Link to="/discover" className="btn-cta">{isBrand ? 'Find Creators' : 'Find Brands'} <Send className="w-4 h-4" /></Link>
        </div>

        {loading ? <LoadingBlock /> : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <StatCard label="Active Deals" value={active} sub="in progress" accent="text-brand-600" />
              <StatCard label="Completed" value={completed} sub="all time" />
              {isBrand
                ? <><StatCard label="Total Deals" value={deals.length} /><StatCard label="Creators Reached" value={creatorsReached} sub="unique creators" accent="text-pink-500" /></>
                : <><StatCard label="Total Earned" value={rupee(earnings?.totalEarned || 0)} accent="text-emerald-600" /><StatCard label="Pending Payout" value={rupee(earnings?.pendingPayout || 0)} sub="in escrow" accent="text-pink-500" /></>}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 card p-5">
                <SectionTitle action={<Link to="/deals" className="text-sm text-brand-600 inline-flex items-center gap-1">View all <ChevRight className="w-3.5 h-3.5" /></Link>}>Recent Deals</SectionTitle>
                {deals.length === 0 ? (
                  <div className="text-center py-10 text-muted text-sm">No deals yet. <Link to="/discover" className="text-brand-600">Start by finding {isBrand ? 'a creator' : 'a brand'}.</Link></div>
                ) : (
                  <div className="divide-y divide-line">
                    {deals.slice(0, 5).map((d) => (
                      <Link key={d._id} to={`/deals/${d._id}`} className="flex items-center gap-3 py-3 hover:bg-bg -mx-2 px-2 rounded-lg">
                        <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center"><Handshake className="w-4 h-4" /></span>
                        <div className="flex-1 min-w-0"><div className="text-sm font-medium text-ink truncate">{d.title}</div><div className="text-xs text-muted">{rupee(d.terms?.amount)}</div></div>
                        <span className="pill bg-brand-50 text-brand-700 capitalize">{d.state?.replace('_', ' ')}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div className="card p-5">
                <SectionTitle>Quick Actions</SectionTitle>
                <div className="space-y-2">
                  <Link to="/discover" className="flex items-center gap-3 p-3 rounded-lg hover:bg-bg"><Users className="w-5 h-5 text-brand-600" /><span className="text-sm font-medium text-ink">Browse {isBrand ? 'Creators' : 'Brands'}</span></Link>
                  <Link to="/campaigns" className="flex items-center gap-3 p-3 rounded-lg hover:bg-bg"><Send className="w-5 h-5 text-pink-500" /><span className="text-sm font-medium text-ink">{isBrand ? 'Manage Campaigns' : 'Browse Campaigns'}</span></Link>
                  <Link to="/messages" className="flex items-center gap-3 p-3 rounded-lg hover:bg-bg"><Mail className="w-5 h-5 text-emerald-500" /><span className="text-sm font-medium text-ink">Messages</span></Link>
                  <Link to="/deals" className="flex items-center gap-3 p-3 rounded-lg hover:bg-bg"><Handshake className="w-5 h-5 text-amber-500" /><span className="text-sm font-medium text-ink">My Deals</span></Link>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

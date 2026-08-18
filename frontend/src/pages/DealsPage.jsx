import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { Handshake, ChevRight } from '../components/icons';
import { api } from '../lib/api';
import { LoadingBlock, ErrorBlock, EmptyBlock } from '../lib/ui-state';
import { rupee } from '../lib/normalize';

const STATE_STYLE = {
  invited: 'bg-slate-100 text-slate-600', negotiating: 'bg-amber-50 text-amber-600',
  accepted: 'bg-blue-50 text-blue-600', escrow_funded: 'bg-violet-50 text-violet-600',
  in_progress: 'bg-indigo-50 text-indigo-600', submitted: 'bg-cyan-50 text-cyan-600',
  revision: 'bg-orange-50 text-orange-600', completed: 'bg-emerald-50 text-emerald-600',
  disputed: 'bg-rose-50 text-rose-600', cancelled: 'bg-slate-100 text-slate-500',
};
const FILTERS = ['all', 'invited', 'negotiating', 'escrow_funded', 'in_progress', 'submitted', 'completed'];

export default function DealsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deals, setDeals] = useState([]);
  const [filter, setFilter] = useState('all');

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.myDeals(); setDeals(data || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const shown = filter === 'all' ? deals : deals.filter((d) => d.state === filter);

  return (
    <AppShell>
      <div className="max-w-[1100px] mx-auto px-6 py-6">
        <h1 className="font-display font-extrabold text-2xl text-ink mb-1">My Deals</h1>
        <p className="text-muted text-sm mb-5">Every collaboration and its escrow status.</p>

        <div className="flex gap-2 mb-5 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`pill capitalize whitespace-nowrap ${filter === f ? 'bg-brand-600 text-white' : 'bg-white border border-line text-muted'}`}>{f.replace('_', ' ')}</button>
          ))}
        </div>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={load} />
          : shown.length === 0 ? <EmptyBlock title="No deals here" sub="When you invite a creator or get invited, deals show up here." action={<Link to="/discover" className="btn-cta mt-2">Find creators</Link>} />
          : (
            <div className="space-y-3">
              {shown.map((d) => (
                <Link key={d._id} to={`/deals/${d._id}`} className="card p-4 flex items-center gap-4 hover:shadow-cardhover transition">
                  <span className="w-11 h-11 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center"><Handshake className="w-5 h-5" /></span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ink truncate">{d.title}</div>
                    <div className="text-sm text-muted">{rupee(d.terms?.amount)} · {d.contentTypes?.join(', ') || 'Campaign'}</div>
                  </div>
                  <span className={`pill capitalize ${STATE_STYLE[d.state] || 'bg-slate-100 text-slate-600'}`}>{d.state?.replace('_', ' ')}</span>
                  <ChevRight className="w-4 h-4 text-muted" />
                </Link>
              ))}
            </div>
          )}
      </div>
    </AppShell>
  );
}

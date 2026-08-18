import { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell';
import { X } from '../../components/icons';
import { api } from '../../lib/api';
import { LoadingBlock, ErrorBlock, EmptyBlock, Spinner, useToast } from '../../lib/ui-state';
import { rupee } from '../../lib/normalize';

const STATE_STYLE = {
  invited: 'bg-slate-100 text-slate-600', negotiating: 'bg-amber-50 text-amber-600',
  accepted: 'bg-blue-50 text-blue-600', escrow_funded: 'bg-violet-50 text-violet-600',
  in_progress: 'bg-indigo-50 text-indigo-600', submitted: 'bg-cyan-50 text-cyan-600',
  revision: 'bg-orange-50 text-orange-600', completed: 'bg-emerald-50 text-emerald-600',
  disputed: 'bg-rose-50 text-rose-600', cancelled: 'bg-slate-100 text-slate-500',
};
const FILTERS = ['all', 'disputed', 'escrow_funded', 'in_progress', 'submitted', 'completed', 'cancelled'];

function ResolveModal({ deal, onClose, onDone }) {
  const [to, setTo] = useState('completed');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit() {
    if (note.trim().length < 3) { toast.push('Add a note explaining the resolution', 'error'); return; }
    setBusy(true);
    try { await api.adminResolveDeal(deal._id, to, note); toast.push('Deal resolved ✓', 'success'); onDone(); }
    catch (e) { toast.push(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-lg text-ink">Resolve — {deal.title}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Outcome</label>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-white">
              <option value="completed">Release escrow to creator</option>
              <option value="cancelled">Refund escrow to brand</option>
              <option value="in_progress">Send back to in-progress</option>
            </select>
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Resolution note (required)" rows={3}
            className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          <button onClick={submit} disabled={busy} className="btn-cta w-full">{busy ? <Spinner className="w-4 h-4" /> : 'Confirm resolution'}</button>
        </div>
      </div>
    </div>
  );
}

export default function AdminDeals() {
  const [deals, setDeals] = useState([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [resolving, setResolving] = useState(null);

  const load = async (f = filter) => {
    setLoading(true); setError(null);
    try {
      const params = f === 'all' ? {} : f === 'disputed' ? { disputed: 'true' } : { state: f };
      const { data, meta } = await api.adminDeals(params);
      setDeals(data || []); setTotal(meta?.total ?? (data || []).length);
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <AdminShell>
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6">
        <h1 className="font-display font-extrabold text-2xl text-ink mb-1">Deal Oversight</h1>
        <p className="text-muted text-sm mb-5">{total} deals · every state across the platform.</p>

        <div className="flex gap-2 mb-5 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => { setFilter(f); load(f); }} className={`pill capitalize whitespace-nowrap ${filter === f ? 'bg-brand-600 text-white' : 'bg-white border border-line text-muted'}`}>{f.replace('_', ' ')}</button>
          ))}
        </div>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={() => load()} />
          : !deals.length ? <EmptyBlock title="No deals match this filter" />
          : (
            <div className="space-y-3">
              {deals.map((d) => (
                <div key={d._id} className="card p-4 flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <div className="font-semibold text-ink">{d.title}</div>
                    <div className="text-sm text-muted">{rupee(d.terms?.amount)} · updated {new Date(d.updatedAt).toLocaleDateString('en-IN')}</div>
                  </div>
                  <span className={`pill capitalize ${STATE_STYLE[d.state] || 'bg-slate-100 text-slate-600'}`}>{d.state?.replace('_', ' ')}</span>
                  {(d.state === 'disputed' || d.state === 'escrow_funded' || d.state === 'in_progress' || d.state === 'submitted' || d.state === 'revision') && (
                    <button onClick={() => setResolving(d)} className="btn-outline text-sm">Resolve</button>
                  )}
                </div>
              ))}
            </div>
          )}

        {resolving && <ResolveModal deal={resolving} onClose={() => setResolving(null)} onDone={() => { setResolving(null); load(); }} />}
      </div>
    </AdminShell>
  );
}

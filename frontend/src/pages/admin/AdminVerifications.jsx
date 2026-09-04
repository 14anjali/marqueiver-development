import { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell';
import { Check, X } from '../../components/icons';
import { api } from '../../lib/api';
import { LoadingBlock, ErrorBlock, EmptyBlock, Spinner, useToast } from '../../lib/ui-state';

export default function AdminVerifications() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.adminVerifications('pending'); setItems(data || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  async function decide(id, decision) {
    setBusyId(id);
    try {
      await api.adminDecideVerification(id, decision, decision === 'approved' ? 'Docs verified' : 'Docs insufficient');
      setItems((list) => list.filter((v) => v._id !== id));
      toast.push(`Verification ${decision} ✓`, 'success');
    } catch (e) { toast.push(e.message, 'error'); } finally { setBusyId(null); }
  }

  return (
    <AdminShell>
      <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-6">
        <h1 className="font-display font-extrabold text-2xl text-ink mb-1">Verification Queue</h1>
        <p className="text-muted text-sm mb-5">Pending business/GST/social verification requests.</p>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={load} />
          : !items.length ? <EmptyBlock title="Queue is empty" sub="No pending verification requests right now." />
          : (
            <div className="space-y-3">
              {items.map((v) => (
                <div key={v._id} className="card p-4 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="font-semibold text-ink capitalize">{v.kind} verification</div>
                    <div className="text-sm text-muted">{v.subject?.phone || v.subject?.email} · {v.subjectRole}</div>
                    {v.documents?.length > 0 && <div className="text-xs text-brand-600 mt-1">{v.documents.length} document(s) attached</div>}
                  </div>
                  <button onClick={() => decide(v._id, 'approved')} disabled={busyId === v._id} className="btn-brand text-sm">
                    {busyId === v._id ? <Spinner className="w-4 h-4" /> : <><Check className="w-3.5 h-3.5" /> Approve</>}
                  </button>
                  <button onClick={() => decide(v._id, 'rejected')} disabled={busyId === v._id} className="btn-ghost text-sm text-rose-500">
                    <X className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
              ))}
            </div>
          )}
      </div>
    </AdminShell>
  );
}

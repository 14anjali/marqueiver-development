import { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell';
import { Star } from '../../components/icons';
import { api } from '../../lib/api';
import { LoadingBlock, ErrorBlock, EmptyBlock, useToast } from '../../lib/ui-state';

export default function AdminReviews() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.adminListReviews({ limit: 50 }); setReviews(data || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  async function toggleHide(r) {
    try {
      await api.adminModerateReview(r._id, !r.hidden);
      setReviews((list) => list.map((x) => (x._id === r._id ? { ...x, hidden: !x.hidden } : x)));
      toast.push(r.hidden ? 'Review unhidden' : 'Review hidden', 'success');
    } catch (e) { toast.push(e.message, 'error'); }
  }

  return (
    <AdminShell>
      <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-6">
        <h1 className="font-display font-extrabold text-2xl text-ink mb-1">Reviews Moderation</h1>
        <p className="text-muted text-sm mb-5">Every review across the platform — hide anything that violates policy.</p>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={load} />
          : !reviews.length ? <EmptyBlock title="No reviews yet" />
          : (
            <div className="space-y-3">
              {reviews.map((r) => (
                <div key={r._id} className={`card p-4 ${r.hidden ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex gap-0.5">{[...Array(r.rating)].map((_, i) => <Star key={i} className="w-3.5 h-3.5" />)}</div>
                    <button onClick={() => toggleHide(r)} className={`text-xs font-medium ${r.hidden ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {r.hidden ? 'Unhide' : 'Hide'}
                    </button>
                  </div>
                  {r.text && <p className="text-sm text-ink">{r.text}</p>}
                  <div className="text-xs text-muted mt-1">
                    {r.author?.phone || r.author?.email} → {r.target?.phone || r.target?.email} · {new Date(r.createdAt).toLocaleDateString('en-IN')}
                    {r.hidden && <span className="text-rose-500 ml-2">(hidden)</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </AdminShell>
  );
}

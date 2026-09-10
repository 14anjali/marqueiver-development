import { useState, useEffect } from 'react';
import AdminPage from '../../components/AdminPage';
import { AdminRow, AdminList } from '../../components/AdminPage';
import { ConfirmDialog } from '../../components/overlay';
import { StatusPill } from '../../components/feedback';
import { Star } from '../../components/icons';
import { api } from '../../lib/api';
import { useToast } from '../../lib/ui-state';

/**
 * Review moderation.
 *
 * Hiding a review removes a creator's or brand's public reputation signal, and
 * it used to happen on a single unguarded click on a text link — no
 * confirmation, no way back if the wrong row was hit. It now goes through a
 * confirm dialog that quotes the review being hidden, so the moderator sees
 * what they are acting on rather than trusting they clicked the right row.
 *
 * Unhiding is not confirmed: restoring something is not destructive, and a
 * dialog on every toggle would train people to dismiss it.
 */
export default function AdminReviews() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.adminListReviews({ limit: 50 }); setReviews(data || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  async function apply(r) {
    setBusy(true);
    try {
      await api.adminModerateReview(r._id, !r.hidden);
      setReviews((list) => list.map((x) => (x._id === r._id ? { ...x, hidden: !x.hidden } : x)));
      toast.push(r.hidden ? 'Review restored' : 'Review hidden', 'success');
      setConfirming(null);
    } catch (e) { toast.push(e.message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <AdminPage
        title="Review moderation"
        description="Every review across the platform. Hide anything that breaches the community guidelines — the author is not told, and the rating stops counting towards the recipient's average."
        loading={loading}
        error={error}
        onRetry={load}
        isEmpty={!reviews.length}
        emptyTitle="No reviews yet"
        emptySub="Reviews appear once collaborations complete and both sides have rated each other."
        width="max-w-[900px]"
      >
        <AdminList>
          {reviews.map((r) => (
            <AdminRow key={r._id} className={r.hidden ? 'bg-bg/60' : ''}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="flex gap-0.5 text-money-500" aria-label={`${r.rating} out of 5`}>
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={`w-3.5 h-3.5 ${i >= r.rating ? 'opacity-20' : ''}`} />
                    ))}
                  </span>
                  {r.hidden && <StatusPill status="rejected" />}
                </div>

                {r.text
                  ? <p className={`text-sm leading-relaxed ${r.hidden ? 'text-muted line-through decoration-line' : 'text-ink'}`}>{r.text}</p>
                  : <p className="text-sm text-muted italic">Rating only — no written review.</p>}

                <div className="text-xs text-muted mt-2">
                  {r.author?.phone || r.author?.email}
                  <span className="mx-1.5 text-line">→</span>
                  {r.target?.phone || r.target?.email}
                  <span className="mx-1.5 text-line">·</span>
                  <span className="tnum">{new Date(r.createdAt).toLocaleDateString('en-IN')}</span>
                </div>
              </div>

              <button
                onClick={() => (r.hidden ? apply(r) : setConfirming(r))}
                className={`shrink-0 self-start sm:self-auto text-xs font-semibold px-3 py-1.5 rounded-lg
                  transition-colors focusable ${r.hidden
                    ? 'text-jade-600 hover:bg-jade-50'
                    : 'text-rose-500 hover:bg-rose-50'}`}
              >
                {r.hidden ? 'Restore' : 'Hide'}
              </button>
            </AdminRow>
          ))}
        </AdminList>
      </AdminPage>

      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={() => apply(confirming)}
        busy={busy}
        tone="danger"
        title="Hide this review?"
        description={confirming?.text
          ? `“${confirming.text.slice(0, 160)}${confirming.text.length > 160 ? '…' : ''}” — it stops being publicly visible and no longer counts towards the recipient's average.`
          : 'It stops being publicly visible and no longer counts towards the recipient’s average.'}
        confirmLabel="Hide review"
      />
    </>
  );
}

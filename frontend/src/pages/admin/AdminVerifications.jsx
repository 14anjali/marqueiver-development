import { useState, useEffect } from 'react';
import AdminPage, { AdminList, AdminRow } from '../../components/AdminPage';
import { ConfirmDialog } from '../../components/overlay';
import { FileText, ShieldCheck } from '../../components/icons';
import { api } from '../../lib/api';
import { Spinner, useToast } from '../../lib/ui-state';

/**
 * The KYC / verification queue.
 *
 * Both decisions used to send a hardcoded note — "Docs verified" or "Docs
 * insufficient" — regardless of what the reviewer had actually seen. A
 * rejection is the one that matters: the applicant is told why, and "Docs
 * insufficient" gives them nothing to correct, so they resubmit the same thing
 * and the queue grows. Rejecting now requires a reason in the reviewer's own
 * words.
 *
 * Approval stays one click. It is the non-destructive direction, and a queue is
 * worked at speed.
 */
export default function AdminVerifications() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const toast = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.adminVerifications('pending'); setItems(data || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  async function decide(v, decision, note) {
    setBusyId(v._id);
    try {
      await api.adminDecideVerification(v._id, decision, note);
      // Removed from the list rather than re-fetched: the row is decided, and a
      // reload would visibly re-order everything the reviewer is working down.
      setItems((list) => list.filter((x) => x._id !== v._id));
      toast.push(decision === 'approved' ? 'Verification approved' : 'Verification rejected', 'success');
      setRejecting(null); setReason('');
    } catch (e) { toast.push(e.message, 'error'); }
    finally { setBusyId(null); }
  }

  const reasonValid = reason.trim().length >= 4;

  return (
    <>
      <AdminPage
        title="Verification queue"
        description="Pending business, GST and social verification requests. Approving grants the badge that brands and creators use to decide who to work with."
        loading={loading}
        error={error}
        onRetry={load}
        isEmpty={!items.length}
        emptyTitle="Queue is clear"
        emptySub="Nothing is waiting on a decision. New requests appear here as soon as they are submitted."
        width="max-w-[900px]"
        skeletonRows={3}
      >
        <AdminList>
          {items.map((v) => (
            <AdminRow key={v._id}>
              <span
                className="w-10 h-10 rounded-xl2 wash text-brand-500 grid place-items-center shrink-0"
                aria-hidden="true"
              >
                <ShieldCheck className="w-4.5 h-4.5" />
              </span>

              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-ink capitalize">
                  {v.kind} verification
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {v.subject?.phone || v.subject?.email}
                  <span className="mx-1.5 text-line">·</span>
                  <span className="capitalize">{v.subjectRole}</span>
                </div>
                {v.documents?.length > 0 && (
                  <div className="inline-flex items-center gap-1 text-xs text-brand-600 mt-1.5">
                    <FileText className="w-3 h-3" />
                    {v.documents.length} document{v.documents.length === 1 ? '' : 's'} attached
                  </div>
                )}
              </div>

              <div className="flex gap-2 shrink-0 w-full sm:w-auto">
                <button
                  onClick={() => decide(v, 'approved', 'Documents verified')}
                  disabled={busyId === v._id}
                  className="btn-brand text-xs px-3.5 py-2 flex-1 sm:flex-none"
                >
                  {busyId === v._id ? <Spinner className="w-3.5 h-3.5" /> : 'Approve'}
                </button>
                <button
                  onClick={() => setRejecting(v)}
                  disabled={busyId === v._id}
                  className="btn-ghost text-xs px-3.5 py-2 text-rose-500 flex-1 sm:flex-none"
                >
                  Reject
                </button>
              </div>
            </AdminRow>
          ))}
        </AdminList>
      </AdminPage>

      <ConfirmDialog
        open={Boolean(rejecting)}
        onClose={() => { setRejecting(null); setReason(''); }}
        onConfirm={() => reasonValid && decide(rejecting, 'rejected', reason.trim())}
        busy={busyId === rejecting?._id}
        tone="danger"
        title="Reject this verification?"
        description="The applicant is shown your reason and can resubmit. Be specific enough that they can fix it."
        confirmLabel="Reject"
      >
        <label htmlFor="reject-reason" className="field-label">Reason</label>
        <textarea
          id="reject-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={300}
          placeholder="e.g. The GST certificate is expired — please upload a current one."
          className="field resize-none"
        />
        <div className="flex justify-between items-baseline mt-1.5">
          <span className="text-xs text-muted">
            {reasonValid ? 'Shown to the applicant.' : 'Required.'}
          </span>
          <span className="text-xs text-muted tnum">{reason.length}/300</span>
        </div>
      </ConfirmDialog>
    </>
  );
}

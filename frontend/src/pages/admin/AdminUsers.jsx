import { useState, useEffect } from 'react';
import AdminPage, { AdminList, AdminRow } from '../../components/AdminPage';
import { ConfirmDialog } from '../../components/overlay';
import { StatusPill } from '../../components/feedback';
import { Search } from '../../components/icons';
import { api } from '../../lib/api';
import { useToast } from '../../lib/ui-state';

/**
 * The account directory.
 *
 * Suspending an account cuts someone off mid-collaboration, and it used to be a
 * one-click text link that sent the hardcoded reason "Policy violation" —
 * whatever had actually happened. It now asks for a reason, and that reason is
 * what gets recorded and shown, because "Policy violation" in an audit log six
 * weeks later tells nobody anything.
 */
export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = async (nextQ = q, nextRole = role) => {
    setLoading(true); setError(null);
    try {
      const { data, meta } = await api.adminListUsers({ q: nextQ, role: nextRole, limit: 50 });
      setUsers(data || []); setTotal(meta?.total ?? 0);
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function apply(u, suspend) {
    setBusy(true);
    try {
      await api.adminSuspendUser(u._id, suspend, suspend ? reason.trim() : undefined);
      setUsers((list) => list.map((x) => (
        x._id === u._id ? { ...x, status: suspend ? 'suspended' : 'active' } : x)));
      toast.push(suspend ? 'Account suspended' : 'Account reactivated', 'success');
      setConfirming(null); setReason('');
    } catch (e) { toast.push(e.message, 'error'); }
    finally { setBusy(false); }
  }

  const filtersActive = Boolean(q || role);

  return (
    <>
      <AdminPage
        title="Users"
        description={`${total} ${total === 1 ? 'account' : 'accounts'} on the platform. Suspension blocks sign-in and stops any new collaboration.`}
        loading={loading}
        error={error}
        onRetry={() => load()}
        isEmpty={!users.length}
        emptyTitle={filtersActive ? 'No accounts match' : 'No accounts yet'}
        emptySub={filtersActive ? 'Try a different search term or role.' : undefined}
        emptyAction={filtersActive && (
          <button
            onClick={() => { setQ(''); setRole(''); load('', ''); }}
            className="btn-outline mt-1"
          >
            Clear filters
          </button>
        )}
      >
        <form
          className="flex flex-col sm:flex-row gap-2.5 mb-4"
          onSubmit={(e) => { e.preventDefault(); load(); }}
          role="search"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search phone or email…"
              aria-label="Search accounts"
              className="field pl-9"
            />
          </div>
          <select
            value={role}
            onChange={(e) => { setRole(e.target.value); load(q, e.target.value); }}
            aria-label="Filter by role"
            className="field sm:w-44"
          >
            <option value="">All roles</option>
            <option value="creator">Creator</option>
            <option value="brand">Brand</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" className="btn-outline sm:w-auto">Search</button>
        </form>

        <AdminList>
          {users.map((u) => (
            <AdminRow key={u._id}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink truncate">{u.phone || u.email}</div>
                <div className="text-xs text-muted mt-0.5 capitalize">
                  {u.role}
                  <span className="mx-1.5 text-line">·</span>
                  <span className="tnum">joined {new Date(u.createdAt).toLocaleDateString('en-IN')}</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <StatusPill status={u.status === 'suspended' ? 'rejected' : 'open'} />
                {u.role !== 'admin' && (
                  <button
                    onClick={() => (u.status === 'suspended'
                      ? apply(u, false)
                      : setConfirming(u))}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors focusable ${
                      u.status === 'suspended'
                        ? 'text-jade-600 hover:bg-jade-50'
                        : 'text-rose-500 hover:bg-rose-50'}`}
                  >
                    {u.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                  </button>
                )}
              </div>
            </AdminRow>
          ))}
        </AdminList>
      </AdminPage>

      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => { setConfirming(null); setReason(''); }}
        onConfirm={() => apply(confirming, true)}
        busy={busy}
        tone="danger"
        title="Suspend this account?"
        description={`${confirming?.phone || confirming?.email} will be signed out and unable to start or continue any collaboration. Escrow already funded is unaffected and stays held.`}
        confirmLabel="Suspend account"
      >
        <label htmlFor="suspend-reason" className="field-label">Reason</label>
        <input
          id="suspend-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="What happened?"
          maxLength={200}
          className="field"
        />
        <p className="text-xs text-muted mt-1.5">
          Recorded in the audit log. Optional, but “Policy violation” six weeks
          from now will not tell anyone what this was.
        </p>
      </ConfirmDialog>
    </>
  );
}

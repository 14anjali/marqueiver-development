import { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell';
import { Search } from '../../components/icons';
import { api } from '../../lib/api';
import { LoadingBlock, ErrorBlock, EmptyBlock, useToast } from '../../lib/ui-state';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const { data, meta } = await api.adminListUsers({ q, role, limit: 50 });
      setUsers(data || []); setTotal(meta?.total ?? 0);
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function toggleSuspend(u) {
    try {
      await api.adminSuspendUser(u._id, u.status !== 'suspended', u.status !== 'suspended' ? 'Policy violation' : undefined);
      setUsers((list) => list.map((x) => (x._id === u._id ? { ...x, status: x.status === 'suspended' ? 'active' : 'suspended' } : x)));
      toast.push(u.status === 'suspended' ? 'User reactivated' : 'User suspended', 'success');
    } catch (e) { toast.push(e.message, 'error'); }
  }

  return (
    <AdminShell>
      <div className="max-w-[1000px] mx-auto px-4 sm:px-6 py-6">
        <h1 className="font-display font-extrabold text-2xl text-ink mb-1">Users</h1>
        <p className="text-muted text-sm mb-5">{total} accounts on the platform.</p>

        <div className="flex gap-3 mb-5 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="Search phone or email…" className="w-full bg-white border border-line rounded-lg pl-9 pr-3 py-2 text-sm" />
          </div>
          <select value={role} onChange={(e) => { setRole(e.target.value); }} className="border border-line rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">All roles</option><option value="creator">Creator</option><option value="brand">Brand</option><option value="admin">Admin</option>
          </select>
          <button onClick={load} className="btn-outline">Search</button>
        </div>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={load} />
          : !users.length ? <EmptyBlock title="No users found" />
          : (
            <div className="card divide-y divide-line">
              {users.map((u) => (
                <div key={u._id} className="flex items-center gap-3 p-4">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-ink">{u.phone || u.email}</div>
                    <div className="text-xs text-muted capitalize">{u.role} · joined {new Date(u.createdAt).toLocaleDateString('en-IN')}</div>
                  </div>
                  <span className={`pill capitalize ${u.status === 'suspended' ? 'bg-rose-50 text-rose-600' : 'bg-avail-bg text-avail-fg'}`}>{u.status}</span>
                  {u.role !== 'admin' && (
                    <button onClick={() => toggleSuspend(u)} className={`text-sm font-medium ${u.status === 'suspended' ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {u.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
      </div>
    </AdminShell>
  );
}

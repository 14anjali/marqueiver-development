import { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell';
import { Download } from '../../components/icons';
import { api } from '../../lib/api';
import { LoadingBlock, ErrorBlock, EmptyBlock, useToast } from '../../lib/ui-state';

export default function AdminAudit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.adminAuditLog(); setLogs(data || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  async function exportCsv(kind) {
    try { await api.adminExportCsv(kind); toast.push('Export downloaded ✓', 'success'); }
    catch (e) { toast.push(e.message, 'error'); }
  }

  return (
    <AdminShell>
      <div className="max-w-[1000px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <h1 className="font-display font-extrabold text-2xl text-ink">Audit Log</h1>
          <div className="flex gap-2">
            <button onClick={() => exportCsv('deals')} className="btn-outline text-sm"><Download className="w-3.5 h-3.5" /> Deals CSV</button>
            <button onClick={() => exportCsv('transactions')} className="btn-outline text-sm"><Download className="w-3.5 h-3.5" /> Transactions CSV</button>
          </div>
        </div>
        <p className="text-muted text-sm mb-5">Every mutating admin action, recorded immutably.</p>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={load} />
          : !logs.length ? <EmptyBlock title="No audit entries yet" />
          : (
            <div className="card divide-y divide-line">
              {logs.map((l) => (
                <div key={l._id} className="flex items-center gap-3 p-4">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-ink">{l.action}</div>
                    <div className="text-xs text-muted">{l.entityType} · {new Date(l.createdAt).toLocaleString('en-IN')}</div>
                  </div>
                  <span className="pill bg-bg text-muted">{l.actor}</span>
                </div>
              ))}
            </div>
          )}
      </div>
    </AdminShell>
  );
}

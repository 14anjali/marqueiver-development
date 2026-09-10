import { useState, useEffect } from 'react';
import AdminPage, { AdminList, AdminRow } from '../../components/AdminPage';
import { Drawer } from '../../components/overlay';
import { Download } from '../../components/icons';
import { api } from '../../lib/api';
import { useToast } from '../../lib/ui-state';

/**
 * Every mutating admin action, immutably recorded.
 *
 * The redesign is mostly about scanning: an audit log is read by someone
 * looking for one entry among hundreds, so the action is the thing that has to
 * be findable, and it now leads the row in the display face. The actor and the
 * timestamp are supporting detail, set quieter and in tabular figures so the
 * dates line up column-wise down the list.
 */
export default function AdminAudit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [inspecting, setInspecting] = useState(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.adminAuditLog(); setLogs(data || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  async function exportCsv(kind) {
    // Named per-button rather than a single boolean, so only the button that
    // was pressed shows the pending state.
    setExporting(kind);
    try { await api.adminExportCsv(kind); toast.push('Export downloaded', 'success'); }
    catch (e) { toast.push(e.message, 'error'); }
    finally { setExporting(null); }
  }

  const exportButton = (kind, label) => (
    <button
      onClick={() => exportCsv(kind)}
      disabled={exporting !== null}
      className="btn-outline text-sm"
    >
      <Download className="w-3.5 h-3.5" />
      {exporting === kind ? 'Preparing…' : label}
    </button>
  );

  return (
    <>
    <AdminPage
      title="Audit log"
      description="Every mutating admin action, recorded immutably. Entries cannot be edited or removed."
      actions={<>{exportButton('deals', 'Deals CSV')}{exportButton('transactions', 'Transactions CSV')}</>}
      loading={loading}
      error={error}
      onRetry={load}
      isEmpty={!logs.length}
      emptyTitle="No admin actions recorded yet"
      emptySub="Approvals, suspensions, refunds and dispute decisions will appear here as they happen."
      skeletonRows={6}
    >
      <AdminList>
        {logs.map((l) => (
          <AdminRow key={l._id} onClick={() => setInspecting(l)}>
            <div className="flex-1 min-w-0">
              {/* The action is what someone is scanning for. */}
              <div className="font-display font-bold text-sm text-ink truncate">{l.action}</div>
              <div className="text-xs text-muted mt-0.5">
                {l.entityType}
                <span className="mx-1.5 text-line">·</span>
                <span className="tnum">{new Date(l.createdAt).toLocaleString('en-IN')}</span>
              </div>
            </div>
            <span className="pill-quiet shrink-0 self-start sm:self-auto font-mono text-[11px]">
              {l.actor}
            </span>
          </AdminRow>
        ))}
      </AdminList>
    </AdminPage>

    <Drawer
      open={Boolean(inspecting)}
      onClose={() => setInspecting(null)}
      title={inspecting?.action ?? 'Audit entry'}
    >
      <div className="mb-5 pb-5 border-b border-line space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-muted">Actor</span>
          <span className="text-ink font-mono text-xs break-all text-right">{inspecting?.actor}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">Entity</span>
          <span className="text-ink">{inspecting?.entityType}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">When</span>
          <span className="text-ink tnum">
            {inspecting && new Date(inspecting.createdAt).toLocaleString('en-IN')}
          </span>
        </div>
        {inspecting?.ip && (
          <div className="flex justify-between gap-3">
            <span className="text-muted">IP</span>
            <span className="text-ink font-mono text-xs">{inspecting.ip}</span>
          </div>
        )}
      </div>

      <h3 className="font-display font-bold text-sm text-ink mb-3">Changes</h3>
      <ChangeList entry={inspecting} />
    </Drawer>
    </>
  );
}

/**
 * What actually changed.
 *
 * The log stored `before` and `after` on every entry and the UI never showed
 * either, so an audit log could tell you that someone resolved a deal but not
 * what they changed it from. Only the fields that differ are listed — a full
 * document dump of a Deal is 60 keys of noise around the two that moved.
 */
function ChangeList({ entry }) {
  const before = entry?.before ?? {};
  const after = entry?.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .filter((k) => !['updatedAt', '__v', 'timeline'].includes(k));

  if (!keys.length) {
    return <p className="text-sm text-muted">No field-level changes were recorded for this action.</p>;
  }

  const show = (v) => {
    if (v === undefined) return <span className="text-muted italic">not set</span>;
    if (v === null) return <span className="text-muted italic">null</span>;
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  return (
    <dl className="space-y-3">
      {keys.map((k) => (
        <div key={k} className="text-sm">
          <dt className="font-medium text-ink mb-1">{k}</dt>
          <dd className="grid gap-1.5">
            <span className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-xs break-words line-through decoration-rose-300">
              {show(before[k])}
            </span>
            <span className="px-2.5 py-1.5 rounded-lg bg-jade-50 text-jade-700 text-xs break-words">
              {show(after[k])}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

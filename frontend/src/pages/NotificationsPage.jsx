import { useState, useEffect } from 'react';
import AppShell from '../components/AppShell';
import { Bell, Check, Handshake, Mail, Star } from '../components/icons';
import { api } from '../lib/api';
import { LoadingBlock, ErrorBlock, EmptyBlock, useToast } from '../lib/ui-state';

// Icon per notification type — purely presentational, not fabricated content.
const ICON_FOR = (type) => {
  if (type?.startsWith('deal.escrow')) return Check;
  if (type?.startsWith('deal.')) return Handshake;
  if (type === 'message') return Mail;
  if (type === 'review') return Star;
  return Bell;
};

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function NotificationsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.notifications(); setItems(data || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  async function markAllRead() {
    const unreadIds = items.filter((n) => !n.read).map((n) => n._id);
    if (!unreadIds.length) return;
    try {
      await api.markNotificationsRead(unreadIds);
      setItems((list) => list.map((n) => ({ ...n, read: true })));
    } catch (e) { toast.push(e.message, 'error'); }
  }

  const unreadCount = items.filter((n) => !n.read).length;

  return (
    <AppShell>
      <div className="max-w-[700px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="font-display font-extrabold text-2xl text-ink">Notifications</h1>
          <button onClick={markAllRead} disabled={!unreadCount} className="text-sm text-brand-600 disabled:text-muted disabled:cursor-default">
            Mark all read{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </button>
        </div>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={load} />
          : !items.length ? <EmptyBlock title="No notifications yet" sub="Deal updates, messages, and reviews will show up here." />
          : (
            <div className="card divide-y divide-line">
              {items.map((n) => {
                const Icon = ICON_FOR(n.type);
                return (
                  <div key={n._id} className={`flex items-start gap-3 p-4 hover:bg-bg ${!n.read ? 'bg-brand-50/40' : ''}`}>
                    <span className="w-9 h-9 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
                    <div className="flex-1"><div className="text-sm font-medium text-ink">{n.title}</div><div className="text-sm text-muted">{n.body}</div></div>
                    <span className="text-[11px] text-muted whitespace-nowrap">{timeAgo(n.createdAt)}</span>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </AppShell>
  );
}

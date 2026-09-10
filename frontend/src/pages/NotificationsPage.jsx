import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import AppPage from '../components/AppPage';
import { Bell, Check, Handshake, Mail, Star, Wallet } from '../components/icons';
import { Money, StatusPill } from '../components/feedback';
import { api } from '../lib/api';
import { useToast } from '../lib/ui-state';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * Deal updates, messages and reviews.
 *
 * The redesign is mostly about the unread state and about getting somewhere.
 * Before, unread was a faint tint on the row and nothing else, and no
 * notification linked anywhere — you were told a deal had moved and then had to
 * go and find it. Rows that carry a `dealId` are now links.
 *
 * Money notifications are marked in ochre like every other money surface, so an
 * escrow release does not look like a new message.
 *
 * ── What this pass fixed ────────────────────────────────────────────────────
 *
 * **A notification you have to open to understand.** Every deal notification in
 * the product was emitted with `data: { dealId }` and nothing else, so this list
 * could say *that* something happened and never *what*: "Escrow funded" with no
 * amount, "Deal updated" with no state. The reader had to open the deal to find
 * out whether it mattered — which is the work the notification was supposed to
 * save them.
 *
 * `dealPayload()` on the server now carries the deal's `state`, its `amount` and
 * its `title` alongside the id (one helper, so the twelve emit sites cannot
 * drift apart again), and the row renders them with the same `StatusPill` the
 * deals table uses and the same `Money` as every other rupee figure. Rows are
 * tolerant of both shapes, because notifications written before this change are
 * still in the database and must not render worse than they did.
 */

const ICON_FOR = (type) => {
  if (type?.startsWith('deal.escrow') || type?.includes('payout')) return Wallet;
  if (type?.startsWith('deal.additional_terms')) return Handshake;
  if (type?.startsWith('deal.')) return Handshake;
  if (type?.startsWith('campaign.')) return Check;
  if (type === 'message') return Mail;
  if (type === 'review') return Star;
  return Bell;
};

const isMoney = (type) => Boolean(type && (type.includes('escrow') || type.includes('payout') || type.includes('payment')));

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function NotificationsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [marking, setMarking] = useState(false);
  const toast = useToast();
  const reduced = usePrefersReducedMotion();

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.notifications(); setItems(data || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);

  async function markAllRead() {
    const unreadIds = items.filter((n) => !n.read).map((n) => n._id);
    if (!unreadIds.length) return;

    // Optimistic: the rows clear immediately and are restored if the call
    // fails. Waiting on a round trip to un-highlight a row reads as a stall.
    const previous = items;
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    setMarking(true);
    try {
      await api.markNotificationsRead(unreadIds);
    } catch (e) {
      setItems(previous);
      toast.push(e.message, 'error');
    } finally { setMarking(false); }
  }

  return (
    <AppPage
      title="Notifications"
      description={unreadCount
        ? `${unreadCount} unread.`
        : 'Deal updates, messages and reviews, newest first.'}
      width="max-w-[700px]"
      loading={loading}
      error={error}
      onRetry={load}
      isEmpty={!items.length}
      emptyTitle="Nothing yet"
      emptySub="Deal updates, messages and reviews will appear here as they happen."
      emptyIcon={<Bell className="w-6 h-6" />}
      actions={(
        <button
          onClick={markAllRead}
          disabled={!unreadCount || marking}
          className="btn-ghost text-sm"
        >
          {marking ? 'Marking…' : `Mark all read${unreadCount ? ` (${unreadCount})` : ''}`}
        </button>
      )}
    >
      <div className="card divide-y divide-line overflow-hidden">
        {items.map((n) => {
          const Icon = ICON_FOR(n.type);
          const money = isMoney(n.type);
          const dealId = n.data?.dealId;
          const state = n.data?.state;
          const dealTitle = n.data?.title;
          // Only money notifications show a figure. The amount is on every deal
          // payload, but "₹40,000" beside "New message" is noise, not context.
          const amount = money ? n.data?.amount : undefined;

          const body = (
            <>
              <span
                className={`w-9 h-9 rounded-full grid place-items-center shrink-0 ${
                  money ? 'bg-money-50 text-money-700' : 'wash text-brand-600'}`}
                aria-hidden="true"
              >
                <Icon className="w-4 h-4" />
              </span>

              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-ink">{n.title}</span>
                <span className="block text-sm text-muted leading-relaxed mt-0.5">{n.body}</span>

                {/*
                  The facts the row can now carry. Each is rendered only when
                  present, so a notification stored before the payload changed
                  looks exactly as it did rather than showing "undefined".
                */}
                {(state || amount != null || dealTitle) && (
                  <span className="flex flex-wrap items-center gap-2 mt-2">
                    {state && <StatusPill status={state} />}
                    {amount != null && (
                      <span className="text-sm font-semibold">
                        <Money amount={amount} />
                      </span>
                    )}
                    {dealTitle && (
                      <span className="text-xs text-muted truncate max-w-[16rem]">{dealTitle}</span>
                    )}
                  </span>
                )}
              </span>

              <span className="flex flex-col items-end gap-1.5 shrink-0">
                <span className="text-[11px] text-muted whitespace-nowrap tnum">
                  {timeAgo(n.createdAt)}
                </span>
                {/* A dot rather than colour alone, so unread survives a
                    greyscale screen and a colourblind reader. */}
                {!n.read && (
                  <span className="w-2 h-2 rounded-full bg-brand-500" aria-label="Unread" role="img" />
                )}
              </span>
            </>
          );

          const rowClass = `flex items-start gap-3 p-4 transition-colors ${
            n.read ? 'hover:bg-bg' : 'bg-brand-50/40 hover:bg-brand-50/70'}`;

          return (
            <motion.div key={n._id} variants={withReducedMotion(rise, reduced)}>
              {dealId
                ? <Link to={`/deals/${dealId}`} className={`${rowClass} focusable`}>{body}</Link>
                : <div className={rowClass}>{body}</div>}
            </motion.div>
          );
        })}
      </div>
    </AppPage>
  );
}

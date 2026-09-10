import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import AppPage from '../components/AppPage';
import { joinDeal, on, emitTyping } from '../lib/socket';
import { Search, Send, ShieldCheck, ChevLeft, Mail, Lock } from '../components/icons';
import { StatusPill } from '../components/feedback';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/ui-state';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * Creator ↔ brand chat.
 *
 * Three fixes beyond the visual treatment:
 *
 *  1. **The search box did nothing.** It had no state, no handler and no
 *     filtering — a control that looks like it works and does not is worse than
 *     no control. It now filters by counterpart and deal title.
 *
 *  2. **Mobile showed both panes at once.** The layout was a two-column grid
 *     that collapsed to `grid-cols-1`, so on a phone the thread list and the
 *     conversation stacked inside a fixed 600px box, giving roughly 250px to
 *     each. It is now master-detail: the list, then the conversation with a
 *     back button, which is how every chat app on a phone works.
 *
 *  3. **"Open the deal" was a bare `<a href>`,** which does a full page reload
 *     and drops the socket connection and the whole app state.
 *
 *  4. **One lock message for six different reasons.** Messaging is gated on the
 *     deal's state — `messaging.policy.js` opens chat at `in_progress` and
 *     keeps it open through `completed` — and the API already sends `dealState`
 *     on every thread. This page ignored it and showed the same sentence,
 *     "Chat opens once the advance is paid", for every locked thread. For a
 *     deal still being negotiated that is true. For one that was **declined or
 *     cancelled** it is a straightforward falsehood: that chat is never going
 *     to open, and the person is being told to wait for a payment that will
 *     never be made. The lock now reads the state and says the right thing,
 *     and the state itself is shown as the same `StatusPill` the deals table
 *     uses — because "why can't I type?" is answered by the state, so the
 *     state should be on screen.
 */

/**
 * What a locked thread should say, by the state it is locked in.
 *
 * Mirrors `server/src/modules/messaging/messaging.policy.js`. Anything not
 * listed falls through to the generic waiting copy, which is the safe direction:
 * a new state added to the backend reads as "not open yet" rather than
 * inventing a reason.
 */
const LOCK_COPY = {
  invitation: {
    title: 'Chat opens once the collaboration is agreed and funded',
    body: 'While an invitation is open, terms are exchanged as offers so both sides keep a record of exactly what was proposed.',
    over: false,
  },
  negotiation: {
    title: 'Chat opens once the collaboration is agreed and funded',
    body: 'Counter-offers are versioned records rather than messages, so the terms you agree to cannot be quietly changed later.',
    over: false,
  },
  accepted: {
    title: 'Chat opens once the advance is paid',
    body: 'The terms are locked. Chat opens as soon as the brand’s payment into escrow is confirmed.',
    over: false,
  },
  escrow_pending: {
    title: 'Chat opens once the advance is paid',
    body: 'Until the brand’s payment is confirmed, terms are exchanged as offers so both sides keep a record of exactly what was agreed.',
    over: false,
  },
  declined: {
    title: 'This collaboration was declined',
    body: 'Chat never opened for this one, and it will not — a declined brief ends there. The record of what was proposed stays on the collaboration.',
    over: true,
  },
  cancelled: {
    title: 'This collaboration was cancelled',
    body: 'Messaging is closed. The terms, the offers and any settlement stay on the collaboration record.',
    over: true,
  },
};

const lockCopy = (state) => LOCK_COPY[state] ?? {
  title: 'Chat is not open for this collaboration yet',
  body: 'Messaging opens once the collaboration is under way. Until then, terms are exchanged as offers so both sides keep a record.',
  over: false,
};

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('');

export default function MessagesPage() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [peerTyping, setPeerTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const typingTimer = useRef(null);
  const bottomRef = useRef(null);
  const toast = useToast();
  const reduced = usePrefersReducedMotion();

  const loadThreads = async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.listMessageThreads();
      setThreads(data || []);
      const preselect = params.get('deal');
      const initial = data?.find((t) => t.dealId === preselect) || null;
      if (initial) selectThread(initial);
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { loadThreads(); /* eslint-disable-next-line */ }, []);

  async function selectThread(t) {
    setActive(t);
    setMsgs([]);
    if (!t.messagingUnlocked) return;
    try {
      const { data } = await api.listMessages(t.dealId);
      setMsgs(data || []);
      if (t.unreadCount > 0) {
        await api.markMessagesRead(t.dealId);
        setThreads((list) => list.map((th) => (th.dealId === t.dealId ? { ...th, unreadCount: 0 } : th)));
      }
    } catch (e) { toast.push(e.message, 'error'); }
  }

  /** Dedupe: the sender gets their message from the POST and from the room. */
  const addMessage = useCallback((msg) => {
    if (!msg?._id && !msg?.id) return;
    const key = msg._id ?? msg.id;
    setMsgs((m) => (m.some((x) => (x._id ?? x.id) === key) ? m : [...m, msg]));
  }, []);

  useEffect(() => {
    if (!active?.dealId || !active.messagingUnlocked) return undefined;

    const leave = joinDeal(active.dealId, {
      onDenied: (reason) => {
        if (reason === 'MESSAGING_LOCKED') {
          setThreads((list) => list.map((t) => (
            t.dealId === active.dealId ? { ...t, messagingUnlocked: false } : t)));
        }
      },
    });

    const offMessage = on('message:new', (msg) => {
      if (msg?.deal !== active.dealId && msg?.dealId !== active.dealId) return;
      addMessage(msg);
      setThreads((list) => list.map((t) => (t.dealId === active.dealId
        ? { ...t, lastMessage: msg.body, lastMessageAt: msg.createdAt ?? new Date().toISOString() }
        : t)));
    });

    const offTyping = on('typing', (p) => {
      if (p?.dealId !== active.dealId || p?.userId === user?.id) return;
      setPeerTyping(true);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setPeerTyping(false), 2500);
    });

    return () => {
      leave(); offMessage(); offTyping();
      clearTimeout(typingTimer.current);
      setPeerTyping(false);
    };
  }, [active?.dealId, active?.messagingUnlocked, user?.id, addMessage]);

  // Follow the conversation as it grows, including when the peer starts typing.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'end' });
  }, [msgs, peerTyping, reduced]);

  async function send() {
    if (!text.trim() || !active || sending) return;
    const body = text;
    setText('');
    setSending(true);
    try {
      const { data } = await api.sendMessage(active.dealId, body);
      addMessage(data);
      setThreads((list) => list.map((t) => (t.dealId === active.dealId
        ? { ...t, lastMessage: body, lastMessageAt: new Date().toISOString() } : t)));
    } catch (e) {
      setText((cur) => cur || body); // never lose what someone typed
      toast.push(e.message, 'error');
    } finally { setSending(false); }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) =>
      (t.counterpartName || '').toLowerCase().includes(q)
      || (t.dealTitle || '').toLowerCase().includes(q));
  }, [threads, query]);

  const totalUnread = threads.reduce((n, t) => n + (t.unreadCount ?? 0), 0);

  return (
    <AppPage
      title="Messages"
      description={totalUnread
        ? `${totalUnread} unread message${totalUnread === 1 ? '' : 's'}.`
        : 'Conversations open once a collaboration’s advance payment is confirmed.'}
      loading={loading}
      error={error}
      onRetry={loadThreads}
      isEmpty={!threads.length}
      emptyTitle="No conversations yet"
      emptySub="Chat unlocks on a collaboration as soon as the brand’s advance payment clears. Until then, terms are exchanged as offers on the deal."
      emptyIcon={<Mail className="w-6 h-6" />}
      emptyAction={<Link to="/deals" className="btn-outline mt-1">View your deals</Link>}
    >
      <div className="card grid grid-cols-1 md:grid-cols-[300px_1fr] overflow-hidden h-[70vh] min-h-[26rem] md:h-[600px]">
        {/*
          Master-detail on a phone: the list is hidden once a conversation is
          open, and a back button returns to it.
        */}
        <div className={`border-r border-line flex-col ${active ? 'hidden md:flex' : 'flex'}`}>
          <div className="p-3 border-b border-line">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
                className="w-full bg-bg rounded-lg pl-9 pr-3 py-2 text-sm border border-transparent
                           focus:outline-none focus:border-brand-300 focus:bg-white transition-colors"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar">
            {!filtered.length ? (
              <p className="text-xs text-muted text-center py-8 px-4">
                Nothing matches “{query}”.
              </p>
            ) : filtered.map((t) => (
              <motion.button
                key={t.dealId}
                variants={withReducedMotion(rise, reduced)}
                onClick={() => selectThread(t)}
                aria-current={active?.dealId === t.dealId}
                className={`w-full flex items-center gap-3 p-3 text-left transition-colors focusable ${
                  active?.dealId === t.dealId ? 'bg-brand-50' : 'hover:bg-bg'}`}
              >
                <span className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-xs font-bold shrink-0">
                  {initials(t.counterpartName)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex justify-between items-baseline gap-2">
                    <span className="text-sm font-semibold text-ink truncate">{t.counterpartName}</span>
                    <span className="text-[10px] text-muted shrink-0 tnum">{timeAgo(t.lastMessageAt)}</span>
                  </span>
                  <span className="block text-xs text-muted truncate mt-0.5">
                    {t.messagingUnlocked === false
                      // "Opens once the advance is paid" was shown for declined
                      // and cancelled deals too, where nothing is ever going to
                      // open. `lockCopy` knows which is which.
                      ? (lockCopy(t.dealState).over ? 'Closed' : 'Not open yet')
                      : (t.lastMessage || t.dealTitle)}
                  </span>
                </span>
                {t.unreadCount > 0 && (
                  <span className="bg-pink-500 text-white text-[10px] font-bold rounded-full w-5 h-5 grid place-items-center shrink-0 tnum">
                    {t.unreadCount}
                  </span>
                )}
              </motion.button>
            ))}
          </div>
        </div>

        <div className={`flex-col min-w-0 ${active ? 'flex' : 'hidden md:flex'}`}>
          {active ? (
            <>
              <div className="p-3 border-b border-line flex items-center gap-2.5">
                <button
                  onClick={() => setActive(null)}
                  className="md:hidden focusable p-1 -ml-1 text-muted hover:text-ink transition-colors"
                  aria-label="Back to conversations"
                >
                  <ChevLeft className="w-5 h-5" />
                </button>
                <span className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-xs font-bold shrink-0">
                  {initials(active.counterpartName)}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-ink block truncate">{active.counterpartName}</span>
                  <Link
                    to={`/deals/${active.dealId}`}
                    className="text-xs text-muted hover:text-brand-600 transition-colors truncate block focusable"
                  >
                    {active.dealTitle}
                  </Link>
                </div>

                {/*
                  The deal's state, in the product's own status colours. It is
                  the thing that decides whether this thread can be typed in at
                  all, so it belongs where the person looks when they wonder why
                  the box is missing — not two screens away on the deal page.
                */}
                {active.dealState && (
                  <StatusPill status={active.dealState} className="shrink-0 hidden sm:inline-flex" />
                )}
              </div>

              {active.messagingUnlocked === false ? (
                (() => {
                  const copy = lockCopy(active.dealState);
                  return (
                    <div className="flex-1 grid place-items-center p-6 sm:p-8">
                      <div className="max-w-sm text-center">
                        {/*
                          A shield for "waiting on a step" and a padlock for
                          "closed for good" — the two are different situations
                          and were sharing one icon along with one sentence.
                        */}
                        <span className={`inline-flex w-11 h-11 rounded-full items-center justify-center mb-3 ${
                          copy.over ? 'bg-bg text-muted' : 'wash text-brand-600'}`}
                        >
                          {copy.over ? <Lock className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
                        </span>

                        {active.dealState && (
                          <div className="flex justify-center mb-3 sm:hidden">
                            <StatusPill status={active.dealState} />
                          </div>
                        )}

                        <h2 className="font-display font-bold text-ink">{copy.title}</h2>
                        <p className="text-sm text-muted mt-2 leading-relaxed">{copy.body}</p>
                        <Link to={`/deals/${active.dealId}`} className="btn-outline mt-5">
                          Open the collaboration
                        </Link>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar">
                    {!msgs.length ? (
                      <p className="text-xs text-muted text-center py-6">
                        No messages yet — say hello.
                      </p>
                    ) : msgs.map((m) => {
                      const mine = m.sender === user?.id;
                      return (
                        <div
                          key={m._id ?? m.id}
                          className={`max-w-[80%] sm:max-w-[70%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                            mine ? 'ml-auto bg-brand-600 text-white rounded-br-md'
                              : 'bg-bg text-ink rounded-bl-md'}`}
                        >
                          {m.body}
                        </div>
                      );
                    })}

                    {peerTyping && (
                      <div className="max-w-[70%] px-3 py-2 rounded-2xl rounded-bl-md bg-bg" aria-live="polite">
                        <span className="sr-only">{active.counterpartName} is typing</span>
                        <span className="flex gap-1" aria-hidden="true">
                          {[0, 1, 2].map((i) => (
                            <span
                              key={i}
                              className="w-1.5 h-1.5 rounded-full bg-muted/60"
                              style={{ animation: `pulsering 1.2s ease-in-out ${i * 0.15}s infinite` }}
                            />
                          ))}
                        </span>
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </div>

                  <div className="p-3 border-t border-line flex gap-2">
                    <input
                      value={text}
                      onChange={(e) => { setText(e.target.value); emitTyping(active.dealId); }}
                      onKeyDown={(e) => e.key === 'Enter' && send()}
                      placeholder="Type a message…"
                      aria-label="Message"
                      className="field flex-1"
                    />
                    <button
                      onClick={send}
                      disabled={!text.trim() || sending}
                      className="btn-cta px-4 disabled:opacity-40"
                      aria-label="Send"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="flex-1 grid place-items-center text-sm text-muted p-6 text-center">
              Pick a conversation to start reading.
            </div>
          )}
        </div>
      </div>
    </AppPage>
  );
}

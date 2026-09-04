import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { Search, Send, ShieldCheck } from '../components/icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LoadingBlock, ErrorBlock, EmptyBlock, useToast } from '../lib/ui-state';

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function MessagesPage() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const toast = useToast();

  const loadThreads = async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.listMessageThreads();
      setThreads(data || []);
      const preselect = params.get('deal');
      const initial = data?.find((t) => t.dealId === preselect) || data?.[0] || null;
      if (initial) selectThread(initial);
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { loadThreads(); /* eslint-disable-next-line */ }, []);

  async function selectThread(t) {
    setActive(t);
    setMsgs([]);
    // Scope §13 — messaging is closed until the campaign is funded and active.
    // The backend rejects these calls; skipping them avoids a pointless 403.
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

  async function send() {
    if (!text.trim() || !active) return;
    const body = text; setText('');
    try {
      const { data } = await api.sendMessage(active.dealId, body);
      setMsgs((m) => [...m, data]);
      setThreads((list) => list.map((t) => (t.dealId === active.dealId ? { ...t, lastMessage: body, lastMessageAt: new Date().toISOString() } : t)));
    } catch (e) { toast.push(e.message, 'error'); }
  }

  return (
    <AppShell>
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6">
        <h1 className="font-display font-extrabold text-2xl text-ink mb-5">Messages</h1>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={loadThreads} />
          : !threads.length ? (
            <EmptyBlock title="No conversations yet" sub="Messages tied to your deals will show up here once you or a counterpart sends one." />
          ) : (
            <div className="card grid grid-cols-1 md:grid-cols-[300px_1fr] overflow-hidden h-[600px]">
              <div className="border-r border-line flex flex-col">
                <div className="p-3 border-b border-line">
                  <div className="relative"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input placeholder="Search" className="w-full bg-bg rounded-lg pl-9 pr-3 py-2 text-sm" /></div>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar">
                  {threads.map((t) => (
                    <button key={t.dealId} onClick={() => selectThread(t)} className={`w-full flex items-center gap-3 p-3 text-left hover:bg-bg ${active?.dealId === t.dealId ? 'bg-brand-50' : ''}`}>
                      <span className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold shrink-0">
                        {(t.counterpartName || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between"><span className="text-sm font-semibold text-ink">{t.counterpartName}</span><span className="text-[10px] text-muted">{timeAgo(t.lastMessageAt)}</span></div>
                        <div className="text-xs text-muted truncate">
                          {t.messagingUnlocked === false ? 'Opens when the campaign starts' : (t.lastMessage || t.dealTitle)}
                        </div>
                      </div>
                      {t.unreadCount > 0 && <span className="bg-pink-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">{t.unreadCount}</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col">
                {active ? (
                  <>
                    <div className="p-3 border-b border-line flex items-center gap-3">
                      <span className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold">
                        {(active.counterpartName || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}
                      </span>
                      <div><span className="font-semibold text-ink block">{active.counterpartName}</span><span className="text-xs text-muted">{active.dealTitle}</span></div>
                    </div>
                    {active.messagingUnlocked === false ? (
                      /* Scope §13 — explain the rule where the user hits it,
                         rather than showing a composer that will be rejected. */
                      <div className="flex-1 flex items-center justify-center p-8">
                        <div className="max-w-sm text-center">
                          <span className="inline-flex w-11 h-11 rounded-full bg-brand-50 text-brand-700 items-center justify-center mb-3">
                            <ShieldCheck className="w-5 h-5" />
                          </span>
                          <h3 className="font-display font-bold text-ink">Messaging opens when the campaign starts</h3>
                          <p className="text-sm text-muted mt-2 leading-relaxed">
                            Until this deal is agreed and escrow is funded, terms are exchanged as offers
                            and counter-offers so both sides keep a record of what was proposed.
                          </p>
                          <a href={`/deals/${active.dealId}`} className="btn-outline mt-5">Open the deal</a>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar">
                          {!msgs.length ? <p className="text-xs text-muted text-center py-6">No messages yet. Say hello 👋</p>
                            : msgs.map((m) => (
                              <div key={m._id} className={`max-w-[70%] px-3 py-2 rounded-2xl text-sm ${m.sender === user?.id ? 'ml-auto bg-brand-600 text-white' : 'bg-bg text-ink'}`}>{m.body}</div>
                            ))}
                        </div>
                        <div className="p-3 border-t border-line flex gap-2">
                          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Type a message…" className="flex-1 border border-line rounded-lg px-3 py-2 text-sm" />
                          <button onClick={send} className="btn-cta px-4"><Send className="w-4 h-4" /></button>
                        </div>
                      </>
                    )}
                  </>
                ) : <div className="flex-1 flex items-center justify-center text-sm text-muted">Select a conversation</div>}
              </div>
            </div>
          )}
      </div>
    </AppShell>
  );
}

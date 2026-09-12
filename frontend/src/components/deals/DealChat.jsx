import { useEffect, useRef, useState } from 'react';
import { Send, FileText, Image as ImageIcon, Lock, X } from '../icons';
import { uploadFile } from '../profile/shared';
import { api } from '../../lib/api';
import { Spinner, useToast } from '../../lib/ui-state';

/**
 * The collaboration thread.
 *
 * ── It only exists after the advance is verified ───────────────────────────
 *
 * The lock is enforced on the server (`messaging.policy.js` — every route
 * checks the deal state, so calling the API directly does not bypass it). What
 * this adds is the reason: a locked chat that says nothing reads as broken, and
 * "chat opens when the advance clears" is also the thing that tells a brand why
 * paying matters.
 *
 * ── Attachments ────────────────────────────────────────────────────────────
 *
 * Through `uploadFile`, the same signed-upload helper the profile, portfolio,
 * campaign and application flows use, pointed at the same endpoint with a
 * `message` purpose. Nothing about uploading is reimplemented here.
 *
 * An image renders as an image and a file as a named chip, which needs the
 * content type — a signed storage URL usually ends in a query string, so the
 * extension is not a reliable answer. The server derives `kind` once from the
 * type the sender's own file reported.
 *
 * ── References ─────────────────────────────────────────────────────────────
 *
 * A message can point at a proposal version, the final terms or an accepted
 * amendment. Without it both parties retype what they mean — "the deadline in
 * V2" — which is how two people end up discussing different versions without
 * noticing.
 */

const when = (d) => (d ? new Date(d).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
}) : '');

/**
 * One attachment.
 *
 * An image that fails to load falls back to the file chip. A signed storage URL
 * expires, and a broken-image icon next to nothing readable tells the reader
 * neither what it was nor what to do; the name and a link do both.
 */
function Attachment({ a, mine }) {
  const [broken, setBroken] = useState(false);

  if (a.kind === 'image' && !broken) {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className="focusable block">
        <img
          src={a.url}
          alt={a.name || 'Attachment'}
          loading="lazy"
          onError={() => setBroken(true)}
          className="max-h-40 rounded-xl2 border border-line/40 object-cover"
        />
      </a>
    );
  }

  return (
    <a
      href={a.url} target="_blank" rel="noreferrer"
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs focusable ${
        mine ? 'bg-white/15' : 'bg-white border border-line'}`}
    >
      {a.kind === 'image' ? <ImageIcon className="w-3 h-3 shrink-0" /> : <FileText className="w-3 h-3 shrink-0" />}
      <span className="truncate max-w-[10rem]">{a.name || (a.kind === 'image' ? 'Image' : 'File')}</span>
    </a>
  );
}

/** What can be referenced, built from what this collaboration actually has. */
function availableReferences({ offers = [], terms }) {
  const out = [];
  if (terms?.locked) out.push({ kind: 'final_terms', label: 'Final terms' });
  for (const o of [...offers].sort((a, b) => b.seq - a.seq).slice(0, 6)) {
    out.push({ kind: 'proposal', ref: o._id, seq: o.seq, label: `Proposal V${o.seq}` });
  }
  (terms?.amendments ?? []).forEach((a, i) => {
    out.push({ kind: 'amendment', ref: a._id, label: `Amendment ${i + 1}` });
  });
  return out;
}

export default function DealChat({ deal, role, locked, lockReason, offers, terms }) {
  const toast = useToast();
  const [messages, setMessages] = useState(null);
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [references, setReferences] = useState([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    if (locked) { setMessages([]); return; }
    let alive = true;
    api.listMessages(deal._id)
      .then(({ data }) => { if (alive) setMessages(data ?? []); })
      .catch(() => { if (alive) setMessages([]); });
    return () => { alive = false; };
  }, [deal._id, locked]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages?.length]);

  const refs = availableReferences({ offers, terms });
  const canSend = Boolean(body.trim() || attachments.length || references.length);

  async function addFiles(files) {
    setBusy(true);
    try {
      for (const file of Array.from(files).slice(0, 10 - attachments.length)) {
        const url = await uploadFile(file, api.messageUploadUrl);
        setAttachments((a) => [...a, {
          url, name: file.name, contentType: file.type, size: file.size,
        }]);
      }
    } catch (e) {
      toast.push(e.message || 'That file could not be uploaded', 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function send() {
    if (!canSend || busy) return;
    setBusy(true);
    const payload = {
      body: body.trim(),
      ...(attachments.length ? { attachments } : {}),
      ...(references.length ? { references } : {}),
    };
    try {
      const { data } = await api.sendMessage(deal._id, payload);
      setMessages((m) => [...(m ?? []), data]);
      setBody(''); setAttachments([]); setReferences([]);
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (locked) {
    return (
      <section className="card p-5 flex flex-col h-[26rem]">
        <h2 className="font-display font-bold text-ink text-sm mb-3">Messages</h2>
        <div className="flex-1 grid place-items-center text-center px-4">
          <div>
            <span className="w-10 h-10 rounded-xl2 bg-bg border border-line grid place-items-center mx-auto mb-3 text-muted">
              <Lock className="w-4 h-4" />
            </span>
            <p className="text-sm text-muted leading-relaxed max-w-xs">
              {lockReason}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card p-5 flex flex-col h-[30rem]">
      <h2 className="font-display font-bold text-ink text-sm mb-3">Messages</h2>

      <div className="flex-1 overflow-y-auto space-y-2.5 no-scrollbar">
        {messages === null ? (
          <div className="py-6 grid place-items-center"><Spinner className="w-5 h-5" /></div>
        ) : !messages.length ? (
          <p className="text-xs text-muted text-center py-6">
            No messages yet. The collaboration is active — this is where you work it out.
          </p>
        ) : messages.map((m, i) => {
          const mine = m.senderRole === role;
          return (
            <div key={m._id ?? i} className={`max-w-[85%] ${mine ? 'ml-auto' : ''}`}>
              <div
                className={`px-3 py-2 rounded-2xl text-sm leading-relaxed break-words ${
                  mine ? 'bg-brand-600 text-white' : 'bg-bg text-ink'}`}
              >
                {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}

                {/* Images inline, files as named chips. */}
                {m.attachments?.length > 0 && (
                  <div className={`flex flex-wrap gap-1.5 ${m.body ? 'mt-2' : ''}`}>
                    {m.attachments.map((a) => (
                      <Attachment key={a.url} a={a} mine={mine} />
                    ))}
                  </div>
                )}

                {/* What this message is about. */}
                {m.references?.length > 0 && (
                  <div className={`flex flex-wrap gap-1.5 ${m.body || m.attachments?.length ? 'mt-2' : ''}`}>
                    {m.references.map((r, j) => (
                      <span
                        key={j}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                          mine ? 'bg-white/15' : 'bg-brand-50 text-brand-700'}`}
                      >
                        {r.label || r.kind}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className={`text-[10px] text-muted mt-1 ${mine ? 'text-right' : ''}`}>
                {when(m.createdAt)}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* ── what is queued to send ──────────────────────────────────── */}
      {(attachments.length > 0 || references.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {attachments.map((a) => (
            <span key={a.url} className="chip !bg-bg !text-muted inline-flex items-center gap-1">
              {a.contentType?.startsWith('image/')
                ? <ImageIcon className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
              <span className="truncate max-w-[8rem]">{a.name}</span>
              <button
                onClick={() => setAttachments((list) => list.filter((x) => x.url !== a.url))}
                aria-label={`Remove ${a.name}`}
                className="focusable"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {references.map((r, i) => (
            <span key={i} className="chip inline-flex items-center gap-1">
              {r.label}
              <button
                onClick={() => setReferences((list) => list.filter((_, j) => j !== i))}
                aria-label={`Remove ${r.label}`}
                className="focusable"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── reference picker ────────────────────────────────────────── */}
      {picking && (
        <div className="mt-3 rounded-xl2 border border-line p-3">
          <p className="text-xs font-semibold text-muted mb-2">Point at something</p>
          {refs.length === 0 ? (
            <p className="text-xs text-muted">Nothing to reference yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {refs.map((r, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setReferences((list) => (
                      list.some((x) => x.label === r.label) ? list : [...list, r].slice(0, 5)
                    ));
                    setPicking(false);
                  }}
                  className="chip hover:!bg-brand-100 focusable"
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-2 mt-3">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => e.target.files?.length && addFiles(e.target.files)}
          aria-label="Attach files"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy || attachments.length >= 10}
          className="btn-ghost bg-white px-3 shrink-0"
          aria-label="Attach a file or image"
          title="Attach a file or image"
        >
          <FileText className="w-4 h-4" />
        </button>
        <button
          onClick={() => setPicking((v) => !v)}
          aria-pressed={picking}
          className="btn-ghost bg-white px-3 shrink-0"
          aria-label="Reference something in this collaboration"
          title="Reference a proposal, the final terms or an amendment"
        >
          <span className="text-sm font-semibold">@</span>
        </button>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a new line. A chat box that cannot
            // hold two lines makes people send two messages instead.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          rows={1}
          placeholder="Message…"
          aria-label="Message"
          className="field flex-1 resize-none min-h-[2.6rem] max-h-24 py-2"
        />
        <button
          onClick={send}
          disabled={!canSend || busy}
          className="btn-brand px-3.5 shrink-0"
          aria-label="Send"
        >
          {busy ? <Spinner className="w-4 h-4" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </section>
  );
}
import { FileText, Image as ImageIcon, Lock } from '../icons';

/**
 * Every file in the collaboration, in one place.
 *
 * ── Why it is gathered rather than stored ──────────────────────────────────
 *
 * There is no file collection, and adding one would mean two records of the
 * same upload that can disagree. The files that exist are the attachments on
 * messages and the links on work submissions, so this reads those. A reference
 * image sent in chat on day one is exactly as hard to find as it sounds if the
 * only way back to it is scrolling a month of messages.
 *
 * Deliverable links are shown alongside, marked as deliverables, because the
 * question "where is the file" does not distinguish between the two — but the
 * question "has the work been delivered" very much does, so the label stays.
 *
 * ── Locked ─────────────────────────────────────────────────────────────────
 *
 * Before the advance is verified there are no messages to read — the server
 * refuses to list them — so this says so rather than rendering an empty panel
 * that reads as "no files were ever shared".
 */

const when = (d) => (d ? new Date(d).toLocaleDateString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric',
}) : '');

/**
 * A readable name for a link that has none of its own.
 *
 * Host as well as the last segment: an Instagram story URL ends in its numeric
 * id, so the last segment alone rendered as "123" in the file list, which tells
 * the reader nothing about what they are about to open.
 */
function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    const host = u.hostname.replace(/^www\./, '');
    return last ? `${host}/${last}` : host;
  } catch {
    return url;
  }
}

/**
 * Messages and submissions, flattened to one list, newest first.
 *
 * Message attachments already carry `kind`, derived on the server from the
 * content type the sender's file reported — not from the extension, because a
 * signed storage URL usually ends in a query string.
 */
export function collectFiles({ messages = [], deal }) {
  const out = [];

  for (const m of messages) {
    for (const a of m.attachments ?? []) {
      out.push({
        url: a.url,
        name: a.name || (a.kind === 'image' ? 'Image' : 'File'),
        kind: a.kind === 'image' ? 'image' : 'file',
        source: m.senderRole === 'brand' ? 'From the brand' : 'From the creator',
        at: m.createdAt,
      });
    }
  }

  (deal?.workSubmissions ?? []).forEach((s, i) => {
    const which = deal.workSubmissions.length > 1 ? ` · submission ${i + 1}` : '';
    const label = s.deliverable?.label ? `${s.deliverable.label}${which}` : `Deliverable${which}`;

    /*
      Uploaded files as well as links. They were missed at first: the list read
      `urls` only, so a reel uploaded through the submission form — the thing the
      brand most wants to open — did not appear in the files list at all.
    */
    for (const f of s.files ?? []) {
      out.push({
        url: f.url,
        name: f.name || 'File',
        kind: f.kind === 'image' ? 'image' : 'file',
        source: f.role === 'support' ? `Supporting${which}` : label,
        at: s.submittedAt,
      });
    }

    for (const url of s.urls ?? []) {
      out.push({
        url,
        name: nameFromUrl(url),
        kind: 'link',
        source: label,
        at: s.submittedAt,
      });
    }
  });

  return out.sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0));
}

export default function CollaborationFiles({ deal, messages = [], locked = false }) {
  const files = locked ? [] : collectFiles({ messages, deal });

  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-display font-bold text-ink text-sm">Files</h2>
        {files.length > 0 && (
          <span className="text-xs text-muted tnum">{files.length}</span>
        )}
      </div>

      {locked ? (
        <p className="text-xs text-muted leading-relaxed inline-flex items-start gap-1.5">
          <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Files are shared once the collaboration is active.
        </p>
      ) : !files.length ? (
        <p className="text-xs text-muted leading-relaxed">
          Nothing shared yet. Files sent in messages and submitted deliverables appear here.
        </p>
      ) : (
        <ul className="space-y-2">
          {files.map((f, i) => (
            <li key={`${f.url}-${i}`}>
              <a
                href={f.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2.5 rounded-xl2 border border-line p-2.5 hover:bg-bg transition-colors focusable"
              >
                <span
                  aria-hidden="true"
                  className="w-8 h-8 rounded-lg bg-bg border border-line grid place-items-center shrink-0 text-muted"
                >
                  {f.kind === 'image' ? <ImageIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-ink truncate">{f.name}</span>
                  <span className="block text-[11px] text-muted">
                    {f.source}{f.at ? ` · ${when(f.at)}` : ''}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
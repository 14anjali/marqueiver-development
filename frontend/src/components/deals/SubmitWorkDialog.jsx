import { useState } from 'react';
import { Drawer } from '../overlay';
import { SuccessMark } from '../feedback';
import { X, FileText, Image as ImageIcon, Play, Check } from '../icons';
import { uploadFile } from '../profile/shared';
import { api } from '../../lib/api';
import { Spinner, useToast } from '../../lib/ui-state';

/**
 * Submitting one deliverable.
 *
 * ── What this is for ───────────────────────────────────────────────────────
 *
 * A submission is the thing a payment is eventually released against, so it has
 * to carry enough for a brand to actually review: the work, where it can be
 * seen, the copy that will run with it, whatever supports it, and a word from
 * the creator. It used to be a list of links and a note — before that, a
 * hardcoded placeholder URL that every creator filed against their own
 * collaboration.
 *
 * ── Which deliverable ──────────────────────────────────────────────────────
 *
 * Named explicitly when the brief has more than one line. The server refuses an
 * untagged submission in that case, because a brand looking at two reels and
 * three stories cannot review "a submission" — they have to know which line it
 * answers, and so does the progress list both parties read.
 *
 * ── Uploads and links are both offered ─────────────────────────────────────
 *
 * Not a preference between them. A finished reel is a file; a published post is
 * a URL and cannot be anything else; a Drive folder is a link by nature. The
 * requirement is only that at least one of the two is present — a submission
 * with neither is an empty review request, and it starts the brand's clock.
 *
 * Uploads go through `uploadFile`, the same signed-upload helper the profile,
 * portfolio, campaign, application and message flows use, with a `deliverable`
 * purpose. Nothing about uploading is reimplemented here.
 *
 * ── A drawer, not a modal ──────────────────────────────────────────────────
 *
 * `Modal` scrolls as one piece, footer included; this form is long enough that
 * the submit button would sit below the fold on a phone. `Drawer` pins it.
 */

const MAX_FILE_BYTES = 100 * 1024 * 1024;

const kindOf = (contentType = '') => {
  if (/^image\//i.test(contentType)) return 'image';
  if (/^video\//i.test(contentType)) return 'video';
  return 'file';
};

const isUrl = (s) => {
  try { const u = new URL(String(s).trim()); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
};

const bytes = (n) => (n >= 1024 * 1024
  ? `${(n / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(1, Math.round(n / 1024))} KB`);

/** One queued file, with the way to take it back off. */
function FileRow({ f, onRemove }) {
  const Icon = f.kind === 'image' ? ImageIcon : f.kind === 'video' ? Play : FileText;
  return (
    <li className="flex items-center gap-2.5 rounded-xl2 border border-line p-2.5">
      <span aria-hidden="true" className="w-8 h-8 rounded-lg bg-bg border border-line grid place-items-center shrink-0 text-muted">
        <Icon className="w-4 h-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ink truncate">{f.name}</span>
        {f.size != null && <span className="block text-[11px] text-muted tnum">{bytes(f.size)}</span>}
      </span>
      <button
        type="button" onClick={onRemove} aria-label={`Remove ${f.name}`}
        className="focusable text-muted hover:text-rose-500 transition-colors shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </li>
  );
}

export default function SubmitWorkDialog({
  deal, deliverables = [], isResubmission, onClose, onDone,
}) {
  const toast = useToast();

  const [deliverableKey, setDeliverableKey] = useState(
    deliverables.length === 1 ? deliverables[0].key : '',
  );
  const [files, setFiles] = useState([]);
  const [support, setSupport] = useState([]);
  const [urls, setUrls] = useState(['']);
  const [caption, setCaption] = useState('');
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const filledUrls = urls.map((u) => u.trim()).filter(Boolean);
  const invalidUrls = filledUrls.filter((u) => !isUrl(u));

  const needsChoice = deliverables.length > 1 && !deliverableKey;
  const canSubmit = !needsChoice
    && (files.length > 0 || filledUrls.length > 0)
    && invalidUrls.length === 0
    && !uploading;

  async function addFiles(list, role) {
    const setter = role === 'support' ? setSupport : setFiles;
    setUploading(role);
    try {
      for (const file of Array.from(list).slice(0, 10)) {
        if (file.size > MAX_FILE_BYTES) {
          toast.push(`${file.name} is larger than 100 MB — share it as a link instead`, 'error');
          continue;
        }
        const url = await uploadFile(file, api.deliverableUploadUrl);
        setter((prev) => [...prev, {
          url, name: file.name, contentType: file.type, size: file.size, kind: kindOf(file.type),
        }]);
      }
    } catch (e) {
      toast.push(e.message || 'That file could not be uploaded', 'error');
    } finally {
      setUploading('');
    }
  }

  async function submit(e) {
    e?.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      await api.submitWork(deal._id ?? deal.id, {
        ...(deliverableKey ? { deliverableKey } : {}),
        urls: filledUrls,
        files: files.map(({ url, name, contentType, size }) => ({ url, name, contentType, size })),
        supportingFiles: support.map(({ url, name, contentType, size }) => ({ url, name, contentType, size })),
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setDone(true);
      setTimeout(onDone, 1200);
    } catch (err) {
      // A missing disclosure confirmation is refused here (Policy 15), and the
      // creator needs to know which thing to go and do.
      toast.push(err.message, 'error');
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Drawer open onClose={onDone} dismissible={false} title="Submitted">
        <div className="text-center py-6">
          <SuccessMark className="w-14 h-14 mx-auto mb-4" />
          <h2 className="font-display font-extrabold text-lg text-ink">Deliverable submitted</h2>
          <p className="text-sm text-muted mt-2 leading-relaxed">
            The brand has seven days to review it. You will be told when they
            approve it or ask for a revision.
          </p>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      open
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      title={isResubmission ? 'Resubmit your work' : 'Submit your work'}
      footer={(
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost flex-1">Cancel</button>
          <button type="button" onClick={submit} disabled={!canSubmit || busy} className="btn-cta flex-1">
            {busy ? <><Spinner className="w-4 h-4" /> Submitting…</> : isResubmission ? 'Resubmit' : 'Submit for review'}
          </button>
        </div>
      )}
    >
      <form onSubmit={submit} className="space-y-5">
        <p className="text-sm text-muted leading-relaxed">
          {isResubmission
            ? 'Send the revised work. The brand’s seven-day review window restarts from now, and the previous version stays on the record.'
            : 'The brand’s seven-day review window starts when you submit. Nothing replaces what you have already sent — every version is kept.'}
        </p>

        {/* ── which deliverable ──────────────────────────────────────── */}
        {deliverables.length > 0 && (
          <div>
            <span className="field-label">Which deliverable</span>
            {deliverables.length === 1 ? (
              <p className="text-sm text-ink">{deliverables[0].label}</p>
            ) : (
              <div className="space-y-1.5">
                {deliverables.map((d) => {
                  const chosen = d.key === deliverableKey;
                  return (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => setDeliverableKey(d.key)}
                      aria-pressed={chosen}
                      className={`w-full text-left rounded-xl2 border p-3 focusable transition-colors ${
                        chosen ? 'border-brand-300 bg-brand-50' : 'border-line hover:bg-bg'}`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="text-sm text-ink font-medium">{d.label}</span>
                        <span className="shrink-0">
                          {d.status === 'approved'
                            ? <span className="pill-done">Approved</span>
                            : chosen ? <Check className="w-4 h-4 text-brand-600" /> : null}
                        </span>
                      </span>
                      {d.status === 'approved' && (
                        <span className="block text-[11px] text-muted mt-1">
                          Already approved — submitting again replaces nothing, it adds a version.
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── the work itself ────────────────────────────────────────── */}
        <div>
          <span className="field-label">The content</span>
          {files.length > 0 && (
            <ul className="space-y-1.5 mb-2">
              {files.map((f, i) => (
                <FileRow key={f.url} f={f} onRemove={() => setFiles((l) => l.filter((_, j) => j !== i))} />
              ))}
            </ul>
          )}
          <label className="btn-outline w-full justify-center cursor-pointer">
            <input
              type="file" multiple className="sr-only"
              onChange={(e) => e.target.files?.length && addFiles(e.target.files, 'content')}
            />
            {uploading === 'content' ? <><Spinner className="w-4 h-4" /> Uploading…</> : 'Upload content'}
          </label>
          <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
            Up to 100 MB a file. Anything bigger belongs in a link below.
          </p>
        </div>

        {/* ── links ──────────────────────────────────────────────────── */}
        <div>
          <span className="field-label">Links to the work</span>
          <div className="space-y-2">
            {urls.map((u, i) => {
              const bad = u.trim() && !isUrl(u);
              return (
                <div key={i} className="flex gap-2">
                  <input
                    value={u}
                    onChange={(e) => setUrls((l) => l.map((v, j) => (j === i ? e.target.value : v)))}
                    placeholder="https://…"
                    inputMode="url"
                    aria-label={`Link ${i + 1}`}
                    aria-invalid={Boolean(bad)}
                    className={`field flex-1 ${bad ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : ''}`}
                  />
                  {urls.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setUrls((l) => l.filter((_, j) => j !== i))}
                      aria-label={`Remove link ${i + 1}`}
                      className="focusable w-9 shrink-0 grid place-items-center text-muted hover:text-rose-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {invalidUrls.length > 0 && (
            <p className="text-xs text-rose-600 mt-1.5">
              {invalidUrls.length === 1 ? 'One link is not a valid URL.' : `${invalidUrls.length} links are not valid URLs.`}
              {' '}They should start with http:// or https://
            </p>
          )}
          <button
            type="button"
            onClick={() => setUrls((l) => [...l, ''])}
            className="text-xs font-medium text-brand-600 hover:text-brand-700 mt-2 focusable px-1 py-1"
          >
            + Add another link
          </button>
        </div>

        {/* ── caption ────────────────────────────────────────────────── */}
        <div>
          <label htmlFor="sub-caption" className="field-label">
            Caption / copy <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="sub-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="The words that will run with the post, including the disclosure."
            className="field resize-none"
          />
          <div className="flex justify-end mt-1">
            <span className="text-xs text-muted tnum">{caption.length}/4000</span>
          </div>
        </div>

        {/* ── supporting files ───────────────────────────────────────── */}
        <div>
          <span className="field-label">
            Supporting files <span className="font-normal text-muted">(optional)</span>
          </span>
          {support.length > 0 && (
            <ul className="space-y-1.5 mb-2">
              {support.map((f, i) => (
                <FileRow key={f.url} f={f} onRemove={() => setSupport((l) => l.filter((_, j) => j !== i))} />
              ))}
            </ul>
          )}
          <label className="btn-ghost bg-white w-full justify-center cursor-pointer border border-line">
            <input
              type="file" multiple className="sr-only"
              onChange={(e) => e.target.files?.length && addFiles(e.target.files, 'support')}
            />
            {uploading === 'support' ? <><Spinner className="w-4 h-4" /> Uploading…</> : 'Add supporting files'}
          </label>
          <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
            Raw footage, alternate crops, analytics screenshots — anything the brand may want but is not the deliverable.
          </p>
        </div>

        {/* ── message ───────────────────────────────────────────────── */}
        <div>
          <label htmlFor="sub-note" className="field-label">
            Message with this submission <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="sub-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={isResubmission
              ? 'What changed since the last version?'
              : 'Anything they should know before reviewing.'}
            className="field resize-none"
          />
          <div className="flex justify-end mt-1">
            <span className="text-xs text-muted tnum">{note.length}/2000</span>
          </div>
        </div>

        {deal.terms?.deadline && new Date() > new Date(deal.terms.deadline) && (
          <p className="text-xs text-money-700 bg-money-50 rounded-lg p-2.5 leading-relaxed">
            This is past the agreed deadline. It will still be accepted and
            marked late — Policy 11 does not block a late submission.
          </p>
        )}
      </form>
    </Drawer>
  );
}
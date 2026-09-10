import { useState } from 'react';
import { Modal } from '../overlay';
import { SuccessMark } from '../feedback';
import { X, FileText } from '../icons';
import { api } from '../../lib/api';
import { Spinner, useToast } from '../../lib/ui-state';

/**
 * Submitting a deliverable.
 *
 * This dialog exists because the button that used to do this sent a hardcoded
 * placeholder:
 *
 *     api.submitWork(id, { urls: ['https://drive.example.com/deliverable.mp4'],
 *                          note: 'Submitting deliverables' })
 *
 * Every creator who pressed "Submit work" filed the same fake link against
 * their collaboration, and the brand's 7-day review clock started on it. There
 * was no way to submit real work through the UI at all.
 *
 * Links rather than uploads: creators deliver from Drive, Dropbox or a
 * scheduled post, and the platform has no file store for video. Each link is
 * validated as a URL before it can be added, because a typo here becomes a
 * review the brand cannot complete.
 */
export default function SubmitWorkDialog({ deal, isResubmission, onClose, onDone }) {
  const [urls, setUrls] = useState(['']);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const toast = useToast();

  const isUrl = (s) => {
    try { const u = new URL(s.trim()); return u.protocol === 'http:' || u.protocol === 'https:'; }
    catch { return false; }
  };

  const filled = urls.map((u) => u.trim()).filter(Boolean);
  const invalid = filled.filter((u) => !isUrl(u));
  const canSubmit = filled.length > 0 && invalid.length === 0;

  const setAt = (i, v) => setUrls((list) => list.map((u, j) => (j === i ? v : u)));
  const addRow = () => setUrls((list) => [...list, '']);
  const removeAt = (i) => setUrls((list) => (list.length === 1 ? [''] : list.filter((_, j) => j !== i)));

  async function submit(e) {
    e?.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      await api.submitWork(deal._id ?? deal.id, {
        urls: filled,
        note: note.trim() || undefined,
      });
      setDone(true);
      setTimeout(onDone, 1300);
    } catch (err) {
      // A missing disclosure confirmation is refused here (Policy 15) and the
      // creator needs to know which thing to go and do.
      toast.push(err.message, 'error');
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal open onClose={onDone} dismissible={false} size="sm">
        <div className="text-center py-4">
          <SuccessMark className="w-14 h-14 mx-auto mb-4" />
          <h2 className="font-display font-extrabold text-lg text-ink">Deliverable submitted</h2>
          <p className="text-sm text-muted mt-2 leading-relaxed">
            The brand has seven days to review. You will be notified when they
            approve or ask for a revision.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      title={isResubmission ? 'Resubmit your work' : 'Submit your work'}
      description={isResubmission
        ? 'Send the revised deliverable. The brand’s review window restarts from now.'
        : 'Share where the brand can see the finished work. Their seven-day review window starts once you submit.'}
    >
      <form onSubmit={submit}>
        <span className="field-label">Links to the work</span>
        <div className="space-y-2">
          {urls.map((u, i) => {
            const bad = u.trim() && !isUrl(u);
            return (
              <div key={i} className="flex gap-2">
                <input
                  value={u}
                  onChange={(e) => setAt(i, e.target.value)}
                  placeholder="https://…"
                  inputMode="url"
                  aria-label={`Link ${i + 1}`}
                  aria-invalid={Boolean(bad)}
                  className={`field flex-1 ${bad ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : ''}`}
                />
                {urls.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
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

        {invalid.length > 0 && (
          <p className="text-xs text-rose-600 mt-1.5">
            {invalid.length === 1 ? 'One link is not a valid URL.' : `${invalid.length} links are not valid URLs.`}
            {' '}They should start with http:// or https://
          </p>
        )}

        <button
          type="button"
          onClick={addRow}
          className="text-xs font-medium text-brand-600 hover:text-brand-700 mt-2 focusable px-1 py-1"
        >
          + Add another link
        </button>

        <label htmlFor="submit-note" className="field-label mt-5">Note for the brand <span className="font-normal text-muted">(optional)</span></label>
        <textarea
          id="submit-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder={isResubmission
            ? 'What changed since the last version?'
            : 'Anything they should know before reviewing.'}
          className="field resize-none"
        />
        <div className="flex justify-end mt-1.5">
          <span className="text-xs text-muted tnum">{note.length}/1000</span>
        </div>

        {deal.terms?.deadline && new Date() > new Date(deal.terms.deadline) && (
          <p className="text-xs text-money-700 bg-money-50 rounded-lg p-2.5 mt-3 leading-relaxed">
            <FileText className="w-3 h-3 inline mr-1" />
            This is past the agreed deadline. It will still be accepted and
            marked late — Policy 11 does not block a late submission.
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy || !canSubmit} className="btn-cta">
            {busy ? <><Spinner className="w-4 h-4" /> Submitting…</> : isResubmission ? 'Resubmit' : 'Submit for review'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

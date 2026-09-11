import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { Spinner, useToast, ErrorBlock } from '../../../lib/ui-state';
import { Skeleton, StatusPill, SuccessMark } from '../../feedback';
import { ShieldCheck, FileText, X, Check } from '../../icons';
import { SectionCard, PrivateNotice, uploadFile } from '../shared';

/**
 * The verified badge, and the documents behind it.
 *
 * The backend is unchanged: `POST /api/verifications` takes `{ kind, documents }`
 * and `GET /api/verifications` returns this user's submissions. One submission
 * per kind — the model has a unique index on `{ subject, kind }` — so a kind
 * already submitted is shown with its status rather than offered again.
 *
 * Documents are write-only from this screen. They are uploaded, their URLs are
 * attached to the submission, and the file names are shown back as confirmation
 * — but the page never renders a link to the stored document. A verification
 * document is a passport or a GST certificate; putting a clickable link to one
 * on a profile page is how it ends up in a screen share. Admins reviewing a
 * submission read them through the admin console, which is access-controlled
 * separately.
 */

const KINDS = [
  {
    id: 'business',
    label: 'Business registration',
    blurb: 'Incorporation certificate, partnership deed or shop licence.',
    needsDocuments: true,
  },
  {
    id: 'gst',
    label: 'GST',
    blurb: 'Your GST registration certificate.',
    needsDocuments: true,
  },
  {
    id: 'website',
    label: 'Website',
    blurb: 'Proof you own the domain you publish from.',
    needsDocuments: true,
  },
  {
    id: 'social',
    label: 'Social presence',
    blurb: 'Additional proof of the accounts you have connected.',
    needsDocuments: true,
  },
  {
    id: 'email',
    label: 'Business email',
    blurb: 'An address on your own domain.',
    needsDocuments: false,
  },
];

const MAX_BYTES = 10 * 1024 * 1024;

export default function Verification() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const [openKind, setOpenKind] = useState(null);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fileRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    setError(null);
    api.myVerifications()
      .then(({ data }) => { if (alive) setRows(data ?? []); })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [nonce]);

  const byKind = (kind) => rows?.find((r) => r.kind === kind);
  const approved = rows?.some((r) => r.status === 'approved');

  async function pickFiles(e) {
    const chosen = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!chosen.length) return;

    const tooBig = chosen.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      toast.push(`${tooBig.name} is over the 10MB limit`, 'error');
      return;
    }

    setUploading(true);
    try {
      const uploaded = [];
      for (const file of chosen) {
        // Sequential: each upload needs its own signed URL, and a burst of
        // parallel PUTs to storage is the quickest way to be rate-limited.
        // eslint-disable-next-line no-await-in-loop
        const url = await uploadFile(file, api.verificationUploadUrl);
        uploaded.push({ name: file.name, url });
      }
      setFiles((f) => [...f, ...uploaded]);
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function submit(kind) {
    const meta = KINDS.find((k) => k.id === kind);
    if (meta?.needsDocuments && !files.length) {
      toast.push('Attach at least one document', 'error');
      return;
    }

    setSubmitting(true);
    try {
      await api.submitVerification(kind, files.map((f) => f.url));
      toast.push('Submitted for review', 'success');
      setOpenKind(null);
      setFiles([]);
      setNonce((n) => n + 1);
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Verification"
        description="A verified badge tells brands the business behind the profile has been checked. It is optional, and it measurably improves response rates."
      >
        {error ? (
          <ErrorBlock error={error} onRetry={() => setNonce((n) => n + 1)} />
        ) : !rows ? (
          <div aria-busy="true" aria-live="polite" aria-label="Loading your verifications" className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-xl2 border border-line p-4">
                <Skeleton className="h-4 w-40 rounded" />
                <Skeleton className="h-3 w-56 max-w-full rounded mt-2" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div
              className={`rounded-xl2 border p-5 flex flex-col sm:flex-row sm:items-center gap-4
                          ${approved
                            ? 'border-jade-200 bg-jade-50/50'
                            : 'border-line bg-gradient-to-br from-brand-50/50 to-pink-50/40'}`}
            >
              {approved ? (
                <SuccessMark className="w-11 h-11 shrink-0" />
              ) : (
                <span className="w-11 h-11 rounded-full bg-white border border-line text-brand-500
                                 grid place-items-center shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-display font-bold text-ink">
                  {approved ? 'Your account is verified' : 'Not verified yet'}
                </p>
                <p className="text-sm text-muted mt-0.5 leading-relaxed">
                  {approved
                    ? 'The verified badge appears beside your name across the platform.'
                    : 'Submit any one of the documents below. Most reviews are completed within two working days.'}
                </p>
              </div>
            </div>

            <PrivateNotice>
              Documents you upload are seen only by the Marqueiver review team. They are never shown
              on your profile and never visible to brands — only the badge is.
            </PrivateNotice>
          </>
        )}
      </SectionCard>

      {rows && (
        <SectionCard
          title="Documents"
          description="One submission per type. You can submit more than one type."
        >
          <div className="space-y-3">
            {KINDS.map((kind) => {
              const existing = byKind(kind.id);
              const isOpen = openKind === kind.id;

              return (
                <div
                  key={kind.id}
                  className={`rounded-xl2 border transition-colors
                              ${isOpen ? 'border-brand-200 bg-brand-50/30' : 'border-line'}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                    <span className="w-9 h-9 rounded-lg bg-bg border border-line text-muted
                                     grid place-items-center shrink-0">
                      <FileText className="w-4 h-4" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">{kind.label}</p>
                      <p className="text-xs text-muted mt-0.5 leading-relaxed">{kind.blurb}</p>
                    </div>

                    {existing ? (
                      <StatusPill
                        status={{
                          approved: 'completed',
                          pending: 'pending_review',
                          rejected: 'rejected',
                        }[existing.status] ?? 'pending_review'}
                        label={{
                          approved: 'Verified',
                          pending: 'In review',
                          rejected: 'Not accepted',
                        }[existing.status]}
                        className="shrink-0"
                      />
                    ) : (
                      <button
                        onClick={() => { setOpenKind(isOpen ? null : kind.id); setFiles([]); }}
                        className="btn-outline text-sm shrink-0 justify-center"
                      >
                        {isOpen ? 'Cancel' : 'Submit'}
                      </button>
                    )}
                  </div>

                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-brand-100 pt-4">
                      {kind.needsDocuments && (
                        <>
                          <input
                            ref={fileRef}
                            type="file"
                            multiple
                            accept="image/*,application/pdf"
                            className="sr-only"
                            onChange={pickFiles}
                          />

                          <button
                            onClick={() => fileRef.current?.click()}
                            disabled={uploading}
                            className="btn-outline text-sm w-full justify-center"
                          >
                            {uploading
                              ? <><Spinner className="w-4 h-4" /> Uploading…</>
                              : '+ Attach a document'}
                          </button>

                          <p className="text-xs text-muted mt-2">
                            PDF or image, up to 10MB each.
                          </p>

                          {files.length > 0 && (
                            <ul className="mt-3 space-y-1.5">
                              {files.map((f, i) => (
                                <li
                                  key={f.url}
                                  className="flex items-center gap-2 text-xs bg-white rounded-lg
                                             border border-line px-3 py-2"
                                >
                                  <Check className="w-3.5 h-3.5 text-jade-600 shrink-0" />
                                  {/* The file name, not a link to it. */}
                                  <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
                                  <button
                                    onClick={() => setFiles((list) => list.filter((_, idx) => idx !== i))}
                                    aria-label={`Remove ${f.name}`}
                                    className="text-muted hover:text-rose-600 shrink-0 focusable"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      )}

                      <button
                        onClick={() => submit(kind.id)}
                        disabled={submitting || uploading}
                        className="btn-brand w-full justify-center mt-4"
                      >
                        {submitting
                          ? <><Spinner className="w-4 h-4" /> Submitting…</>
                          : 'Submit for review'}
                      </button>
                    </div>
                  )}

                  {existing?.status === 'rejected' && existing.note && (
                    <div className="px-4 pb-4">
                      <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200
                                    rounded-lg px-3 py-2 leading-relaxed">
                        {existing.note}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
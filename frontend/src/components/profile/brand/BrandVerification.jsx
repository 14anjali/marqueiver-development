import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { Spinner, useToast, ErrorBlock } from '../../../lib/ui-state';
import { Skeleton, StatusPill, SuccessMark } from '../../feedback';
import { ShieldCheck, FileText, X, Check } from '../../icons';
import { SectionCard, PrivateNotice, uploadFile } from '../shared';

/**
 * Brand verification — Policy 13.
 *
 * Reuses the existing verification module exactly as the creator section does:
 * `POST /api/verifications` with `{ kind, documents }`, `GET /api/verifications`
 * to read them back, one submission per kind (the model has a unique index on
 * `{ subject, kind }`). When an admin approves one, `admin.decideVerification`
 * already sets `BrandProfile.verifications.{kind} = true`, so nothing new is
 * needed to record the outcome.
 *
 * ── The level is derived, never claimed ────────────────────────────────────
 *
 * Policy 13.1 defines Brand verification as "company name, work email on a
 * business domain, website, and GSTIN where applicable". That is computed
 * server-side in `verificationLevel.service.js` from state the platform already
 * maintains, and arrives on the profile as `verificationLevel`. This screen
 * displays it and lists what is outstanding; it cannot grant anything.
 *
 * ── Documents are write-only here ──────────────────────────────────────────
 *
 * Policy 13.5: identity and financial documents "are never displayed to other
 * users". They are uploaded, attached to a submission, and the file name is
 * echoed back as confirmation — but this page never renders a link to a stored
 * document. Admins review them through the admin console.
 */

const KINDS = [
  {
    id: 'business',
    label: 'Business registration',
    blurb: 'Incorporation certificate, partnership deed, or shop & establishment licence.',
    needsDocuments: true,
  },
  {
    id: 'gst',
    label: 'GST',
    blurb: 'Your GST registration certificate. Required only where you are GST-registered.',
    needsDocuments: true,
  },
  {
    id: 'website',
    label: 'Website ownership',
    blurb: 'Proof you control the domain your brand publishes from.',
    needsDocuments: true,
  },
  {
    id: 'email',
    label: 'Work email',
    blurb: 'An address on your own business domain.',
    needsDocuments: false,
  },
  {
    id: 'social',
    label: 'Social presence',
    blurb: 'Additional proof of the accounts your brand operates.',
    needsDocuments: true,
  },
];

const MAX_BYTES = 10 * 1024 * 1024;

export default function BrandVerification({ profile, onEdit }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const [openKind, setOpenKind] = useState(null);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fileRef = useRef(null);
  const toast = useToast();

  const level = profile.verificationLevel ?? {};

  useEffect(() => {
    let alive = true;
    setError(null);
    api.myVerifications()
      .then(({ data }) => { if (alive) setRows(data ?? []); })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [nonce]);

  const byKind = (kind) => rows?.find((r) => r.kind === kind);

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
        // parallel PUTs is the quickest way to be rate-limited by storage.
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

  const verified = level.brandVerified;

  return (
    <div className="space-y-5">
      <SectionCard
        title="Verification status"
        description="Creators are asked to produce work before they are paid. A verified badge is the strongest reassurance you can offer them."
      >
        <div
          className={`rounded-xl2 border p-5 flex flex-col sm:flex-row sm:items-center gap-4
                      ${verified
                        ? 'border-jade-200 bg-jade-50/50'
                        : 'border-line bg-gradient-to-br from-brand-50/50 to-pink-50/40'}`}
        >
          {verified ? (
            <SuccessMark className="w-11 h-11 shrink-0" />
          ) : (
            <span className="w-11 h-11 rounded-full bg-white border border-line text-brand-500
                             grid place-items-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <p className="font-display font-bold text-ink flex flex-wrap items-center gap-2">
              {level.label ?? 'Not verified'}
              {level.gstVerified && <span className="pill-done">GST verified</span>}
            </p>
            <p className="text-sm text-muted mt-0.5 leading-relaxed">
              {verified
                ? 'Your verified badge appears beside your brand name across the platform.'
                : 'Policy 13.1 — brand verification needs your company name, a work email on a business domain, your website, and GSTIN where applicable.'}
            </p>
          </div>
        </div>

        {/*
          What is actually outstanding, computed server-side against the policy
          rather than guessed at here, and each row links to the section that
          fixes it.
        */}
        {!verified && level.requirements?.length > 0 && (
          <ul className="mt-5 space-y-2">
            {level.requirements.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-xl2 border border-line px-4 py-3"
              >
                <span
                  className={`w-5 h-5 rounded-full grid place-items-center shrink-0
                              ${r.done ? 'bg-jade-50 text-jade-600' : 'bg-bg text-muted'}`}
                  aria-hidden="true"
                >
                  {r.done ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                </span>
                <span className={`text-sm flex-1 min-w-0 ${r.done ? 'text-muted line-through' : 'text-ink'}`}>
                  {r.label}
                </span>
                {!r.done && onEdit && (
                  <button
                    onClick={() => onEdit(r.section)}
                    className="text-xs font-semibold text-brand-700 hover:text-brand-800 shrink-0 focusable"
                  >
                    Fix →
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <PrivateNotice>
          Documents you upload are seen only by the Marqueiver review team. Policy 13.5 — they are
          never displayed to other users, and creators see only the badge.
        </PrivateNotice>
      </SectionCard>

      <SectionCard
        title="Documents"
        description="One submission per type. Most reviews are completed within two working days."
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

                          <p className="text-xs text-muted mt-2">PDF or image, up to 10MB each.</p>

                          {files.length > 0 && (
                            <ul className="mt-3 space-y-1.5">
                              {files.map((f, i) => (
                                <li
                                  key={f.url}
                                  className="flex items-center gap-2 text-xs bg-white rounded-lg
                                             border border-line px-3 py-2"
                                >
                                  <Check className="w-3.5 h-3.5 text-jade-600 shrink-0" />
                                  {/* The file name, never a link to the document. */}
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

                  {existing?.status === 'rejected' && existing.decisionNote && (
                    <div className="px-4 pb-4">
                      <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200
                                    rounded-lg px-3 py-2 leading-relaxed">
                        {existing.decisionNote}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
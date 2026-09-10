import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import AppPage from '../components/AppPage';
import { StatusPill, Progress } from '../components/feedback';
import { ShieldCheck, FileText } from '../components/icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Spinner, useToast } from '../lib/ui-state';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * Documents that earn a verified badge.
 *
 * Three things were wrong beyond the look:
 *
 *  1. **A rejection showed its reason as grey italic footnote text**, smaller
 *     than the hint above it — the one piece of information the person needs in
 *     order to act was the quietest thing on the row.
 *  2. **There was no sense of progress.** Five cards, no indication of how many
 *     were done or that any of them were optional.
 *  3. **A file upload had no size or type guard**, so a 40MB photo would be
 *     attempted and fail somewhere in the network layer with a provider error.
 */

const KINDS = [
  { key: 'business', label: 'Business registration', hint: 'Certificate of incorporation, business licence, or equivalent.' },
  { key: 'gst', label: 'GST registration', hint: 'Your GST certificate.' },
  { key: 'website', label: 'Website ownership', hint: 'Proof you control the website on your profile.' },
  { key: 'social', label: 'Social media ownership', hint: 'Proof of the accounts you have connected.' },
  { key: 'email', label: 'Email domain', hint: 'Proof of a business email domain.' },
];

const MAX_MB = 10;

export default function VerificationsPage() {
  useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploadingKind, setUploadingKind] = useState(null);
  const toast = useToast();
  const reduced = usePrefersReducedMotion();

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.myVerifications(); setItems(data || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const byKind = (kind) => items.find((v) => v.kind === kind);
  const approved = KINDS.filter((k) => byKind(k.key)?.status === 'approved').length;

  async function onFilePick(kind, e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Checked here rather than discovered as a provider error mid-upload.
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.push(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is ${MAX_MB}MB.`, 'error');
      e.target.value = '';
      return;
    }

    setUploadingKind(kind);
    try {
      const { data: urls } = await api.verificationUploadUrl(file.name, file.type);
      if (urls?.uploadUrl && !urls.uploadUrl.includes('mock-storage')) {
        await fetch(urls.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      }
      const existing = byKind(kind);
      const documents = [...(existing?.documents || []), urls.publicUrl];
      const { data: submitted } = await api.submitVerification(kind, documents);
      setItems((list) => [...list.filter((v) => v.kind !== kind), submitted]);
      toast.push('Submitted for review', 'success');
    } catch (err) { toast.push(err.message, 'error'); }
    finally { setUploadingKind(null); e.target.value = ''; }
  }

  return (
    <AppPage
      title="Verification"
      description="Verified badges tell brands who they are dealing with. Every document is reviewed by a person — none of these are required, and each one is judged on its own."
      width="max-w-[800px]"
      loading={loading}
      error={error}
      onRetry={load}
      isEmpty={false}
      skeletonRows={4}
    >
      <div className="card p-4 mb-4 flex items-center gap-4">
        <span className="w-11 h-11 rounded-xl2 wash text-brand-600 grid place-items-center shrink-0" aria-hidden="true">
          <ShieldCheck className="w-5 h-5" />
        </span>
        <Progress
          value={approved} max={KINDS.length} tone={approved === KINDS.length ? 'done' : 'brand'}
          label={`${approved} of ${KINDS.length} verified`} className="flex-1"
        />
      </div>

      <div className="space-y-2.5">
        {KINDS.map((k) => {
          const v = byKind(k.key);
          const uploading = uploadingKind === k.key;
          const rejected = v?.status === 'rejected';

          return (
            <motion.div
              key={k.key}
              variants={withReducedMotion(rise, reduced)}
              className={`card p-4 transition-colors ${rejected ? 'border-rose-200' : ''}`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink">{k.label}</span>
                    {v && <StatusPill status={
                      v.status === 'approved' ? 'completed'
                        : v.status === 'rejected' ? 'rejected'
                          : 'pending_review'
                    } />}
                  </div>
                  <p className="text-xs text-muted mt-1 leading-relaxed">{k.hint}</p>

                  {v?.documents?.length > 0 && (
                    <p className="inline-flex items-center gap-1 text-xs text-brand-600 mt-1.5">
                      <FileText className="w-3 h-3" />
                      {v.documents.length} document{v.documents.length === 1 ? '' : 's'} submitted
                    </p>
                  )}
                </div>

                <label
                  className={`btn-outline text-sm shrink-0 cursor-pointer w-full sm:w-auto justify-center ${
                    uploading ? 'opacity-60 pointer-events-none' : ''}`}
                >
                  {uploading
                    ? <><Spinner className="w-4 h-4" /> Uploading…</>
                    : rejected ? 'Resubmit' : v ? 'Add another' : 'Upload'}
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => onFilePick(k.key, e)}
                    disabled={uploading}
                  />
                </label>
              </div>

              {/*
                The reviewer's note, given the weight of the thing it is: on a
                rejection it is the only route forward.
              */}
              {v?.decisionNote && (
                <p className={`text-sm mt-3 p-2.5 rounded-lg leading-relaxed ${
                  rejected ? 'bg-rose-50 text-rose-700' : 'bg-bg text-muted'}`}
                >
                  {v.decisionNote}
                </p>
              )}
            </motion.div>
          );
        })}
      </div>

      <p className="text-xs text-muted mt-4 text-center">
        Documents are visible only to the Marqueiver review team. Brands see the
        badge, never the underlying paperwork.
      </p>
    </AppPage>
  );
}

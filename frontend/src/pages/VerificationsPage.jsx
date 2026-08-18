import { useState, useEffect } from 'react';
import AppShell from '../components/AppShell';
import { ShieldCheck, Check, X, Clock } from '../components/icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LoadingBlock, ErrorBlock, Spinner, useToast } from '../lib/ui-state';

const KINDS = [
  { key: 'business', label: 'Business registration', hint: 'Certificate of incorporation, business license, or similar.' },
  { key: 'gst', label: 'GST registration', hint: 'GST certificate.' },
  { key: 'website', label: 'Website ownership', hint: 'Proof you control the listed website.' },
  { key: 'social', label: 'Social media ownership', hint: 'Screenshot or proof of your connected social accounts.' },
  { key: 'email', label: 'Email domain', hint: 'Proof of a business email domain.' },
];

const STATUS_STYLE = {
  pending: { pill: 'bg-amber-50 text-amber-600', icon: Clock },
  approved: { pill: 'bg-avail-bg text-avail-fg', icon: Check },
  rejected: { pill: 'bg-rose-50 text-rose-600', icon: X },
};

export default function VerificationsPage() {
  useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploadingKind, setUploadingKind] = useState(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.myVerifications(); setItems(data || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const byKind = (kind) => items.find((v) => v.kind === kind);

  async function onFilePick(kind, e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingKind(kind);
    try {
      const { data: urls } = await api.verificationUploadUrl(file.name, file.type);
      if (urls?.uploadUrl && !urls.uploadUrl.includes('mock-storage')) {
        await fetch(urls.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      }
      const existing = byKind(kind);
      const documents = [...(existing?.documents || []), urls.publicUrl];
      const { data: submitted } = await api.submitVerification(kind, documents);
      setItems((list) => {
        const others = list.filter((v) => v.kind !== kind);
        return [...others, submitted];
      });
      toast.push('Document submitted for review ✓', 'success');
    } catch (err) { toast.push(err.message, 'error'); } finally { setUploadingKind(null); e.target.value = ''; }
  }

  return (
    <AppShell>
      <div className="max-w-[800px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><ShieldCheck className="w-5 h-5" /></span>
          <h1 className="font-display font-extrabold text-2xl text-ink">Verification</h1>
        </div>
        <p className="text-muted text-sm mb-5">Submit documents to get a verified badge on your profile. Each one is reviewed by our team.</p>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={load} /> : (
          <div className="space-y-3">
            {KINDS.map((k) => {
              const v = byKind(k.key);
              const style = v ? STATUS_STYLE[v.status] : null;
              const StatusIcon = style?.icon;
              return (
                <div key={k.key} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-semibold text-ink flex items-center gap-2">
                        {k.label}
                        {v && (
                          <span className={`pill capitalize inline-flex items-center gap-1 ${style.pill}`}>
                            <StatusIcon className="w-3 h-3" />{v.status}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted mt-0.5">{k.hint}</p>
                      {v?.decisionNote && <p className="text-xs text-muted mt-1 italic">Note: {v.decisionNote}</p>}
                      {v?.documents?.length > 0 && (
                        <p className="text-xs text-brand-600 mt-1">{v.documents.length} document(s) submitted</p>
                      )}
                    </div>
                    <label className={`btn-outline text-sm shrink-0 cursor-pointer ${uploadingKind === k.key ? 'opacity-60 pointer-events-none' : ''}`}>
                      {uploadingKind === k.key ? <Spinner className="w-4 h-4" /> : (v?.status === 'rejected' ? 'Resubmit' : v ? 'Add more' : 'Upload')}
                      <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => onFilePick(k.key, e)} disabled={uploadingKind === k.key} />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

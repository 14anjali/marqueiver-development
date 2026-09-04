import { useState, useEffect } from 'react';
import AppShell from '../components/AppShell';
import { MapPin, Send, X, Check } from '../components/icons';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { rupee } from '../lib/normalize';
import { LoadingBlock, ErrorBlock, EmptyBlock, Spinner, useToast } from '../lib/ui-state';

function CreateCampaignModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', brief: '', budget: '', location: 'India', tags: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.title || !form.budget) { toast.push('Title and budget are required', 'error'); return; }
    setBusy(true);
    try {
      const { data } = await api.createCampaign({
        title: form.title, brief: form.brief, budget: Number(form.budget),
        location: form.location, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      toast.push('Campaign created ✓', 'success');
      onCreated(data);
    } catch (e) { toast.push(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-lg text-ink">New Campaign</h2>
          <button onClick={onClose} className="text-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Campaign title"
            className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          <textarea value={form.brief} onChange={(e) => set('brief', e.target.value)} placeholder="Brief" rows={3}
            className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <input value={form.budget} onChange={(e) => set('budget', e.target.value)} type="number" placeholder="Budget (₹)"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            <input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Location"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          </div>
          <input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="Tags (comma separated)"
            className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
          <button onClick={submit} disabled={busy} className="btn-cta w-full">{busy ? <Spinner className="w-4 h-4" /> : 'Create Campaign'}</button>
        </div>
      </div>
    </div>
  );
}

function ApplicantsModal({ campaign, onClose }) {
  const [applicants, setApplicants] = useState(null);
  const [error, setError] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api.listCampaignApplicants(campaign._id).then(({ data }) => setApplicants(data)).catch(setError);
  }, [campaign._id]);

  async function decide(creatorId, status) {
    try {
      await api.decideApplicant(campaign._id, creatorId, status);
      setApplicants((list) => list.map((a) => (a.creator === creatorId ? { ...a, status } : a)));
    } catch (e) { toast.push(e.message, 'error'); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="card w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-lg text-ink">Applicants — {campaign.title}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>
        {error ? <ErrorBlock error={error} /> : !applicants ? <LoadingBlock /> : !applicants.length ? (
          <EmptyBlock title="No applicants yet" sub="Creators who apply to this campaign will show up here." />
        ) : (
          <div className="divide-y divide-line">
            {applicants.map((a) => (
              <div key={a.creator} className="flex items-center gap-3 py-3">
                <div className="flex-1">
                  <div className="text-sm font-semibold text-ink">{a.profile?.displayName || 'Creator'}</div>
                  <div className="text-xs text-muted">{a.profile?.headline} · {(a.profile?.totalAudience ?? 0).toLocaleString('en-IN')} audience</div>
                </div>
                {a.status === 'pending' ? (
                  <div className="flex gap-2">
                    <button onClick={() => decide(a.creator, 'accepted')} className="btn-brand text-xs py-1.5 px-2.5"><Check className="w-3.5 h-3.5" /></button>
                    <button onClick={() => decide(a.creator, 'rejected')} className="btn-ghost text-xs py-1.5 px-2.5 text-rose-500"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : <span className="pill bg-bg text-muted capitalize">{a.status}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CampaignsPage() {
  const { user } = useAuth();
  const isBrand = user?.role === 'brand';
  const toast = useToast();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [applicantsFor, setApplicantsFor] = useState(null);
  const [applyingId, setApplyingId] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.listCampaigns(); setCampaigns(data || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  /**
   * Application state comes from the server (`myApplication` on each campaign),
   * never from local state — that was the bug: a refresh wiped the Set and the
   * Apply button came back even though the application existed.
   */
  async function apply(campaignId) {
    setApplyingId(campaignId);
    try {
      const { data } = await api.applyToCampaign(campaignId);
      setCampaigns((list) => list.map((c) =>
        c._id === campaignId ? { ...c, myApplication: data.application } : c));
      toast.push('Application sent', 'success');
    } catch (e) {
      // 409 means it already exists server-side — reload so the UI matches.
      if (/already applied/i.test(e.message)) load();
      toast.push(e.message, 'error');
    } finally { setApplyingId(null); }
  }

  /** Server-side application status → button label (§9). */
  const APPLICATION_LABEL = {
    pending: 'Applied — pending review',
    accepted: 'Accepted',
    rejected: 'Not selected',
  };

  return (
    <AppShell>
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div>
            <h1 className="font-display font-extrabold text-2xl text-ink">{isBrand ? 'My Campaigns' : 'Browse Campaigns'}</h1>
            <p className="text-muted text-sm mt-1">{isBrand ? 'Campaigns you\'ve created and their status.' : 'Open campaigns you can apply to.'}</p>
          </div>
          {isBrand && <button onClick={() => setShowCreate(true)} className="btn-cta">Create Campaign <Send className="w-4 h-4" /></button>}
        </div>

        {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={load} />
          : !campaigns.length ? (
            <EmptyBlock title={isBrand ? 'No campaigns yet' : 'No open campaigns right now'}
              sub={isBrand ? 'Create your first campaign to start receiving applications.' : 'Check back soon — new campaigns open regularly.'} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {campaigns.map((c) => (
                <div key={c._id} className="card overflow-hidden hover:shadow-cardhover transition">
                  <div className="p-4">
                    <div className="font-semibold text-ink">{c.title}</div>
                    {c.brief && <p className="text-xs text-muted mt-1 line-clamp-2">{c.brief}</p>}
                    <div className="flex gap-1.5 my-2 flex-wrap">{(c.tags || []).map((t) => <span key={t} className="pill bg-bg text-muted">{t}</span>)}</div>
                    <div className="text-xs text-muted inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{c.location}</div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="font-bold text-ink">{rupee(c.budget)}</span>
                      <span className={`pill capitalize ${c.status === 'open' ? 'bg-avail-bg text-avail-fg' : 'bg-bg text-muted'}`}>{c.status}</span>
                    </div>
                    {isBrand ? (
                      <button onClick={() => setApplicantsFor(c)} className="btn-brand w-full mt-3">View Applicants ({c.applicants?.length ?? 0})</button>
                    ) : (
                      c.myApplication ? (
                        /* §9 — once applied, show the status, never Apply again. */
                        <div className="mt-3">
                          <div className={`w-full text-center text-sm font-semibold rounded-lg py-2.5 ${
                            c.myApplication.status === 'accepted' ? 'bg-jade-50 text-jade-700'
                              : c.myApplication.status === 'rejected' ? 'bg-bg text-muted'
                              : 'bg-brand-50 text-brand-700'}`}>
                            {APPLICATION_LABEL[c.myApplication.status] ?? 'Applied'}
                          </div>
                          {c.myApplication.status === 'accepted' && c.myApplication.deal && (
                            <Link to={`/deals/${c.myApplication.deal}`} className="btn-outline w-full mt-2 text-sm">
                              Open negotiation
                            </Link>
                          )}
                        </div>
                      ) : (
                        <button onClick={() => apply(c._id)} disabled={applyingId === c._id || c.status !== 'open'}
                          className="btn-brand w-full mt-3 disabled:opacity-50">
                          {applyingId === c._id ? <Spinner className="w-4 h-4" /> : 'Apply Now'}
                        </button>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

        {showCreate && <CreateCampaignModal onClose={() => setShowCreate(false)} onCreated={(c) => { setCampaigns((list) => [c, ...list]); setShowCreate(false); }} />}
        {applicantsFor && <ApplicantsModal campaign={applicantsFor} onClose={() => setApplicantsFor(null)} />}
      </div>
    </AppShell>
  );
}

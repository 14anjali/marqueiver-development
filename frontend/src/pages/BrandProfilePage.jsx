import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { VerifiedName } from '../components/ui';
import { Mail, MapPin, Star, Check, MapPin as Pin } from '../components/icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LoadingBlock, ErrorBlock, EmptyBlock, Spinner, useToast } from '../lib/ui-state';
import { rupee } from '../lib/normalize';

export default function BrandProfilePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const isCreator = user?.role === 'creator';

  const [brand, setBrand] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [applying, setApplying] = useState(null);
  const [appliedIds, setAppliedIds] = useState(new Set());

  const load = async () => {
    setLoading(true); setError(null);
    try {
      // If no :id in the route, a brand is viewing their own profile.
      const targetId = id || (await api.myProfile()).data?._id;
      const { data } = await api.getBrand(targetId);
      setBrand(data);
      if (data?.user) {
        api.listCampaignsForBrand(data.user).then((r) => setCampaigns(r.data || [])).catch(() => {});
      }
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function apply(campaignId) {
    setApplying(campaignId);
    try {
      await api.applyToCampaign(campaignId);
      setAppliedIds((s) => new Set(s).add(campaignId));
      toast.push('Application sent ✓', 'success');
    } catch (e) { toast.push(e.message, 'error'); } finally { setApplying(null); }
  }

  if (loading) return <AppShell><LoadingBlock label="Loading brand…" /></AppShell>;
  if (error) return <AppShell><div className="max-w-2xl mx-auto py-10"><ErrorBlock error={error} onRetry={load} /></div></AppShell>;
  if (!brand) return null;

  const n = brand;
  const verificationList = Object.entries(n.verifications || {}).filter(([, v]) => v);

  return (
    <AppShell>
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
          {/* ==== center ==== */}
          <div className="space-y-5 min-w-0">
            <div className="card overflow-hidden">
              <div className="relative h-32 bg-gradient-to-br from-brand-600 to-pink-500" />
              <div className="px-5 pb-5">
                <div className="flex items-start gap-4 -mt-10">
                  <div className="w-24 h-24 rounded-2xl bg-white border-4 border-white shadow-card flex items-center justify-center overflow-hidden shrink-0">
                    {n.logo ? <img src={n.logo} className="w-full h-full object-cover" alt="" /> : <span className="font-display font-extrabold text-2xl text-brand-600">{(n.companyName || '?')[0]}</span>}
                  </div>
                  <div className="flex-1 pt-11">
                    {verificationList.length > 0 && <span className="pill bg-avail-bg text-avail-fg mb-1">Verified Brand</span>}
                    <VerifiedName name={n.companyName} className="font-display font-extrabold text-2xl text-ink" />
                    {n.industry && <p className="text-sm text-muted">{n.industry}</p>}
                    {n.about && <p className="text-sm text-ink mt-1">{n.about}</p>}
                    <div className="flex items-center gap-3 mt-2 text-sm text-muted flex-wrap">
                      {(n.location?.city || n.location?.country) && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{[n.location?.city, n.location?.country].filter(Boolean).join(', ')}</span>}
                      {n.website && <span>{n.website}</span>}
                    </div>
                  </div>
                </div>
                {n.trust?.reviewCount > 0 && (
                  <div className="flex items-center gap-1 mt-4 text-sm">
                    <Star className="w-4 h-4" /> <span className="font-semibold text-ink">{n.trust.overall?.toFixed(1)}</span>
                    <span className="text-muted">({n.trust.reviewCount} reviews)</span>
                  </div>
                )}
              </div>
            </div>

            {/* about details */}
            {(n.companySize || n.foundedYear) && (
              <div className="card p-5">
                <h3 className="font-display font-bold text-ink mb-2">About {n.companyName}</h3>
                {[['Founded', n.foundedYear], ['Company Size', n.companySize], ['Industry', n.industry]].filter(([, v]) => v).map(([a, b]) => (
                  <div key={a} className="flex justify-between py-2 border-b border-line last:border-0 text-sm">
                    <span className="text-muted inline-flex items-center gap-2"><Check className="w-3.5 h-3.5 text-brand-500" />{a}</span>
                    <span className="font-medium text-ink text-right">{b}</span>
                  </div>
                ))}
              </div>
            )}

            {/* open campaigns — real */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4"><h3 className="font-display font-bold text-ink">Open Campaigns</h3></div>
              {!campaigns.length ? (
                <EmptyBlock title="No open campaigns right now" />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {campaigns.map((c) => (
                    <div key={c._id} className="rounded-xl border border-line overflow-hidden p-3">
                      <div className="font-semibold text-sm text-ink">{c.title}</div>
                      <div className="flex gap-1.5 my-1.5 flex-wrap">{(c.tags || []).map((t) => <span key={t} className="pill bg-bg text-muted">{t}</span>)}</div>
                      <div className="text-[11px] text-muted inline-flex items-center gap-1"><Pin className="w-3 h-3" />{c.location}</div>
                      <div className="font-bold text-ink text-sm mt-1">{rupee(c.budget)}</div>
                      {isCreator && (
                        <button onClick={() => apply(c._id)} disabled={applying === c._id || appliedIds.has(c._id) || c.status !== 'open'}
                          className="text-sm text-brand-600 font-medium mt-1 disabled:text-muted">
                          {appliedIds.has(c._id) ? 'Applied ✓' : applying === c._id ? <Spinner className="w-4 h-4" /> : 'Apply Now'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ==== right rail ==== */}
          <div className="space-y-4">
            {isCreator && (
              <div className="card p-4">
                <h3 className="font-semibold text-ink text-sm">Interested in working together?</h3>
                <p className="text-xs text-muted mt-1 mb-3">Message the brand or apply to an open campaign above.</p>
                <button onClick={() => nav('/messages')} className="btn-outline w-full"><Mail className="w-4 h-4" /> Message Brand</button>
              </div>
            )}

            {n.trust && (
              <div className="card p-4">
                <h3 className="font-display font-bold text-ink mb-3">Brand Trust Score</h3>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-11 h-11 rounded-full bg-avail-bg text-avail-fg flex items-center justify-center"><Check className="w-5 h-5" /></div>
                  <div><span className="font-display font-extrabold text-2xl text-ink">{(n.trust.overall ?? 0).toFixed(1)}/5</span></div>
                </div>
                {[['Payment Reliability', n.trust.paymentReliability], ['Communication', n.trust.communication], ['Campaign Experience', n.trust.campaignExperience], ['Repeat Collaboration', n.trust.repeatCollaboration]]
                  .filter(([, v]) => v)
                  .map(([a, b]) => (
                    <div key={a} className="flex justify-between py-1.5 text-sm"><span className="text-muted">{a}</span><span className="font-semibold text-ink">{b.toFixed(1)}/5</span></div>
                  ))}
              </div>
            )}

            {verificationList.length > 0 && (
              <div className="card p-4">
                <h3 className="font-display font-bold text-ink mb-3">Verification & Compliance</h3>
                {verificationList.map(([v]) => (
                  <div key={v} className="flex items-center justify-between py-1.5 text-sm"><span className="text-muted capitalize">{v}</span><Check className="w-4 h-4 text-emerald-500" /></div>
                ))}
              </div>
            )}

            {n.teamMembers?.length > 0 && (
              <div className="card p-4">
                <h3 className="font-display font-bold text-ink mb-3">Brand Team</h3>
                {n.teamMembers.map((m) => (
                  <div key={m.name} className="flex items-center gap-3 py-2">
                    <span className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold">{m.name.split(' ').map((w) => w[0]).join('')}</span>
                    <div className="flex-1"><div className="text-sm font-semibold text-ink">{m.name}</div><div className="text-[11px] text-muted">{m.role}</div></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { VerifiedName, Rating, Avail } from '../components/ui';
import { Mail, MapPin, Star, Play, Send, Bookmark, Platform, ChevLeft } from '../components/icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast, Spinner, LoadingBlock, ErrorBlock, EmptyBlock } from '../lib/ui-state';
import { rupee, fmt } from '../lib/normalize';

export default function CreatorProfilePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const isBrand = user?.role === 'brand';

  const [profile, setProfile] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.getCreator(id);
      setProfile(data.profile);
      if (data.profile?.user) {
        api.reviewsForUser(data.profile.user).then((r) => setReviews(r.data || [])).catch(() => {});
      }
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function invite() {
    if (!profile?.user) return;
    setBusy(true);
    try {
      const { data } = await api.createDeal({
        creatorId: profile.user, title: `Collaboration with ${profile.displayName}`,
        contentTypes: profile.contentTypes?.length ? profile.contentTypes : ['reel'],
        amount: profile.rateCard?.[0]?.price || 0,
        deliverables: 'To be discussed', revisionsAllowed: 1,
      });
      toast.push('Invite sent — deal created ✓', 'success');
      nav(`/deals/${data._id}`);
    } catch (e) { toast.push(e.message, 'error'); } finally { setBusy(false); }
  }

  async function toggleSave() {
    if (!isBrand || !id) return;
    try {
      if (saved) { await api.unsaveCreator(id); setSaved(false); }
      else { await api.saveCreator(id); setSaved(true); toast.push('Creator saved ✓', 'success'); }
    } catch (e) { toast.push(e.message, 'error'); }
  }

  if (loading) return <AppShell><LoadingBlock label="Loading profile…" /></AppShell>;
  if (error) return <AppShell><div className="max-w-2xl mx-auto py-10"><ErrorBlock error={error} onRetry={load} /></div></AppShell>;
  if (!profile) return null;

  const d = profile;

  return (
    <AppShell>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4">
        <button onClick={() => nav('/discover')} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-3">
          <ChevLeft className="w-4 h-4" /> Back to search results
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          {/* ============ LEFT column ============ */}
          <div className="space-y-5 min-w-0">
            {/* hero */}
            <div className="card overflow-hidden">
              <div className="relative h-32 bg-gradient-to-br from-brand-500 to-pink-500" />
              <div className="px-5 pb-5">
                <div className="flex items-start gap-4 -mt-10">
                  <div className="relative">
                    <div className="w-24 h-24 rounded-full border-4 border-white bg-brand-100 flex items-center justify-center text-2xl font-display font-extrabold text-brand-700">
                      {(d.displayName || '?').slice(0, 1).toUpperCase()}
                    </div>
                    {d.availability && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2"><Avail /></span>}
                  </div>
                  <div className="flex-1 pt-11">
                    <VerifiedName name={d.displayName} className="font-display font-extrabold text-xl text-ink" />
                    {d.headline && <p className="text-sm text-muted">{d.headline}</p>}
                    {(d.location?.city || d.location?.country) && (
                      <p className="inline-flex items-center gap-1 text-sm text-muted mt-0.5"><MapPin className="w-3.5 h-3.5" />{[d.location?.city, d.location?.country].filter(Boolean).join(', ')}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(d.categories || []).map((t) => <span key={t} className="pill bg-bg text-muted">{t}</span>)}
                    </div>
                  </div>
                  <div className="hidden xl:flex gap-6 pt-11 text-center">
                    {[[fmt(d.totalAudience), 'Total Audience'], [`${d.creatorScore ?? 0}/100`, 'Creator Score'], [`${d.responseTimeHrs ?? 24}h`, 'Response Time']].map(([v, l]) => (
                      <div key={l}><div className="font-display font-extrabold text-lg text-ink">{v}</div><div className="text-[11px] text-muted">{l}</div></div>
                    ))}
                  </div>
                </div>
                {d.bio && <p className="text-sm text-ink mt-4">{d.bio}</p>}
              </div>
            </div>

            {/* social performance — real synced data only, no fabricated growth/sparklines */}
            <div className="card p-5">
              <h3 className="font-display font-bold text-ink mb-4">Social Media Reach</h3>
              {!d.socialAccounts?.length ? (
                <EmptyBlock title="No connected accounts" sub="This creator hasn't connected any social accounts yet." />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {d.socialAccounts.map((p) => (
                    <div key={p.platform} className="card p-4">
                      <div className="flex items-center gap-2">
                        <Platform name={p.platform} className="w-8 h-8" />
                        <div>
                          <div className="font-semibold text-ink text-sm capitalize">{p.platform}</div>
                          <div className="text-[11px] text-muted">{p.handle}</div>
                        </div>
                      </div>
                      <div className="font-display font-extrabold text-2xl text-ink mt-3">{fmt(p.followers)}</div>
                      <div className="text-[11px] text-muted">Followers · {p.engagementRate ?? 0}% eng. rate</div>
                      <span className="pill bg-bg text-muted mt-2 inline-block">{p.dataSource === 'connected' ? 'Live data' : 'Self-reported'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* portfolio — real uploaded items */}
            {d.portfolio?.length > 0 && (
              <div className="card p-5">
                <h3 className="font-display font-bold text-ink mb-4">Portfolio</h3>
                <div className="flex gap-3 overflow-x-auto no-scrollbar">
                  {d.portfolio.map((item) => (
                    <div key={item._id} className="relative w-32 h-44 rounded-xl overflow-hidden shrink-0 bg-bg">
                      <img src={item.thumbnailUrl || item.mediaUrl} className="w-full h-full object-cover" alt={item.title || ''} />
                      {item.mediaType === 'video' && <span className="absolute bottom-2 left-2 text-white text-xs font-semibold inline-flex items-center gap-1"><Play className="w-3 h-3" /></span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ============ RIGHT sidebar ============ */}
          <div className="space-y-4">
            {isBrand && (
              <>
                <button onClick={invite} disabled={busy} className="btn-cta w-full py-3">{busy ? <Spinner /> : <>Invite to Campaign <Send className="w-4 h-4" /></>}</button>
                <button onClick={() => nav('/messages')} className="btn-outline w-full"><Mail className="w-4 h-4" /> Send Message</button>
                <button onClick={toggleSave} className="btn-ghost w-full bg-white">
                  <Bookmark className="w-4 h-4" /> {saved ? 'Saved ✓' : 'Save Creator'}
                </button>
              </>
            )}

            {/* availability */}
            <div className="card p-4 text-sm">
              <h3 className="font-display font-bold text-ink mb-3">Availability</h3>
              <p className={d.availability ? 'text-avail-fg font-medium mb-2' : 'text-muted font-medium mb-2'}>
                {d.availability ? '✓ Available for new campaigns' : 'Not currently available'}
              </p>
              {[['Collaboration Type', (d.collaborationTypes || []).join(' / ') || '—'], ['Content Types', (d.contentTypes || []).join(', ') || '—']].map(([a, b]) => (
                <div key={a} className="flex justify-between py-1.5 border-b border-line last:border-0"><span className="text-muted">{a}</span><span className="text-ink font-medium text-right">{b}</span></div>
              ))}
            </div>

            {/* reviews — real only */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display font-bold text-ink">Reviews</h3>
                {reviews.length > 0 && <Rating value={(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)} count={`${reviews.length}`} />}
              </div>
              {!reviews.length ? (
                <p className="text-xs text-muted">No reviews yet.</p>
              ) : reviews.slice(0, 3).map((r) => (
                <div key={r._id} className="py-2 border-b border-line last:border-0">
                  <div className="flex gap-0.5 my-1">{[...Array(r.rating)].map((_, i) => <Star key={i} className="w-3 h-3" />)}</div>
                  {r.text && <p className="text-xs text-muted">{r.text}</p>}
                  <div className="text-[10px] text-muted mt-1">{new Date(r.createdAt).toLocaleDateString('en-IN')}</div>
                </div>
              ))}
            </div>

            {/* rate card */}
            {d.rateCard?.length > 0 && (
              <div className="card p-4">
                <h3 className="font-display font-bold text-ink mb-3">Rates (Starting From)</h3>
                {d.rateCard.map((r) => (
                  <div key={r.contentType} className="flex justify-between py-1.5 text-sm border-b border-line last:border-0">
                    <span className="text-muted capitalize">{r.contentType}</span><span className="font-bold text-ink">{rupee(r.price)}</span>
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

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import SocialConnectCard from '../components/SocialConnectCard';
import AccountSettings from '../components/profile/AccountSettings';
import { Platform, Check, FileText, Image, BarChart, Wallet, ShieldCheck, X } from '../components/icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LoadingBlock, Spinner, useToast } from '../lib/ui-state';

const CONTENT_TYPES = ['reel', 'post', 'story', 'video', 'short', 'ugc', 'blog', 'live'];

export default function ProfilePage() {
  const { user } = useAuth();
  const isBrand = user?.role !== 'creator';
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({});
  const [ig, setIg] = useState(null);
  const [igConfirm, setIgConfirm] = useState(false);
  const [igBusy, setIgBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [downloadingKit, setDownloadingKit] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const toast = useToast();

  /** Scope §16 / A73 — disconnect Instagram and clear it from the UI at once. */
  async function disconnectIg() {
    setIgBusy(true);
    try {
      await api.disconnectInstagram();
      setIg(null);
      setIgConfirm(false);
      toast.push('Instagram disconnected', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally { setIgBusy(false); }
  }

  useEffect(() => { (async () => {
    try { const { data } = await api.myProfile(); setProfile(data); setForm(data || {}); }
    catch { /* offline */ } finally { setLoading(false); }
  })(); }, []);

  useEffect(() => { if (!isBrand) { api.instagramProfile().then(({ data }) => setIg(data)).catch(() => {}); } }, [isBrand]);

  async function syncIg() {
    setSyncing(true);
    try { const { data } = await api.instagramSync(); setIg(data); toast.push('Instagram synced ✓', 'success'); }
    catch (e) { toast.push(e.message, 'error'); } finally { setSyncing(false); }
  }

  async function save() {
    try {
      if (isBrand) await api.updateBrand({ companyName: form.companyName, industry: form.industry, about: form.about, website: form.website });
      else await api.updateCreator({ displayName: form.displayName, headline: form.headline, bio: form.bio });
      toast.push('Profile saved ✓', 'success');
    } catch (e) { toast.push(e.message, 'error'); }
  }

  async function savePreferences() {
    setSavingPrefs(true);
    try {
      const { data } = await api.updateCreator({
        availability: form.availability,
        collaborationTypes: form.collaborationTypes || [],
        contentTypes: form.contentTypes || [],
        rateCard: form.rateCard || [],
      });
      setProfile(data);
      toast.push('Preferences saved ✓', 'success');
    } catch (e) { toast.push(e.message, 'error'); } finally { setSavingPrefs(false); }
  }

  async function downloadKit() {
    setDownloadingKit(true);
    try { await api.downloadMediaKit(`${(profile?.displayName || 'creator').replace(/\s+/g, '-')}-media-kit.pdf`); }
    catch (e) { toast.push(e.message, 'error'); } finally { setDownloadingKit(false); }
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleArrayValue = (key, value) => {
    setForm((f) => {
      const arr = f[key] || [];
      return { ...f, [key]: arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value] };
    });
  };
  const updateRateRow = (i, key, value) => {
    setForm((f) => {
      const rows = [...(f.rateCard || [])];
      rows[i] = { ...rows[i], [key]: value };
      return { ...f, rateCard: rows };
    });
  };
  const addRateRow = () => setForm((f) => ({ ...f, rateCard: [...(f.rateCard || []), { contentType: 'reel', price: 0 }] }));
  const removeRateRow = (i) => setForm((f) => ({ ...f, rateCard: (f.rateCard || []).filter((_, idx) => idx !== i) }));

  if (loading) return <AppShell><LoadingBlock /></AppShell>;

  return (
    <AppShell>
      <div className="max-w-[800px] mx-auto px-4 sm:px-6 py-6">
        <h1 className="font-display font-extrabold text-2xl text-ink mb-1">My Profile</h1>
        <p className="text-muted text-sm mb-5">This is what {isBrand ? 'creators' : 'brands'} see about you.</p>

        <div className="card p-6 space-y-4">
          {isBrand ? (
            <>
              <Field label="Company name" value={form.companyName || ''} onChange={(v) => set('companyName', v)} />
              <Field label="Industry" value={form.industry || ''} onChange={(v) => set('industry', v)} />
              <Field label="Website" value={form.website || ''} onChange={(v) => set('website', v)} />
              <Field label="About" textarea value={form.about || ''} onChange={(v) => set('about', v)} />
            </>
          ) : (
            <>
              <Field label="Display name" value={form.displayName || ''} onChange={(v) => set('displayName', v)} />
              <Field label="Headline" value={form.headline || ''} onChange={(v) => set('headline', v)} placeholder="e.g. Fitness & Lifestyle Creator" />
              <Field label="Bio" textarea value={form.bio || ''} onChange={(v) => set('bio', v)} />
            </>
          )}
          <div className="flex justify-end"><button onClick={save} className="btn-cta">Save changes</button></div>
        </div>

        {/* Verification — link out to the submission flow */}
        <div className="card p-6 mt-5 flex items-center gap-4">
          <span className="w-11 h-11 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><ShieldCheck className="w-5 h-5" /></span>
          <div className="flex-1">
            <div className="font-semibold text-ink">Verification</div>
            <div className="text-sm text-muted">Submit business, GST, or other documents to get a verified badge.</div>
          </div>
          <Link to="/verifications" className="btn-outline text-sm">Manage</Link>
        </div>

        {/* Availability & Preferences (creator-only) */}
        {!isBrand && (
          <div className="card p-6 mt-5">
            <h3 className="font-display font-bold text-ink mb-4">Availability & Preferences</h3>

            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-medium text-ink">Available for new campaigns</div>
                <div className="text-xs text-muted">Turn off if you're not taking new work right now.</div>
              </div>
              <button onClick={() => set('availability', !form.availability)}
                className={`w-11 h-6 rounded-full relative transition ${form.availability ? 'bg-brand-600' : 'bg-line'}`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition ${form.availability ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>

            <div className="py-3 border-t border-line">
              <div className="text-sm font-medium text-ink mb-2">Collaboration types</div>
              <div className="flex gap-2">
                {['paid', 'barter'].map((t) => (
                  <button key={t} onClick={() => toggleArrayValue('collaborationTypes', t)}
                    className={`pill capitalize ${(form.collaborationTypes || []).includes(t) ? 'bg-brand-600 text-white' : 'bg-bg text-muted border border-line'}`}>{t}</button>
                ))}
              </div>
            </div>

            <div className="py-3 border-t border-line">
              <div className="text-sm font-medium text-ink mb-2">Content types you create</div>
              <div className="flex flex-wrap gap-2">
                {CONTENT_TYPES.map((t) => (
                  <button key={t} onClick={() => toggleArrayValue('contentTypes', t)}
                    className={`pill capitalize ${(form.contentTypes || []).includes(t) ? 'bg-brand-600 text-white' : 'bg-bg text-muted border border-line'}`}>{t}</button>
                ))}
              </div>
            </div>

            <div className="py-3 border-t border-line">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-ink">Rate card</div>
                <button onClick={addRateRow} className="text-xs text-brand-600 font-medium">+ Add rate</button>
              </div>
              {!(form.rateCard || []).length ? (
                <p className="text-xs text-muted">No rates set yet — brands will see "Contact for pricing".</p>
              ) : (
                <div className="space-y-2">
                  {form.rateCard.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select value={r.contentType} onChange={(e) => updateRateRow(i, 'contentType', e.target.value)}
                        className="border border-line rounded-lg px-2 py-1.5 text-sm bg-white capitalize flex-1">
                        {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input type="number" value={r.price} onChange={(e) => updateRateRow(i, 'price', Number(e.target.value))}
                        placeholder="₹" className="w-28 border border-line rounded-lg px-2 py-1.5 text-sm" />
                      <button onClick={() => removeRateRow(i)} className="text-muted hover:text-rose-500 p-1"><X className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-3">
              <button onClick={savePreferences} disabled={savingPrefs} className="btn-cta">{savingPrefs ? <Spinner className="w-4 h-4" /> : 'Save preferences'}</button>
            </div>
          </div>
        )}

        {!isBrand && (
          <div className="card p-6 mt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-bold text-ink">Instagram</h3>
              {ig && <button onClick={syncIg} disabled={syncing} className="btn-outline text-sm py-1.5">{syncing ? <Spinner className="w-4 h-4" /> : 'Sync now'}</button>}
            </div>
            {ig ? (
              <div className="flex items-center gap-4">
                <Platform name="instagram" className="w-12 h-12" />
                <div className="flex-1">
                  <div className="font-semibold text-ink flex items-center gap-1">@{ig.username} <Check className="w-4 h-4 text-emerald-500" /></div>
                  <div className="text-sm text-muted">{(ig.followers || 0).toLocaleString()} followers · {(ig.following || 0).toLocaleString()} following · {ig.mediaCount || 0} posts</div>
                  {ig.lastSyncedAt && <div className="text-[11px] text-muted mt-0.5">Last synced {new Date(ig.lastSyncedAt).toLocaleString()}</div>}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className="pill-done capitalize">{ig.status}</span>
                  {/* Scope §16 — Instagram had no disconnect control anywhere in
                      the UI even though the endpoint existed. */}
                  {igConfirm ? (
                    <div className="flex gap-2">
                      <button onClick={disconnectIg} disabled={igBusy}
                        className="btn text-white bg-rose-600 hover:bg-rose-700 text-xs py-1.5">
                        {igBusy ? <Spinner className="w-3 h-3" /> : 'Confirm'}
                      </button>
                      <button onClick={() => setIgConfirm(false)} className="btn-ghost text-xs py-1.5">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setIgConfirm(true)}
                      className="btn-ghost text-xs py-1.5 text-rose-600 border-rose-200 hover:bg-rose-50">
                      Disconnect
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted">No Instagram account connected.</p>
                <a href={`/onboarding/influencer`} className="btn-brand text-sm">Connect Instagram</a>
              </div>
            )}
          </div>
        )}

        <SocialConnectCard
          platform="facebook" label="Facebook" successParam="fb"
          fetchProfile={api.facebookProfile} getAuthUrl={api.facebookAuthUrl} sync={api.facebookSync}
          disconnect={api.disconnectFacebook}
          renderConnected={(fb) => (
            <>
              <div className="font-semibold text-ink flex items-center gap-1">{fb.pageName} <Check className="w-4 h-4 text-emerald-500" /></div>
              {fb.lastSyncedAt && <div className="text-[11px] text-muted mt-0.5">Last synced {new Date(fb.lastSyncedAt).toLocaleString()}</div>}
            </>
          )}
        />

        <SocialConnectCard
          platform="youtube" label="YouTube" successParam="yt"
          fetchProfile={api.youtubeProfile} getAuthUrl={api.youtubeAuthUrl} sync={api.youtubeSync}
          disconnect={api.disconnectYoutube}
          renderConnected={(yt) => (
            <>
              <div className="font-semibold text-ink flex items-center gap-1">{yt.title} <Check className="w-4 h-4 text-emerald-500" /></div>
              <div className="text-sm text-muted">{(yt.subscriberCount || 0).toLocaleString()} subscribers · {yt.videoCount || 0} videos</div>
              {yt.lastSyncedAt && <div className="text-[11px] text-muted mt-0.5">Last synced {new Date(yt.lastSyncedAt).toLocaleString()}</div>}
            </>
          )}
        />

        {!isBrand && profile?.socialAccounts?.length > 0 && (
          <div className="card p-6 mt-5">
            <h3 className="font-display font-bold text-ink mb-3">Connected platforms</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {profile.socialAccounts.map((s) => (
                <div key={s.platform} className="flex items-center gap-2 p-3 rounded-lg border border-line">
                  <Platform name={s.platform} className="w-6 h-6" />
                  <div><div className="text-xs font-semibold text-ink capitalize">{s.platform}</div><div className="text-[11px] text-muted">{(s.followers/1000).toFixed(1)}K</div></div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!isBrand && (
          <div className="card p-6 mt-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-bold text-ink">Media Kit</h3>
              <button onClick={downloadKit} disabled={downloadingKit} className="btn-brand text-sm py-1.5">
                {downloadingKit ? <Spinner className="w-4 h-4" /> : <><FileText className="w-4 h-4" /> Download PDF</>}
              </button>
            </div>
            <p className="text-sm text-muted">A one-page PDF built from your current profile, social stats and rate card — always up to date.</p>
            <div className="grid grid-cols-3 gap-3 mt-4">
              <Link to="/portfolio" className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-line hover:bg-bg text-center">
                <Image className="w-5 h-5 text-brand-600" /><span className="text-xs font-medium text-ink">Portfolio</span>
              </Link>
              <Link to="/analytics" className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-line hover:bg-bg text-center">
                <BarChart className="w-5 h-5 text-brand-600" /><span className="text-xs font-medium text-ink">Analytics</span>
              </Link>
              <Link to="/earnings" className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-line hover:bg-bg text-center">
                <Wallet className="w-5 h-5 text-brand-600" /><span className="text-xs font-medium text-ink">Earnings</span>
              </Link>
            </div>
          </div>
        )}
      </div>
    
      {/* Policy 3.3 + account deletion. Placed at the end of the profile so
          destructive controls are never adjacent to routine editing. */}
      <div className="max-w-[1000px] mx-auto px-6 pb-10">
        <h2 className="h-display text-display-sm mb-4 mt-10">Account settings</h2>
        <AccountSettings
          profile={profile}
          isCreator={!isBrand}
          onProfileChange={setProfile}
        />
      </div>
    </AppShell>
  );
}

function Field({ label, value, onChange, textarea, placeholder }) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1.5">{label}</label>
      {textarea
        ? <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-400" />
        : <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-400" />}
    </div>
  );
}

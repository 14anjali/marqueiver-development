import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/ui';
import { Platform, Check, ChevRight } from '../components/icons';
import { Spinner, useToast } from '../lib/ui-state';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * Influencer onboarding (SRS FR-2).
 * Step 1: personal details (FR-2.1, FR-2.2)
 * Step 2: connect Instagram — REQUIRED before dashboard (FR-2.3)
 * On success: dashboard access (FR-2.4)
 */
const LANGS = ['English', 'Hindi', 'Tamil', 'Telugu', 'Bengali', 'Marathi', 'Kannada', 'Punjabi'];
const CATS = ['Fitness', 'Lifestyle', 'Fashion', 'Beauty', 'Tech', 'Travel', 'Finance', 'Food', 'Wellness'];

export default function InfluencerOnboarding() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  // Resume support: if we returned from the IG OAuth redirect (?ig=), or the
  // backend already has a saved step from a previous session, jump straight
  // there instead of restarting at step 1.
  const [step, setStep] = useState(params.get('ig') || user?.onboardingStep === 'instagram' ? 2 : 1);
  const [form, setForm] = useState({ displayName: '', dob: '', gender: '', bio: '', city: '', language: 'English', category: 'Fitness' });
  const [igConnected, setIgConnected] = useState(false);
  const [igProfile, setIgProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // If we returned from the IG OAuth callback, check connection status.
  useEffect(() => {
    const ig = params.get('ig');
    if (ig === 'connected') { toast.push('Instagram connected ✓', 'success'); checkIg(); }
    else if (ig === 'error') { toast.push(params.get('message') || 'Instagram connection failed', 'error'); }
    // also check on mount in case already connected
    checkIg();
    // eslint-disable-next-line
  }, []);

  async function checkIg() {
    try { const { data } = await api.instagramProfile(); setIgProfile(data); setIgConnected(true); }
    catch { /* not connected yet */ }
  }

  async function saveDetails() {
    setBusy(true);
    try {
      await api.updateCreator({
        displayName: form.displayName, bio: form.bio, gender: form.gender || undefined,
        dob: form.dob || undefined, categories: [form.category], languages: [form.language],
        location: { city: form.city, country: 'India' },
      });
      await api.saveOnboardingStep('instagram').catch(() => {});
      setStep(2);
    } catch (e) { toast.push(e.message, 'error'); } finally { setBusy(false); }
  }

  async function connectInstagram() {
    setBusy(true);
    try {
      const { data } = await api.instagramAuthUrl();   // FR-4.2
      window.location.href = data.authUrl;             // navigate to consent (mock loops back)
    } catch (e) { toast.push(e.message, 'error'); setBusy(false); }
  }

  async function finish() {
    setBusy(true);
    try {
      await api.completeOnboarding();   // backend enforces IG connection (FR-2.3)
      toast.push('You\'re all set!', 'success');
      nav('/dashboard');
    } catch (e) { toast.push(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-xl mx-auto px-6 py-10">
        <div className="mb-8"><Logo /></div>

        {/* progress */}
        <div className="flex items-center gap-2 mb-8">
          {['Your details', 'Connect Instagram'].map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${step > i + 1 || (i === 1 && igConnected) ? 'bg-emerald-500 text-white' : step === i + 1 ? 'bg-brand-600 text-white' : 'bg-white border border-line text-muted'}`}>
                {step > i + 1 ? <Check className="w-4 h-4" /> : i + 1}
              </span>
              <span className={`text-sm font-medium ${step === i + 1 ? 'text-ink' : 'text-muted'}`}>{label}</span>
              {i === 0 && <div className="flex-1 h-px bg-line" />}
            </div>
          ))}
        </div>

        {step === 1 ? (
          <div className="card p-6 space-y-4">
            <h2 className="font-display font-extrabold text-xl text-ink">Tell us about you</h2>
            <Field label="Full name" value={form.displayName} onChange={(v) => set('displayName', v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date of birth" type="date" value={form.dob} onChange={(v) => set('dob', v)} />
              <SelectField label="Gender" value={form.gender} onChange={(v) => set('gender', v)} options={['male', 'female', 'other']} />
            </div>
            <Field label="Bio" textarea value={form.bio} onChange={(v) => set('bio', v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="City" value={form.city} onChange={(v) => set('city', v)} />
              <SelectField label="Language" value={form.language} onChange={(v) => set('language', v)} options={LANGS} />
            </div>
            <SelectField label="Category" value={form.category} onChange={(v) => set('category', v)} options={CATS} />
            <button onClick={saveDetails} disabled={busy || !form.displayName} className="btn-cta w-full py-3">
              {busy ? <Spinner /> : <>Continue <ChevRight className="w-4 h-4" /></>}
            </button>
          </div>
        ) : (
          <div className="card p-6">
            <h2 className="font-display font-extrabold text-xl text-ink mb-1">Connect your Instagram</h2>
            <p className="text-muted text-sm mb-5">Influencers must connect an Instagram account to access the dashboard. We only read public profile data — never your password.</p>

            {igConnected ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-center gap-3 mb-5">
                <Platform name="instagram" className="w-10 h-10" />
                <div className="flex-1">
                  <div className="font-semibold text-ink flex items-center gap-1">@{igProfile?.username} <Check className="w-4 h-4 text-emerald-500" /></div>
                  <div className="text-xs text-muted">{(igProfile?.followers || 0).toLocaleString()} followers · {igProfile?.mediaCount || 0} posts</div>
                </div>
                <span className="pill bg-avail-bg text-avail-fg">Connected</span>
              </div>
            ) : (
              <button onClick={connectInstagram} disabled={busy} className="w-full rounded-xl border-2 border-dashed border-brand-300 hover:border-brand-500 hover:bg-brand-50 p-6 flex flex-col items-center gap-2 mb-5 transition">
                <Platform name="instagram" className="w-10 h-10" />
                <span className="font-semibold text-ink">{busy ? 'Redirecting…' : 'Connect Instagram account'}</span>
                <span className="text-xs text-muted">Secure OAuth via Instagram</span>
              </button>
            )}

            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="btn-ghost">Back</button>
              <button onClick={finish} disabled={!igConnected || busy} className="btn-cta flex-1">
                {busy ? <Spinner /> : 'Go to dashboard'}
              </button>
            </div>
            {!igConnected && <p className="text-xs text-muted text-center mt-3">Connect Instagram to continue.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, textarea, type = 'text' }) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1.5">{label}</label>
      {textarea
        ? <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-400" />
        : <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-400" />}
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-white capitalize focus:outline-none focus:border-brand-400">
        <option value="">Select…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

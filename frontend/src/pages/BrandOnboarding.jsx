import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/ui';
import { Check } from '../components/icons';
import { Spinner, useToast } from '../lib/ui-state';
import { api } from '../lib/api';

/**
 * Brand onboarding (SRS FR-3). Captures company + contact + business details and
 * an optional logo, then grants dashboard access (FR-3.4). No Instagram required.
 */
const CATS = ['Sportswear', 'Beauty & Personal Care', 'Food & Beverage', 'Technology', 'Fashion', 'Fitness', 'Travel', 'Finance'];

export default function BrandOnboarding() {
  const [form, setForm] = useState({
    companyName: '', contactPerson: '', contactEmail: '', contactPhone: '',
    industry: 'Sportswear', city: '', about: '', website: '', logo: '',
  });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function onLogoPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // FR-3.3: get a presigned URL from the backend, then use the returned public URL.
      const { data } = await api.logoUploadUrl(file.name, file.type);
      if (data?.publicUrl) { set('logo', data.publicUrl); toast.push('Logo attached'); }
      else throw new Error('no url');
    } catch {
      // Fallback: preview locally so the flow isn't blocked in mock/offline.
      set('logo', URL.createObjectURL(file));
      toast.push('Logo attached (local preview)');
    }
  }

  async function finish() {
    if (!form.companyName) { toast.push('Company name is required', 'error'); return; }
    setBusy(true);
    try {
      await api.updateBrand({
        companyName: form.companyName, industry: form.industry, about: form.about,
        website: form.website || undefined, logo: form.logo || undefined,
        contactPerson: form.contactPerson || undefined,
        contactEmail: form.contactEmail || undefined,
        contactPhone: form.contactPhone || undefined,
        location: { city: form.city, country: 'India' },
      });
      await api.completeOnboarding();   // FR-3.4
      toast.push('Welcome aboard!', 'success');
      nav('/dashboard');
    } catch (e) { toast.push(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-xl mx-auto px-6 py-10">
        <div className="mb-8"><Logo /></div>
        <div className="card p-6 space-y-4">
          <h2 className="font-display font-extrabold text-xl text-ink">Set up your brand</h2>

          {/* logo */}
          <div className="flex items-center gap-4">
            <label className="w-16 h-16 rounded-xl border-2 border-dashed border-line hover:border-brand-400 flex items-center justify-center cursor-pointer overflow-hidden shrink-0">
              {form.logo ? <img src={form.logo} alt="logo" className="w-full h-full object-cover" /> : <span className="text-2xl text-muted">+</span>}
              <input type="file" accept="image/*" className="hidden" onChange={onLogoPick} />
            </label>
            <div><div className="text-sm font-medium text-ink">Company logo</div><div className="text-xs text-muted">PNG or JPG, optional</div></div>
          </div>

          <Field label="Company name" value={form.companyName} onChange={(v) => set('companyName', v)} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact person" value={form.contactPerson} onChange={(v) => set('contactPerson', v)} />
            <SelectField label="Business category" value={form.industry} onChange={(v) => set('industry', v)} options={CATS} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact email" type="email" value={form.contactEmail} onChange={(v) => set('contactEmail', v)} />
            <Field label="Contact phone" value={form.contactPhone} onChange={(v) => set('contactPhone', v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City" value={form.city} onChange={(v) => set('city', v)} />
            <Field label="Website (optional)" value={form.website} onChange={(v) => set('website', v)} />
          </div>
          <Field label="Description" textarea value={form.about} onChange={(v) => set('about', v)} />

          <button onClick={finish} disabled={busy} className="btn-cta w-full py-3">{busy ? <Spinner /> : 'Go to dashboard'}</button>
        </div>
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
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-brand-400">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

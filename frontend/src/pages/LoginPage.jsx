import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/ui';
import { Spinner, useToast } from '../lib/ui-state';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * OTP login/signup supporting BOTH phone and email channels (SRS FR-1.3, FR-6, FR-7).
 * New users are routed into onboarding (FR-1.7); existing users to their
 * dashboard (FR-1.6).
 */
export default function LoginPage() {
  const [channel, setChannel] = useState('phone');   // phone | email  (FR-1.3)
  const [step, setStep] = useState('identify');       // identify | otp
  const [phone, setPhone] = useState('+919000000501');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('brand');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  const identifier = channel === 'phone' ? phone : email;

  async function sendCode() {
    if (channel === 'email' && !/^[^@]+@[^@]+\.[^@]+$/.test(email)) { toast.push('Enter a valid email', 'error'); return; }
    setBusy(true);
    try {
      const { data } = channel === 'phone'
        ? await api.requestOtp(phone, 'signup')
        : await api.sendEmailOtp(email, 'signup');
      setStep('otp');
      if (data?.devCode) { setDevCode(data.devCode); setCode(data.devCode); toast.push('Dev code: ' + data.devCode); }
    } catch (e) { toast.push(e.message, 'error'); } finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true);
    try {
      const { data } = channel === 'phone'
        ? await api.verifyOtp(phone, code, role)
        : await api.verifyEmailOtp(email, code, role);
      login({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      toast.push('Welcome to Marqueiver', 'success');
      // Admins have no onboarding flow — straight to the admin dashboard.
      if (data.user?.role === 'admin') {
        nav('/admin');
      } else if (data.isNew || !data.user?.onboardingComplete) {
        // FR-1.6/1.7: existing (onboarded) → dashboard; new → onboarding
        nav(data.user?.role === 'creator' ? '/onboarding/influencer' : '/onboarding/brand');
      } else {
        nav('/dashboard');
      }
    } catch (e) { toast.push(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-brand-grad text-white p-12 relative overflow-hidden">
        <div className="relative z-10"><Logo /></div>
        <div className="relative z-10 max-w-md">
          <h1 className="font-display font-extrabold text-4xl leading-tight">Where brands and creators come together to create impact.</h1>
          <p className="text-white/80 mt-4">Discover creators, run escrow-secured campaigns, and manage every collaboration in one place.</p>
          <div className="flex gap-8 mt-8">
            <div><div className="font-display font-extrabold text-3xl">2,843</div><div className="text-white/70 text-sm">Creators</div></div>
            <div><div className="font-display font-extrabold text-3xl">320+</div><div className="text-white/70 text-sm">Campaigns</div></div>
            <div><div className="font-display font-extrabold text-3xl">₹2Cr+</div><div className="text-white/70 text-sm">Paid out</div></div>
          </div>
        </div>
        <div className="relative z-10 text-white/60 text-sm">© 2026 Marqueiver</div>
        <div className="absolute -right-20 -top-20 w-96 h-96 rounded-full bg-white/10" />
        <div className="absolute -right-10 bottom-10 w-72 h-72 rounded-full bg-pink-500/20" />
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8"><Logo /></div>
          <h2 className="font-display font-extrabold text-2xl text-ink">
            {step === 'identify' ? 'Sign in or create account' : 'Enter the code'}
          </h2>
          <p className="text-muted text-sm mt-1 mb-6">
            {step === 'identify' ? "We'll send a one-time code to verify you." : `Sent to ${identifier}`}
          </p>

          {step === 'identify' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">I am a</label>
                <div className="grid grid-cols-2 gap-2">
                  {['brand', 'creator'].map((r) => (
                    <button key={r} onClick={() => setRole(r)}
                      className={`py-2.5 rounded-lg border text-sm font-medium capitalize transition ${role === r ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-muted hover:border-brand-300'}`}>
                      {r === 'creator' ? 'Influencer' : r}
                    </button>
                  ))}
                </div>
              </div>

              {/* channel switch — FR-1.3 */}
              <div className="flex rounded-lg border border-line overflow-hidden text-sm">
                {['phone', 'email'].map((ch) => (
                  <button key={ch} onClick={() => setChannel(ch)}
                    className={`flex-1 py-2 font-medium capitalize transition ${channel === ch ? 'bg-brand-600 text-white' : 'text-muted hover:bg-bg'}`}>
                    {ch} OTP
                  </button>
                ))}
              </div>

              {channel === 'phone' ? (
                <div>
                  <label className="block text-sm font-medium text-ink mb-1.5">Phone number</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400" placeholder="+91 90000 00000" />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-ink mb-1.5">Email address</label>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
                    className="w-full border border-line rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400" placeholder="you@company.com" />
                </div>
              )}

              <button onClick={sendCode} disabled={busy} className="btn-cta w-full py-3">{busy ? <Spinner /> : 'Send code'}</button>
              <p className="text-xs text-muted text-center">Mock mode: code is prefilled for you.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">6-digit code</label>
                <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={6}
                  className="w-full border border-line rounded-lg px-3 py-2.5 text-lg tracking-[0.4em] text-center font-bold focus:outline-none focus:border-brand-400" placeholder="______" />
                {devCode && <p className="text-xs text-brand-600 mt-1.5">Dev code: {devCode} (prefilled)</p>}
              </div>
              <button onClick={verify} disabled={busy || code.length < 4} className="btn-cta w-full py-3">{busy ? <Spinner /> : 'Verify & continue'}</button>
              <button onClick={() => setStep('identify')} className="text-sm text-muted hover:text-ink w-full text-center">← Change {channel}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

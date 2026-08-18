import { useState } from 'react';
import AdminShell from '../../components/AdminShell';
import { api } from '../../lib/api';
import { Spinner, useToast } from '../../lib/ui-state';
import { useAuth } from '../../lib/auth';

export default function AdminTeam() {
  const { user } = useAuth();
  const [phone, setPhone] = useState('');
  const [level, setLevel] = useState('support');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const isSuper = user?.adminLevel === 'super';

  async function invite() {
    if (!phone) { toast.push('Enter a phone number', 'error'); return; }
    setBusy(true);
    try { await api.adminInviteTeam(phone, level); toast.push('Team member invited ✓', 'success'); setPhone(''); }
    catch (e) { toast.push(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <AdminShell>
      <div className="max-w-[600px] mx-auto px-4 sm:px-6 py-6">
        <h1 className="font-display font-extrabold text-2xl text-ink mb-1">Team</h1>
        <p className="text-muted text-sm mb-5">Invite another admin with a specific permission level.</p>

        {!isSuper ? (
          <div className="card p-5 text-sm text-muted">Only super admins can invite team members.</div>
        ) : (
          <div className="card p-5 space-y-3">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Phone number</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 90000 00000"
                className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Permission level</label>
              <select value={level} onChange={(e) => setLevel(e.target.value)} className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-white">
                <option value="support">Support — moderation, user suspension</option>
                <option value="finance">Finance — deal resolution, exports</option>
                <option value="super">Super — everything</option>
              </select>
            </div>
            <button onClick={invite} disabled={busy} className="btn-cta w-full">{busy ? <Spinner className="w-4 h-4" /> : 'Send invite'}</button>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

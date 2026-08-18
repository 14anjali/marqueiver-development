import { useState, useEffect } from 'react';
import { Platform, Check } from './icons';
import { Spinner, useToast } from '../lib/ui-state';

/**
 * A connect/sync card for an optional social platform (Facebook, YouTube —
 * anything that isn't gated into onboarding the way Instagram is). Handles
 * its own load/connect/sync so ProfilePage doesn't need per-platform state.
 */
export default function SocialConnectCard({ platform, label, fetchProfile, getAuthUrl, sync, renderConnected, successParam }) {
  const [data, setData] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const toast = useToast();

  useEffect(() => {
    fetchProfile().then(({ data }) => setData(data)).catch(() => {});
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (!successParam) return;
    const params = new URLSearchParams(window.location.search);
    const val = params.get(successParam);
    if (val === 'connected') toast.push(`${label} connected ✓`, 'success');
    else if (val === 'error') toast.push(params.get('message') || `${label} connection failed`, 'error');
    // eslint-disable-next-line
  }, []);

  async function connect() {
    setConnecting(true);
    try { const { data } = await getAuthUrl(); window.location.href = data.authUrl; }
    catch (e) { toast.push(e.message, 'error'); setConnecting(false); }
  }

  async function doSync() {
    setSyncing(true);
    try { const { data } = await sync(); setData(data); toast.push(`${label} synced ✓`, 'success'); }
    catch (e) { toast.push(e.message, 'error'); } finally { setSyncing(false); }
  }

  return (
    <div className="card p-6 mt-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-bold text-ink">{label}</h3>
        {data && <button onClick={doSync} disabled={syncing} className="btn-outline text-sm py-1.5">{syncing ? <Spinner className="w-4 h-4" /> : 'Sync now'}</button>}
      </div>
      {data ? (
        <div className="flex items-center gap-4">
          <Platform name={platform} className="w-12 h-12" />
          <div className="flex-1">{renderConnected(data)}</div>
          <span className="pill bg-avail-bg text-avail-fg capitalize">{data.status}</span>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">No {label} account connected. Optional — helps brands see your full social presence.</p>
          <button onClick={connect} disabled={connecting} className="btn-brand text-sm shrink-0 ml-3">
            {connecting ? <Spinner className="w-4 h-4" /> : `Connect ${label}`}
          </button>
        </div>
      )}
    </div>
  );
}

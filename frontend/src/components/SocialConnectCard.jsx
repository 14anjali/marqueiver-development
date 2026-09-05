import { useState, useEffect } from 'react';
import { Platform, Check } from './icons';
import { Spinner, useToast } from '../lib/ui-state';

/**
 * Connect / sync / disconnect card for a social platform.
 *
 * Disconnect (scope §16, A73) asks for confirmation first, calls the backend,
 * and then clears local state so the platform immediately shows as connectable
 * again — the connection is removed server-side, not just hidden in the UI.
 * `onChange` lets the parent re-check how many platforms remain connected,
 * which matters because dashboard access requires at least one (A71).
 */
export default function SocialConnectCard({
  platform, label, fetchProfile, getAuthUrl, sync, disconnect, renderConnected, successParam, onChange,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  useEffect(() => {
    fetchProfile()
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (!successParam) return;
    const params = new URLSearchParams(window.location.search);
    const val = params.get(successParam);
    if (val === 'connected') toast.push(`${label} connected`, 'success');
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
    try {
      const { data } = await sync();

      /**
       * Sync now answers `{ page | account, sync }` — the report says which
       * steps refreshed and which could not, so a partial run can be reported
       * rather than stale numbers being presented as current. Unwrapped here,
       * with a fallback to the bare object so a platform still on the old
       * shape (YouTube) keeps working.
       */
      setData(data.page ?? data.account ?? data);

      const failed = Object.entries(data.sync?.steps ?? {})
        .filter(([, s]) => s.status === 'failed');

      toast.push(
        failed.length
          ? `${label} synced, but ${failed.length} part(s) could not refresh`
          : `${label} synced`,
        failed.length ? 'info' : 'success',
      );
    } catch (e) { toast.push(e.message, 'error'); } finally { setSyncing(false); }
  }

  async function doDisconnect() {
    setDisconnecting(true);
    try {
      await disconnect();
      setData(null);
      setConfirming(false);
      toast.push(`${label} disconnected`, 'success');
      onChange?.();
    } catch (e) {
      toast.push(e.message, 'error');
    } finally { setDisconnecting(false); }
  }

  return (
    <div className="card p-6 mt-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-display font-bold text-ink flex items-center gap-2">
          <Platform name={platform} className="w-5 h-5" /> {label}
        </h3>
        {data && !confirming && (
          <div className="flex gap-2 shrink-0">
            {sync && (
              <button onClick={doSync} disabled={syncing} className="btn-outline text-sm py-1.5">
                {syncing ? <Spinner className="w-4 h-4" /> : 'Sync now'}
              </button>
            )}
            {disconnect && (
              <button
                onClick={() => setConfirming(true)}
                className="btn-ghost text-sm py-1.5 text-rose-600 border-rose-200 hover:bg-rose-50"
              >
                Disconnect
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted"><Spinner className="w-4 h-4" /> Checking connection…</div>
      ) : confirming ? (
        /* Confirmation is inline rather than a window.confirm so it matches the
           rest of the product and stays readable on mobile. */
        <div className="rounded-xl2 border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm text-ink font-medium">Disconnect {label}?</p>
          <p className="text-sm text-muted mt-1">
            Your {label} stats will stop updating on your profile and brands will no longer see them.
            You can reconnect at any time.
          </p>
          <div className="flex gap-2 mt-4">
            <button onClick={doDisconnect} disabled={disconnecting} className="btn text-white bg-rose-600 hover:bg-rose-700 text-sm">
              {disconnecting ? <Spinner className="w-4 h-4" /> : `Yes, disconnect`}
            </button>
            <button onClick={() => setConfirming(false)} disabled={disconnecting} className="btn-ghost text-sm">Keep connected</button>
          </div>
        </div>
      ) : data ? (
        <div className="flex items-center gap-4">
          <Platform name={platform} className="w-12 h-12" />
          <div className="flex-1 min-w-0">{renderConnected(data)}</div>
          <span className="pill-done capitalize shrink-0"><Check className="w-3 h-3" /> {data.status || 'connected'}</span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            No {label} account connected. Connecting lets brands see verified audience data.
          </p>
          <button onClick={connect} disabled={connecting} className="btn-brand text-sm shrink-0">
            {connecting ? <Spinner className="w-4 h-4" /> : `Connect ${label}`}
          </button>
        </div>
      )}
    </div>
  );
}
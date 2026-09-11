import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Platform, Check } from './icons';
import { Skeleton } from './feedback';
import { ConfirmDialog } from './overlay';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';
import { Spinner, useToast } from '../lib/ui-state';

/**
 * Connect / sync / disconnect card for a social platform.
 *
 * Disconnect (scope §16, A73) asks for confirmation first, calls the backend,
 * and then clears local state so the platform immediately shows as connectable
 * again — the connection is removed server-side, not just hidden in the UI.
 * `onChange` lets the parent re-check how many platforms remain connected,
 * which matters because dashboard access requires at least one (A71).
 *
 * Disconnecting is irreversible in the sense that matters — the stats a brand
 * is looking at stop updating — so it goes through the shared `ConfirmDialog`
 * rather than an inline panel that pushed the rest of the card down the page.
 * The dialog also traps focus and returns it, which the inline panel did not.
 *
 * Instagram used to have its own fifty-line copy of this card written inline in
 * ProfilePage, with its own connect, sync, disconnect and confirm. It is a
 * caller of this component now, so all three platforms behave identically.
 *
 * Two presentation props, both defaulting to the original behaviour:
 *
 *   `bare`            drop the card chrome and the heading. The Account Center
 *                     already wraps each platform in a titled section, and a
 *                     card inside a card with the platform named twice reads as
 *                     a mistake.
 *   `disconnectOnly`  show the connected state and Disconnect, nothing else.
 *                     Used for "disconnect Facebook entirely", where offering
 *                     Connect or Sync beside a list of individually managed
 *                     Pages would be ambiguous about what it acts on.
 */
export default function SocialConnectCard({
  platform, label, fetchProfile, getAuthUrl, sync, disconnect, renderConnected, successParam, onChange,
  bare = false, disconnectOnly = false,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const reduced = usePrefersReducedMotion();
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

  // `disconnectOnly` hides the two actions that are ambiguous in that context;
  // it never hides Disconnect, which is the reason the card is rendered at all.
  const showSync = Boolean(sync) && !disconnectOnly;
  const showConnect = Boolean(getAuthUrl) && !disconnectOnly;

  const body = (
    <>
      {!bare && (
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="font-display font-bold text-ink flex items-center gap-2">
            <Platform name={platform} className="w-5 h-5" /> {label}
          </h3>
          {data && (
            <div className="flex gap-2 shrink-0">
              {showSync && (
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
      )}

      {loading ? (
        /* Shaped like the connected row, so the card does not resize when the
           answer arrives. The spinner-and-sentence it replaced was a different
           height from both outcomes. */
        <div className="flex items-center gap-4" aria-busy="true" aria-live="polite" aria-label={`Checking your ${label} connection`}>
          <Skeleton className="w-12 h-12" circle />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-4 w-40 max-w-full rounded" />
            <Skeleton className="h-3 w-52 max-w-full rounded mt-2" />
          </div>
        </div>
      ) : data ? (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <Platform name={platform} className="w-12 h-12 shrink-0" />
              <div className="flex-1 min-w-0">{renderConnected(data)}</div>
            </div>
            <span className="pill-done capitalize shrink-0 w-fit">
              <Check className="w-3 h-3" /> {data.status || 'connected'}
            </span>
          </div>

          {/* Without the header there is nowhere else for these to live. */}
          {bare && (showSync || disconnect) && (
            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-line/70">
              {showSync && (
                <button onClick={doSync} disabled={syncing} className="btn-outline text-xs py-1.5">
                  {syncing ? <><Spinner className="w-3.5 h-3.5" /> Syncing…</> : 'Sync now'}
                </button>
              )}
              {disconnect && (
                <button
                  onClick={() => setConfirming(true)}
                  className="btn-ghost text-xs py-1.5 text-muted hover:text-rose-600 sm:ml-auto"
                >
                  Disconnect
                </button>
              )}
            </div>
          )}
        </div>
      ) : disconnectOnly ? (
        // Nothing connected and nothing this card can do about it — the Pages
        // list above already offers Connect.
        <p className="text-sm text-muted">No {label} authorisation to remove.</p>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-muted">
            No {label} account connected. Connecting lets brands see verified audience data.
          </p>
          {showConnect && (
            <button onClick={connect} disabled={connecting} className="btn-brand text-sm shrink-0 justify-center">
              {connecting ? <><Spinner className="w-4 h-4" /> Opening {label}…</> : `Connect ${label}`}
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={doDisconnect}
        busy={disconnecting}
        tone="danger"
        title={`Disconnect ${label}?`}
        description={`Your ${label} stats will stop updating on your profile and brands will no longer see them. You can reconnect at any time.`}
        confirmLabel="Yes, disconnect"
        cancelLabel="Keep connected"
      />
    </>
  );

  if (bare) return body;

  return (
    <motion.div
      variants={withReducedMotion(rise, reduced)}
      initial="hidden"
      animate="visible"
      className="card-edge p-5 sm:p-6 mt-5"
    >
      {body}
    </motion.div>
  );
}
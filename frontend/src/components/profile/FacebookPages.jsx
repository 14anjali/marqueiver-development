import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../lib/api';
import { Spinner, useToast, ErrorBlock } from '../../lib/ui-state';
import { Skeleton, StatusPill } from '../feedback';
import { Modal, ConfirmDialog } from '../overlay';
import { Platform, Check, Star, X } from '../icons';
import { rise, stagger, withReducedMotion, usePrefersReducedMotion } from '../../lib/motion';
import { followerCount } from './shared';

/**
 * Facebook Pages — several of them.
 *
 * A creator may administer more than one Page, and until now Marqueiver stored
 * exactly one: `FacebookPage.user` was a unique index, and every endpoint
 * resolved "the" Page with `findOne({ user })`. Connecting a second Page
 * replaced the first.
 *
 * The backend now keeps one row per Page. Three rules shape this screen:
 *
 *  1. **One Page is primary.** `CreatorProfile.socialAccounts` carries a single
 *     handle-and-follower pair per platform, and folding three Pages into one
 *     pair would misstate which audience belongs to which account. The creator
 *     nominates the Page that represents them; the others are managed here
 *     without affecting discovery. That is stated on the card rather than left
 *     to be inferred, because "why do brands only see one of my Pages" is the
 *     obvious question.
 *  2. **Duplicates are impossible, not merely discouraged.** `facebookPageId`
 *     is globally unique, so a Page cannot be added twice by one person nor
 *     claimed by two. The picker marks what is already connected and disables
 *     it; the server would refuse anyway.
 *  3. **Removing a Page is not disconnecting Facebook.** Per-Page removal
 *     leaves the others alone. "Disconnect Facebook" — all Pages, the
 *     authorisation, everything — stays available and is clearly separated.
 */
export default function FacebookPages({ onChange }) {
  const [pages, setPages] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const [picker, setPicker] = useState(false);
  const [available, setAvailable] = useState(null);
  const [availableError, setAvailableError] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [adding, setAdding] = useState(false);

  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [removingBusy, setRemovingBusy] = useState(false);
  const [primaryBusy, setPrimaryBusy] = useState(null);

  const reduced = usePrefersReducedMotion();
  const toast = useToast();

  /* ── the Pages this user has connected ─────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    setError(null);
    api.connectedFacebookPages()
      .then(({ data }) => { if (alive) setPages(data ?? []); })
      .catch((e) => {
        if (!alive) return;
        /*
          A 404 means "no Facebook connected", which is a normal empty state,
          not a failure. Anything else is a real error and gets the error block
          with a retry — the version this replaces caught everything and
          rendered "not connected", so a broken API looked like a creator who
          had never connected.
        */
        if (e.status === 404) setPages([]);
        else setError(e);
      });
    return () => { alive = false; };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  /* ── connect (first time, or re-authorise to reach more Pages) ─────────── */
  async function startConnect() {
    setConnecting(true);
    try {
      const { data } = await api.facebookAuthUrl();
      window.location.href = data.authUrl;
    } catch (e) {
      toast.push(e.message, 'error');
      setConnecting(false);
    }
  }

  /* ── the picker ────────────────────────────────────────────────────────── */
  async function openPicker() {
    setPicker(true);
    setAvailable(null);
    setAvailableError(null);
    setChosen([]);
    try {
      const { data } = await api.facebookPages();
      setAvailable(data);
    } catch (e) {
      setAvailableError(e);
    }
  }

  async function addChosen() {
    if (!chosen.length) return;
    setAdding(true);
    try {
      await api.selectFacebookPages(chosen);
      toast.push(
        chosen.length === 1 ? 'Page connected' : `${chosen.length} Pages connected`,
        'success',
      );
      setPicker(false);
      reload();
      onChange?.();
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setAdding(false);
    }
  }

  /* ── per-Page actions ──────────────────────────────────────────────────── */
  async function syncOne(page) {
    setSyncingId(page.facebookPageId);
    try {
      const { data } = await api.syncFacebookPage(page.facebookPageId);
      const failed = Object.entries(data?.sync?.steps ?? {})
        .filter(([, s]) => s.status === 'failed');
      toast.push(
        failed.length
          ? `${page.name} synced, but ${failed.length} part(s) could not refresh`
          : `${page.name} synced`,
        failed.length ? 'info' : 'success',
      );
      reload();
      onChange?.();
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setSyncingId(null);
    }
  }

  async function makePrimary(page) {
    setPrimaryBusy(page.facebookPageId);
    try {
      await api.setPrimaryFacebookPage(page.facebookPageId);
      toast.push(`${page.name} is now shown on your profile`, 'success');
      reload();
      onChange?.();
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setPrimaryBusy(null);
    }
  }

  async function removeOne() {
    if (!removing) return;
    setRemovingBusy(true);
    try {
      await api.disconnectFacebookPage(removing.facebookPageId);
      toast.push(`${removing.name} removed`, 'success');
      setRemoving(null);
      reload();
      onChange?.();
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setRemovingBusy(false);
    }
  }

  /* ── render ────────────────────────────────────────────────────────────── */

  if (error) {
    return <ErrorBlock error={error} onRetry={reload} />;
  }

  if (!pages) {
    return (
      <div aria-busy="true" aria-live="polite" aria-label="Loading your Facebook Pages" className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl2 border border-line p-4 flex items-center gap-4">
            <Skeleton className="w-12 h-12" circle />
            <div className="flex-1 min-w-0">
              <Skeleton className="h-4 w-40 max-w-full rounded" />
              <Skeleton className="h-3 w-28 rounded mt-2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!pages.length) {
    return (
      <>
        <div className="rounded-xl3 border border-dashed border-line bg-gradient-to-br from-brand-50/50 to-pink-50/40
                        p-7 text-center">
          <Platform name="facebook" className="w-12 h-12 mx-auto" />
          <p className="font-display font-bold text-ink mt-4">No Facebook Page connected</p>
          <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-sm mx-auto">
            Connect the Pages you run. Brands see verified follower and engagement figures rather
            than numbers you typed in, and you can connect more than one.
          </p>
          <button
            onClick={startConnect}
            disabled={connecting}
            className="btn-brand mt-5 justify-center mx-auto"
          >
            {connecting ? <><Spinner className="w-4 h-4" /> Opening Facebook…</> : 'Connect Facebook'}
          </button>
        </div>
        {pickerModal()}
      </>
    );
  }

  return (
    <>
      <motion.div
        variants={withReducedMotion(stagger, reduced)}
        initial="hidden"
        animate="visible"
        className="space-y-3"
      >
        <AnimatePresence initial={false}>
          {pages.map((page) => (
            <PageCard
              key={page.facebookPageId}
              page={page}
              reduced={reduced}
              syncing={syncingId === page.facebookPageId}
              primaryBusy={primaryBusy === page.facebookPageId}
              onSync={() => syncOne(page)}
              onPrimary={() => makePrimary(page)}
              onRemove={() => setRemoving(page)}
            />
          ))}
        </AnimatePresence>
      </motion.div>

      <div className="flex flex-col sm:flex-row gap-2 mt-4">
        <button onClick={openPicker} className="btn-outline justify-center">
          + Add another Page
        </button>
        <button
          onClick={startConnect}
          disabled={connecting}
          className="btn-ghost justify-center text-muted"
        >
          {connecting ? <Spinner className="w-4 h-4" /> : 'Re-authorise with Facebook'}
        </button>
      </div>

      <p className="text-xs text-muted mt-3 leading-relaxed">
        Only seeing some of your Pages? Facebook grants access per Page, so re-authorising and
        ticking the missing ones on Facebook&rsquo;s screen is what makes them available here.
      </p>

      {pickerModal()}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={removeOne}
        busy={removingBusy}
        tone="danger"
        title={`Remove ${removing?.name ?? 'this Page'}?`}
        description={
          removing?.isPrimary && pages.length > 1
            ? 'This is the Page shown on your public profile. Another connected Page will take its place, and its figures will stop updating.'
            : pages.length === 1
              ? 'This is your only connected Page, so Facebook will no longer appear on your profile. You can reconnect at any time.'
              : 'Its figures will stop updating and it will no longer appear here. Your other Pages are unaffected.'
        }
        confirmLabel="Remove Page"
        cancelLabel="Keep it"
      />
    </>
  );

  /* The picker is used from two places, so it is defined once. */
  function pickerModal() {
    const alreadyConnected = new Set(pages?.map((p) => p.facebookPageId) ?? []);

    return (
      <Modal
        open={picker}
        onClose={() => !adding && setPicker(false)}
        title="Add a Facebook Page"
        description="These are the Pages your Facebook account can manage. Tick the ones to connect."
        dismissible={!adding}
        size="lg"
        footer={(
          <>
            <button onClick={() => setPicker(false)} disabled={adding} className="btn-ghost">
              Cancel
            </button>
            <button
              onClick={addChosen}
              disabled={adding || !chosen.length}
              className="btn-brand justify-center"
            >
              {adding
                ? <><Spinner className="w-4 h-4" /> Connecting…</>
                : `Connect ${chosen.length || ''} Page${chosen.length === 1 ? '' : 's'}`.replace('  ', ' ')}
            </button>
          </>
        )}
      >
        {availableError ? (
          <ErrorBlock error={availableError} onRetry={openPicker} />
        ) : !available ? (
          <div aria-busy="true" aria-live="polite" aria-label="Reading your Pages from Facebook" className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl2 border border-line">
                <Skeleton className="w-10 h-10" circle />
                <div className="flex-1">
                  <Skeleton className="h-4 w-36 max-w-full rounded" />
                  <Skeleton className="h-3 w-24 rounded mt-2" />
                </div>
              </div>
            ))}
          </div>
        ) : !available.pages?.length ? (
          <div className="text-center py-6">
            <p className="text-sm text-ink font-medium">Facebook returned no Pages</p>
            <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-sm mx-auto">
              Your account did not grant access to any Page. Create a Page, or ask its owner for a
              role on it, then re-authorise.
            </p>
          </div>
        ) : (
          <ul className="space-y-2 max-h-[45vh] overflow-y-auto -mx-1 px-1">
            {available.pages.map((p) => {
              const connected = p.connected || alreadyConnected.has(p.id);
              const ticked = chosen.includes(p.id);

              return (
                <li key={p.id}>
                  <label
                    className={`flex items-center gap-3 p-3 rounded-xl2 border transition-colors
                                ${connected
                                  ? 'border-line bg-bg cursor-default'
                                  : ticked
                                    ? 'border-brand-300 bg-brand-50/60 cursor-pointer'
                                    : 'border-line hover:border-brand-200 cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      // Already-connected Pages cannot be ticked. The server
                      // would refuse a duplicate anyway; disabling it here means
                      // the person is not offered an action that cannot happen.
                      disabled={connected}
                      checked={ticked}
                      onChange={() => setChosen((c) => (
                        c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id]
                      ))}
                    />

                    <span
                      className={`w-5 h-5 rounded-md border grid place-items-center shrink-0 transition-colors
                                  ${connected
                                    ? 'bg-jade-50 border-jade-200 text-jade-600'
                                    : ticked
                                      ? 'bg-brand-600 border-brand-600 text-white'
                                      : 'border-line'}`}
                      aria-hidden="true"
                    >
                      {(ticked || connected) && <Check className="w-3.5 h-3.5" />}
                    </span>

                    {p.picture
                      ? <img src={p.picture} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                      : <Platform name="facebook" className="w-10 h-10 shrink-0" />}

                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink truncate">{p.name}</span>
                      <span className="block text-xs text-muted truncate">
                        {p.category ? `${p.category} · ` : ''}
                        {followerCount(p.followers ?? 0)} followers
                      </span>
                    </span>

                    {connected && <span className="pill-done shrink-0">Connected</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
    );
  }
}

/* ─────────────────────────────── the card ──────────────────────────────────── */

function PageCard({ page, reduced, syncing, primaryBusy, onSync, onPrimary, onRemove }) {
  const canPublish = page.canPublish;
  const canModerate = page.canModerate;

  return (
    <motion.article
      layout
      variants={withReducedMotion(rise, reduced)}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      className={`rounded-xl3 border p-4 sm:p-5 transition-colors
                  ${page.isPrimary
                    ? 'border-brand-200 bg-gradient-to-br from-brand-50/60 to-pink-50/40'
                    : 'border-line bg-white'}`}
    >
      <div className="flex items-start gap-4">
        {page.profilePicture
          ? <img src={page.profilePicture} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
          : <Platform name="facebook" className="w-12 h-12 shrink-0" />}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-ink truncate">{page.name}</h3>
            {page.isPrimary && (
              <span className="pill bg-gradient-to-r from-brand-600 to-pink-600 text-white shrink-0">
                <Star className="w-3 h-3" fill="currentColor" /> On your profile
              </span>
            )}
            {page.status && page.status !== 'connected' && (
              <StatusPill status="pending_review" label="Needs attention" />
            )}
          </div>

          <p className="text-sm text-muted mt-0.5">
            {page.category ? `${page.category} · ` : ''}
            <span className="tnum">{followerCount(page.followersCount)}</span> followers
            {typeof page.likesCount === 'number' && page.likesCount > 0 && (
              <> · <span className="tnum">{followerCount(page.likesCount)}</span> likes</>
            )}
          </p>

          {/*
            What Facebook actually lets this person do on this Page, from Graph
            `tasks`. Shown so a missing capability is visible here rather than
            discovered by a publish that fails.
          */}
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <Capability on={canPublish} label="Publish" />
            <Capability on={canModerate} label="Moderate comments" />
          </div>

          {page.lastSyncedAt && (
            <p className="text-[11px] text-muted mt-2">
              Last synced {new Date(page.lastSyncedAt).toLocaleString('en-IN')}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-line/70">
        <button onClick={onSync} disabled={syncing} className="btn-outline text-xs py-1.5">
          {syncing ? <><Spinner className="w-3.5 h-3.5" /> Syncing…</> : 'Sync now'}
        </button>

        {!page.isPrimary && (
          <button
            onClick={onPrimary}
            disabled={primaryBusy}
            className="btn-ghost text-xs py-1.5 text-brand-700"
          >
            {primaryBusy ? <Spinner className="w-3.5 h-3.5" /> : 'Show this on my profile'}
          </button>
        )}

        <button
          onClick={onRemove}
          className="btn-ghost text-xs py-1.5 text-muted hover:text-rose-600 sm:ml-auto"
        >
          <X className="w-3.5 h-3.5" /> Remove
        </button>
      </div>
    </motion.article>
  );
}

function Capability({ on, label }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border
                  ${on
                    ? 'border-jade-200 bg-jade-50 text-jade-700'
                    : 'border-line bg-bg text-muted'}`}
    >
      {on ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
      {label}
    </span>
  );
}
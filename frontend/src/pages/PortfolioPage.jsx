import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import AppPage from '../components/AppPage';
import { ConfirmDialog } from '../components/overlay';
import { Progress } from '../components/feedback';
import { Image, Play, X } from '../components/icons';
import { api } from '../lib/api';
import { Spinner, useToast } from '../lib/ui-state';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * A creator's work samples — the thing brands actually judge them on.
 *
 * Three fixes beyond the visual treatment:
 *
 *  1. **Delete had no confirmation.** A hover-revealed × removed a portfolio
 *     item permanently on one click, and the button sat directly over the image
 *     it destroyed.
 *  2. **No size or type guard.** A 200MB video was attempted and failed
 *     somewhere in the network layer with a provider error.
 *  3. **No broken-image handling.** A dead media URL rendered as the browser's
 *     default broken-image glyph on a black tile.
 */

const MAX_MB = 50;

export default function PortfolioPage() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(() => new Set());
  const toast = useToast();
  const reduced = usePrefersReducedMotion();

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.myProfile(); setProfile(data); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  async function onPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_MB * 1024 * 1024) {
      toast.push(`That file is ${(file.size / 1024 / 1024).toFixed(0)}MB — the limit is ${MAX_MB}MB.`, 'error');
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const { data: urls } = await api.portfolioUploadUrl(file.name, file.type);
      // Mock storage returns a usable publicUrl immediately; a real provider
      // needs the PUT first.
      if (urls?.uploadUrl && !urls.uploadUrl.includes('mock-storage')) {
        await fetch(urls.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      }
      const { data: portfolio } = await api.addPortfolioItem({
        title: file.name.replace(/\.[^.]+$/, ''),
        mediaUrl: urls.publicUrl,
        mediaType: file.type.startsWith('video') ? 'video' : 'image',
      });
      setProfile((p) => ({ ...p, portfolio }));
      toast.push('Added to your portfolio', 'success');
    } catch (err) { toast.push(err.message, 'error'); }
    finally { setUploading(false); e.target.value = ''; }
  }

  async function remove(item) {
    setBusy(true);
    try {
      const { data: portfolio } = await api.deletePortfolioItem(item._id);
      setProfile((p) => ({ ...p, portfolio }));
      toast.push('Removed', 'success');
      setRemoving(null);
    } catch (e) { toast.push(e.message, 'error'); }
    finally { setBusy(false); }
  }

  const items = profile?.portfolio ?? [];

  const addButton = (
    <label className={`btn-cta text-sm cursor-pointer ${uploading ? 'opacity-70 pointer-events-none' : ''}`}>
      {uploading ? <><Spinner className="w-4 h-4" /> Uploading…</> : <><Image className="w-4 h-4" /> Add work</>}
      <input
        type="file" accept="image/*,video/*" className="hidden"
        onChange={onPick} disabled={uploading}
      />
    </label>
  );

  return (
    <>
      <AppPage
        title="Portfolio"
        description="Your best work, shown on your public profile. This is usually the first thing a brand looks at."
        width="max-w-[1000px]"
        loading={loading}
        error={error}
        onRetry={load}
        isEmpty={!items.length}
        emptyTitle="Nothing in your portfolio yet"
        emptySub="Add a reel, a post or a short video. Brands shortlist on work far more than on follower counts."
        emptyIcon={<Image className="w-6 h-6" />}
        emptyAction={addButton}
        actions={items.length > 0 ? addButton : null}
        skeletonRows={2}
      >
        {uploading && (
          <div className="card p-4 mb-4">
            <Progress value={100} max={100} label="Uploading" />
            <p className="text-xs text-muted mt-2">Large videos can take a moment.</p>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
          {items.map((item) => {
            const isBroken = broken.has(item._id);
            return (
              <motion.figure
                key={item._id}
                variants={withReducedMotion(rise, reduced)}
                className="relative group rounded-xl2 overflow-hidden border border-line bg-bg aspect-[3/4]
                           transition-shadow duration-200 hover:shadow-cardhover"
              >
                {isBroken ? (
                  // A dead URL says so, instead of showing the browser's
                  // broken-image glyph on a creator's own portfolio.
                  <div className="w-full h-full grid place-items-center text-center p-3">
                    <span className="text-muted">
                      <Image className="w-6 h-6 mx-auto mb-1.5 opacity-50" />
                      <span className="text-[11px] block leading-snug">This file could not be loaded</span>
                    </span>
                  </div>
                ) : (
                  <img
                    src={item.thumbnailUrl || item.mediaUrl}
                    alt={item.title || 'Portfolio item'}
                    loading="lazy"
                    onError={() => setBroken((s) => new Set(s).add(item._id))}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                )}

                {item.mediaType === 'video' && !isBroken && (
                  <span
                    className="absolute bottom-2 left-2 text-white inline-flex items-center gap-1
                               bg-black/45 rounded px-1.5 py-1 backdrop-blur-sm"
                    aria-label="Video"
                  >
                    <Play className="w-3 h-3" />
                  </span>
                )}

                <button
                  onClick={() => setRemoving(item)}
                  aria-label={`Remove ${item.title || 'this item'}`}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/55 text-white
                             grid place-items-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100
                             transition-opacity backdrop-blur-sm focusable"
                >
                  <X className="w-3.5 h-3.5" />
                </button>

                {item.title && (
                  <figcaption className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent
                                         p-2 pt-6 text-white text-xs font-medium truncate">
                    {item.title}
                  </figcaption>
                )}
              </motion.figure>
            );
          })}
        </div>
      </AppPage>

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => remove(removing)}
        busy={busy}
        tone="danger"
        title="Remove from your portfolio?"
        description={`“${removing?.title || 'This item'}” stops appearing on your public profile. This cannot be undone — you would need to upload it again.`}
        confirmLabel="Remove"
      />
    </>
  );
}

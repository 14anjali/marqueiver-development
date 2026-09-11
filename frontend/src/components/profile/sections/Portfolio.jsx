import { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../../lib/api';
import { Spinner, useToast } from '../../../lib/ui-state';
import { ConfirmDialog } from '../../overlay';
import { Image as ImageIcon, Play, X } from '../../icons';
import { rise, stagger, withReducedMotion, usePrefersReducedMotion } from '../../../lib/motion';
import { SectionCard, SaveButton, Field, uploadFile } from '../shared';

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Work samples, and a link to wherever the real book lives.
 *
 * Two different things, deliberately kept apart. `portfolio` is an array of
 * files hosted by us and shown inline on the profile; `portfolioLink` is an
 * external URL — plenty of creators keep their book on Behance, a Drive folder
 * or their own site, and before this there was nowhere to put that, so it ended
 * up in the bio where it is neither clickable nor structured.
 */
export default function Portfolio({ profile, onSaved }) {
  const [link, setLink] = useState(profile.portfolioLink ?? '');
  const [savingLink, setSavingLink] = useState(false);
  const [linkError, setLinkError] = useState(null);

  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [removingBusy, setRemovingBusy] = useState(false);

  const fileRef = useRef(null);
  const reduced = usePrefersReducedMotion();
  const toast = useToast();

  const items = profile.portfolio ?? [];
  const linkDirty = link !== (profile.portfolioLink ?? '');

  const normalisedLink = useMemo(() => {
    const value = link.trim();
    if (!value) return '';
    // Someone typing "behance.net/me" means a URL; the server's `z.string().url()`
    // would reject it, with an error that reads like the link is invalid rather
    // than merely unprefixed.
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }, [link]);

  async function saveLink() {
    setLinkError(null);

    if (normalisedLink) {
      try {
        // eslint-disable-next-line no-new
        new URL(normalisedLink);
      } catch {
        setLinkError('That does not look like a web address.');
        return;
      }
    }

    setSavingLink(true);
    try {
      const { data } = await api.updateCreator({ portfolioLink: normalisedLink });
      onSaved(data);
      setLink(data.portfolioLink ?? '');
      toast.push(normalisedLink ? 'Portfolio link saved' : 'Portfolio link removed', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setSavingLink(false);
    }
  }

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      toast.push('Work samples must be an image or a video', 'error');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.push(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 25MB.`, 'error');
      return;
    }

    setUploading(true);
    try {
      const mediaUrl = await uploadFile(file, api.portfolioUploadUrl);
      const { data: portfolio } = await api.addPortfolioItem({
        title: file.name.replace(/\.[^.]+$/, ''),
        mediaUrl,
        mediaType: isVideo ? 'video' : 'image',
      });
      onSaved({ ...profile, portfolio });
      toast.push('Added to your portfolio', 'success');
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function removeItem() {
    if (!removing) return;
    setRemovingBusy(true);
    try {
      const { data: portfolio } = await api.deletePortfolioItem(removing._id);
      onSaved({ ...profile, portfolio });
      setRemoving(null);
      toast.push('Removed', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setRemovingBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Portfolio link"
        description="If your work lives somewhere else — Behance, a Drive folder, your own site — put the link here and brands can open it from your profile."
        footer={<SaveButton onClick={saveLink} busy={savingLink} dirty={linkDirty} label="Save link" />}
      >
        <Field
          id="pf-link"
          label="Link"
          type="url"
          value={link}
          onChange={setLink}
          error={linkError}
          placeholder="behance.net/yourname"
          hint="We will add https:// if you leave it off."
        />

        {profile.portfolioLink && !linkDirty && (
          <a
            href={profile.portfolioLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700
                       hover:text-brand-800 mt-3 focusable"
          >
            Open your portfolio →
          </a>
        )}
      </SectionCard>

      <SectionCard
        title="Work samples"
        description="Shown directly on your profile. Images and video, up to 25MB each."
        actions={
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="btn-brand text-sm justify-center"
          >
            {uploading ? <><Spinner className="w-4 h-4" /> Uploading…</> : '+ Add a sample'}
          </button>
        }
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          className="sr-only"
          onChange={pickFile}
        />

        {!items.length ? (
          <div className="rounded-xl2 border border-dashed border-line bg-gradient-to-br
                          from-brand-50/40 to-pink-50/30 p-8 text-center">
            <span className="w-12 h-12 rounded-xl2 bg-white border border-line grid place-items-center mx-auto">
              <ImageIcon className="w-5 h-5 text-brand-400" />
            </span>
            <p className="font-display font-bold text-ink mt-4">Nothing here yet</p>
            <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-sm mx-auto">
              Showing what you make is more convincing than describing it. Three or four of your
              best pieces is plenty.
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="btn-outline mt-5 mx-auto justify-center"
            >
              {uploading ? <><Spinner className="w-4 h-4" /> Uploading…</> : 'Upload your first sample'}
            </button>
          </div>
        ) : (
          <motion.div
            variants={withReducedMotion(stagger, reduced)}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-2 sm:grid-cols-3 gap-3"
          >
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.figure
                  key={item._id}
                  layout
                  variants={withReducedMotion(rise, reduced)}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                  className="group relative rounded-xl2 overflow-hidden border border-line bg-bg
                             aspect-square"
                >
                  {item.mediaType === 'video' ? (
                    <>
                      <video
                        src={item.mediaUrl}
                        className="w-full h-full object-cover"
                        preload="metadata"
                        muted
                      />
                      <span className="absolute inset-0 grid place-items-center pointer-events-none">
                        <span className="w-9 h-9 rounded-full bg-ink/60 backdrop-blur-sm grid place-items-center">
                          <Play className="w-4 h-4 text-white" />
                        </span>
                      </span>
                    </>
                  ) : (
                    <img
                      src={item.mediaUrl}
                      alt={item.title || 'Work sample'}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform duration-300
                                 group-hover:scale-[1.03]"
                    />
                  )}

                  {/* The caption sits over a gradient rather than a flat scrim,
                      so a light image keeps the text readable without dimming
                      the whole picture. */}
                  <figcaption className="absolute inset-x-0 bottom-0 p-2.5 pt-6 bg-gradient-to-t
                                         from-ink/75 to-transparent">
                    <span className="block text-[11px] font-medium text-white truncate">
                      {item.title || 'Untitled'}
                    </span>
                  </figcaption>

                  <button
                    onClick={() => setRemoving(item)}
                    aria-label={`Remove ${item.title || 'this sample'}`}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 backdrop-blur-sm
                               text-muted hover:text-rose-600 grid place-items-center shadow-flat
                               opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity
                               focusable"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </motion.figure>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </SectionCard>

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={removeItem}
        busy={removingBusy}
        tone="danger"
        title="Remove this sample?"
        description={`"${removing?.title || 'This piece'}" will be taken off your profile. This cannot be undone — you would need to upload it again.`}
        confirmLabel="Remove"
        cancelLabel="Keep it"
      />
    </div>
  );
}
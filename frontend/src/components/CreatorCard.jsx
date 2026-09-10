import { useState } from 'react';
import { motion } from 'framer-motion';
import { Avail, VerifiedName } from './ui';
import { Heart, MapPin, Platform } from './icons';
import { Money } from './feedback';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/ui-state';

/**
 * One creator in the discovery grid, and in a brand's saved shortlist.
 *
 * ── What this pass fixed ────────────────────────────────────────────────────
 *
 *  1. **Every card claimed the creator was available.** `<Avail />` took no
 *     input and always rendered "Available". `CreatorProfile.availability` is a
 *     real field with a switch on the creator's own profile page — a creator
 *     who turns it off is telling brands they are not taking work, and the
 *     product went on advertising them anyway. See `lib/normalize.js`, which
 *     was dropping the field before it ever reached here.
 *  2. **Every card drew a verification tick.** `VerifiedName` rendered
 *     `<Verified/>` unconditionally, so an unverified creator carried the same
 *     badge as a verified one. On a platform that sells verified audience data,
 *     that is the badge costing more than it earns — and it appeared on the
 *     first screen a brand ever sees.
 *  3. **The card could not be opened from a keyboard.** It was a `<div>` with
 *     `onClick` and nothing else: no role, no `tabIndex`, no key handler. The
 *     save button inside it was reachable by Tab; the creator behind it was
 *     not, which made discovery — the brand's main screen — unusable without a
 *     mouse.
 *  4. **The rate was plain text.** Ochre is money throughout Marqueiver, and
 *     "Starting from" is the one number on this card a brand is deciding on.
 *  5. **`group` with no `group-*` anywhere**, and a hover shadow doing all the
 *     work of saying the card is interactive.
 */
export default function CreatorCard({ c, onOpen, saved: savedProp = false, onSaveChange }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState(savedProp);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const reduced = usePrefersReducedMotion();
  const isBrand = user?.role === 'brand';

  async function toggleSave(e) {
    e.stopPropagation();
    if (!isBrand || busy) return;
    setBusy(true);
    const next = !saved;
    try {
      if (next) await api.saveCreator(c.id);
      else await api.unsaveCreator(c.id);
      setSaved(next);
      onSaveChange?.(c.id, next);
    } catch (err) {
      toast.push(err.message, 'error');
    } finally { setBusy(false); }
  }

  const open = () => onOpen?.(c);

  return (
    <motion.article
      variants={withReducedMotion(rise, reduced)}
      whileHover={reduced ? undefined : { y: -3 }}
      transition={{ duration: 0.2 }}
      /*
        A real control: reachable by Tab, activated by Enter or Space, and
        announced with the creator's name rather than as an anonymous group.
      */
      role="button"
      tabIndex={0}
      aria-label={`Open ${c.name}'s profile`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      }}
      className="card-interactive overflow-hidden cursor-pointer focusable group h-full flex flex-col"
    >
      {/* photo */}
      <div className="relative h-52 bg-brand-50 overflow-hidden">
        <img
          src={c.img}
          alt=""
          className="w-full h-full object-cover transition-transform duration-500
                     group-hover:scale-[1.03] motion-reduce:transform-none"
          loading="lazy"
        />

        {/* Only shown when we actually know, and truthful when we do. */}
        <span className="absolute top-3 left-3"><Avail available={c.available} /></span>

        {isBrand && (
          <button
            onClick={toggleSave}
            disabled={busy}
            aria-pressed={saved}
            className={`absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 backdrop-blur
                        flex items-center justify-center transition-all duration-200 focusable
                        disabled:opacity-60 ${
                          saved ? 'text-pink-500 scale-100' : 'text-muted hover:text-pink-500 hover:scale-110'}`}
            aria-label={saved ? `Remove ${c.name} from saved` : `Save ${c.name}`}
          >
            <Heart className={`w-4 h-4 ${saved ? 'fill-current' : ''}`} />
          </button>
        )}
      </div>

      <div className="p-4 flex-1 flex flex-col">
        <VerifiedName
          name={c.name}
          verified={c.verified}
          className="font-display font-bold text-ink"
        />
        {c.role && <p className="text-sm text-muted mt-0.5 truncate">{c.role}</p>}
        {c.city && (
          <p className="inline-flex items-center gap-1 text-sm text-muted mt-1 min-w-0">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{c.city}</span>
          </p>
        )}

        {/* total audience */}
        <div className="flex items-end justify-between gap-2 mt-3">
          <span className="chip">Total audience</span>
          <span className="font-display font-extrabold text-xl text-ink leading-none tnum">{c.total}</span>
        </div>

        {/* social row */}
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-line">
          {c.socials.map(([p, n]) => (
            <div key={p} className="flex flex-col items-center gap-1 flex-1 min-w-0">
              <Platform name={p} className="w-4 h-4" />
              <span className="text-[11px] text-muted font-medium tnum">{n}</span>
            </div>
          ))}
          {c.extra > 0 && (
            <div className="flex flex-col items-center gap-1 flex-1">
              <span className="w-4 h-4 rounded bg-bg text-[10px] text-muted flex items-center justify-center font-bold">
                +{c.extra}
              </span>
            </div>
          )}
        </div>

        {/* engagement + rate */}
        <div className="flex items-end justify-between gap-2 mt-3">
          <div>
            <p className="text-[11px] text-muted">Eng. rate</p>
            <p className="text-sm font-bold text-ink tnum">{c.engRate}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted">Starting from</p>
            {/*
              Ochre, like every other rupee figure in the product. It was plain
              ink, so the one number a brand is comparing across a grid of
              twenty cards looked like the rest of the label text.
            */}
            <p className="text-sm">
              {c.startRateValue != null
                ? <Money amount={c.startRateValue} className="!text-sm" />
                : <span className="text-muted">On request</span>}
            </p>
          </div>
        </div>

        {/* tags */}
        {c.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {c.tags.map((t) => <span key={t} className="pill bg-bg text-muted">{t}</span>)}
            {c.moreTags > 0 && <span className="pill bg-bg text-muted">+{c.moreTags}</span>}
          </div>
        )}
      </div>
    </motion.article>
  );
}

import { useState } from 'react';
import { Avail, VerifiedName } from './ui';
import { Heart, MapPin, Platform } from './icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/ui-state';

// Single creator card as in the discovery grid.
export default function CreatorCard({ c, onOpen, saved: savedProp = false, onSaveChange }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState(savedProp);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
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

  return (
    <div className="card overflow-hidden hover:shadow-cardhover transition group cursor-pointer" onClick={() => onOpen?.(c)}>
      {/* photo */}
      <div className="relative h-52 bg-brand-50">
        <img src={c.img} alt={c.name} className="w-full h-full object-cover" loading="lazy" />
        <span className="absolute top-3 left-3"><Avail /></span>
        {isBrand && (
          <button onClick={toggleSave} disabled={busy}
            className={`absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 backdrop-blur flex items-center justify-center transition ${saved ? 'text-pink-500' : 'text-muted hover:text-pink-500'}`}
            aria-label={saved ? 'Remove from saved' : 'Save creator'}>
            <Heart className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="p-4">
        <VerifiedName name={c.name} className="font-display font-bold text-ink" />
        <p className="text-sm text-muted mt-0.5">{c.role}</p>
        <p className="inline-flex items-center gap-1 text-sm text-muted mt-1"><MapPin className="w-3.5 h-3.5" />{c.city}</p>

        {/* total audience */}
        <div className="flex items-end justify-between mt-3">
          <span className="chip">Total Audience</span>
          <span className="font-display font-extrabold text-xl text-ink leading-none">{c.total}</span>
        </div>

        {/* social row */}
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-line">
          {c.socials.map(([p, n]) => (
            <div key={p} className="flex flex-col items-center gap-1 flex-1">
              <Platform name={p} className="w-4 h-4" />
              <span className="text-[11px] text-muted font-medium">{n}</span>
            </div>
          ))}
          {c.extra > 0 && (
            <div className="flex flex-col items-center gap-1 flex-1">
              <span className="w-4 h-4 rounded bg-bg text-[10px] text-muted flex items-center justify-center font-bold">+{c.extra}</span>
            </div>
          )}
        </div>

        {/* eng rate + starting from */}
        <div className="flex items-center justify-between mt-3">
          <div>
            <div className="text-[11px] text-muted">Eng. Rate</div>
            <div className="text-sm font-bold text-ink">{c.engRate}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-muted">Starting From</div>
            <div className="text-sm font-bold text-ink">{c.startRate}</div>
          </div>
        </div>

        {/* tags */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {c.tags.map((t) => <span key={t} className="pill bg-bg text-muted">{t}</span>)}
          {c.moreTags > 0 && <span className="pill bg-bg text-muted">+{c.moreTags}</span>}
        </div>
      </div>
    </div>
  );
}

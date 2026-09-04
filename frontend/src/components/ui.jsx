import { Verified, Star, MapPin } from './icons';

// The marqueiver sparkle logo (gradient 4-point star) + wordmark.
//
// `tone="light"` is for dark grounds — the auth screens sit on a deep aubergine
// field where the default ink wordmark is invisible. The wordmark inherits
// `currentColor` rather than hardcoding a colour, so a caller can also pass its
// own text colour through `className`.
export function Logo({ compact = false, tagline = false, tone = 'dark', className = '' }) {
  const light = tone === 'light';
  return (
    <div className={`flex items-center gap-2 ${light ? 'text-white' : 'text-ink'} ${className}`}>
      <img
        src="/MQ-logo.png"
        alt="Marqueiver"
        className="w-7 h-7 shrink-0 object-contain"
      />

      {!compact && (
        <div className="leading-none">
          <span className="font-display font-extrabold text-[19px] tracking-tight">
            marqueiver
          </span>

          {tagline && (
            <div className={`text-[10px] mt-0.5 ${light ? 'text-white/60' : 'text-muted'}`}>
              Powering Authentic Partnerships
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const Avail = ({ className = '' }) => (
  <span className={`pill bg-avail-bg text-avail-fg ${className}`}>Available</span>
);

export const VerifiedName = ({ name, className = '' }) => (
  <span className={`inline-flex items-center gap-1 ${className}`}>
    {name}<Verified className="w-[15px] h-[15px]" />
  </span>
);

export const Rating = ({ value, count, className = '' }) => (
  <span className={`inline-flex items-center gap-1 text-sm ${className}`}>
    <Star className="w-4 h-4" /><span className="font-semibold text-ink">{value}</span>
    {count != null && <span className="text-muted">({count})</span>}
  </span>
);

export const Location = ({ children }) => (
  <span className="inline-flex items-center gap-1 text-sm text-muted">
    <MapPin className="w-3.5 h-3.5" />{children}
  </span>
);

// vertical stat like "258.6K / Total Audience"
export const Stat = ({ value, label, accent }) => (
  <div className="text-center">
    <div className={`stat-num text-lg ${accent ? 'text-brand-600' : ''}`}>{value}</div>
    <div className="text-[11px] text-muted mt-0.5">{label}</div>
  </div>
);

export const SectionTitle = ({ children, action }) => (
  <div className="flex items-center justify-between mb-3">
    <h3 className="font-display font-bold text-ink">{children}</h3>
    {action}
  </div>
);

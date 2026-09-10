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

/**
 * Whether this creator is taking new work.
 *
 * It used to render "Available" unconditionally, with no input at all — every
 * creator card and every creator profile in the product claimed availability
 * regardless of the creator's own setting. `CreatorProfile.availability` is a
 * real, indexed field, the profile screen has a switch for it, and discovery
 * can filter on it; only the badge ignored it. So a creator who turned
 * themselves off was still advertised to brands as open for work — a promise
 * the product was making on their behalf, against what they had explicitly
 * said.
 *
 * `available` is required rather than defaulted to `true`, so a caller that has
 * not got the value renders nothing instead of silently claiming the good case.
 */
export const Avail = ({ available, className = '' }) => {
  if (available == null) return null;
  return available
    ? <span className={`pill bg-avail-bg text-avail-fg ${className}`}>Available</span>
    : <span className={`pill-quiet ${className}`}>Not taking work</span>;
};

/**
 * A name, with the verification tick only if there is a verification.
 *
 * The tick was unconditional here too. On a platform whose entire argument is
 * "the numbers are verified", drawing a verified badge next to every unverified
 * account is the most expensive possible thing to get wrong: it makes the badge
 * mean nothing, and it does so most visibly on the discovery grid, which is the
 * first thing a brand sees.
 */
export const VerifiedName = ({ name, verified = false, className = '' }) => (
  <span className={`inline-flex items-center gap-1 min-w-0 ${className}`}>
    <span className="truncate">{name}</span>
    {verified && (
      <Verified className="w-[15px] h-[15px] shrink-0" aria-label="Verified" />
    )}
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

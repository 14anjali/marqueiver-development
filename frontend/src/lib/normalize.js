// Maps raw backend documents into the shape our cards/pages render.
// Backend returns rich Mongo docs; the UI wants compact display fields.

const fmt = (n) => {
  if (n == null) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
};

export const rupee = (n) => '₹' + (n ?? 0).toLocaleString('en-IN');

// creator document → discovery card
export function creatorToCard(c) {
  const socials = (c.socialAccounts || []).slice(0, 5).map((s) => [s.platform, fmt(s.followers)]);
  const rate = (c.rateCard || []).reduce((min, r) => (min == null || r.price < min ? r.price : min), null);
  return {
    id: c._id || c.id,
    name: c.displayName || 'Creator',
    role: c.headline || '',
    city: [c.location?.city, c.location?.country].filter(Boolean).join(', '),
    img: c.avatarUrl || '',
    total: fmt(c.totalAudience),
    engRate: (c.avgEngagement ?? 0) + '%',
    startRate: rate != null ? rupee(rate) : '—',
    score: (c.creatorScore ?? 0) + '/100',
    socials,
    extra: Math.max(0, (c.socialAccounts?.length || 0) - 5),
    tags: (c.categories || []).slice(0, 3),
    moreTags: Math.max(0, (c.categories?.length || 0) - 3),

    /*
      Two fields this mapper used to drop, both of which the card then drew as
      unconditionally true.

      `availability` is a real indexed field with a switch on the creator's own
      profile page, and discovery can filter on it — but because it never
      reached the card, every creator was shown as "Available" whether or not
      they had turned themselves off. `verified` is worse: a verification tick
      beside an unverified account devalues it beside every verified one.

      Defaulted the safe way round: `availability` defaults to true server-side
      (a creator who has never touched the switch is taking work), and
      `verified` defaults to false, because an absent verification is not a
      verification.
    */
    available: c.availability !== false,
    verified: Boolean(c.verified),

    // The numeric rate as well as the formatted one — `Money` needs a number,
    // and "starting from ₹—" needs to be distinguishable from "starting from ₹0".
    startRateValue: rate,

    raw: c,
  };
}

export function brandToCard(b) {
  return {
    id: b._id || b.id,
    name: b.companyName,
    industry: b.industry,
    trust: b.trust?.overall ?? 0,
    verified: !!b.verifications?.business,
    raw: b,
  };
}

export { fmt };

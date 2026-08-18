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

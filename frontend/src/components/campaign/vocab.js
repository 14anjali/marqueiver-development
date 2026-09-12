/**
 * The campaign wizard's option lists.
 *
 * ── These mirror the server, and a test enforces it ────────────────────────
 *
 * The authoritative copies live in
 * `marqueiver-js/server/src/modules/campaigns/campaignBrief.schema.js`, which
 * validates every one of them at the API boundary. The frontend cannot import
 * across the two packages, so the lists are repeated here — and
 * `tests/campaign-brief.test.js` reads this file and asserts the two agree,
 * because the failure mode otherwise is silent: the wizard offers an option,
 * the brand picks it, and the save fails with a validation error naming a field
 * they never saw.
 *
 * `CATEGORIES` is the exception — it is not validated server-side (a brand may
 * work in a category nobody predicted), so it is a suggestion list, not a
 * contract. It matches the creator-side category list so brand and creator are
 * describing themselves in the same words.
 */

export const PLATFORMS = ['instagram', 'youtube', 'facebook'];

export const PLATFORM_LABEL = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  facebook: 'Facebook',
};

export const CONTENT_TYPES = {
  instagram: ['Reel', 'Post', 'Carousel', 'Story', 'Live'],
  youtube: ['Video', 'Short', 'Integration', 'Community post', 'Live'],
  facebook: ['Reel', 'Post', 'Story', 'Video', 'Live'],
};

/** Formats measured in seconds — the duration field appears only for these. */
export const TIMED_CONTENT_TYPES = ['Reel', 'Short', 'Video', 'Integration', 'Story', 'Live'];

export const OBJECTIVES = [
  'Brand awareness', 'Product launch', 'Sales / conversions', 'App installs',
  'Content for our own channels', 'Event promotion', 'Community growth',
];

export const PAYMENT_MODELS = ['fixed', 'per_deliverable', 'barter_plus_fee', 'barter_only'];

export const PAYMENT_MODEL_LABEL = {
  fixed: 'Fixed fee per creator',
  per_deliverable: 'Per deliverable',
  barter_plus_fee: 'Product plus a fee',
  barter_only: 'Product only',
};

export const USAGE_CHANNELS = [
  'Brand social channels', 'Brand website', 'Email marketing', 'Paid social ads',
  'In-store / point of sale', 'Print', 'OOH / billboards', 'Marketplace listings',
];

export const QUESTION_TYPES = ['short_text', 'long_text', 'single_choice', 'multi_choice', 'link', 'number'];

export const QUESTION_TYPE_LABEL = {
  short_text: 'Short text',
  long_text: 'Long text',
  single_choice: 'Pick one',
  multi_choice: 'Pick several',
  link: 'A link',
  number: 'A number',
};

export const GENDERS = ['female', 'male', 'non-binary', 'any'];

/* ── suggestion lists, not server contracts ──────────────────────────────── */

export const CATEGORIES = [
  'Fashion', 'Beauty & Personal Care', 'Fitness', 'Food & Beverage', 'Travel',
  'Technology', 'Gaming', 'Finance', 'Education', 'Lifestyle', 'Parenting',
  'Healthcare', 'Automotive', 'Home & Living', 'Sports',
];

export const LANGUAGES = [
  'Hindi', 'English', 'Tamil', 'Telugu', 'Kannada', 'Malayalam',
  'Marathi', 'Bengali', 'Gujarati', 'Punjabi', 'Odia', 'Assamese',
];

export const AUDIENCE_AGE_RANGES = ['13–17', '18–24', '25–34', '35–44', '45–54', '55+'];

/**
 * Countries, for both the creator's own location and their audience's.
 *
 * This has to be one shared list, not a per-screen one. Discovery matches
 * audience locations as exact array terms, so a creator who declared "UK" and a
 * brand who filtered for "United Kingdom" simply never meet — and neither of
 * them can see why. The same list on both sides is what makes the filter
 * capable of returning anything.
 */
export const LOCATIONS = [
  'India', 'United States', 'United Kingdom', 'UAE',
  'Singapore', 'Australia', 'Canada', 'Germany',
];

export const EXPERIENCE_LEVELS = [
  'Any experience',
  'Has worked with brands before',
  'Has run paid campaigns before',
  'Established creator with a portfolio',
];
/**
 * The application status vocabulary, on the frontend.
 *
 * Mirrors `models/Campaign.js` — the server is the authority, and a test reads
 * this file to assert the two lists agree. The failure mode otherwise is a
 * status the server sends and the UI renders as a blank pill.
 *
 * The tone mapping goes through `StatusPill`'s existing vocabulary rather than
 * inventing colours: waiting states are lilac, good news is jade, a decision
 * that went the other way is quiet grey, and nothing here is ochre because no
 * money has moved at application time.
 */

export const APPLICATION_STATUSES = [
  'applied', 'under_review', 'shortlisted', 'selected', 'rejected', 'withdrawn',
];

/** Legacy spellings the server still accepts on old rows, mapped for display. */
export const LEGACY_STATUS_MAP = { pending: 'applied', accepted: 'selected' };

export const normaliseStatus = (s) => LEGACY_STATUS_MAP[s] ?? s;

/**
 * `pill` is the existing StatusPill status whose colour fits, not a new one.
 * `label` is what the creator reads. `blurb` is the one line that says what it
 * means, because "shortlisted" and "under review" are not self-explanatory to
 * someone waiting on an answer.
 *
 * ── Two voices, one vocabulary ─────────────────────────────────────────────
 *
 * The same status is read from both sides: the creator sees "The brand chose
 * you", the brand sees "You selected this creator". Keeping both here — rather
 * than a second status file for the brand — is what stops the two drifting
 * apart, and is why the brand's review page briefly told the brand that a
 * brand had chosen *it*. `brandLabel` falls back to `label` where the word is
 * already neutral; only `rejected` differs, because the brand did the
 * rejecting and "Not selected" is the softening a creator gets, not a fact the
 * brand needs softened.
 */
export const STATUS_META = {
  applied: {
    pill: 'pending_review',
    label: 'Applied',
    blurb: 'Your application is in. The brand has not opened it yet.',
    brandBlurb: 'Waiting for you to open it.',
  },
  under_review: {
    pill: 'negotiation',
    label: 'Under review',
    blurb: 'The brand is reading your application.',
    brandBlurb: 'You marked this one as under review.',
  },
  shortlisted: {
    pill: 'accepted',
    label: 'Shortlisted',
    blurb: 'You are on the brand’s shortlist. No decision yet.',
    brandBlurb: 'On your shortlist. Nothing has been promised to them.',
  },
  selected: {
    pill: 'completed',
    label: 'Selected',
    blurb: 'The brand chose you. Negotiation is open.',
    brandBlurb: 'You selected this creator. The collaboration is open.',
  },
  rejected: {
    pill: 'declined',
    label: 'Not selected',
    brandLabel: 'Rejected',
    blurb: 'The brand went with someone else this time.',
    brandBlurb: 'You rejected this application.',
  },
  withdrawn: {
    pill: 'cancelled',
    label: 'Withdrawn',
    blurb: 'You withdrew this application.',
    brandBlurb: 'The creator withdrew this application.',
  },
};

export const statusMeta = (status) => STATUS_META[normaliseStatus(status)]
  ?? { pill: 'pending_review', label: status, blurb: '' };

/**
 * The same entry read in the brand's voice. Falls back to the creator copy
 * rather than rendering a blank line, so a status added to the list above
 * without brand copy degrades to something true-but-second-person instead of
 * to nothing.
 */
export const brandStatusMeta = (status) => {
  const m = statusMeta(status);
  return { ...m, label: m.brandLabel ?? m.label, blurb: m.brandBlurb ?? m.blurb };
};

/** Can the creator still withdraw? Only before a decision has been made. */
export const canWithdraw = (status) =>
  ['applied', 'under_review', 'shortlisted'].includes(normaliseStatus(status));
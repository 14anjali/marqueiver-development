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
 */
export const STATUS_META = {
  applied: {
    pill: 'pending_review',
    label: 'Applied',
    blurb: 'Your application is in. The brand has not opened it yet.',
  },
  under_review: {
    pill: 'negotiation',
    label: 'Under review',
    blurb: 'The brand is reading your application.',
  },
  shortlisted: {
    pill: 'accepted',
    label: 'Shortlisted',
    blurb: 'You are on the brand’s shortlist. No decision yet.',
  },
  selected: {
    pill: 'completed',
    label: 'Selected',
    blurb: 'The brand chose you. Negotiation is open.',
  },
  rejected: {
    pill: 'declined',
    label: 'Not selected',
    blurb: 'The brand went with someone else this time.',
  },
  withdrawn: {
    pill: 'cancelled',
    label: 'Withdrawn',
    blurb: 'You withdrew this application.',
  },
};

export const statusMeta = (status) => STATUS_META[normaliseStatus(status)]
  ?? { pill: 'pending_review', label: status, blurb: '' };

/** Can the creator still withdraw? Only before a decision has been made. */
export const canWithdraw = (status) =>
  ['applied', 'under_review', 'shortlisted'].includes(normaliseStatus(status));
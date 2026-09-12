/**
 * Shared types — single source of truth for backend + frontend.
 * Proposal §3: "shared types package … strict TypeScript end-to-end".
 */
export const PLATFORMS = [
    'instagram', 'youtube', 'linkedin', 'tiktok', 'x', 'facebook', 'pinterest',
];

/**
 * The collaboration states, exactly as `models/Deal.js` declares them.
 *
 * ── This list was wrong, and it broke two things silently ──────────────────
 *
 * It said `invited`, `negotiating`, `escrow_funded` — three names that have
 * never existed on the Deal schema, whose real spellings are `invitation`,
 * `negotiation` and `escrow_pending`. It was also missing `resolution` and
 * `declined` entirely. `lib/chart-theme.js` already records the same three
 * invented names as a bug it had to work around; this is where they were still
 * being served from.
 *
 * Two consequences, neither of which surfaced as an error anyone would read:
 *
 *  1. `POST /deals/:id/transition` validates `to` against this list. So the
 *     creator's "Accept and negotiate" button — the only way a direct
 *     requirement reaches negotiation — sent `negotiation` and was rejected at
 *     the validator with a 400 naming an enum the caller had no way to satisfy.
 *  2. Any `DEAL_STATES.filter(...)` built a set of states that match no
 *     document, so a query meant to find live collaborations found none.
 *
 * `tests/proposal-stage.test.js` asserts this list and the schema enum are
 * identical, in order, so they cannot drift again.
 */
export const DEAL_STATES = [
    'invitation', 'negotiation', 'accepted', 'escrow_pending', 'in_progress',
    'submitted', 'revision', 'resolution', 'disputed', 'completed',
    'declined', 'cancelled',
];
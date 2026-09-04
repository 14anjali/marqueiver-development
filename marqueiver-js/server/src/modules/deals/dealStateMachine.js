/**
 * Collaboration state machine — Policy 5.1, 5.3, 5.4, 5.5, 6.2, 7, 10.
 *
 * Policy 5.1 names the stages:
 *   Invitation → Negotiation → Acceptance → Escrow funding → In progress
 *   → Submission → Review → Completion
 *
 * Mapped to states:
 *   invitation → negotiation → accepted → escrow_pending → in_progress
 *   → submitted → (revision → in_progress)×2 → completed
 *
 * Plus:
 *   resolution — Policy 5.5, entered when agreed revisions are exhausted and
 *                the Brand still declines to approve.
 *   disputed   — Policy 10, escrow held pending determination.
 *   declined   — a brief refused before acceptance. Policy 7.2 is explicit that
 *                "declining a brief is not a cancellation", so it must not
 *                collapse into `cancelled`.
 *   cancelled  — Policy 7, with a stage-determined money outcome.
 *
 * Rules encoded here:
 *  - Escrow may only be released by Brand approval, automatic completion
 *    (5.3), dispute determination (10.4) or a resolution option (5.5). Those
 *    are the only four routes to `completed` (6.2).
 *  - `escrow_pending → in_progress` is actor `system`: work begins only once
 *    the payment partner confirms funding (4.5, 6.2). No user click activates.
 *  - `submitted → completed` is reachable by `system` for the 7-day automatic
 *    completion in 5.3, as well as by the Brand approving.
 *  - Cancellation is available to the parties at the stages Policy 7 allows,
 *    because the outcome is fixed by the policy rather than decided by an
 *    Admin — see commission.service.js.
 */

export const TRANSITIONS = {
    invitation: [
        { to: 'negotiation', actors: ['creator', 'brand'] },
        { to: 'accepted', actors: ['creator', 'brand'] },
        { to: 'declined', actors: ['creator', 'brand'] },
        // 7.1 — before acceptance, a brand cancellation is a full refund. No
        // money has moved, so there is nothing to settle.
        { to: 'cancelled', actors: ['brand', 'admin'], effect: 'cancel_settlement' },
    ],
    negotiation: [
        { to: 'accepted', actors: ['creator', 'brand'] },
        { to: 'declined', actors: ['creator', 'brand'] },
        { to: 'cancelled', actors: ['brand', 'admin'], effect: 'cancel_settlement' },
    ],
    accepted: [
        // The brand proceeds to fund; scope is frozen from here (5.2).
        { to: 'escrow_pending', actors: ['brand'] },
        // 7.1/7.2 — after acceptance but before work, either side may cancel
        // for a full refund.
        { to: 'cancelled', actors: ['brand', 'creator', 'admin'], effect: 'cancel_settlement' },
    ],
    escrow_pending: [
        // 6.2 — only the payment partner's confirmation starts the work.
        { to: 'in_progress', actors: ['system'], effect: 'confirm_escrow_funded' },
        { to: 'cancelled', actors: ['brand', 'creator', 'admin'], effect: 'cancel_settlement' },
    ],
    in_progress: [
        { to: 'submitted', actors: ['creator'] },
        // 7.1 — creator 25%, brand 75%. 7.2 — full refund unless partial work
        // is accepted. The split is computed, not negotiated.
        { to: 'cancelled', actors: ['brand', 'creator', 'admin'], effect: 'cancel_settlement' },
        { to: 'disputed', actors: ['brand', 'creator'] },
    ],
    submitted: [
        // Brand approves, or 5.3 automatic completion after 7 days.
        { to: 'completed', actors: ['brand', 'system', 'admin'], effect: 'release_escrow' },
        // 5.4 — only while rounds remain; the count is checked by the caller.
        { to: 'revision', actors: ['brand'] },
        // 5.5 — agreed revisions exhausted and still not approved.
        { to: 'resolution', actors: ['brand', 'system'] },
        // 7.1 — after submission the creator receives the full fee.
        { to: 'cancelled', actors: ['brand', 'admin'], effect: 'cancel_settlement' },
        { to: 'disputed', actors: ['brand', 'creator'] },
    ],
    revision: [
        { to: 'in_progress', actors: ['creator'] },
        { to: 'submitted', actors: ['creator'] },
        { to: 'resolution', actors: ['brand', 'system'] },
        { to: 'cancelled', actors: ['brand', 'admin'], effect: 'cancel_settlement' },
        { to: 'disputed', actors: ['brand', 'creator'] },
    ],
    /**
     * Policy 5.5 — options A, B, C, D.
     *   A reduced fee        → completed, partial release
     *   B further paid revision → back to in_progress once the new fee is funded
     *   C release without use → completed, 50/50 (automatic after 7 days)
     *   D escalate           → disputed
     */
    resolution: [
        { to: 'completed', actors: ['brand', 'creator', 'system'], effect: 'resolution_settlement' },
        { to: 'in_progress', actors: ['brand', 'creator'] },
        { to: 'disputed', actors: ['brand', 'creator'] },
    ],
    disputed: [
        // 10.4 — determination is Marqueiver's, as escrow administrator.
        { to: 'completed', actors: ['admin'], effect: 'dispute_determination' },
        { to: 'cancelled', actors: ['admin'], effect: 'dispute_determination' },
        // "A direction to complete outstanding work within a specified period."
        { to: 'in_progress', actors: ['admin'] },
        { to: 'submitted', actors: ['admin'] },
    ],
    completed: [],
    declined: [],
    cancelled: [],
};

export const ALL_STATES = Object.keys(TRANSITIONS);

/** Policy 5.2 — scope is fixed at acceptance and cannot change afterwards. */
export const TERMS_LOCKED_STATES = new Set([
    'accepted', 'escrow_pending', 'in_progress', 'submitted',
    'revision', 'resolution', 'disputed', 'completed',
]);

/** Policy 5.4 — default two rounds unless the parties agreed otherwise. */
export const DEFAULT_REVISION_ROUNDS = 2;

/** Policy 5.3 — the Brand's review window, in days. */
export const REVIEW_WINDOW_DAYS = 7;

/** Policy 5.5 — option C applies automatically after this long in Resolution. */
export const RESOLUTION_AUTO_DAYS = 7;

/** Policy 10.2 — a dispute must be raised within 14 days of the event. */
export const DISPUTE_WINDOW_DAYS = 14;

/** States in which escrow is funded and therefore at risk. */
export const FUNDED_STATES = new Set([
    'in_progress', 'submitted', 'revision', 'resolution', 'disputed',
]);

export function canTransition(from, to, actor) {
    const rules = TRANSITIONS[from];
    if (!rules) return { allowed: false, reason: `Unknown state "${from}"` };
    const rule = rules.find((r) => r.to === to);
    if (!rule) return { allowed: false, reason: `No transition ${from} → ${to}` };
    if (!rule.actors.includes(actor))
        return { allowed: false, reason: `${actor} may not perform ${from} → ${to}` };
    return { allowed: true, rule };
}

/** Policy 5.4 — a revision may only be requested while rounds remain. */
export function canRequestRevision(deal) {
    const allowed = deal.terms?.revisionsAllowed ?? DEFAULT_REVISION_ROUNDS;
    const used = deal.revisionCount ?? 0;
    if (used >= allowed)
        return { allowed: false, reason: `All ${allowed} agreed revision rounds have been used`, used, limit: allowed };
    return { allowed: true, used, limit: allowed };
}

/** Policy 7.2 — cancellation is unavailable to a Creator after submission. */
export function canCancel(state, actor) {
    if (actor === 'creator' && ['submitted', 'revision', 'resolution'].includes(state))
        return { allowed: false, reason: 'Cancellation is not available after submission (Policy 7.2)' };
    return canTransition(state, 'cancelled', actor);
}

/**
 * Policy 7.2 — "declining a brief is not a cancellation". Declining is
 * available only before the parties have accepted; afterwards the route out is
 * cancellation (Policy 7) or dispute (Policy 10). Replaces the pre-policy
 * `canRejectDeal`.
 */
export function canDeclineBrief(state) {
    return state === 'invitation' || state === 'negotiation';
}

export function isTerminal(state) {
    return (TRANSITIONS[state] ?? []).length === 0;
}

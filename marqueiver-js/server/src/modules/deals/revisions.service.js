import { Types } from 'mongoose';
import { INCLUDED_REVISIONS } from '../../models/Deal.js';

/**
 * The revision rounds: how many are included, how many are used, and what each
 * one was about.
 *
 * ── Where the limit comes from ─────────────────────────────────────────────
 *
 * `terms.revisionsAllowed`, which starts at `INCLUDED_REVISIONS` (3) and is
 * raised in exactly one place in the codebase: funding an accepted additional-
 * terms offer (Policy 5.5 option B). Not read from a constant here — a
 * collaboration may have agreed a different number, and the agreement wins.
 *
 * ── Why rounds are recorded rather than derived ────────────────────────────
 *
 * "Revision 2 of 3" can be counted from `revisionCount`. "What did they want
 * changed in round 2" cannot — that lives in the submission review, which is
 * attached to the submission being rejected, not to the round. Stitching the
 * two together after the fact works right up until a round is opened against a
 * submission that was later superseded. So each round is one row, written once.
 */

export const revisionLimit = (deal) =>
    deal?.terms?.revisionsAllowed ?? INCLUDED_REVISIONS;

/**
 * Where the collaboration stands on revisions.
 *
 * `exhausted` is the one the UI turns on: past it, further work is not an
 * included round — it is new scope, which the creator can refuse and must be
 * paid for (Policy 5.5 option B).
 */
export function revisionState(deal) {
    const allowed = revisionLimit(deal);
    const used = deal?.revisionCount ?? 0;
    return {
        used,
        allowed,
        remaining: Math.max(0, allowed - used),
        exhausted: used >= allowed,
        /** The round a new request would open. */
        next: used + 1,
        /** Rounds bought through additional terms, if any. */
        purchased: deal?.additionalTerms?.status === 'funded'
            ? (deal.additionalTerms.revisionsAdded ?? 0)
            : 0,
    };
}

/**
 * Open a revision round.
 *
 * Called before the state transition, so the round number matches what
 * `revisionCount` becomes: the transition into `revision` is what increments it,
 * and that is still the only writer.
 */
export function recordRevisionRequest(deal, { reason, actorId, actorRole = 'brand', submission }) {
    const round = (deal.revisionCount ?? 0) + 1;
    const entry = {
        round,
        reason: String(reason ?? '').trim(),
        requestedAt: new Date(),
        ...(actorId ? { requestedBy: new Types.ObjectId(actorId) } : {}),
        requestedByRole: actorRole === 'admin' ? 'admin' : 'brand',
        ...(submission?._id ? { submission: submission._id } : {}),
        ...(submission?.deliverable?.key ? {
            deliverableKey: submission.deliverable.key,
            deliverableLabel: submission.deliverable.label,
        } : {}),
    };
    deal.revisions = [...(deal.revisions ?? []), entry];
    return entry;
}

/**
 * Close the open round, if there is one.
 *
 * A resubmission answers the most recent unanswered round. It does NOT touch
 * `revisionCount` — a new upload is how a creator answers a revision, not a
 * reason to forget one happened.
 */
export function resolveOpenRevision(deal, submissionId) {
    const open = [...(deal.revisions ?? [])].reverse().find((r) => !r.resolvedAt);
    if (!open) return null;
    open.resolvedAt = new Date();
    if (submissionId) open.resolvedBySubmission = submissionId;
    return open;
}

/** The rounds as a UI can show them: newest first, with their state. */
export function revisionHistory(deal) {
    return [...(deal?.revisions ?? [])]
        .map((r) => (r.toObject?.() ?? r))
        .sort((a, b) => (b.round ?? 0) - (a.round ?? 0))
        .map((r) => ({ ...r, status: r.resolvedAt ? 'answered' : 'awaiting_resubmission' }));
}
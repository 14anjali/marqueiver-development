import { ALL_STATES } from '../deals/dealStateMachine.js';

/**
 * When creator↔brand messaging is permitted.
 *
 * RESOLVED — this was flagged as an open conflict (cleared rules §22): scope
 * §13 said chat opens once money is committed; the cleared rules said it opens
 * at negotiation. The confirmed requirement settles it in favour of §13:
 *
 *   "No collaboration communication before the required 50% escrow payment is
 *    successfully verified."
 *
 * and the flow document orders it explicitly:
 *
 *   Brand pays 50% advance → Payment verified → Communication unlocked →
 *   Collaboration starts
 *
 * The gate is therefore *verified payment*, not "the brand has been asked to
 * pay". In the state machine that distinction is the `escrow_pending →
 * in_progress` transition, whose actor is `system` and whose effect is
 * `confirm_escrow_funded` — it fires only when the payment partner confirms.
 * So `in_progress` is the first state in which chat may open.
 *
 * ── What this set used to be, and why it was wrong ──────────────────────────
 *
 *   escrow_pending, active, submitted, revision, completed
 *
 * Three separate faults, all in the direction of getting the gate backwards:
 *
 *  1. `active` is not a deal state and never has been in this lifecycle. It was
 *     an old name that was never mapped to `in_progress` when the states were
 *     renamed, so it matched nothing. The assertion at the bottom of this file
 *     now makes a name that does not exist impossible to reintroduce.
 *
 *  2. `escrow_pending` was included — chat was open *before* payment was
 *     verified, which is the exact thing the requirement forbids and the exact
 *     window in which an off-platform payment gets arranged.
 *
 *  3. Because of (1), chat was locked during `in_progress` — the whole
 *     collaboration. The parties could talk before paying and not while
 *     working.
 *
 * `resolution` and `disputed` are included because Policy 10.1 expects the
 * parties to attempt direct resolution "through in-platform chat" with a
 * record; locking chat at the moment a dispute starts would push that
 * conversation off-platform, where it cannot be used as evidence.
 *
 * `completed` stays open so the parties can settle delivery details and so the
 * history remains readable after the fact.
 */
export const MESSAGING_ALLOWED_STATES = new Set([
  'in_progress',
  'submitted',
  'revision',
  'resolution',
  'disputed',
  'completed',
]);

/**
 * States in which chat is deliberately closed, with the reason to show.
 *
 * A locked chat that says nothing reads as broken. Naming the reason is also
 * what stops someone "fixing" the lock by opening it.
 */
export const MESSAGING_LOCK_REASON = {
  invitation: 'Chat opens once the collaboration is agreed and the advance is paid.',
  negotiation: 'Terms are still being negotiated — use offers until they are agreed.',
  accepted: 'Chat opens once the brand has paid the advance into escrow.',
  escrow_pending: 'Chat opens as soon as the advance payment is confirmed.',
  declined: 'This collaboration was declined.',
  cancelled: 'This collaboration was cancelled.',
};

export function isMessagingUnlocked(state) {
  return MESSAGING_ALLOWED_STATES.has(state);
}

/** Why chat is closed in this state — safe to show to either party. */
export function messagingLockReason(state) {
  return MESSAGING_LOCK_REASON[state] ?? 'Messaging is not available for this collaboration yet.';
}

/**
 * Every name in the set must be a real deal state.
 *
 * This is the check that `active` needed: a typo or a renamed state silently
 * removes a state from the gate, and the failure mode is a chat that never
 * opens — which looks like a broken feature rather than a broken constant, and
 * went unnoticed through an entire lifecycle rename.
 */
const unknown = [...MESSAGING_ALLOWED_STATES].filter((s) => !ALL_STATES.includes(s));
if (unknown.length) {
  throw new Error(
    `messaging.policy.js lists deal states that do not exist: ${unknown.join(', ')}. `
    + `Known states: ${ALL_STATES.join(', ')}`,
  );
}

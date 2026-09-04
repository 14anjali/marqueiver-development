/**
 * When creator↔brand messaging is permitted.
 *
 * POLICY V2: Policy 1.5 requires all communication about a Collaboration to
 * happen on-platform, and Policy 10.1 expects the parties to attempt direct
 * resolution "through in-platform chat" with a record. Policy 4.4 requires a
 * Brand to answer Creator questions on scope. Chat is therefore open from
 * `negotiation` onward — the pre-policy lock that started at escrow funding
 * would have made those obligations impossible to meet.
 *
 * Still closed at `invitation`: nothing has been agreed and the brief is the
 * communication at that point.
 *
 * Superseded scope §13 note follows for history.
 *
 * Messaging is NOT available while a deal is still at `invited` or
 * `negotiating`. At those states the parties exchange structured offers and
 * counter-offers on the deal itself; free-text chat opens only once money is
 * committed and the campaign is running.
 *
 * This lives in its own module (rather than in the controller) because both
 * the REST controller and the Socket.io gateway enforce it, and the gateway is
 * imported *by* the controller — putting the constant in the controller would
 * create an import cycle.
 *
 * OPEN QUESTION (scope §15): "What exact events permit normal messaging?"
 * Change this one set once the client confirms; nothing else needs to move.
 */
/**
 * ⚠ UNRESOLVED — cleared rules §22.
 *
 * The two source documents contradict each other. Scope §13 says no free
 * messaging before the campaign is active; cleared rules Q3/Q6 say Campaign
 * Chat opens at `negotiating`, alongside a separate Negotiation Chat.
 *
 * The set below is the OLD state names mapped onto the new lifecycle and
 * NOTHING MORE. It is not a decision. When §22 is resolved this either stays
 * (scope §13 wins) or is replaced by two chat channels (cleared rules win).
 */
export const MESSAGING_ALLOWED_STATES = new Set([
  'escrow_pending',
  'active',
  'submitted',
  'revision',
  'completed',
]);

export function isMessagingUnlocked(state) {
  return MESSAGING_ALLOWED_STATES.has(state);
}

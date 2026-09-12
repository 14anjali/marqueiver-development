/**
 * When chat is open, and what to say when it is not.
 *
 * ── This mirrors the server, and a test enforces it ────────────────────────
 *
 * `marqueiver-js/server/src/modules/messaging/messaging.policy.js` is the
 * authority — every messaging route checks it, so calling the API directly does
 * not bypass the lock. The two packages cannot import from each other, so the
 * lists are repeated here and `tests/escrow-unlock.test.js` reads this file and
 * asserts they agree.
 *
 * The failure mode that makes the test worth having is silent in both
 * directions: a state missing here shows an open composer whose every send is
 * refused, and a state missing there opens a chat the policy meant to keep
 * closed. The server file already records exactly this happening once — a state
 * named `active` that never existed left chat locked for the whole of
 * `in_progress`, and it went unnoticed through a lifecycle rename.
 *
 * The gate is *verified payment*, not "the brand has been asked to pay":
 * `in_progress` is reached only by the signature-verified Cashfree webhook.
 */

export const MESSAGING_ALLOWED_STATES = [
  'in_progress',
  'submitted',
  'revision',
  'resolution',
  'disputed',
  'completed',
];

export const MESSAGING_LOCK_REASON = {
  invitation: 'Chat opens once the collaboration is agreed and the advance is paid.',
  negotiation: 'Terms are still being negotiated — use offers until they are agreed.',
  accepted: 'Chat opens once the brand has paid the advance into escrow.',
  escrow_pending: 'Chat opens as soon as the advance payment is confirmed.',
  declined: 'This collaboration was declined.',
  cancelled: 'This collaboration was cancelled.',
};

export const isMessagingUnlocked = (state) => MESSAGING_ALLOWED_STATES.includes(state);

export const messagingLockReason = (state) =>
  MESSAGING_LOCK_REASON[state] ?? 'Messaging is not available for this collaboration yet.';
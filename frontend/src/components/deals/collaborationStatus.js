/**
 * What a collaboration is doing right now, and what happens next.
 *
 * ── These are display statuses, not deal states ────────────────────────────
 *
 * The Deal has twelve canonical states and they are not up for negotiation —
 * the state machine, the money paths and every policy reference are built on
 * them. The ten statuses below are what a person is shown, derived from a state
 * plus facts that are actually recorded (has the advance been verified, has
 * escrow been released, has a payout been made).
 *
 * Three of them sit on the single `completed` state, distinguished by what the
 * money record actually says:
 *
 *   Approved            `completed`, no release recorded yet
 *   Payment Completed   the release is recorded — `escrow.releasedAt`, with a
 *                       creator payout in `escrow.settlement`
 *   Completed           both: closed and settled
 *
 * `Payment Completed` is therefore a STAGE, not a resting status. Brand
 * approval, the escrow release and the state change all happen inside one
 * `settleRelease` transaction, so nobody is ever looking at a collaboration
 * whose current status is "payment completed" — it is already "completed". It
 * stays in the stepper because somebody tracking a collaboration needs to see
 * that the payment step happened; it is not offered as a badge.
 *
 * What the release does is credit the creator's **wallet** and write a `Payout`
 * row with `status: 'pending'` — withdrawing that money is a separate step and
 * paying it out is not built. The copy says exactly that and claims nothing
 * more.
 *
 * Two states the request did not name still have to render, because the machine
 * can be in them: `resolution` (Policy 5.5, revisions exhausted) and `declined`
 * (Policy 7.2 — refusing a brief is not a cancellation). A status vocabulary
 * that cannot name a state the backend can reach shows a blank badge at exactly
 * the moment a party most needs to know where they are.
 *
 * ── Payment Verified ───────────────────────────────────────────────────────
 *
 * Verification and activation are one transition, so this is normally a moment
 * rather than a resting state. It is still worth naming: if the webhook writes
 * `verified` and the transition then fails, the collaboration sits with the
 * money taken and nothing started. That is precisely the case somebody has to
 * be told about, and the alternative is showing "Awaiting Payment" to a brand
 * that has already paid.
 */

/** The stages a collaboration moves through, in order. */
export const STAGES = [
  { id: 'awaiting_payment', label: 'Awaiting payment' },
  { id: 'payment_verified', label: 'Payment verified' },
  { id: 'active', label: 'Active' },
  { id: 'submitted', label: 'Deliverable submitted' },
  { id: 'approved', label: 'Approved' },
  { id: 'payment_completed', label: 'Payment completed' },
  { id: 'completed', label: 'Completed' },
];

/**
 * Stages that are not on the line.
 *
 * `revision` loops back rather than moving forward, and the two terminal ones
 * end it. Rendering them as steps would draw a path that does not exist.
 */
export const OFF_PATH = {
  revision_requested: 'Revision requested',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
  declined: 'Declined',
  resolution: 'In resolution',
};

/**
 * The product's existing colour language, borrowed rather than re-invented:
 * these are the same tones `StatusPill` maps the deal states to in
 * `components/feedback.jsx`. A status that is ochre here and grey there is how a
 * person learns to stop trusting the colour.
 */
const pill = {
  awaiting_payment: 'pill-money',
  payment_verified: 'pill-live',
  active: 'pill-live',
  submitted: 'pill-wait',
  revision_requested: 'pill-wait',
  resolution: 'pill-warn',
  approved: 'pill-done',
  payment_completed: 'pill-done',
  completed: 'pill-done',
  disputed: 'pill-warn',
  cancelled: 'pill-quiet',
  declined: 'pill-quiet',
};

/** Did the advance actually arrive? The one fact the whole first half turns on. */
export const advanceVerified = (deal) =>
  Boolean(deal?.escrow?.schedule?.advance?.funded ?? deal?.escrow?.funded);

/**
 * Has the money been settled out of escrow?
 *
 * `escrow.releasedAt` is written by `settleRelease`, in the same transaction as
 * the wallet credit and the Payout row — so it is the one recorded fact that
 * means the creator has actually been credited. There is no "payout completed"
 * field anywhere and this does not invent one: the Payout row is written with
 * `status: 'pending'` because paying it out is not built.
 */
const escrowReleased = (deal) => Boolean(deal?.escrow?.releasedAt);

/** A release that actually paid the creator, as opposed to a full refund. */
const creatorPaid = (deal) =>
  escrowReleased(deal) && Number(deal?.escrow?.settlement?.creatorPayout ?? 0) > 0;

/**
 * The collaboration's status right now.
 *
 * `payments` is the payment record, used only for the one case the deal alone
 * cannot express: money verified, collaboration not started.
 */
export function collaborationStatus(deal, { payments = [] } = {}) {
  const state = deal?.state;

  if (state === 'cancelled') return status('cancelled', 'Cancelled');
  if (state === 'declined') return status('declined', 'Declined');
  if (state === 'disputed') return status('disputed', 'Disputed');
  if (state === 'resolution') return status('resolution', OFF_PATH.resolution);
  if (state === 'revision') return status('revision_requested', OFF_PATH.revision_requested);
  if (state === 'submitted') return status('submitted', 'Deliverable submitted');
  if (state === 'in_progress') return status('active', 'Active');

  if (state === 'completed') {
    // Approved but not settled: the approval landed and the money did not. The
    // release runs inside the same transaction, so this should not happen — and
    // that is exactly why it is named rather than shown as "Completed".
    return escrowReleased(deal)
      ? status('completed', 'Completed')
      : status('approved', 'Approved');
  }

  /*
    Before the collaboration starts. The money is the only thing that moves it,
    so the status is about the money.
  */
  const verified = payments.some((p) => ['verified', 'success'].includes(p?.status));
  if (verified && !advanceVerified(deal)) {
    // Paid, but the collaboration did not start. Somebody needs to know.
    return status('payment_verified', 'Payment verified');
  }
  return status('awaiting_payment', 'Awaiting payment');
}

function status(id, label) {
  return { id, label, pill: pill[id] ?? 'pill-quiet' };
}

/**
 * Where each stage stands: done, current, pending, or locked.
 *
 * `locked` is distinct from `pending` on purpose. Pending means "not yet";
 * locked means "not yet, and nothing you do here will change that" — which is
 * the difference between a creator waiting to submit work and a creator who
 * cannot submit because the brand has not paid.
 */
export function stageStates(deal, { payments = [] } = {}) {
  const current = collaborationStatus(deal, { payments });
  const paid = advanceVerified(deal);
  const ended = ['cancelled', 'declined'].includes(deal?.state);

  /** How far along the line the collaboration has actually got. */
  const reached = {
    awaiting_payment: true,
    payment_verified: paid || current.id === 'payment_verified',
    active: paid,
    submitted: paid && ['submitted', 'revision', 'resolution', 'disputed', 'completed']
      .includes(deal?.state),
    approved: deal?.state === 'completed',
    payment_completed: creatorPaid(deal),
    completed: deal?.state === 'completed' && escrowReleased(deal),
  };

  const currentIndex = STAGES.findIndex((s) => s.id === current.id);

  return STAGES.map((stage, i) => {
    if (ended) {
      // A cancelled collaboration has no "current" stage; what it has is a
      // record of how far it got before it stopped.
      return { ...stage, state: reached[stage.id] ? 'done' : 'skipped' };
    }
    if (stage.id === current.id) return { ...stage, state: 'current' };
    if (reached[stage.id] && (currentIndex === -1 || i < currentIndex)) {
      return { ...stage, state: 'done' };
    }
    // Everything after the money, before the money has arrived, is locked
    // rather than merely pending.
    if (!paid && i > 1) return { ...stage, state: 'locked' };
    return { ...stage, state: 'pending' };
  });
}

/**
 * What this user has to do now — or who is being waited on.
 *
 * One line, and it is either an instruction to the reader or an explanation of
 * why there is nothing for them to do. "Waiting on the brand" is a genuine
 * answer; a blank space is not.
 */
export function nextAction(deal, role, { payments = [] } = {}) {
  const other = role === 'brand' ? 'the creator' : 'the brand';
  const you = role === 'brand' ? 'brand' : 'creator';
  const s = deal?.state;

  if (s === 'cancelled') return { mine: false, text: 'This collaboration was cancelled.' };
  if (s === 'declined') return { mine: false, text: 'This brief was declined.' };
  if (s === 'disputed') {
    return { mine: false, text: 'A dispute is open. Marqueiver is reviewing it — escrow is held until it is settled.' };
  }

  if (s === 'invitation') {
    return deal?.requestedBy === you
      ? { mine: false, text: `Waiting for ${other} to accept or decline the request.` }
      : { mine: true, text: 'Accept the request to start agreeing terms, or decline it.' };
  }

  if (s === 'negotiation') {
    return { mine: true, text: 'Agree the terms — send a proposal, or answer the one on the table.' };
  }

  if (s === 'accepted' || s === 'escrow_pending') {
    const verified = payments.some((p) => ['verified', 'success'].includes(p?.status));
    if (verified && !advanceVerified(deal)) {
      return {
        mine: false,
        warn: true,
        /*
          Not "our team has been notified": nothing detects this case on the
          server, so saying so would be a promise the product does not keep. It
          says what is true — the money is safe, nothing more will be charged,
          and support is the way out.
        */
        text: 'The payment is verified but the collaboration has not started. Nothing further will be '
          + 'charged — contact support if it does not start shortly.',
      };
    }
    const failed = payments.some((p) => p?.status === 'failed');
    return role === 'brand'
      ? {
        mine: true,
        text: failed
          ? 'The advance payment failed. Try it again to start the collaboration.'
          : 'Pay the 50% advance into escrow to start the collaboration.',
      }
      : { mine: false, text: 'Waiting for the brand to pay the advance. Messaging opens once it clears.' };
  }

  if (s === 'in_progress') {
    return role === 'creator'
      ? { mine: true, text: 'The work is live. Submit the deliverables when they are ready.' }
      : { mine: false, text: `Waiting on ${other} to submit the work. You can message them here.` };
  }

  if (s === 'submitted') {
    return role === 'brand'
      ? { mine: true, text: 'Review the deliverables — approve them, or request a revision.' }
      : { mine: false, text: 'Submitted. Waiting for the brand to review it.' };
  }

  if (s === 'revision') {
    return role === 'creator'
      ? { mine: true, text: 'A revision was requested. Resubmit when the changes are done.' }
      : { mine: false, text: `Waiting on ${other} to resubmit.` };
  }

  if (s === 'resolution') {
    return { mine: true, text: 'The agreed revisions are used up. Settle this through the resolution options.' };
  }

  if (s === 'completed') {
    if (!escrowReleased(deal)) {
      return {
        mine: false,
        warn: true,
        text: 'Approved, but the escrow settlement was not recorded. Contact support before the '
          + 'collaboration is treated as closed.',
      };
    }
    return role === 'creator'
      ? { mine: false, text: 'Approved. Your payment is in your wallet — withdrawing it is a separate step.' }
      : { mine: false, text: 'Approved and closed. Nothing further is needed.' };
  }

  return { mine: false, text: '' };
}

/** Everything a workspace needs to say where it is, in one call. */
export function workspaceStatus(deal, role, { payments = [] } = {}) {
  return {
    status: collaborationStatus(deal, { payments }),
    stages: stageStates(deal, { payments }),
    action: nextAction(deal, role, { payments }),
    paid: advanceVerified(deal),
  };
}
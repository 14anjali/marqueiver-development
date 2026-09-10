import { Deal, Transaction } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { notify, dealPayload } from '../notifications/notifications.service.js';
import { currentCommissionPct, computeCollaborationMoney } from '../../services/commission.service.js';
import * as cashfree from '../../services/cashfree.service.js';
import { transitionDeal } from './deals.service.js';

/**
 * Policy 5.5 option B — a further revision, paid for.
 *
 * The rule this module exists to enforce: **a fourth revision is not free
 * work.** Once the included rounds are used, more revisions are new scope, and
 * new scope needs the creator's agreement and the brand's money before any of
 * it becomes real. Neither party can move it alone:
 *
 *   - the brand proposes and pays, but cannot make the creator accept;
 *   - the creator accepts or declines, but cannot set the fee;
 *   - the rounds appear only when the money is in escrow.
 *
 * `terms.revisionsAllowed` is written in exactly one place in this codebase —
 * `fundAdditionalTerms` below — so "the brand cannot simply raise the revision
 * limit" is a property of the data path, not a check someone has to remember.
 */

/** A proposal can only be made from Resolution, where exhausted revisions land. */
const PROPOSABLE_STATES = new Set(['resolution']);

function assertBrand(deal, actorId) {
  if (deal.brand.toString() !== actorId)
    throw ApiError.forbidden('Only the brand can propose additional terms');
}

function assertCreator(deal, actorId) {
  if (deal.creator.toString() !== actorId)
    throw ApiError.forbidden('Only the creator can respond to additional terms');
}

/**
 * The brand offers a fee for further revision rounds.
 *
 * Re-proposing after a decline is allowed — a declined price is a negotiation,
 * not a dead end — but re-proposing over a live proposal is not, because the
 * creator would be answering a question that had already changed.
 */
export async function proposeAdditionalTerms({ dealId, actorId, amount, revisionsAdded, scopeNote, deadline }) {
  const deal = await Deal.findById(dealId);
  if (!deal) throw ApiError.notFound('Deal not found');
  assertBrand(deal, actorId);

  if (!PROPOSABLE_STATES.has(deal.state))
    throw ApiError.unprocessable(
      `Additional revisions can only be proposed once the agreed rounds are used up. `
      + `This collaboration is ${deal.state}.`,
    );

  const status = deal.additionalTerms?.status ?? 'none';
  if (status === 'proposed')
    throw ApiError.unprocessable('There is already a proposal awaiting the creator’s response');
  if (status === 'accepted')
    throw ApiError.unprocessable('The creator has accepted — the next step is payment, not a new proposal');
  if (status === 'funded')
    throw ApiError.unprocessable('These additional terms are already paid for');

  deal.additionalTerms = {
    status: 'proposed',
    amount,
    revisionsAdded,
    scopeNote,
    deadline: deadline ? new Date(deadline) : undefined,
    proposedAt: new Date(),
    proposedBy: deal.brand,
    // Cleared so a re-proposal does not carry the last refusal with it.
    respondedAt: undefined,
    declineReason: undefined,
  };
  deal.resolutionOption = 'B';
  await deal.save();

  await notify({
    user: deal.creator,
    type: 'deal.additional_terms_proposed',
    title: 'Extra revisions offered',
    body: `The brand has offered ₹${amount.toLocaleString('en-IN')} for `
      + `${revisionsAdded} more revision${revisionsAdded === 1 ? '' : 's'} on "${deal.title}". `
      + 'You can accept or decline.',
    data: dealPayload(deal),
  }).catch(() => void 0);

  return deal;
}

/**
 * The creator accepts or declines.
 *
 * Accepting does not restart the work — it fixes the price and the scope, and
 * the commission rate that will apply to this addition. Work restarts at
 * funding, in `fundAdditionalTerms`.
 */
export async function respondToAdditionalTerms({ dealId, actorId, accept, declineReason }) {
  const deal = await Deal.findById(dealId);
  if (!deal) throw ApiError.notFound('Deal not found');
  assertCreator(deal, actorId);

  if (deal.additionalTerms?.status !== 'proposed')
    throw ApiError.unprocessable('There is no proposal awaiting your response');

  deal.additionalTerms.respondedAt = new Date();

  if (!accept) {
    deal.additionalTerms.status = 'declined';
    deal.additionalTerms.declineReason = declineReason;
    await deal.save();

    await notify({
      user: deal.brand,
      type: 'deal.additional_terms_declined',
      title: 'Extra revisions declined',
      body: declineReason
        ? `The creator declined the additional revisions: ${declineReason}`
        : 'The creator declined the additional revisions.',
      data: dealPayload(deal),
    }).catch(() => void 0);

    return deal;
  }

  deal.additionalTerms.status = 'accepted';
  // Policy 14.7 — fixed at acceptance, like the original collaboration.
  deal.additionalTerms.commissionPct = currentCommissionPct();
  await deal.save();

  await notify({
    user: deal.brand,
    type: 'deal.additional_terms_accepted',
    title: 'Extra revisions accepted',
    body: `The creator accepted. Pay ₹${deal.additionalTerms.amount.toLocaleString('en-IN')} `
      + 'into escrow to restart the work.',
    data: dealPayload(deal),
  }).catch(() => void 0);

  return deal;
}

/**
 * A payment session for the accepted addition.
 *
 * Keyed separately from the original funding (`fund_<id>` vs
 * `addterms_<id>_<n>`) so the two can never be mistaken for each other, and
 * numbered by proposal so a second addition on the same deal gets its own key
 * rather than colliding with the first and being treated as a duplicate.
 */
export async function createAdditionalTermsPaymentSession(dealId, actorId) {
  const deal = await Deal.findById(dealId);
  if (!deal) throw ApiError.notFound('Deal not found');
  assertBrand(deal, actorId);

  if (deal.additionalTerms?.status !== 'accepted')
    throw ApiError.unprocessable(
      deal.additionalTerms?.status === 'funded'
        ? 'These additional terms are already paid for'
        : 'The creator has not accepted these terms yet',
    );

  const amount = deal.additionalTerms.amount;
  const round = (deal.terms.revisionsAllowed ?? 0) + (deal.additionalTerms.revisionsAdded ?? 0);
  const idempotencyKey = `addterms_${deal.id}_${round}`;

  const existing = await Transaction.findOne({ idempotencyKey, status: 'pending' });
  if (existing && existing.meta?.paymentSessionId
      && Date.now() - existing.createdAt.getTime() < 15 * 60 * 1000) {
    return {
      paymentSessionId: existing.meta.paymentSessionId,
      orderRef: existing.gatewayRef,
      gateway: existing.gateway,
    };
  }
  if (existing) await Transaction.deleteOne({ _id: existing._id });

  const order = await cashfree.createEscrowOrder(deal.id, amount);
  await Transaction.create({
    deal: deal._id,
    fromUser: deal.brand,
    type: 'escrow_fund',
    status: 'pending',
    amount,
    gateway: order.gateway,
    gatewayRef: order.orderRef,
    idempotencyKey,
    meta: { paymentSessionId: order.paymentSessionId, additionalTerms: true },
  });

  return { paymentSessionId: order.paymentSessionId, orderRef: order.orderRef, gateway: order.gateway };
}

/**
 * Payment confirmed — the rounds now exist and work restarts.
 *
 * This is the ONLY place `terms.revisionsAllowed` is increased. Called from the
 * payment confirmation path, not from a user request, for the same reason the
 * original `escrow_pending → in_progress` transition has actor `system`: work
 * begins when the payment partner confirms, not when someone says it has.
 */
export async function fundAdditionalTerms({ dealId, actorId }) {
  const deal = await Deal.findById(dealId);
  if (!deal) throw ApiError.notFound('Deal not found');

  if (deal.additionalTerms?.status !== 'accepted')
    throw ApiError.unprocessable('These additional terms are not awaiting payment');

  const { amount, revisionsAdded } = deal.additionalTerms;

  deal.additionalTerms.status = 'funded';
  deal.additionalTerms.fundedAt = new Date();

  // The agreed scope grows by exactly what was paid for.
  deal.terms.revisionsAllowed = (deal.terms.revisionsAllowed ?? 0) + revisionsAdded;
  if (deal.additionalTerms.deadline) deal.terms.deadline = deal.additionalTerms.deadline;
  if (deal.additionalTerms.scopeNote) {
    deal.terms.deliverables = `${deal.terms.deliverables}\n\nAdditional (paid): ${deal.additionalTerms.scopeNote}`.trim();
  }

  // Escrow now holds the original plus this addition.
  deal.escrow.amount = (deal.escrow.amount ?? 0) + amount;
  await deal.save();

  const moved = await transitionDeal({
    dealId: deal.id,
    to: 'in_progress',
    actor: 'brand',
    actorId,
    note: `Additional terms funded — ${revisionsAdded} further revision`
      + `${revisionsAdded === 1 ? '' : 's'} added (Policy 5.5 option B)`,
  });

  await notify({
    user: deal.creator,
    type: 'deal.additional_terms_funded',
    title: 'Extra revisions paid for',
    body: `The additional fee is in escrow. ${revisionsAdded} further revision`
      + `${revisionsAdded === 1 ? '' : 's'} are now part of "${deal.title}".`,
    data: dealPayload(deal),
  }).catch(() => void 0);

  return moved;
}

/**
 * What the creator will actually receive from this addition.
 *
 * Shown before they accept, because "accept ₹5,000 for two more rounds" is not
 * an informed decision if the figure that lands is ₹4,375.
 */
export function previewAdditionalTerms(deal) {
  const at = deal.additionalTerms;
  if (!at?.amount) return null;

  const money = computeCollaborationMoney(at.amount, at.commissionPct ?? currentCommissionPct());
  return {
    amount: money.agreedValue,
    commissionPct: money.commissionPct,
    commission: money.commission,
    creatorNet: money.creatorNet,
    revisionsAdded: at.revisionsAdded,
    status: at.status,
  };
}

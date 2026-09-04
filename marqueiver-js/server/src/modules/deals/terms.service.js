import { Types } from 'mongoose';
import { Deal } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { transitionDeal } from './deals.service.js';
import { notify } from '../notifications/notifications.service.js';
import { TERMS_LOCKED_STATES } from './dealStateMachine.js';
import { currentCommissionPct } from '../../services/commission.service.js';
import { currentPolicyVersionMap } from '../policies/policies.controller.js';

/**
 * Dual terms confirmation (cleared rules §5, A47, A48).
 *
 * Accepting an offer is NOT agreement. Both parties must separately confirm
 * the terms of the deal that the accepted offer produced. Only when the second
 * confirmation lands does the deal move `negotiating → terms_agreed`, and from
 * that moment the amount, deliverables, deadline and revision limit are
 * immutable — changing any of them requires a new offer and a new deal.
 *
 * A48 — a confirmation can be taken back, but only while the other party has
 * not yet confirmed. Once both are in, the deal has already moved on and there
 * is nothing left to un-confirm.
 *
 * A47 — reaching `terms_agreed` does NOT start the funding window. The brand
 * must then click "Proceed to payment", which is what moves the deal to
 * `escrow_pending` and starts the 48 hours. That lives in the controller.
 */

const FUNDING_WINDOW_HOURS = 48; // §6 / A49

function assertParty(deal, actorId, actorRole) {
    const expected = actorRole === 'creator' ? deal.creator : deal.brand;
    if (!expected || expected.toString() !== actorId)
        throw ApiError.forbidden('Not a party to this deal');
}

/** Both sides in? */
export function bothConfirmed(deal) {
    return Boolean(deal.termsConfirmation?.brand?.at && deal.termsConfirmation?.creator?.at);
}

export async function confirmTerms({ dealId, actorId, actorRole }) {
    const deal = await Deal.findById(dealId);
    if (!deal) throw ApiError.notFound('Deal not found');
    assertParty(deal, actorId, actorRole);

    if (deal.state !== 'negotiation')
        throw ApiError.unprocessable(
            deal.state === 'invitation'
                ? 'The request must be accepted before terms can be confirmed'
                : `Terms are already settled — this deal is ${deal.state}`,
        );

    if (deal.termsConfirmation?.[actorRole]?.at)
        throw ApiError.unprocessable('You have already confirmed these terms');

    deal.termsConfirmation = deal.termsConfirmation ?? {};
    deal.termsConfirmation[actorRole] = { at: new Date(), by: new Types.ObjectId(actorId) };

    if (!bothConfirmed(deal)) {
        // First confirmation — wait for the other side.
        await deal.save();
        await notify({
            user: (actorRole === 'creator' ? deal.brand : deal.creator).toString(),
            type: 'deal.terms_confirm_pending',
            title: 'Terms confirmed by the other party',
            body: `Confirm the terms on "${deal.title}" to lock them in.`,
            data: { dealId: deal.id },
        }).catch(() => void 0);
        return { deal, agreed: false };
    }

    // Second confirmation — terms are agreed and now immutable.
    deal.termsConfirmation.agreedAt = new Date();

    /**
     * Policy 14.7 — "changes will not affect Collaborations already accepted".
     * Policy 14.8 — "the applicable rate is that shown at the point of
     * acceptance". Both require the rate to be FROZEN here; reading the live
     * rate at release would silently re-price a deal accepted under a
     * promotional rate. `settleRelease` reads this snapshot.
     */
    deal.commission = {
        ...(deal.commission ?? {}),
        ratePct: currentCommissionPct(),
        snapshotAt: new Date(),
    };

    /**
     * Policy 5.2 / 24 — the Collaboration is governed by the policy versions in
     * force at Acceptance, so a later policy update cannot retroactively change
     * the terms of a deal already agreed.
     */
    try {
        const versions = await currentPolicyVersionMap();
        deal.policyVersionAtAcceptance = JSON.stringify(versions);
    } catch {
        // A missing policy table must not block an acceptance; the snapshot is
        // recorded as unavailable rather than silently claiming a version.
        deal.policyVersionAtAcceptance = null;
    }

    await deal.save();

    const updated = await transitionDeal({
        dealId: deal.id,
        to: 'accepted',
        actor: 'system',
        actorId,
        note: 'Both parties confirmed the terms',
    });

    await notify({
        user: (actorRole === 'creator' ? deal.brand : deal.creator).toString(),
        type: 'deal.terms_agreed',
        title: 'Terms agreed',
        body: `Terms are locked on "${deal.title}". The brand can now fund escrow.`,
        data: { dealId: deal.id },
    }).catch(() => void 0);

    return { deal: updated, agreed: true };
}

/** A48 — withdraw your confirmation, but only before the other party confirms. */
export async function unconfirmTerms({ dealId, actorId, actorRole }) {
    const deal = await Deal.findById(dealId);
    if (!deal) throw ApiError.notFound('Deal not found');
    assertParty(deal, actorId, actorRole);

    if (deal.state !== 'negotiation')
        throw ApiError.unprocessable(`Terms can no longer be un-confirmed — this deal is ${deal.state}`);
    if (!deal.termsConfirmation?.[actorRole]?.at)
        throw ApiError.unprocessable('You have not confirmed these terms');

    const other = actorRole === 'creator' ? 'brand' : 'creator';
    if (deal.termsConfirmation?.[other]?.at)
        throw ApiError.unprocessable('Both parties have confirmed — the terms are locked');

    deal.termsConfirmation[actorRole] = { at: null, by: null };
    await deal.save();
    return deal;
}

/**
 * §5 / non-negotiable rule 8 — confirmed terms are immutable. Any code path
 * that would edit amount, deliverables, deadline or revision limit must call
 * this first. Kept here so there is one place the rule is enforced rather than
 * a check scattered across controllers.
 */
export function assertTermsEditable(deal) {
    if (TERMS_LOCKED_STATES.has(deal.state))
        throw ApiError.unprocessable(
            'Confirmed terms cannot be changed. Start a new offer if the terms need to change.',
        );
}

/**
 * A47 — the brand clicks "Proceed to payment". This is the only way into
 * `escrow_pending`, and it starts the 48-hour funding window (A49).
 */
export async function proceedToPayment({ dealId, actorId }) {
    const deal = await Deal.findById(dealId);
    if (!deal) throw ApiError.notFound('Deal not found');
    if (deal.brand.toString() !== actorId)
        throw ApiError.forbidden('Only the brand can start the payment step');
    if (deal.state !== 'accepted')
        throw ApiError.unprocessable(`Cannot fund a deal that is ${deal.state}`);

    const deadline = new Date(Date.now() + FUNDING_WINDOW_HOURS * 3600 * 1000);
    await Deal.updateOne({ _id: deal._id }, {
        $set: { escrowFundingDeadline: deadline, fundingOverdue: false },
    });

    const updated = await transitionDeal({
        dealId: deal.id,
        to: 'escrow_pending',
        actor: 'brand',
        actorId,
        note: `Funding window opened, closes ${deadline.toISOString()}`,
    });

    await notify({
        user: deal.creator.toString(),
        type: 'deal.escrow_pending',
        title: 'Awaiting escrow funding',
        body: `The brand has 48 hours to fund escrow on "${deal.title}".`,
        data: { dealId: deal.id },
    }).catch(() => void 0);

    return updated;
}

/**
 * A50 — once the window passes, funding is BLOCKED until an Admin acts. The
 * deal is not cancelled (§6 forbids that) and the creator may raise a ticket.
 * Evaluated on read rather than by a scheduled job, so a missing cron cannot
 * let a stale deal be funded.
 */
export function isFundingBlocked(deal) {
    if (deal.state !== 'escrow_pending') return false;
    if (deal.fundingOverdue) return true;
    return Boolean(deal.escrowFundingDeadline && deal.escrowFundingDeadline <= new Date());
}

import { Types } from 'mongoose';
import { Deal, NegotiationThread, Offer } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { notify } from '../notifications/notifications.service.js';
import { computeFees } from '../../services/platformFee.js';
import { transitionDeal } from './deals.service.js';
import { canDeclineBrief } from './dealStateMachine.js';

/**
 * Dual terms confirmation lives in terms.service.js, which owns the whole
 * terms_agreed → escrow_pending path (§5, A47, A48). It is re-exported here so
 * callers can treat this module as the single entry point for the negotiation
 * flow. Re-export rather than reimplement — there must be exactly one place
 * that decides when terms lock.
 */
export { confirmTerms, unconfirmTerms, bothConfirmed, assertTermsEditable } from './terms.service.js';

/**
 * Structured negotiation — cleared rules §3, §4, §5 and A52–A56.
 *
 * This replaces the earlier single-outstanding-offer model, which the cleared
 * rules overruled. The differences that matter:
 *
 *  - Offers live in their own collection on a NegotiationThread (B2), because
 *    accepting one spawns a **separate deal** and a subdocument cannot do that.
 *  - Both parties may have a live offer at the same time; only one **each**
 *    (A55). Accepting one does not touch the other (§4).
 *  - Offers can never be withdrawn (§4). The protection against a party
 *    silently revising terms is immutability, not turn-taking.
 *  - Expiry is evaluated lazily at accept time (A53) — a missing cron can never
 *    make a stale offer acceptable.
 *  - The thread closes as soon as an offer is accepted (B2 follow-up).
 */

const MAX_PENDING_PER_THREAD = 10; // A56

function assertParty(thread, actorId, actorRole) {
    const expected = actorRole === 'creator' ? thread.creator : thread.brand;
    if (!expected || expected.toString() !== actorId)
        throw ApiError.forbidden('Not a party to this negotiation');
}

const counterpartOf = (thread, role) =>
    (role === 'creator' ? thread.brand : thread.creator).toString();

/**
 * Opens the thread when the receiving party accepts a request/invitation (§3).
 * An invitation is explicitly NOT the first offer — negotiation cannot start
 * before this handshake.
 */
export async function openThread({ deal, actorId, actorRole }) {
    if (deal.state !== 'invitation')
        throw ApiError.unprocessable(`Cannot open negotiation on a ${deal.state} deal`);

    // The receiving party is whoever did not create the request.
    const initiator = deal.requestedBy ?? 'brand';
    if (actorRole === initiator)
        throw ApiError.forbidden('The receiving party must accept the request');

    const existing = await NegotiationThread.findOne({ originDeal: deal._id, status: 'open' });
    if (existing) return existing;

    return NegotiationThread.create({
        brand: deal.brand,
        creator: deal.creator,
        originDeal: deal._id,
        campaign: deal.campaign,
        title: deal.title,
        status: 'open',
    });
}

/** Post an offer. Either party, at any point while the thread is open. */
export async function postOffer({ threadId, actorId, actorRole, terms }) {
    const thread = await NegotiationThread.findById(threadId);
    if (!thread) throw ApiError.notFound('Negotiation not found');
    assertParty(thread, actorId, actorRole);

    if (thread.status !== 'open')
        throw ApiError.unprocessable('This negotiation is closed');

    const pending = await Offer.find({ thread: thread._id, status: 'proposed' });
    const live = pending.filter((o) => o.isLive());

    // A55 — one live offer per party, but both sides may have one at once.
    if (live.some((o) => o.byRole === actorRole))
        throw ApiError.unprocessable(
            'You already have a live offer in this negotiation. It cannot be withdrawn — ' +
            'wait for a response, or let it expire if you set an expiry.',
        );

    // A56 — cap the thread.
    if (pending.length >= MAX_PENDING_PER_THREAD)
        throw ApiError.unprocessable(`A negotiation may hold at most ${MAX_PENDING_PER_THREAD} pending offers`);

    if (terms.expiresAt && new Date(terms.expiresAt) <= new Date())
        throw ApiError.unprocessable('Expiry must be in the future');

    const last = await Offer.findOne({ thread: thread._id }).sort({ seq: -1 }).select('seq').lean();

    const offer = await Offer.create({
        thread: thread._id,
        seq: (last?.seq ?? 0) + 1,
        by: new Types.ObjectId(actorId),
        byRole: actorRole,
        amount: terms.amount,
        deliverables: terms.deliverables ?? '',
        deadline: terms.deadline ? new Date(terms.deadline) : undefined,
        revisionsAllowed: terms.revisionsAllowed ?? 1,
        note: terms.note,
        expiresAt: terms.expiresAt ? new Date(terms.expiresAt) : undefined,
    });

    thread.lastOfferAt = new Date();
    await thread.save();

    await notify({
        user: counterpartOf(thread, actorRole),
        type: 'offer.received',
        title: 'New offer',
        body: `An offer of ₹${terms.amount.toLocaleString('en-IN')} was sent on "${thread.title}".`,
        data: { threadId: thread.id, offerId: offer.id },
    }).catch(() => void 0);

    return offer;
}

/**
 * Accept an offer. Spawns a **new deal** carrying that offer's terms, and
 * closes the thread (B2 follow-up).
 *
 * Note what is deliberately NOT done here: the other pending offers are left
 * alone (§4, non-negotiable rule 13). They stop being acceptable only because
 * the thread closes.
 */
export async function acceptOffer({ offerId, actorId, actorRole }) {
    const offer = await Offer.findById(offerId);
    if (!offer) throw ApiError.notFound('Offer not found');

    const thread = await NegotiationThread.findById(offer.thread);
    if (!thread) throw ApiError.notFound('Negotiation not found');
    assertParty(thread, actorId, actorRole);

    if (thread.status !== 'open')
        throw ApiError.unprocessable('This negotiation is already closed');
    if (offer.byRole === actorRole)
        throw ApiError.unprocessable('You cannot accept your own offer');
    if (offer.status !== 'proposed')
        throw ApiError.unprocessable(`That offer is ${offer.status} and can no longer be accepted`);

    // A53 — lazy expiry, evaluated here rather than by a scheduled job.
    if (offer.expiresAt && offer.expiresAt <= new Date()) {
        offer.status = 'expired';
        await offer.save();
        throw ApiError.unprocessable('That offer has expired. Ask for a new one.');
    }

    const fees = computeFees(offer.amount);

    // §4 — the accepted offer produces its own deal, with terms copied from
    // the offer version so they are always traceable to something both parties
    // saw. The deal starts at `negotiating`: terms still need dual confirmation
    // (§5) before it can move to terms_agreed.
    const deal = await Deal.create({
        brand: thread.brand,
        creator: thread.creator,
        campaign: thread.campaign,
        title: thread.title || 'Collaboration',
        state: 'negotiation',
        sourceOffer: offer._id,
        terms: {
            amount: offer.amount,
            deliverables: offer.deliverables,
            deadline: offer.deadline,
            revisionsAllowed: offer.revisionsAllowed,
        },
        fees: {
            brandFeePct: fees.brandFeePct,
            creatorFeePct: fees.creatorFeePct,
            brandFee: fees.brandFee,
            creatorFee: fees.creatorFee,
            brandCharge: fees.brandCharge,
            creatorPayout: fees.creatorPayout,
        },
        escrow: { amount: fees.escrowAmount },
        timeline: [{
            from: null, to: 'negotiation',
            by: new Types.ObjectId(actorId), byRole: actorRole,
            note: `Created from accepted offer #${offer.seq}`,
            at: new Date(),
        }],
    });

    offer.status = 'accepted';
    offer.respondedBy = new Types.ObjectId(actorId);
    offer.respondedAt = new Date();
    offer.spawnedDeal = deal._id;
    await offer.save();

    thread.status = 'closed';
    thread.closedReason = 'offer_accepted';
    thread.closedAt = new Date();
    thread.resultingDeal = deal._id;
    await thread.save();

    await notify({
        user: counterpartOf(thread, actorRole),
        type: 'offer.accepted',
        title: 'Offer accepted',
        body: `Your offer on "${thread.title}" was accepted. Confirm the terms to continue.`,
        data: { dealId: deal.id },
    }).catch(() => void 0);

    return { deal, offer, thread };
}

/**
 * Reject a single offer. Per §15/Q15 this does NOT reject the deal — the
 * thread stays open and further offers can be made. Ending the whole thing is
 * the separate Reject Deal action.
 */
export async function rejectOffer({ offerId, actorId, actorRole, note }) {
    const offer = await Offer.findById(offerId);
    if (!offer) throw ApiError.notFound('Offer not found');

    const thread = await NegotiationThread.findById(offer.thread);
    if (!thread) throw ApiError.notFound('Negotiation not found');
    assertParty(thread, actorId, actorRole);

    if (offer.byRole === actorRole)
        throw ApiError.unprocessable('You cannot reject your own offer, and offers cannot be withdrawn');
    if (offer.status !== 'proposed')
        throw ApiError.unprocessable(`That offer is already ${offer.status}`);

    offer.status = 'rejected';
    offer.respondedBy = new Types.ObjectId(actorId);
    offer.respondedAt = new Date();
    offer.rejectionNote = note;
    await offer.save();

    await notify({
        user: counterpartOf(thread, actorRole),
        type: 'offer.rejected',
        title: 'Offer declined',
        body: `Your offer on "${thread.title}" was declined. You can send another.`,
        data: { threadId: thread.id },
    }).catch(() => void 0);

    return offer;
}

/** Thread view: every offer, newest first, with expiry applied. */
export async function getThread({ threadId, actorId, actorRole }) {
    const thread = await NegotiationThread.findById(threadId).lean();
    if (!thread) throw ApiError.notFound('Negotiation not found');
    if (actorRole !== 'admin')
        assertParty(thread, actorId, actorRole);

    const offers = await Offer.find({ thread: threadId }).sort({ seq: -1 });
    return { thread, offers: offers.map((o) => o.toJSON()) };
}

/**
 * Reject the whole deal (§7 / Q7 / §3.5).
 *
 * Distinct from `rejectOffer`, which kills one offer and leaves the negotiation
 * running. This ends the deal itself and is only available **before terms are
 * agreed** — after `terms_agreed` a party must raise a ticket instead (§7,
 * non-negotiable rule 7).
 *
 * Q7: no reason is required. A48/§4 of the earlier review requires the closure
 * reason to be visible to both parties when given, so it is stored on the deal
 * rather than only in the timeline note.
 */
export async function rejectDeal({ dealId, actorId, actorRole, note }) {
    const deal = await Deal.findById(dealId);
    if (!deal) throw ApiError.notFound('Deal not found');

    const expected = actorRole === 'creator' ? deal.creator : deal.brand;
    if (!expected || expected.toString() !== actorId)
        throw ApiError.forbidden('Not a party to this deal');

    if (!canDeclineBrief(deal.state))
        throw ApiError.unprocessable(
            deal.state === 'declined' || deal.state === 'cancelled'
                ? `This collaboration is already ${deal.state}`
                : `A brief can only be declined before acceptance. This collaboration is ${deal.state} — `
                  + 'cancellation (Policy 7) or dispute (Policy 10) applies instead.',
        );

    deal.closure = {
        reason: note,
        by: new Types.ObjectId(actorId),
        byRole: actorRole,
        at: new Date(),
    };
    await deal.save();

    const updated = await transitionDeal({
        dealId: deal.id,
        to: 'declined',
        actor: actorRole,
        actorId,
        note: note ?? `Declined by the ${actorRole}`,
    });

    // Any open negotiation for this deal ends with it. Offers are left in place
    // as history — they simply stop being acceptable once the thread closes.
    await NegotiationThread.updateMany(
        { originDeal: deal._id, status: 'open' },
        { $set: { status: 'closed', closedReason: 'brief_declined', closedAt: new Date() } },
    );

    await notify({
        user: (actorRole === 'creator' ? deal.brand : deal.creator).toString(),
        type: 'deal.declined',
        title: 'Brief declined',
        body: `"${deal.title}" was declined by the ${actorRole}.`,
        data: { dealId: deal.id },
    }).catch(() => void 0);

    return updated;
}

import { Types } from 'mongoose';
import { Deal, NegotiationThread, Offer } from '../../models/index.js';
import { INCLUDED_REVISIONS } from '../../models/Deal.js';
import { termsOf } from '../../models/Negotiation.js';
import { ApiError } from '../../utils/apiError.js';
import { notify, dealPayload } from '../notifications/notifications.service.js';
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
 * Also imported, not only re-exported. `export … from` re-publishes a name
 * without binding it locally, so the guard was reachable by every other module
 * and not by this one — which is part of why nothing here ever called it.
 */
import { assertTermsEditable } from './terms.service.js';

/**
 * Structured negotiation — cleared rules §3, §4, §5 and A52–A56.
 *
 * This replaces the earlier single-outstanding-offer model, which the cleared
 * rules overruled. The differences that matter:
 *
 *  - Offers live in their own collection on a NegotiationThread (B2), so each
 *    version is its own immutable row and nothing is ever overwritten.
 *  - Both parties may have a live offer at the same time; only one **each**
 *    (A55). Accepting one does not touch the other (§4).
 *  - Offers can never be withdrawn (§4). The protection against a party
 *    silently revising terms is immutability, not turn-taking.
 *  - Expiry is evaluated lazily at accept time (A53) — a missing cron can never
 *    make a stale offer acceptable.
 *  - The thread closes as soon as an offer is accepted (B2 follow-up).
 *
 * ── This stage was not reachable ───────────────────────────────────────────
 *
 * Three independent breaks meant no proposal could be sent or read at all, and
 * none of them produced an error anyone would notice:
 *
 *  1. `postOffer` takes a `threadId`; the controller passed it `dealId`. Every
 *     attempt to send a proposal resolved no thread and 404'd.
 *  2. Only campaign selection opened a thread. A creator accepting a direct
 *     requirement reached `negotiation` with no thread in existence, so even a
 *     fixed call would have had nowhere to write.
 *  3. The panel read `deal.offers`, which is not a path on the Deal schema —
 *     it was removed when offers moved to this collection. It rendered an empty
 *     history for every negotiation, forever.
 *
 * `threadForDeal` below is the answer to the first two: the deal is the address,
 * and the thread is found or opened from it. That also makes the two entry
 * routes identical here by construction rather than by both remembering to call
 * `openThread`.
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
 * The negotiation thread for a deal, opened if this is the first proposal.
 *
 * Distinct from `openThread`, which is the invitation handshake and enforces
 * that the *receiving* party accepts. By the time a deal is in `negotiation`
 * that handshake has already happened — whichever route it came through — so
 * this neither repeats it nor lets it be skipped.
 *
 * `create: false` is a read: it returns null rather than opening a thread, so
 * merely looking at a collaboration does not create state.
 */
export async function threadForDeal(dealId, { create = false } = {}) {
    const deal = await Deal.findById(dealId);
    if (!deal) throw ApiError.notFound('Collaboration not found');

    const existing = await NegotiationThread.findOne({ originDeal: deal._id })
        .sort({ createdAt: -1 });
    if (existing || !create) return { deal, thread: existing ?? null };

    if (deal.state !== 'negotiation') {
        throw ApiError.unprocessable(
            deal.state === 'invitation'
                ? 'The request has to be accepted before proposals can be exchanged'
                : `Proposals can only be exchanged during negotiation — this collaboration is ${deal.state}`,
        );
    }

    const thread = await NegotiationThread.create({
        brand: deal.brand,
        creator: deal.creator,
        originDeal: deal._id,
        campaign: deal.campaign,
        title: deal.title,
        status: 'open',
    });

    await seedFirstProposal(deal, thread);
    return { deal, thread };
}

/**
 * The opening requirement, recorded as Proposal V1.
 *
 * Without this the history starts at whatever the first counter happened to be,
 * and "V2" would be the first thing either party ever saw — which reads as a
 * version having gone missing. It also matters for the record: the terms on the
 * deal at this point are real terms somebody proposed, and if the other party
 * simply accepts them there has to be a version to point at.
 *
 * Authored by whoever made the request, which is exactly `requestedBy`: the
 * brand on a direct requirement, the creator on a campaign application. So the
 * two routes seed the same way without either one knowing about the other.
 *
 * Deliberately no expiry: an opening position that quietly expires would leave
 * a negotiation with no proposals in it and nothing explaining why.
 */
async function seedFirstProposal(deal, thread) {
    const existing = await Offer.findOne({ thread: thread._id }).select('_id').lean();
    if (existing) return null;

    const byRole = deal.requestedBy === 'creator' ? 'creator' : 'brand';
    const by = byRole === 'creator' ? deal.creator : deal.brand;
    const t = deal.terms?.toObject?.() ?? deal.terms ?? {};

    return Offer.create({
        thread: thread._id,
        seq: 1,
        by,
        byRole,
        amount: t.amount ?? 0,
        deliverables: t.deliverables ?? '',
        contentItems: t.contentItems ?? [],
        guidelines: t.guidelines ?? {},
        startDate: t.startDate,
        deadline: t.deadline,
        usageRights: deal.usageRights?.toObject?.() ?? deal.usageRights ?? undefined,
        exclusivity: deal.exclusivity ?? '',
        otherTerms: t.otherTerms ?? '',
        revisionsAllowed: t.revisionsAllowed ?? INCLUDED_REVISIONS,
        note: 'The opening requirement, as sent.',
    });
}

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
export async function postOffer({ dealId, actorId, actorRole, terms }) {
    // Addressed by deal, not by thread: that is what the route already passes,
    // and it is what makes the two entry routes converge here.
    const { deal, thread } = await threadForDeal(dealId, { create: true });
    assertParty(thread, actorId, actorRole);

    // §5 / non-negotiable rule 8 — once terms are agreed they are immutable, and
    // a new proposal is an edit to them. This was written as a guard and never
    // called anywhere; a proposal on a funded deal would have been accepted.
    assertTermsEditable(deal);

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

    /*
      A timeline that runs backwards is not a position anyone can accept, so it
      is refused at the point of proposing rather than discovered by whoever has
      to respond to it. Same rule the campaign wizard applies to its own dates.
    */
    if (terms.startDate && terms.deadline
        && new Date(terms.startDate) > new Date(terms.deadline)) {
        throw ApiError.unprocessable('Work cannot start after the deadline it is due');
    }

    const last = await Offer.findOne({ thread: thread._id }).sort({ seq: -1 }).select('seq').lean();

    const offer = await Offer.create({
        thread: thread._id,
        seq: (last?.seq ?? 0) + 1,
        by: new Types.ObjectId(actorId),
        byRole: actorRole,
        amount: terms.amount,
        deliverables: terms.deliverables ?? '',
        contentItems: terms.contentItems ?? [],
        guidelines: terms.guidelines ?? {},
        startDate: terms.startDate ? new Date(terms.startDate) : undefined,
        deadline: terms.deadline ? new Date(terms.deadline) : undefined,
        usageRights: terms.usageRights ?? undefined,
        exclusivity: terms.exclusivity ?? '',
        otherTerms: terms.otherTerms ?? '',
        revisionsAllowed: terms.revisionsAllowed ?? INCLUDED_REVISIONS,
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
 * Accept a proposal. Its terms land on the collaboration being negotiated, and
 * the thread closes (B2 follow-up).
 *
 * ── Why this no longer spawns a deal ───────────────────────────────────────
 *
 * §4 used to say an accepted offer creates a separate deal. It did — and left
 * the original one at `negotiation` with nothing that would ever move it, so a
 * single piece of work appeared twice in both parties' lists and only the newer
 * of the two was real. Applying the terms to the collaboration they were
 * negotiated for is both simpler and what the parties think is happening. The
 * rule change is recorded in models/Negotiation.js.
 *
 * ── Every term, not four of them ───────────────────────────────────────────
 *
 * The old copy took amount, deliverables, deadline and revisions. Usage rights
 * were negotiable, were negotiated, and were then dropped on the floor — the
 * deal kept whatever the schema defaulted to. `termsOf` is now the single
 * definition of what a term is, so acceptance and the final lock cannot drift.
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

    const deal = await Deal.findById(thread.originDeal);
    if (!deal) throw ApiError.notFound('Collaboration not found');
    assertTermsEditable(deal);

    /*
      The terms of the accepted version, applied to this collaboration. Usage
      rights and exclusivity go to the top level, which Policy 5.2 designates as
      the agreed scope; everything else goes into `terms`. One home each.
    */
    const t = termsOf(offer);

    deal.sourceOffer = offer._id;
    deal.terms = {
        ...(deal.terms?.toObject?.() ?? deal.terms ?? {}),
        amount: t.amount,
        deliverables: t.deliverables ?? '',
        contentItems: t.contentItems ?? [],
        guidelines: t.guidelines ?? {},
        startDate: t.startDate,
        deadline: t.deadline,
        otherTerms: t.otherTerms ?? '',
        revisionsAllowed: t.revisionsAllowed,
        acceptedOffer: offer._id,
    };
    if (t.usageRights) deal.usageRights = { ...(deal.usageRights ?? {}), ...t.usageRights };
    if (t.exclusivity !== undefined) deal.exclusivity = t.exclusivity;

    // `contentTypes` is the flat list the rest of the app reads; derive it so it
    // cannot disagree with the rows it is derived from.
    if (t.contentItems?.length) {
        deal.contentTypes = [...new Set(t.contentItems.map((i) => i.contentType).filter(Boolean))];
    }

    /**
     * Escrow holds the agreed value and nothing more (Policy 14.5). The
     * commission rate is deliberately NOT snapshotted here: Policy 14.7 ties it
     * to acceptance of the *terms*, which is the dual confirmation in
     * terms.service.js. A deal still at `negotiation` has nothing agreed yet,
     * and fixing a rate now would fix it before the second party had confirmed
     * the terms it applies to.
     */
    deal.escrow = { ...(deal.escrow?.toObject?.() ?? deal.escrow ?? {}), amount: t.amount };

    deal.timeline.push({
        from: deal.state, to: deal.state,
        by: new Types.ObjectId(actorId), byRole: actorRole,
        note: `Proposal V${offer.seq} accepted — terms applied`,
        at: new Date(),
    });
    await deal.save();

    offer.status = 'accepted';
    offer.respondedBy = new Types.ObjectId(actorId);
    offer.respondedAt = new Date();
    // Legacy field name — it now records the deal the terms were applied to,
    // which for every row written since the rule change is the origin deal.
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
        title: 'Proposal accepted',
        body: `Proposal V${offer.seq} on "${thread.title}" was accepted. Confirm the terms to make them final.`,
        data: dealPayload(deal),
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
        data: dealPayload(deal),
    }).catch(() => void 0);

    return updated;
}
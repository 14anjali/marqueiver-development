import { z } from 'zod';
import { Types } from 'mongoose';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok, created } from '../../utils/respond.js';
import { Deal } from '../../models/index.js';
import { transitionDeal, listDealsForUser, createPaymentSession } from './deals.service.js';
import { canRequestRevision, canCancel, REVIEW_WINDOW_DAYS, RESOLUTION_AUTO_DAYS } from './dealStateMachine.js';
import { brandCancellationOutcome, creatorCancellationOutcome } from '../../services/commission.service.js';
import { postOffer, acceptOffer, rejectOffer, rejectDeal, confirmTerms } from './negotiation.service.js';
import { notify } from '../notifications/notifications.service.js';
import { DEAL_STATES } from '../../../../shared/types.js';
/** Brand invites a creator (or creator applies) → new deal in `invited`. */
export const createDealSchema = z.object({
    creatorId: z.string(),
    title: z.string().min(3),
    contentTypes: z.array(z.string()).default([]),
    amount: z.number().min(0),
    deliverables: z.string().default(''),
    deadline: z.string().optional(),
    revisionsAllowed: z.number().min(0).default(1),
});
export const createDeal = catchAsync(async (req, res) => {
    if (req.auth.role !== 'brand')
        throw ApiError.forbidden('Only brands can invite');
    const b = req.body;
    const deal = await Deal.create({
        brand: req.auth.sub,
        creator: b.creatorId,
        origin: 'invite',
        title: b.title,
        contentTypes: b.contentTypes,
        terms: {
            amount: b.amount,
            deliverables: b.deliverables,
            deadline: b.deadline ? new Date(b.deadline) : undefined,
            revisionsAllowed: b.revisionsAllowed,
        },
        state: 'invitation',
        // Cleared rules §3 — an invitation is NOT the first negotiation offer.
        // Offers can only be posted once the receiving party accepts and the
        // deal reaches `negotiating`.
        offers: [],
        timeline: [{ from: null, to: 'invitation', by: new Types.ObjectId(req.auth.sub), byRole: 'brand', at: new Date() }],
    });
    await notify({
        user: b.creatorId, type: 'deal.invited', title: 'New campaign invite',
        body: `You've been invited to "${b.title}".`, data: { dealId: deal.id },
    }).catch(() => void 0);
    created(res, deal);
});
export const listMyDeals = catchAsync(async (req, res) => {
    const role = req.auth.role;
    if (role !== 'creator' && role !== 'brand')
        throw ApiError.forbidden();
    const state = req.query.state;
    const deals = await listDealsForUser(req.auth.sub, role, state);
    ok(res, deals);
});
export const getDeal = catchAsync(async (req, res) => {
    // Not lean: deals predating offers[] get their opening offer written on
    // first read, so it has a real _id the accept/reject endpoints can address.
    const deal = await Deal.findById(req.params.id);
    if (!deal)
        throw ApiError.notFound();
    const isParty = [deal.brand.toString(), deal.creator.toString()].includes(req.auth.sub);
    if (!isParty && req.auth.role !== 'admin')
        throw ApiError.forbidden();
    ok(res, deal);
});
/**
 * Real Cashfree Checkout session (feature: Frontend Cashfree Checkout).
 * Brand-only, deal must be 'accepted'. Returns paymentSessionId for the
 * Cashfree JS SDK; does not itself change the deal state — the frontend
 * calls the normal transition endpoint once Cashfree reports success.
 */
export const startPaymentSession = catchAsync(async (req, res) => {
    const result = await createPaymentSession(req.params.id, req.auth.sub);
    ok(res, result);
});
/** Generic transition endpoint — the state machine enforces legality. */
export const transitionSchema = z.object({
    to: z.enum(DEAL_STATES),
    note: z.string().optional(),
    disputeReason: z.string().optional(),
    payoutAccount: z.string().optional(),
});
export const transition = catchAsync(async (req, res) => {
    const b = req.body;
    const actor = req.auth.role === 'admin' ? 'admin' : req.auth.role;
    const deal = await transitionDeal({
        dealId: req.params.id,
        to: b.to,
        actor,
        actorId: req.auth.sub,
        note: b.note,
        disputeReason: b.disputeReason,
        payoutAccount: b.payoutAccount,
    });
    ok(res, deal);
});
/** Creator submits deliverables (transitions in_progress/revision → submitted). */
export const submitWorkSchema = z.object({
    urls: z.array(z.string()).min(1),
    note: z.string().optional(),
});
export const submitWork = catchAsync(async (req, res) => {
    if (req.auth.role !== 'creator')
        throw ApiError.forbidden();
    const b = req.body;
    const deal = await Deal.findById(req.params.id);
    if (!deal)
        throw ApiError.notFound();
    if (deal.creator.toString() !== req.auth.sub)
        throw ApiError.forbidden();

    /**
     * Policy 15 — required advertising disclosure must be confirmed BEFORE the
     * deliverable can be submitted. Blocking here rather than warning, because
     * 15.5 makes non-disclosure a compliance failure the Platform must prevent,
     * not merely flag.
     */
    if (!deal.disclosure?.confirmedAt)
        throw new ApiError(422, 'DISCLOSURE_REQUIRED',
            'Confirm the advertising disclosure for this collaboration before submitting deliverables (Policy 15).');

    /**
     * Policy 11 — a post-deadline submission is still accepted; it is marked
     * late rather than blocked. "Late" is 24 hours past the agreed deadline.
     */
    const now = new Date();
    const late = Boolean(deal.terms?.deadline && now > new Date(deal.terms.deadline.getTime() + 24 * 3600 * 1000));

    deal.workSubmissions.push({
        urls: b.urls, note: b.note, submittedAt: now, reviewStatus: 'pending', late,
    });

    // Policy 5.3 — the Brand's 7-day review window opens now. The scheduler
    // reads this deadline; nothing else needs to know the duration.
    deal.reviewDeadline = new Date(now.getTime() + REVIEW_WINDOW_DAYS * 24 * 3600 * 1000);
    deal.reviewRemindersSent = [];
    await deal.save();

    const updated = await transitionDeal({
        dealId: deal.id, to: 'submitted', actor: 'creator', actorId: req.auth.sub,
        note: late ? 'Deliverables submitted (late)' : 'Deliverables submitted',
    });
    ok(res, updated);
});

/**
 * Policy 5.4 — a revision request is only valid while agreed rounds remain.
 * Once they are exhausted the Collaboration moves to Resolution (Policy 5.5)
 * instead of silently accepting a third round.
 */
export const requestRevision = catchAsync(async (req, res) => {
    const deal = await Deal.findById(req.params.id);
    if (!deal) throw ApiError.notFound();
    if (deal.brand.toString() !== req.auth.sub) throw ApiError.forbidden();

    const check = canRequestRevision(deal);
    if (!check.allowed) {
        // Move to Resolution rather than refusing outright — the Brand still
        // needs a route forward, and 5.5 defines exactly what it is.
        deal.resolutionDeadline = new Date(Date.now() + RESOLUTION_AUTO_DAYS * 24 * 3600 * 1000);
        await deal.save();
        const moved = await transitionDeal({
            dealId: deal.id, to: 'resolution', actor: 'brand', actorId: req.auth.sub,
            note: `All ${check.limit} agreed revision rounds used — moved to Resolution (Policy 5.5)`,
        });
        return ok(res, {
            deal: moved,
            revisionsExhausted: true,
            message: `You have used all ${check.limit} agreed revision rounds. Choose a resolution option.`,
        });
    }

    deal.revisionCount = (deal.revisionCount ?? 0) + 1;
    await deal.save();

    const updated = await transitionDeal({
        dealId: deal.id, to: 'revision', actor: 'brand', actorId: req.auth.sub,
        note: req.body?.note ?? `Revision ${deal.revisionCount} of ${check.limit} requested`,
    });
    ok(res, { deal: updated, revisionsUsed: deal.revisionCount, revisionsAllowed: check.limit });
});

/** Policy 15 — the Creator confirms the disclosure that will appear on the content. */
export const confirmDisclosureSchema = z.object({
    method: z.enum(['#ad', '#advertisement', '#sponsored', '#paidpartnership', '#collab', 'platform_tool']),
    placement: z.string().max(200).optional(),
    language: z.string().max(40).optional(),
});
export const confirmDisclosure = catchAsync(async (req, res) => {
    const deal = await Deal.findById(req.params.id);
    if (!deal) throw ApiError.notFound();
    if (deal.creator.toString() !== req.auth.sub) throw ApiError.forbidden();

    deal.disclosure = {
        method: req.body.method,
        placement: req.body.placement,
        language: req.body.language,
        confirmedAt: new Date(),
        confirmedBy: new Types.ObjectId(req.auth.sub),
    };
    await deal.save();
    ok(res, deal.disclosure);
});


/* ── Structured negotiation (scope §11, §12) ─────────────────────────────
 * Offers and counter-offers are versioned records in their own collection.
 * Both parties may hold a live offer at once; immutability, not turn-taking,
 * is what stops terms being silently revised. */

export const offerSchema = z.object({
    amount: z.number().min(0),
    deliverables: z.string().default(''),
    deadline: z.string().optional(),
    revisionsAllowed: z.number().min(0).optional(),
    // Optional, chosen by the proposer (§4).
    expiresAt: z.string().optional(),
    note: z.string().max(500).optional(),
});

function party(req) {
    if (req.auth.role !== 'brand' && req.auth.role !== 'creator')
        throw ApiError.forbidden('Only the brand or creator on a deal can negotiate');
    return req.auth.role;
}

export const createOffer = catchAsync(async (req, res) => {
    const deal = await postOffer({
        dealId: req.params.id,
        actorId: req.auth.sub,
        actorRole: party(req),
        terms: req.body,
    });
    created(res, deal);
});

export const acceptOfferHandler = catchAsync(async (req, res) => {
    const deal = await acceptOffer({
        dealId: req.params.id,
        offerId: req.params.offerId,
        actorId: req.auth.sub,
        actorRole: party(req),
    });
    ok(res, deal);
});

export const rejectOfferSchema = z.object({ note: z.string().max(500).optional() });
export const rejectOfferHandler = catchAsync(async (req, res) => {
    const deal = await rejectOffer({
        dealId: req.params.id,
        offerId: req.params.offerId,
        actorId: req.auth.sub,
        actorRole: party(req),
        note: req.body?.note,
    });
    ok(res, deal);
});

/**
 * Confirm terms (§5). Both parties confirm separately; the second confirmation
 * moves the deal to `terms_agreed` and locks the terms.
 */
export const confirmTermsHandler = catchAsync(async (req, res) => {
    // confirmTerms returns { deal, agreed } — `agreed` is true only on the
    // second confirmation, which is what moved the deal to terms_agreed. The
    // UI needs it to know whether to show "waiting on them" or "fund escrow".
    const { deal, agreed } = await confirmTerms({
        dealId: req.params.id,
        actorId: req.auth.sub,
        actorRole: party(req),
    });
    ok(res, { deal, agreed });
});

/** Reject the whole deal — only before terms are agreed (§7). */
export const rejectDealSchema = z.object({ note: z.string().max(500).optional() });
export const rejectDealHandler = catchAsync(async (req, res) => {
    const deal = await rejectDeal({
        dealId: req.params.id,
        actorId: req.auth.sub,
        actorRole: party(req),
        note: req.body?.note,
    });
    ok(res, deal);
});


/* ── Cancellation (Policy 7.1, 7.2, 28) ──────────────────────────────────
 * Policy 28: "Never make the user confirm a cancellation without showing the
 * applicable consequence first." So cancellation is two calls: a preview that
 * computes the exact money outcome for the current stage, and an execute that
 * performs it. The preview is a GET and changes nothing.
 */

/** What cancelling right now would cost. Read-only. */
export const previewCancellation = catchAsync(async (req, res) => {
    const deal = await Deal.findById(req.params.id).lean();
    if (!deal) throw ApiError.notFound('Collaboration not found');

    const role = req.auth.role;
    const isParty = [deal.brand.toString(), deal.creator.toString()].includes(req.auth.sub);
    if (!isParty && role !== 'admin') throw ApiError.forbidden();

    const check = canCancel(deal.state, role);
    if (!check.allowed) {
        return ok(res, {
            allowed: false,
            reason: check.reason,
            state: deal.state,
        });
    }

    const agreedValue = deal.escrow?.amount ?? deal.terms?.amount ?? 0;
    const funded = Boolean(deal.escrow?.funded);

    // Nothing is held yet, so there is nothing to settle.
    if (!funded) {
        return ok(res, {
            allowed: true,
            state: deal.state,
            escrowFunded: false,
            agreedValue,
            creatorReceives: 0,
            brandRefund: 0,
            commission: 0,
            summary: 'No payment has been made yet, so nothing will be charged or refunded.',
        });
    }

    const outcome = role === 'creator'
        ? creatorCancellationOutcome({ state: deal.state, agreedValue, commissionPct: deal.commission?.ratePct })
        : brandCancellationOutcome({ state: deal.state, agreedValue, commissionPct: deal.commission?.ratePct });

    // Plain-language summary per stage, so the consequence is understandable
    // rather than a table of numbers (Policy 28).
    const SUMMARY = {
        accepted: 'Work has not started, so the full amount is refunded to the Brand.',
        escrow_pending: 'Work has not started, so the full amount is refunded to the Brand.',
        in_progress: role === 'brand'
            ? 'Work has begun, so the Creator keeps 25% as a cancellation fee and 75% is refunded to you.'
            : 'You are cancelling work you have begun, so the Brand is refunded in full unless they accept partial deliverables.',
        submitted: 'The Creator has already delivered, so they receive the full fee and no refund is due.',
        revision: 'The Creator has already delivered, so they receive the full fee and no refund is due.',
    };

    ok(res, {
        allowed: true,
        state: deal.state,
        escrowFunded: true,
        agreedValue,
        creatorReceives: outcome.creatorNet,
        creatorGross: outcome.creatorGross,
        commission: outcome.commission,
        commissionPct: outcome.commissionPct,
        brandRefund: outcome.brandRefund,
        summary: SUMMARY[deal.state] ?? 'The outcome will follow the cancellation policy for this stage.',
        irreversible: true,
    });
});

export const cancelDealSchema = z.object({ reason: z.string().max(500).optional() });

/**
 * Execute the cancellation. The settlement is computed server-side from the
 * stage — the client cannot propose amounts, because Policy 7.1 fixes them.
 */
export const cancelDeal = catchAsync(async (req, res) => {
    const deal = await Deal.findById(req.params.id).lean();
    if (!deal) throw ApiError.notFound('Collaboration not found');

    const role = req.auth.role;
    const isParty = [deal.brand.toString(), deal.creator.toString()].includes(req.auth.sub);
    if (!isParty && role !== 'admin') throw ApiError.forbidden();

    const check = canCancel(deal.state, role);
    if (!check.allowed) throw ApiError.unprocessable(check.reason);

    const updated = await transitionDeal({
        dealId: req.params.id,
        to: 'cancelled',
        actor: role,
        actorId: req.auth.sub,
        note: req.body?.reason,
    });
    ok(res, updated);
});

import { z } from 'zod';
import { Types } from 'mongoose';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok, created } from '../../utils/respond.js';
import { Deal } from '../../models/index.js';
import { transitionDeal, listDealsForUser, createPaymentSession } from './deals.service.js';
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
        state: 'invited',
        timeline: [{ from: null, to: 'invited', by: new Types.ObjectId(req.auth.sub), byRole: 'brand', at: new Date() }],
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
    const deal = await Deal.findById(req.params.id).lean();
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
    deal.workSubmissions.push({ urls: b.urls, note: b.note, submittedAt: new Date(), reviewStatus: 'pending' });
    await deal.save();
    const updated = await transitionDeal({
        dealId: deal.id, to: 'submitted', actor: 'creator', actorId: req.auth.sub, note: 'Deliverables submitted',
    });
    ok(res, updated);
});

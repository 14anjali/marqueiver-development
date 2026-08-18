import { Types } from 'mongoose';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok } from '../../utils/respond.js';
import { Transaction, Deal } from '../../models/index.js';
import { verifyWebhook } from '../../services/cashfree.service.js';
/** Escrow funding is driven through the deal transition (accepted → escrow_funded).
 * These endpoints expose the ledger + the gateway webhook. Proposal §6. */
export const myTransactions = catchAsync(async (req, res) => {
    const txns = await Transaction.find({
        $or: [{ fromUser: req.auth.sub }, { toUser: req.auth.sub }],
    }).sort({ createdAt: -1 }).limit(200).lean();
    ok(res, txns);
});
/** Creator earnings summary (proposal §5.1 — completed deals, pending payouts). */
export const earnings = catchAsync(async (req, res) => {
    const released = await Transaction.aggregate([
        { $match: { toUser: new Types.ObjectId(req.auth.sub), type: 'escrow_release', status: 'success' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    const pending = await Deal.aggregate([
        { $match: { creator: new Types.ObjectId(req.auth.sub), state: { $in: ['submitted', 'in_progress'] } } },
        { $group: { _id: null, total: { $sum: '$escrow.amount' } } },
    ]);
    ok(res, {
        totalEarned: released[0]?.total ?? 0,
        completedDeals: released[0]?.count ?? 0,
        pendingPayout: pending[0]?.total ?? 0,
    });
});
/**
 * Cashfree webhook — HMAC signature-verified (x-webhook-signature +
 * x-webhook-timestamp headers). Unlike Razorpay, Cashfree's refund API takes
 * the order_id directly, so — unlike the previous Razorpay integration —
 * there's no id-swap needed here; this just confirms/updates the funding
 * Transaction's status from the payment result.
 */
export const webhook = catchAsync(async (req, res) => {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const raw = req.rawBody ?? JSON.stringify(req.body);
    if (!verifyWebhook(raw, signature, timestamp))
        throw ApiError.unauthorized('Bad signature');

    const type = req.body?.type;
    const orderId = req.body?.data?.order?.order_id;
    if (orderId && type === 'PAYMENT_SUCCESS_WEBHOOK') {
        await Transaction.updateOne({ gatewayRef: orderId }, { status: 'success' });
    } else if (orderId && type === 'PAYMENT_FAILED_WEBHOOK') {
        await Transaction.updateOne({ gatewayRef: orderId }, { status: 'failed' });
    }
    ok(res, { received: true });
});

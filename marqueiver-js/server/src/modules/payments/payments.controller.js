import { Types } from 'mongoose';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { confirmEscrowFunded, flagEscrowFailure } from '../deals/deals.service.js';
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
        { $match: { creator: new Types.ObjectId(req.auth.sub), state: { $in: ['submitted', 'active'] } } },
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
    /**
     * §6 — the webhook is what activates a deal. Previously this only updated
     * the Transaction row and the frontend separately asserted success through
     * `POST /deals/:id/transition`, which meant a client call moved the deal
     * and the money. Now the processor's confirmation is the trigger.
     */
    if (orderId && type === 'PAYMENT_SUCCESS_WEBHOOK') {
        const txn = await Transaction.findOneAndUpdate(
            { gatewayRef: orderId },
            { status: 'success' },
            { new: true },
        );
        if (txn?.deal) {
            // Failures here must not 200 the webhook away silently — Cashfree
            // retries, and we want the retry if activation did not land.
            await confirmEscrowFunded(txn.deal.toString());
        }
    } else if (orderId && type === 'PAYMENT_FAILED_WEBHOOK') {
        const txn = await Transaction.findOneAndUpdate(
            { gatewayRef: orderId },
            { status: 'failed' },
            { new: true },
        );
        // No auto-retry, no auto-cancel — Admin decides (A11).
        if (txn?.deal) await flagEscrowFailure(txn.deal.toString(), req.body?.data?.error?.error_description);
    }
    ok(res, { received: true });
});

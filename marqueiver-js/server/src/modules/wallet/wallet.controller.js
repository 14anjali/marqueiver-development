import { z } from 'zod';
import mongoose from 'mongoose';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok } from '../../utils/respond.js';
import { Wallet, Transaction, CreatorProfile } from '../../models/index.js';
import { transactionsSupported } from '../../config/db.js';
import { payoutToBeneficiary } from '../../services/cashfree.service.js';

/**
 * Wallet module (feature: internal wallet + escrow, real money only via
 * Cashfree at the withdrawal edge). Creator-facing: view balance/ledger, set
 * a payout method, withdraw. The balance itself is only ever changed by
 * server-side code (deals.service.js credits it on escrow release; this
 * module debits it on withdrawal) — never directly by a client request.
 */

async function getOrCreateWallet(userId) {
    let wallet = await Wallet.findOne({ user: userId });
    if (!wallet) wallet = await Wallet.create({ user: userId });
    return wallet;
}

export const getWallet = catchAsync(async (req, res) => {
    const wallet = await getOrCreateWallet(req.auth.sub);
    ok(res, wallet);
});

/** Ledger — wallet-relevant transactions (credits from escrow release, debits from withdrawal). */
export const getLedger = catchAsync(async (req, res) => {
    const txns = await Transaction.find({
        $or: [{ toUser: req.auth.sub, type: 'escrow_release' }, { fromUser: req.auth.sub, type: 'payout' }],
    }).sort({ createdAt: -1 }).limit(200).lean();
    ok(res, txns);
});

export const setPayoutMethodSchema = z.object({
    type: z.enum(['bank', 'upi']),
    accountHolderName: z.string().min(1),
    bankAccount: z.string().optional(),
    ifsc: z.string().optional(),
    vpa: z.string().optional(),
}).refine((d) => (d.type === 'bank' ? !!(d.bankAccount && d.ifsc) : !!d.vpa), {
    message: 'Bank withdrawals need bankAccount + ifsc; UPI withdrawals need vpa',
});
export const setPayoutMethod = catchAsync(async (req, res) => {
    if (req.auth.role !== 'creator') throw ApiError.forbidden('Only creators have a payout method');
    const profile = await CreatorProfile.findOneAndUpdate(
        { user: req.auth.sub },
        { payoutMethod: req.body },
        { new: true },
    );
    if (!profile) throw ApiError.notFound();
    ok(res, profile.payoutMethod);
});

export const withdrawSchema = z.object({ amount: z.number().min(1) });
export const withdraw = catchAsync(async (req, res) => {
    if (req.auth.role !== 'creator') throw ApiError.forbidden('Only creators can withdraw');
    const { amount } = req.body;

    const [wallet, profile] = await Promise.all([
        getOrCreateWallet(req.auth.sub),
        CreatorProfile.findOne({ user: req.auth.sub }).lean(),
    ]);
    if (!profile?.payoutMethod?.type) throw ApiError.badRequest('Add a payout method before withdrawing');
    if (wallet.balance < amount) throw ApiError.unprocessable('Insufficient wallet balance');

    const transferId = `wd_${req.auth.sub}_${Date.now()}`;
    const session = transactionsSupported ? await mongoose.startSession() : null;

    let result;
    const run = async () => {
        // Debit first (atomic — re-checks the balance floor via schema min:0).
        const updated = await Wallet.findOneAndUpdate(
            { user: req.auth.sub, balance: { $gte: amount } },
            { $inc: { balance: -amount, lifetimeWithdrawn: amount } },
            { new: true, session: session ?? undefined },
        );
        if (!updated) throw ApiError.unprocessable('Insufficient wallet balance');

        result = await payoutToBeneficiary({
            transferId,
            amount,
            name: profile.payoutMethod.accountHolderName,
            phone: '9999999999',
            bankAccount: profile.payoutMethod.bankAccount,
            ifsc: profile.payoutMethod.ifsc,
            vpa: profile.payoutMethod.vpa,
        });

        await Transaction.create([{
            fromUser: req.auth.sub,
            type: 'payout',
            status: result.status,
            amount,
            gateway: 'cashfree',
            gatewayRef: result.payoutRef,
            idempotencyKey: transferId,
        }], session ? { session } : {});
    };

    try {
        if (session) await session.withTransaction(run);
        else await run();
    } finally {
        await session?.endSession();
    }

    ok(res, { withdrawn: amount, payoutRef: result.payoutRef, status: result.status });
});

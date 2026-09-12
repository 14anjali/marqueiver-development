import { Types } from 'mongoose';
import { z } from 'zod';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { confirmEscrowFunded, flagEscrowFailure } from '../deals/deals.service.js';
import { fundAdditionalTerms } from '../deals/additionalTerms.service.js';
import { ok, created } from '../../utils/respond.js';
import { Transaction, Deal, BrandPaymentMethod } from '../../models/index.js';
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
        /*
          `verified`, not `success`. The gateway confirming a payment is the
          only thing that writes this state, and it is the only state that
          unlocks the collaboration or the chat. `moveTo` records it in the
          payment's own history so the record says who moved it and when.
        */
        const txn = await Transaction.findOne({ gatewayRef: orderId });
        if (txn) {
            txn.moveTo('verified', { by: 'gateway', note: 'PAYMENT_SUCCESS_WEBHOOK' });
            await txn.save();
        }
        if (txn?.deal) {
            /**
             * Two different payments arrive as `escrow_fund`.
             *
             * The original advance activates the collaboration
             * (`accepted → in_progress`). A Policy 5.5 option B payment tops up
             * an addition on a deal that is already past that point, and must
             * instead add the purchased revision rounds and return the deal to
             * `in_progress` from `resolution`.
             *
             * Without this branch the option B payment would be handed to
             * `confirmEscrowFunded`, which would either refuse the transition
             * or re-run first-funding side effects on a live deal — and the
             * brand would have paid for rounds that never appeared.
             */
            // Failures here must not 200 the webhook away silently — Cashfree
            // retries, and we want the retry if activation did not land.
            if (txn.meta?.additionalTerms) {
                await fundAdditionalTerms({ dealId: txn.deal.toString(), actorId: txn.fromUser?.toString() });
            } else {
                await confirmEscrowFunded(txn.deal.toString());
            }
        }
    } else if (orderId && type === 'PAYMENT_USER_DROPPED_WEBHOOK') {
        /*
          The brand opened checkout and left without paying. Not a failure —
          nothing was refused — so it does not go to `failed` and does not
          notify anyone. The order simply goes back to being unpaid.
        */
        const txn = await Transaction.findOne({ gatewayRef: orderId, status: { $in: ['pending', 'initiated'] } });
        if (txn) {
            txn.moveTo('pending', { by: 'gateway', note: 'Checkout abandoned' });
            await txn.save();
        }
    } else if (orderId && type === 'PAYMENT_FAILED_WEBHOOK') {
        const txn = await Transaction.findOne({ gatewayRef: orderId });
        if (txn) {
            txn.moveTo('failed', {
                by: 'gateway',
                note: req.body?.data?.error?.error_description ?? 'PAYMENT_FAILED_WEBHOOK',
            });
            await txn.save();
        }
        /*
          Still no automatic retry and no automatic cancellation (A11). The
          collaboration stays exactly where it is and the chat stays locked;
          what changed is that the brand is now told they can try again, rather
          than told to wait for a review that most failures do not need.
        */
        if (txn?.deal) await flagEscrowFailure(txn.deal.toString(), req.body?.data?.error?.error_description);
    }
    ok(res, { received: true });
});

/* ─────────────────────── brand payment methods (reference records) ──────────
 *
 * These endpoints manage `BrandPaymentMethod` rows. Read that model's header
 * before changing anything here: a row is a reference record of how a brand
 * pays, NOT a chargeable instrument. Escrow funding still goes
 * `POST /deals/:id/payment-session` → Cashfree hosted checkout, exactly as
 * before, and nothing in this file is consulted by that path.
 *
 * Privacy: a brand can only ever read or write its own rows — every query is
 * filtered by `brand: req.auth.sub`, never by the id alone — and no creator-
 * facing endpoint reads this collection at all.
 */

/**
 * Full account numbers are accepted from the client and thrown away.
 *
 * The brand types the number it knows; we keep four digits so the brand can
 * recognise the row later, and never persist the rest. Doing the truncation
 * here rather than asking the client to send four digits means a brand cannot
 * accidentally store a whole account number by calling the API directly.
 */
const last4 = (value) => String(value ?? '').replace(/\D/g, '').slice(-4);

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const VPA = /^[\w.\-]{2,64}@[a-zA-Z]{2,64}$/;

export const brandPaymentMethodSchema = z.object({
    type: z.enum(['bank', 'upi', 'netbanking']),
    label: z.string().trim().max(60).optional(),
    bankName: z.string().trim().max(80).optional(),
    accountHolderName: z.string().trim().max(120).optional(),
    /** Discarded after `last4`; validated only so a typo is caught early. */
    accountNumber: z.string().trim().regex(/^[0-9]{6,20}$/).optional(),
    ifsc: z.string().trim().toUpperCase().regex(IFSC, 'That is not a valid IFSC').optional(),
    vpa: z.string().trim().toLowerCase().regex(VPA, 'That is not a valid UPI id').optional(),
    isDefault: z.boolean().optional(),
}).refine(
    (d) => (d.type === 'upi' ? Boolean(d.vpa) : Boolean(d.accountNumber && d.ifsc)),
    { message: 'A UPI method needs a VPA; a bank method needs an account number and IFSC' },
);

/** The same fields, all optional — a PATCH may change one of them. */
export const brandPaymentMethodPatchSchema = brandPaymentMethodSchema.innerType().partial();

/** Shape a validated payload into document fields, dropping the account number. */
function toDocument(body) {
    const doc = {
        type: body.type,
        label: body.label ?? '',
        bankName: body.bankName ?? '',
        accountHolderName: body.accountHolderName ?? '',
        ifsc: body.ifsc ?? '',
        vpa: body.vpa ?? '',
    };
    if (body.accountNumber) doc.accountLast4 = last4(body.accountNumber);
    // A UPI method carries no bank fields, and a bank method no VPA — otherwise
    // changing a row's type leaves the previous type's details behind on it.
    if (body.type === 'upi') {
        doc.bankName = ''; doc.accountHolderName = ''; doc.ifsc = ''; doc.accountLast4 = '';
    } else {
        doc.vpa = '';
    }
    return doc;
}

const brandOnly = (req) => {
    if (req.auth.role !== 'brand') throw ApiError.forbidden('Only brands have payment methods');
};

export const listBrandPaymentMethods = catchAsync(async (req, res) => {
    brandOnly(req);
    const methods = await BrandPaymentMethod.find({ brand: req.auth.sub })
        .sort({ isDefault: -1, createdAt: 1 })
        .lean();
    ok(res, methods);
});

export const addBrandPaymentMethod = catchAsync(async (req, res) => {
    brandOnly(req);
    const existing = await BrandPaymentMethod.countDocuments({ brand: req.auth.sub });
    if (existing >= 10) throw ApiError.unprocessable('You can keep up to 10 payment methods');

    // The first one a brand adds is its default — otherwise a brand that never
    // presses "make default" has a list with no default at all.
    const wantsDefault = req.body.isDefault === true || existing === 0;
    if (wantsDefault) await BrandPaymentMethod.updateMany({ brand: req.auth.sub }, { isDefault: false });

    const method = await BrandPaymentMethod.create({
        ...toDocument(req.body),
        brand: req.auth.sub,
        isDefault: wantsDefault,
    });
    created(res, method.toObject());
});

export const updateBrandPaymentMethod = catchAsync(async (req, res) => {
    brandOnly(req);
    // Ownership is part of the filter, not a check after the read: a brand
    // passing another brand's id gets "not found", and no document is loaded.
    const current = await BrandPaymentMethod.findOne({ _id: req.params.id, brand: req.auth.sub });
    if (!current) throw ApiError.notFound('Payment method not found');

    const merged = { ...current.toObject(), ...req.body, type: req.body.type ?? current.type };
    const fields = toDocument(merged);
    // `toDocument` only sets accountLast4 when an account number was supplied;
    // on a PATCH that does not resend it, the stored four digits must survive.
    if (!req.body.accountNumber && merged.type !== 'upi') fields.accountLast4 = current.accountLast4;

    const updated = await BrandPaymentMethod.findOneAndUpdate(
        { _id: req.params.id, brand: req.auth.sub },
        fields,
        { new: true, runValidators: true },
    ).lean();
    ok(res, updated);
});

export const setDefaultBrandPaymentMethod = catchAsync(async (req, res) => {
    brandOnly(req);
    const exists = await BrandPaymentMethod.exists({ _id: req.params.id, brand: req.auth.sub });
    if (!exists) throw ApiError.notFound('Payment method not found');

    // Clear, then set. A failure between the two leaves no default, which the
    // UI handles; the reverse order could leave two.
    await BrandPaymentMethod.updateMany({ brand: req.auth.sub }, { isDefault: false });
    const method = await BrandPaymentMethod.findOneAndUpdate(
        { _id: req.params.id, brand: req.auth.sub },
        { isDefault: true },
        { new: true },
    ).lean();
    ok(res, method);
});

export const removeBrandPaymentMethod = catchAsync(async (req, res) => {
    brandOnly(req);
    const removed = await BrandPaymentMethod.findOneAndDelete({ _id: req.params.id, brand: req.auth.sub }).lean();
    if (!removed) throw ApiError.notFound('Payment method not found');

    // Deleting the default promotes the oldest survivor rather than leaving the
    // brand with a list where nothing is marked.
    if (removed.isDefault) {
        const next = await BrandPaymentMethod.findOne({ brand: req.auth.sub }).sort({ createdAt: 1 });
        if (next) { next.isDefault = true; await next.save(); }
    }
    ok(res, { removed: true });
});
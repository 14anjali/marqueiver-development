import mongoose, { Types } from 'mongoose';
import { Deal, Transaction, Wallet } from '../../models/index.js';
import { transactionsSupported } from '../../config/db.js';
import { canTransition, isTerminal } from './dealStateMachine.js';
import { ApiError } from '../../utils/apiError.js';
import * as cashfree from '../../services/cashfree.service.js';
import { notify } from '../notifications/notifications.service.js';
import { templates } from '../notifications/notification.templates.js';

/**
 * Execute a deal state transition. Every money-moving state change runs
 * inside a MongoDB multi-document transaction across `deals` + `transactions`
 * (+ `wallets` on release), so a partial failure never leaves an inconsistent
 * balance. When the connected server is standalone (dev), we fall back to
 * sequential writes with a warning.
 *
 * Money model (Wallet + escrow, backend-owned — see IMPLEMENTATION_CHANGELOG.md
 * "Wallet & Cashfree" for the full design):
 *  - fund_escrow    → brand pays a real Cashfree order. Money enters Marqueiver's
 *                     merchant account; the deal just records that it's held.
 *  - release_escrow → INTERNAL ONLY. No Cashfree call. Credits the creator's
 *                     Wallet.balance. The creator later withdraws from their
 *                     wallet via modules/wallet, which is the only other point
 *                     real money moves (Cashfree Payouts).
 *  - refund_escrow  → real Cashfree refund back to the brand's original payment.
 */
export async function transitionDeal(params) {
    const { dealId, to, actor, actorId, note } = params;
    const deal = await Deal.findById(dealId);
    if (!deal)
        throw ApiError.notFound('Deal not found');
    if (isTerminal(deal.state))
        throw ApiError.conflict(`Deal is ${deal.state} (terminal)`);
    if (actor !== 'admin' && actor !== 'system') {
        const partyId = actor === 'creator' ? deal.creator : deal.brand;
        if (partyId.toString() !== actorId)
            throw ApiError.forbidden('Not a party to this deal');
    }
    const check = canTransition(deal.state, to, actor);
    if (!check.allowed)
        throw ApiError.unprocessable(check.reason ?? 'Illegal transition');
    const effect = check.rule?.effect;
    const from = deal.state;
    if (!effect || effect === 'open_dispute' || effect === 'resolve_dispute') {
        applyStateFields(deal, { to, actor, actorId, note, disputeReason: params.disputeReason });
        await deal.save();
        await afterTransition(deal, from, to);
        return deal;
    }
    return runMoneyTransition(deal, { ...params, effect });
}

function applyStateFields(deal, p) {
    const from = deal.state;
    deal.state = p.to;
    deal.timeline.push({
        from,
        to: p.to,
        by: new Types.ObjectId(p.actorId),
        byRole: p.actor,
        note: p.note,
        at: new Date(),
    });
    if (p.to === 'disputed') {
        deal.dispute = {
            raisedBy: new Types.ObjectId(p.actorId),
            reason: p.disputeReason ?? p.note ?? 'Dispute raised',
            raisedAt: new Date(),
        };
    }
    if (from === 'revision' || (from === 'submitted' && p.to === 'revision')) {
        if (p.to === 'revision')
            deal.revisionCount += 1;
    }
}

async function runMoneyTransition(deal, params) {
    const { to, actor, actorId, effect } = params;
    const from = deal.state;
    const session = transactionsSupported ? await mongoose.startSession() : null;
    const run = async () => {
        if (effect === 'fund_escrow') {
            // If the brand already went through the Checkout flow
            // (POST /deals/:id/payment-session), a 'pending' Transaction with
            // this idempotency key already exists — reuse its real Cashfree
            // order instead of creating a second one. Falls back to creating
            // a fresh order for callers that skip Checkout (e.g. tests, or
            // an admin-driven transition), so this stays backward compatible.
            const idempotencyKey = `fund_${deal.id}`;
            let txn = await Transaction.findOne({ idempotencyKey }).session(session ?? undefined);
            if (txn) {
                txn.status = 'success';
                await txn.save(session ? { session } : {});
            } else {
                const order = await cashfree.createEscrowOrder(deal.id, deal.terms.amount);
                [txn] = await Transaction.create([{
                        deal: deal._id,
                        fromUser: deal.brand,
                        type: 'escrow_fund',
                        status: 'success',
                        amount: deal.terms.amount,
                        gateway: order.gateway,
                        gatewayRef: order.orderRef,
                        idempotencyKey,
                    }], session ? { session } : {});
            }
            deal.escrow.funded = true;
            deal.escrow.amount = deal.terms.amount;
            deal.escrow.fundedAt = new Date();
            deal.escrow.transactionRef = txn._id;
        }

        if (effect === 'release_escrow') {
            if (!deal.escrow.funded)
                throw ApiError.unprocessable('Escrow was never funded');
            // Internal-only: credit the creator's wallet. No Cashfree call here —
            // real money only moves when the creator later withdraws.
            await Wallet.findOneAndUpdate(
                { user: deal.creator },
                { $inc: { balance: deal.escrow.amount, lifetimeCredited: deal.escrow.amount } },
                { upsert: true, session: session ?? undefined },
            );
            await Transaction.create([{
                    deal: deal._id,
                    toUser: deal.creator,
                    type: 'escrow_release',
                    status: 'success',
                    amount: deal.escrow.amount,
                    gateway: 'mock', // wallet credit is internal, not a gateway call
                    idempotencyKey: `release_${deal.id}`,
                }], session ? { session } : {});
            deal.escrow.releasedAt = new Date();
        }

        if (effect === 'refund_escrow') {
            if (deal.escrow.funded && !deal.escrow.releasedAt) {
                // Refunds need the real Cashfree order id — look up the funding
                // txn's gatewayRef (updated to the confirmed order on webhook
                // ORDER_PAID; see payments.controller.js).
                const fundingTxn = await Transaction.findById(deal.escrow.transactionRef).session(session ?? undefined);
                await cashfree.refundToBrand(fundingTxn?.gatewayRef ?? '', deal.escrow.amount);
                await Transaction.create([{
                        deal: deal._id,
                        toUser: deal.brand,
                        type: 'refund',
                        status: 'success',
                        amount: deal.escrow.amount,
                        gateway: 'cashfree',
                        idempotencyKey: `refund_${deal.id}`,
                    }], session ? { session } : {});
            }
        }

        applyStateFields(deal, { to, actor, actorId, note: params.note });
        if (deal.dispute && (to === 'completed' || to === 'cancelled')) {
            deal.dispute.resolvedBy = new Types.ObjectId(actorId);
            deal.dispute.resolvedAt = new Date();
            deal.dispute.resolution = params.note;
        }
        await deal.save(session ? { session } : {});
    };
    try {
        if (session)
            await session.withTransaction(run);
        else
            await run(); // standalone fallback (dev only)
    }
    finally {
        await session?.endSession();
    }
    await afterTransition(deal, from, to);
    return deal;
}

async function afterTransition(deal, from, to) {
    const recipient = to === 'completed' || to === 'escrow_funded' ? deal.creator : deal.brand;
    const isMoneyEvent = to === 'escrow_funded' || to === 'completed';
    const msg = to === 'escrow_funded'
        ? templates.escrowFunded(deal.title, deal.escrow?.amount ?? deal.terms?.amount)
        : to === 'completed'
            ? templates.escrowReleased(deal.title, deal.escrow?.amount ?? deal.terms?.amount)
            : templates.dealStateChanged(deal.title, to);
    await notify({
        user: recipient.toString(),
        type: `deal.${to}`,
        title: msg.title,
        body: msg.body,
        data: { dealId: deal.id },
        channels: isMoneyEvent ? ['in_app', 'email', 'whatsapp'] : ['in_app'],
    }).catch(() => void 0);
}

/**
 * Create a real Cashfree Checkout session for a deal (feature: Frontend
 * Cashfree Checkout). Separate from the `fund_escrow` transition effect
 * above — this only creates the order + a 'pending' Transaction row and
 * returns the `paymentSessionId` for the Cashfree JS SDK to render an actual
 * payment form. The deal itself is NOT marked funded here; that still only
 * happens via the normal `POST /deals/:id/transition {to:'escrow_funded'}`
 * call (made by the frontend after Cashfree reports payment success), which
 * now reuses this same pending order instead of creating a second one.
 */
export async function createPaymentSession(dealId, actorId) {
    const deal = await Deal.findById(dealId);
    if (!deal) throw ApiError.notFound('Deal not found');
    if (deal.brand.toString() !== actorId) throw ApiError.forbidden('Not a party to this deal');
    if (deal.state !== 'accepted') throw ApiError.unprocessable('Deal must be accepted before funding');

    const idempotencyKey = `fund_${deal.id}`;
    // A still-open session from a moment ago (e.g. a page refresh) can be
    // handed back as-is — its paymentSessionId is cached in `meta` so no
    // extra Cashfree call is needed. Anything older is superseded rather
    // than reused, since a stale/expired session id would fail at checkout.
    const existing = await Transaction.findOne({ idempotencyKey, status: 'pending' });
    if (existing && existing.meta?.paymentSessionId && Date.now() - existing.createdAt.getTime() < 15 * 60 * 1000) {
        return { paymentSessionId: existing.meta.paymentSessionId, orderRef: existing.gatewayRef, gateway: existing.gateway };
    }
    if (existing) await Transaction.deleteOne({ _id: existing._id });

    const order = await cashfree.createEscrowOrder(deal.id, deal.terms.amount);
    await Transaction.create({
        deal: deal._id,
        fromUser: deal.brand,
        type: 'escrow_fund',
        status: 'pending',
        amount: deal.terms.amount,
        gateway: order.gateway,
        gatewayRef: order.orderRef,
        idempotencyKey,
        meta: { paymentSessionId: order.paymentSessionId },
    });
    return { paymentSessionId: order.paymentSessionId, orderRef: order.orderRef, gateway: order.gateway };
}

/** List deals for a user with a single batched query (proposal §4.1 — no fan-out). */
export async function listDealsForUser(userId, role, state) {
    const filter = { [role]: new Types.ObjectId(userId) };
    if (state)
        filter.state = state;
    return Deal.find(filter).sort({ updatedAt: -1 }).lean();
}

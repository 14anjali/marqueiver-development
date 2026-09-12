import mongoose, { Types } from 'mongoose';
import { Deal, Transaction, Wallet, Payout, CommissionRecord } from '../../models/index.js';
import { isVerified } from '../../models/Transaction.js';
import { transactionsSupported } from '../../config/db.js';
import { canTransition, isTerminal } from './dealStateMachine.js';
import {
    computePartialRelease, currentCommissionPct,
    brandCancellationOutcome, creatorCancellationOutcome,
} from '../../services/commission.service.js';
import { allDeliverablesApproved, outstandingDeliverables } from './deliverables.service.js';
import { ApiError } from '../../utils/apiError.js';
import * as cashfree from '../../services/cashfree.service.js';
import { notify, dealPayload } from '../notifications/notifications.service.js';
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
 *  - confirm_escrow_funded → set ONLY by the verified Cashfree success webhook.
 *                     merchant account; the deal just records that it's held.
 *  - release_escrow → INTERNAL ONLY. No Cashfree call. Credits the creator's
 *                     Wallet.balance. The creator later withdraws from their
 *                     wallet via modules/wallet, which is the only other point
 *                     real money moves (Cashfree Payouts).
 *  - admin_escrow_decision → Admin settles a funded deal: full refund, full
 *                     payout, or a validated custom split (§8).
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

/**
 * Policy 5.3 / 5.5 — automatic completion and automatic option C run with NO
 * human actor. `new Types.ObjectId(null)` throws, so every system-driven
 * transition would have crashed. Actor id is optional from here on.
 */
const actorRef = (id) => (id ? new Types.ObjectId(id) : undefined);

function applyStateFields(deal, p) {
    const from = deal.state;
    deal.state = p.to;
    deal.timeline.push({
        from,
        to: p.to,
        by: actorRef(p.actorId),
        byRole: p.actor,
        note: p.note,
        at: new Date(),
    });
    // Policy 7.2 — declining a brief is not a cancellation, so both are
    // recorded, separately, with the reason visible to both parties.
    if (p.to === 'declined' || p.to === 'cancelled') {
        deal.closure = {
            reason: p.note ?? (p.to === 'declined' ? 'Declined' : 'Cancelled'),
            by: actorRef(p.actorId),
            byRole: p.actor,
            at: new Date(),
        };
    }
    if (from === 'revision' || (from === 'submitted' && p.to === 'revision')) {
        if (p.to === 'revision')
            deal.revisionCount += 1;
    }
}


const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The single place money leaves escrow — Policy 6.2, 6.3, 9, 14, 24.
 *
 * Every route to a release (Brand approval, automatic completion, resolution
 * outcome, dispute determination, cancellation settlement) goes through here,
 * so the commission deduction, the CommissionRecord and the Payout record can
 * never be skipped by adding a new caller.
 *
 * Ordering matters: the wallet credit and the Payout record are written before
 * the state change is saved by the caller, inside the same session. Policy 9
 * requires that a Collaboration must not become `completed` unless the credit
 * was actually recorded.
 */
async function settleRelease(deal, { creatorShare, brandRefund, reason, session }) {
    const total = deal.escrow.amount ?? 0;
    const gross = round2(creatorShare);
    const refund = round2(brandRefund);

    if (Math.round((gross + refund) * 100) !== Math.round(total * 100))
        throw ApiError.unprocessable(
            `Settlement must account for the full escrowed ₹${total}. Got ₹${gross} + ₹${refund}.`,
        );

    // Policy 14.7/14.8 — the snapshotted rate governs, not the live one.
    const ratePct = deal.commission?.ratePct ?? currentCommissionPct();
    const money = computePartialRelease({
        agreedValue: total,
        commissionPct: ratePct,
        creatorShare: gross,
    });

    if (gross > 0) {
        await Wallet.findOneAndUpdate(
            { user: deal.creator },
            { $inc: { balance: money.creatorNet, lifetimeCredited: money.creatorNet } },
            { upsert: true, session: session ?? undefined },
        );

        await Transaction.create([{
            deal: deal._id,
            toUser: deal.creator,
            type: 'escrow_release',
            status: 'success',
            amount: money.creatorNet,
            gateway: 'mock', // internal wallet credit; real money moves on withdrawal
            idempotencyKey: `release_${deal.id}_${reason}`,
        }], session ? { session } : {});

        // Policy 24 — immutable money records.
        const [commissionRecord] = await CommissionRecord.create([{
            deal: deal._id,
            creator: deal.creator,
            brand: deal.brand,
            agreedValue: total,
            ratePct,
            amount: money.commission,
            chargedOn: gross,
            releaseReason: reason,
        }], session ? { session } : {});

        await Payout.create([{
            deal: deal._id,
            creator: deal.creator,
            grossAmount: gross,
            commission: money.commission,
            commissionRecord: commissionRecord._id,
            // PENDING CA CONFIRMATION (Policy 6.8) — no deduction assumed.
            tdsAmount: 0,
            netAmount: money.creatorNet,
            status: 'pending',
            payoutMethod: 'upi',
        }], session ? { session } : {});
    }

    if (refund > 0) {
        const fundingTxn = await Transaction.findById(deal.escrow.transactionRef)
            .session(session ?? undefined);
        await cashfree.refundToBrand(fundingTxn?.gatewayRef ?? '', refund);
        await Transaction.create([{
            deal: deal._id,
            toUser: deal.brand,
            type: 'refund',
            status: 'success',
            amount: refund,
            gateway: 'cashfree',
            idempotencyKey: `refund_${deal.id}_${reason}`,
        }], session ? { session } : {});
    }

    deal.commission = {
        ...(deal.commission ?? {}),
        ratePct,
        amount: money.commission,
        creatorNet: money.creatorNet,
        statutoryDeduction: 0,
    };
    deal.escrow.settlement = { creatorPayout: money.creatorNet, brandRefund: refund, at: new Date() };
    deal.escrow.releasedAt = new Date();
}

async function runMoneyTransition(deal, params) {
    const { to, actor, actorId, effect } = params;
    const from = deal.state;
    const session = transactionsSupported ? await mongoose.startSession() : null;
    const run = async () => {
        /**
         * §6 — reached ONLY from the verified Cashfree success webhook, via
         * `confirmEscrowFunded()` below. The previous `fund_escrow` effect was
         * triggered by a client call that asserted its own payment success and
         * wrote `status: 'success'` on the transaction without the processor
         * ever confirming it. That path is gone.
         */
        if (effect === 'confirm_escrow_funded') {
            const txn = await Transaction.findOne({ idempotencyKey: `fund_${deal.id}` })
                .session(session ?? undefined);
            if (!txn)
                throw ApiError.unprocessable('No funding transaction for this deal');
            /*
              `isVerified` rather than `=== 'success'`: the state is now
              `verified`, and `success` is the legacy spelling of the same fact.
              A comparison that knows only one of them reports a paid
              collaboration as unpaid.
            */
            if (!isVerified(txn))
                throw ApiError.unprocessable('Funding transaction is not confirmed by the gateway');

            /**
             * ── The advance is a tranche, not the whole escrow ──────────────
             *
             * This wrote `deal.escrow.amount = txn.amount`. Once the advance
             * became half the value, that would have overwritten the agreed
             * total with half of it — and `release_escrow` pays out
             * `deal.escrow.amount`, so the creator would have been paid the
             * advance and the rest would have vanished from the record.
             *
             * The total is set at acceptance from the frozen schedule and is
             * not touched here. What this records is that the advance tranche
             * arrived.
             */
            deal.escrow.schedule = deal.escrow.schedule ?? {};
            deal.escrow.schedule.advance = {
                ...(deal.escrow.schedule.advance?.toObject?.() ?? deal.escrow.schedule.advance ?? {}),
                funded: true,
                fundedAt: new Date(),
                transactionRef: txn._id,
            };

            /*
              `escrow.funded` means "the collaboration is funded enough to
              start", which under the 50/50 schedule is the advance. The balance
              is a separate tranche and is not part of this gate.
            */
            deal.escrow.funded = true;
            deal.escrow.fundedAt = new Date();
            deal.escrow.transactionRef = txn._id;

            // A previous failure is resolved by a payment that went through.
            deal.escrow.lastFailure = undefined;
            deal.escrow.needsAdminReview = false;
        }

        /**
         * Policy 6.3 / 14 — release deducts the platform commission before the
         * Creator is credited. The previous implementation credited the FULL
         * escrow amount, which paid creators 100% and collected no commission
         * at all.
         *
         * Policy 14.7/14.8 — the rate used is the one snapshotted onto the deal
         * at Acceptance, never the live rate. `settleRelease` reads the
         * snapshot; a deal accepted under a promotional rate keeps it.
         *
         * Policy 9 (impact report) — the Collaboration must not reach
         * `completed` until the Creator's wallet credit is recorded. The credit
         * and the state change share one transaction below, so a failure rolls
         * both back.
         */
        if (effect === 'release_escrow') {
            if (!deal.escrow.funded)
                throw ApiError.unprocessable('Escrow was never funded');

            /**
             * ── A brand releases money on work it has approved ──────────────
             *
             * Approving a submission and releasing the escrow are two decisions,
             * and this is the one that cannot be undone. So a brand-initiated
             * completion is refused until every agreed deliverable carries a
             * recorded approval — otherwise "approve and release" is a single
             * button that pays out work nobody reviewed, which is the same
             * thing as automatic approval with an extra click.
             *
             * `system` is exempt, and only `system`: Policy 5.3 says a
             * deliverable the brand ignored for seven days is deemed approved
             * and the payment released. That path completes the collaboration
             * without marking any submission approved — nobody looked at it —
             * and the workspace says which of the two happened.
             *
             * `admin` is exempt too: a dispute determination (Policy 10.4) and a
             * resolution outcome (Policy 5.5) are decisions *about* unapproved
             * work, and requiring approval first would make them impossible.
             */
            if (actor === 'brand' && !allDeliverablesApproved(deal)) {
                const left = outstandingDeliverables(deal);
                throw ApiError.unprocessable(
                    left.length
                        ? `Review the deliverables first — ${left.join(', ')} ${left.length === 1 ? 'is' : 'are'} not approved yet.`
                        : 'Approve the submitted work before releasing the payment.',
                );
            }

            /**
             * ── Release cannot pay out money that was never collected ───────
             *
             * `creatorShare: deal.escrow.amount` is the full collaboration
             * value, and under the 50/50 schedule only the advance has been
             * charged. Releasing the full value against a half-funded escrow
             * would credit the creator's wallet with money the platform never
             * received.
             *
             * Charging the balance is deliberately not built yet, so this
             * refuses rather than guessing. It refuses ONLY for deals that
             * actually have a schedule with an unfunded balance — deals agreed
             * before the split, whose single payment was the whole value, are
             * unaffected and complete exactly as before.
             *
             * This is the guard, not the feature: the balance charge is the
             * next piece of work, and until it exists a 50/50 collaboration
             * stops here rather than paying out of thin air.
             */
            const sched = deal.escrow.schedule;
            const balanceOwed = sched?.balance?.amount > 0 && !sched.balance.funded;
            if (balanceOwed) {
                throw ApiError.unprocessable(
                    'The remaining 50% has not been paid into escrow, so it cannot be released. '
                    + 'Collecting the balance payment is not available yet.',
                );
            }

            await settleRelease(deal, {
                creatorShare: deal.escrow.amount,
                brandRefund: 0,
                reason: params.releaseReason ?? 'brand_approval',
                session,
            });
        }

        /**
         * Policy 7.1 / 7.2 — cancellation outcomes are DETERMINISTIC by stage.
         * There is no Admin discretion here: the policy states the split, so
         * the system computes it. The old `admin_escrow_decision` effect, which
         * let an Admin choose any split on a normal cancellation, is gone.
         */
        if (effect === 'cancel_settlement') {
            if (deal.escrow.funded && !deal.escrow.releasedAt) {
                const outcome = actor === 'creator'
                    ? creatorCancellationOutcome({
                        state: from,
                        agreedValue: deal.escrow.amount,
                        commissionPct: deal.commission?.ratePct,
                        acceptedPartialValue: params.acceptedPartialValue,
                    })
                    : brandCancellationOutcome({
                        state: from,
                        agreedValue: deal.escrow.amount,
                        commissionPct: deal.commission?.ratePct,
                    });

                await settleRelease(deal, {
                    creatorShare: outcome.creatorGross,
                    brandRefund: outcome.brandRefund,
                    reason: 'cancellation',
                    session,
                });
            }
            deal.cancellation = {
                stage: from,
                byRole: actor,
                by: actorRef(actorId),
                reason: params.note,
                at: new Date(),
            };
        }

        /**
         * Policy 5.5 — Resolution outcomes. Option A is a reduced fee agreed by
         * the parties; option C is the 50/50 release-without-use, which applies
         * automatically after 7 days. The caller supplies `creatorShare`; the
         * split is validated against the escrowed total before money moves.
         */
        if (effect === 'resolution_settlement') {
            if (!deal.escrow.funded)
                throw ApiError.unprocessable('Escrow was never funded');

            const total = deal.escrow.amount ?? 0;
            const creatorShare = Number(
                params.creatorShare ?? (deal.resolutionOption === 'C' ? total / 2 : total),
            );
            const brandRefund = round2(total - creatorShare);
            if (creatorShare < 0 || brandRefund < 0)
                throw ApiError.unprocessable('Resolution amounts cannot be negative');

            await settleRelease(deal, {
                creatorShare, brandRefund, reason: 'resolution', session,
            });
        }

        /**
         * Policy 10.4 — a dispute determination is where Marqueiver DOES
         * exercise discretion, including a partial release. The total must
         * still account for the whole escrowed amount.
         */
        if (effect === 'dispute_determination') {
            const total = deal.escrow.amount ?? 0;
            if (deal.escrow.funded && !deal.escrow.releasedAt) {
                const creatorShare = Number(params.creatorPayout ?? 0);
                const brandRefund = Number(params.brandRefund ?? total - creatorShare);

                if (creatorShare < 0 || brandRefund < 0)
                    throw ApiError.unprocessable('Determination amounts cannot be negative');
                if (Math.round((creatorShare + brandRefund) * 100) !== Math.round(total * 100))
                    throw ApiError.unprocessable(
                        `Creator payout + brand refund must equal the escrowed ₹${total}. Got ₹${creatorShare} + ₹${brandRefund}.`,
                    );

                await settleRelease(deal, {
                    creatorShare, brandRefund, reason: 'dispute_determination', session,
                });
            }
        }

        applyStateFields(deal, { to, actor, actorId, note: params.note });
        if (deal.dispute && (to === 'completed' || to === 'cancelled')) {
            deal.dispute.resolvedBy = actorRef(actorId);
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
    const recipient = to === 'completed' || to === 'in_progress' ? deal.creator : deal.brand;
    const isMoneyEvent = to === 'in_progress' || to === 'completed';
    const msg = to === 'in_progress'
        ? templates.escrowFunded(deal.title, deal.escrow?.amount ?? deal.terms?.amount)
        : to === 'completed'
            ? templates.escrowReleased(deal.title, deal.escrow?.amount ?? deal.terms?.amount)
            : templates.dealStateChanged(deal.title, to);
    await notify({
        user: recipient.toString(),
        type: `deal.${to}`,
        title: msg.title,
        body: msg.body,
        data: dealPayload(deal),
        channels: isMoneyEvent ? ['in_app', 'email', 'whatsapp'] : ['in_app'],
    }).catch(() => void 0);
}

/**
 * Create a real Cashfree Checkout session for a deal (feature: Frontend
 * Cashfree Checkout). Separate from the `fund_escrow` transition effect
 * above — this only creates the order + a 'pending' Transaction row and
 * returns the `paymentSessionId` for the Cashfree JS SDK to render an actual
 * payment form. The deal itself is NOT marked funded here; that still only
 * happens on the verified Cashfree success webhook (§6), which calls
 * `confirmEscrowFunded()`. The frontend cannot activate a deal.
 */
export async function createPaymentSession(dealId, actorId) {
    const deal = await Deal.findById(dealId);
    if (!deal) throw ApiError.notFound('Deal not found');
    if (deal.brand.toString() !== actorId) throw ApiError.forbidden('Not a party to this deal');
    if (deal.state !== 'accepted' && deal.state !== 'escrow_pending')
        throw ApiError.unprocessable('Both parties must confirm terms before escrow can be funded');

    /**
     * ── What is actually charged ───────────────────────────────────────────
     *
     * The advance, not the whole collaboration value. This used to raise an
     * order for `deal.terms.amount` while the confirmed requirement — quoted in
     * `modules/messaging/messaging.policy.js`, and the thing the chat gate is
     * built on — says "the required 50% escrow payment". The policy documents
     * and the payment path disagreed, and the payment path was what ran.
     *
     * The figure is read from the schedule frozen at acceptance rather than
     * recomputed, for the same reason the commission rate is snapshotted
     * (Policy 14.7/14.8): what both parties saw when they agreed is what
     * applies. The fallback to the full amount covers deals that were agreed
     * before the schedule existed — for them the full value *was* the advance.
     */
    const advance = deal.escrow?.schedule?.advance?.amount;
    const amount = advance > 0 ? advance : deal.terms.amount;

    if (deal.escrow?.schedule?.advance?.funded)
        throw ApiError.unprocessable('The advance for this collaboration is already paid');

    const idempotencyKey = `fund_${deal.id}`;
    /*
      A still-open session from a moment ago (e.g. a page refresh) can be handed
      back as-is — its paymentSessionId is cached in `meta` so no extra Cashfree
      call is needed. `initiated` counts as still-open: the brand opened
      checkout and came back, and raising a second order would leave two live
      ones against the same collaboration.

      A `failed` row is never reused and never deleted — it is the record of the
      attempt, and the retry path below supersedes it with a fresh order.
    */
    const existing = await Transaction.findOne({
        idempotencyKey,
        status: { $in: ['pending', 'initiated'] },
    });
    if (existing && existing.meta?.paymentSessionId
        && existing.amount === amount
        && Date.now() - existing.createdAt.getTime() < 15 * 60 * 1000) {
        return {
            paymentSessionId: existing.meta.paymentSessionId,
            orderRef: existing.gatewayRef,
            gateway: existing.gateway,
            amount: existing.amount,
            status: existing.status,
        };
    }
    if (existing) await Transaction.deleteOne({ _id: existing._id });

    /**
     * The idempotency key carries an attempt number, so a retry after a failure
     * gets its own order rather than colliding with the failed one. Without it
     * Cashfree would see a duplicate order id and the brand could never pay.
     */
    const attempt = await Transaction.countDocuments({ deal: deal._id, type: 'escrow_fund', tranche: 'advance' });
    const orderKey = attempt > 0 ? `${deal.id}_a${attempt + 1}` : deal.id;

    const order = await cashfree.createEscrowOrder(orderKey, amount);
    const txn = new Transaction({
        deal: deal._id,
        fromUser: deal.brand,
        type: 'escrow_fund',
        tranche: 'advance',
        amount,
        gateway: order.gateway,
        gatewayRef: order.orderRef,
        idempotencyKey,
        meta: { paymentSessionId: order.paymentSessionId, attempt: attempt + 1 },
    });
    txn.moveTo('pending', { by: 'brand', note: attempt > 0 ? `Retry ${attempt + 1}` : 'Advance payment created' });
    await txn.save();

    return {
        paymentSessionId: order.paymentSessionId,
        orderRef: order.orderRef,
        gateway: order.gateway,
        amount,
        status: 'pending',
    };
}

/**
 * The brand has opened checkout.
 *
 * Reported by the client, and therefore trusted for nothing: it moves the row
 * from `pending` to `initiated` so both parties can see a payment is under way,
 * and that is all it does. Only the signature-verified webhook writes
 * `verified`, and only `verified` unlocks anything.
 */
export async function markPaymentInitiated(dealId, actorId) {
    const deal = await Deal.findById(dealId).select('brand').lean();
    if (!deal) throw ApiError.notFound('Deal not found');
    if (deal.brand.toString() !== actorId) throw ApiError.forbidden('Not a party to this deal');

    const txn = await Transaction.findOne({ idempotencyKey: `fund_${dealId}`, status: 'pending' });
    if (!txn) return null;

    txn.moveTo('initiated', { by: 'brand', note: 'Checkout opened' });
    await txn.save();
    return txn;
}

/** The payment record for a collaboration: every attempt, with its history. */
export async function paymentRecords(dealId) {
    return Transaction.find({ deal: dealId }).sort({ createdAt: 1 }).lean();
}

/** List deals for a user with a single batched query (proposal §4.1 — no fan-out). */
export async function listDealsForUser(userId, role, state) {
    const filter = { [role]: new Types.ObjectId(userId) };
    if (state)
        filter.state = state;
    return Deal.find(filter).sort({ updatedAt: -1 }).lean();
}


/**
 * Called by the Cashfree webhook once a payment is confirmed (§6).
 *
 * This is the ONLY path to `active`. It is not reachable from any user-facing
 * route, which is the point: the deal activates on the processor's word, never
 * on the brand's click.
 */
export async function confirmEscrowFunded(dealId) {
    const deal = await Deal.findById(dealId);
    if (!deal) throw ApiError.notFound('Deal not found');

    // Idempotent — Cashfree retries webhooks.
    if (deal.state === 'in_progress' || deal.escrow.funded) return deal;
    if (deal.state !== 'escrow_pending')
        throw ApiError.unprocessable(`Deal is ${deal.state}, not awaiting escrow`);

    return transitionDeal({
        dealId,
        to: 'in_progress',
        actor: 'system',
        actorId: deal.brand.toString(),
        note: 'Escrow confirmed by Cashfree webhook',
    });
}

/**
 * Called on a payment-failed webhook (§6, A11). Records the failure and leaves
 * the deal exactly where it is: no automatic retry, no automatic cancellation.
 * The case goes to Admin, who decides what happens next.
 */
/**
 * How many failed attempts before a human looks at it.
 *
 * A declined card is an ordinary thing the brand fixes themselves, so raising
 * an admin review on the first failure would fill the queue with cases nobody
 * needs to touch — and tell the brand to wait when what they should do is try a
 * different card. Repeated failures are a different signal.
 *
 * A11's "no automatic retry" is untouched: nothing here retries by itself. The
 * brand asks for a new payment session, which is a person deciding to try again.
 */
const FAILURES_BEFORE_ADMIN_REVIEW = 3;

export async function flagEscrowFailure(dealId, reason) {
    const deal = await Deal.findById(dealId);
    if (!deal) return null;

    const failures = await Transaction.countDocuments({
        deal: deal._id, type: 'escrow_fund', status: 'failed',
    });
    const needsAdmin = failures >= FAILURES_BEFORE_ADMIN_REVIEW;

    deal.escrow.lastFailure = { reason: reason ?? 'Payment failed', at: new Date() };
    deal.escrow.needsAdminReview = needsAdmin;
    await deal.save();

    /*
      The collaboration does not move. It stays exactly where it was —
      `escrow_pending`, chat still locked — which is what "keep it paused" means
      here: a failed payment changes nothing except the record of the attempt.
    */
    await notify({
        user: deal.brand.toString(),
        type: 'deal.escrow_failed',
        title: 'Advance payment failed',
        body: needsAdmin
            ? `The payment for "${deal.title}" has failed ${failures} times. Our team is looking at it — `
              + 'you can still try again from the collaboration.'
            : `The payment for "${deal.title}" did not go through, so the collaboration has not started. `
              + 'You can try again from the collaboration.',
        data: dealPayload(deal),
    }).catch(() => void 0);

    /*
      The creator is told too. They were waiting for work to start and it has
      not — leaving them to wonder is how a collaboration quietly dies.
    */
    await notify({
        user: deal.creator.toString(),
        type: 'deal.escrow_failed',
        title: 'Waiting on the advance payment',
        body: `The advance for "${deal.title}" has not gone through yet, so the collaboration has not started. `
            + 'The brand has been asked to try again.',
        data: dealPayload(deal),
    }).catch(() => void 0);

    return deal;
}
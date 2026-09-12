import { Schema, model } from 'mongoose';
const txnSchema = new Schema({
    // Optional — wallet withdrawals and deposits aren't tied to a specific deal.
    deal: { type: Schema.Types.ObjectId, ref: 'Deal', index: true },
    fromUser: { type: Schema.Types.ObjectId, ref: 'User' },
    toUser: { type: Schema.Types.ObjectId, ref: 'User' },
    type: {
        type: String,
        enum: ['escrow_fund', 'escrow_release', 'refund', 'payout', 'fee'],
        required: true,
        index: true,
    },
    /**
     * ── Payment states ─────────────────────────────────────────────────────
     *
     *   pending     the order exists; nobody has opened checkout
     *   initiated   the brand opened checkout — the gateway has the payment
     *   processing  the gateway is settling it; not yet confirmed
     *   verified    the gateway confirmed it. THIS is what unlocks anything.
     *   failed      the gateway refused or the payment did not complete
     *
     * `success` and `reversed` are kept because rows written before this enum
     * existed carry them, and Mongoose validates on write, not on read: drop a
     * value and every historical document holding it becomes unsaveable — a
     * later `deal.save()` would fail on a field nobody touched. `success` is
     * the legacy spelling of `verified`; `isVerified()` below treats them as
     * one so no caller has to remember that.
     *
     * `initiated` and `processing` are reported by the client and the gateway
     * respectively and are deliberately NOT sufficient for anything. Only a
     * signature-verified webhook writes `verified`.
     */
    status: {
        type: String,
        enum: ['pending', 'initiated', 'processing', 'verified', 'failed', 'success', 'reversed'],
        default: 'pending',
        index: true,
    },

    /**
     * Which tranche of the collaboration this payment is.
     *
     * The schedule is a 50% advance and a 50% balance, so "the escrow payment"
     * is no longer one thing. Absent on rows written before the split existed,
     * which is correct for them — they were a single full-value payment.
     */
    tranche: { type: String, enum: ['advance', 'balance'] },

    /** Every state this payment has been in, in order. */
    history: {
        type: [{
            status: String,
            at: { type: Date, default: Date.now },
            /** Who or what moved it: the brand, the gateway, or an admin. */
            by: { type: String, enum: ['brand', 'gateway', 'admin', 'system'] },
            note: String,
            _id: false,
        }],
        default: [],
    },
    amount: { type: Number, required: true },
    fee: { type: Number, default: 0 },
    gateway: { type: String, enum: ['cashfree', 'mock'], default: 'mock' },
    gatewayRef: String,
    idempotencyKey: { type: String, index: true, sparse: true },
    meta: Schema.Types.Mixed,
}, { timestamps: true });
/**
 * The states a payment can be in, as a person reads them.
 *
 * `success` is absent on purpose — it is the legacy spelling of `verified` and
 * nothing new should write it. `PAYMENT_STATES` is what the UI offers and what
 * a caller should compare against; the schema enum is wider only so old rows
 * stay writable.
 */
export const PAYMENT_STATES = ['pending', 'initiated', 'processing', 'verified', 'failed'];

/** Legacy spellings, mapped for display and comparison. */
export const LEGACY_PAYMENT_STATES = { success: 'verified' };

export const normalisePaymentState = (s) => LEGACY_PAYMENT_STATES[s] ?? s;

/**
 * Is this payment confirmed?
 *
 * The one question the escrow gate asks, in one place. Written as a helper
 * rather than `status === 'verified'` at each call site because there are two
 * spellings of the same fact, and a comparison that forgets the legacy one
 * silently reports a paid collaboration as unpaid.
 */
export const isVerified = (txn) => normalisePaymentState(txn?.status) === 'verified';

/** States from which the brand may try the payment again. */
export const RETRYABLE_PAYMENT_STATES = new Set(['failed']);

txnSchema.methods.isVerified = function isVerifiedMethod() {
    return isVerified(this);
};

/**
 * Every status write goes through here, so the history cannot disagree with
 * the status. Assigning `txn.status` directly still works — nothing is
 * prevented — but then no history entry is written, which is the failure this
 * exists to make unlikely.
 */
txnSchema.methods.moveTo = function moveTo(status, { by = 'system', note } = {}) {
    this.status = status;
    this.history = [...(this.history ?? []), { status, at: new Date(), by, note }];
    return this;
};

export const Transaction = model('Transaction', txnSchema);
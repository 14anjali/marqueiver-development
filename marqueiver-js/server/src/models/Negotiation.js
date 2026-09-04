import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * Negotiation thread + offers (B2).
 *
 * Offers used to be a subdocument array inside a Deal, which could not express
 * the cleared rule that **accepting an offer spawns a separate deal** (§4) —
 * a child cannot create siblings of its own parent. Offers are now their own
 * collection hanging off a thread between one brand and one creator.
 *
 * Lifecycle:
 *   Brand invites / creator applies  → Deal(requested)
 *   Receiving party accepts          → NegotiationThread(open), Deal→negotiating
 *   Either party posts offers        → Offer(proposed), many may be live at once
 *   One offer accepted               → new Deal spawned, thread closes (B2 follow-up)
 *
 * Rules encoded here:
 *  - A55 — one live offer per party at a time, but both parties may have one
 *    outstanding simultaneously.
 *  - A56 — at most 10 pending offers per thread.
 *  - §4 — offers cannot be withdrawn, and accepting one does NOT invalidate the
 *    others while the thread is open.
 *  - A52/A53 — an offer ends only by being accepted, rejected or expired, and
 *    expiry is evaluated lazily at accept time rather than by a scheduled job.
 */

const OFFER_STATUSES = ['proposed', 'accepted', 'rejected', 'expired'];

const offerSchema = new Schema({
    thread: { type: Schema.Types.ObjectId, ref: 'NegotiationThread', required: true, index: true },
    seq: { type: Number, required: true },

    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    byRole: { type: String, enum: ['brand', 'creator'], required: true },

    // The terms being proposed. Immutable once created — a change is a new offer.
    amount: { type: Number, required: true, min: 0 },
    deliverables: { type: String, default: '' },
    deadline: Date,
    revisionsAllowed: { type: Number, default: 1, min: 0 },
    note: String,

    /** Optional, chosen by the proposer (A54 — no bounds on how far out). */
    expiresAt: Date,

    status: { type: String, enum: OFFER_STATUSES, default: 'proposed', index: true },
    respondedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    respondedAt: Date,
    rejectionNote: String,

    /** Set when acceptance spawns a deal (§4). */
    spawnedDeal: { type: Schema.Types.ObjectId, ref: 'Deal' },

    /** True for rows reconstructed from a pre-B2 deal's inline offers. */
    reconstructed: { type: Boolean, default: false },
}, { timestamps: true });

offerSchema.index({ thread: 1, seq: 1 }, { unique: true });
offerSchema.index({ thread: 1, byRole: 1, status: 1 });

/**
 * An offer is only live if it is still proposed AND has not passed its expiry.
 * Expiry is derived rather than stored as a status (A53, lazy expiry), so a
 * missing scheduled job can never leave a stale offer looking acceptable.
 */
offerSchema.methods.isLive = function isLive(now = new Date()) {
    if (this.status !== 'proposed') return false;
    return !this.expiresAt || this.expiresAt > now;
};

offerSchema.virtual('effectiveStatus').get(function effectiveStatus() {
    if (this.status === 'proposed' && this.expiresAt && this.expiresAt <= new Date())
        return 'expired';
    return this.status;
});

offerSchema.set('toJSON', { virtuals: true });
offerSchema.set('toObject', { virtuals: true });

const threadSchema = new Schema({
    brand: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    creator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** The `requested` deal whose acceptance opened this thread. */
    originDeal: { type: Schema.Types.ObjectId, ref: 'Deal', index: true },
    /** Set when a creator applied to a campaign rather than being invited (§2). */
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign' },

    /**
     * B2 follow-up — the thread closes automatically once an offer is accepted
     * and a deal is spawned. `closedReason` distinguishes that from a thread
     * abandoned by rejection.
     */
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    closedReason: { type: String, enum: ['offer_accepted', 'deal_rejected', 'admin'] },
    closedAt: Date,
    resultingDeal: { type: Schema.Types.ObjectId, ref: 'Deal' },

    title: String,
    lastOfferAt: Date,
}, { timestamps: true });

threadSchema.index({ brand: 1, creator: 1, status: 1 });

export const NegotiationThread =
    mongoose.models.NegotiationThread ?? mongoose.model('NegotiationThread', threadSchema);
export const Offer = mongoose.models.Offer ?? mongoose.model('Offer', offerSchema);
export { OFFER_STATUSES };

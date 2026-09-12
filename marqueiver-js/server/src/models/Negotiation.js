import mongoose from 'mongoose';
import { INCLUDED_REVISIONS } from './Deal.js';
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
 *   Brand invites / creator applies  → Deal(invitation)
 *   Receiving party accepts          → NegotiationThread(open), Deal→negotiation
 *   Either party posts proposals     → Offer(proposed), many may be live at once
 *   One proposal accepted            → its terms land on that same Deal, thread
 *                                      closes, both parties then confirm
 *
 * ── A cleared rule that changed ────────────────────────────────────────────
 *
 * §4 originally said accepting an offer **spawns a separate deal**, and the
 * comment above this block used to say so. It no longer does, by an explicit
 * product decision: the spawned deal left the original one stranded at
 * `negotiation` with nothing to move it, so one piece of work showed up twice
 * in both parties' lists and only one of the two was real. A negotiation is now
 * a stage *of* a collaboration rather than a factory for new ones, which is
 * also how both parties describe it — "Proposal V1 → counter → V2 → accepted"
 * is one thing being agreed, not three things being created.
 *
 * `Offer.spawnedDeal` keeps its name for the rows written before this and now
 * records the deal the proposal's terms were applied to.
 *
 * Rules unchanged:
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

    /**
     * ── The proposal itself ────────────────────────────────────────────────
     *
     * Immutable once created. A change is a new offer with the next `seq`, and
     * `seq` is the version number a person sees: "Proposal V1", "V2". Nothing
     * here is ever updated in place, which is what makes the history real
     * rather than a log that can disagree with the record.
     *
     * These fields cover a whole brief rather than a price. An offer that
     * carries only an amount cannot express a counter that accepts the money
     * and objects to the usage rights — and usage rights are the term most
     * often argued over, because Policy 8 makes them part of scope.
     *
     * The vocabulary is the campaign brief's, deliberately: a proposal that
     * followed a campaign application and one sent to a creator found in
     * discovery describe the same work in the same words.
     */
    amount: { type: Number, required: true, min: 0 },

    /** Free text, kept for the summary line and for offers predating the structure below. */
    deliverables: { type: String, default: '' },

    /**
     * Content type and quantity, as pairs. "2 Reels + 3 Stories" is two rows,
     * not a string — so V1 and V2 can be compared field by field, and so the
     * quantity is a number the deliverable count can actually be checked
     * against later.
     */
    contentItems: {
        type: [{
            contentType: { type: String, required: true },
            quantity: { type: Number, default: 1, min: 1 },
            platform: { type: String, default: '' },
            notes: { type: String, default: '' },
            _id: false,
        }],
        default: [],
    },

    /** Creative direction. Same shape as `Campaign.guidelines`. */
    guidelines: {
        dos: { type: [String], default: [] },
        donts: { type: [String], default: [] },
        hashtags: { type: [String], default: [] },
        mentions: { type: [String], default: [] },
        notes: { type: String, default: '' },
    },

    /** Timeline. `startDate` is when work begins; `deadline` is when it is due. */
    startDate: Date,
    deadline: Date,

    /** Policy 8 — usage rights are scope, so they are negotiated, not assumed. */
    usageRights: {
        licenceType: { type: String, enum: ['default', 'extended', 'full_assignment'] },
        durationMonths: { type: Number, min: 1 },
        paidAdvertising: { type: Boolean },
        whitelisting: { type: Boolean },
        modificationAllowed: { type: Boolean },
        notes: { type: String, default: '' },
    },
    exclusivity: { type: String, default: '' },

    /** Anything the structured fields do not cover, agreed in words. */
    otherTerms: { type: String, default: '' },

    revisionsAllowed: { type: Number, default: INCLUDED_REVISIONS, min: 0 },
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

/**
 * Every field of a proposal that is a *term*, in one place.
 *
 * This exists because the same list is needed three times — copying an accepted
 * proposal onto the deal, freezing the agreed terms at confirmation, and
 * diffing V1 against V2 — and when those three were written separately they
 * disagreed. The one that mattered was acceptance: it copied amount,
 * deliverables, deadline and revisions, and silently dropped usage rights. A
 * brand and a creator could argue usage rights through four proposals, agree,
 * and end up bound by the schema default.
 *
 * `note` and `expiresAt` are deliberately absent. They are facts about the
 * offer, not terms of the work — a note explaining why a price was proposed
 * does not survive into what was agreed.
 */
export const PROPOSAL_TERM_FIELDS = [
    'amount', 'deliverables', 'contentItems', 'guidelines',
    'startDate', 'deadline', 'usageRights', 'exclusivity',
    'otherTerms', 'revisionsAllowed',
];

/** The terms of one proposal, as a plain object. */
export function termsOf(offer) {
    const src = typeof offer?.toObject === 'function' ? offer.toObject() : (offer ?? {});
    const out = {};
    for (const f of PROPOSAL_TERM_FIELDS) {
        if (src[f] !== undefined) out[f] = src[f];
    }
    return out;
}

export const NegotiationThread =
    mongoose.models.NegotiationThread ?? mongoose.model('NegotiationThread', threadSchema);
export const Offer = mongoose.models.Offer ?? mongoose.model('Offer', offerSchema);
export { OFFER_STATUSES };
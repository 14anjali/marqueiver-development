import { Schema, model } from 'mongoose';
const submissionSchema = new Schema({
    urls: { type: [String], default: [] },
    note: String,
    submittedAt: { type: Date, default: Date.now },
    reviewStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewNote: String,
    /**
     * §11 — a creator may still submit after the deadline; the submission is
     * marked late rather than blocked. Nothing auto-cancels at the deadline.
     */
    late: { type: Boolean, default: false },
    /** Set when the brand first opens the submission — drives the 3-day review clock (§12 trigger 3). */
    reviewedAt: Date,
}, { _id: true });
const dealSchema = new Schema({
    brand: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    creator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    origin: { type: String, enum: ['invite', 'application', 'campaign'], default: 'invite' },
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    title: { type: String, required: true },
    contentTypes: { type: [String], default: [] },
    terms: {
        amount: { type: Number, required: true, min: 0 },
        deliverables: { type: String, default: '' },
        deadline: Date,
        revisionsAllowed: { type: Number, default: 1 },
        // Which offer version these binding terms came from (§11 — terms are
        // never edited in place; they are adopted from an accepted offer).
        acceptedOffer: { type: Schema.Types.ObjectId },
    },
    /**
     * B2 — offers moved to their own collection (models/Negotiation.js). A deal
     * now points back at the single offer that produced it via `sourceOffer`.
     * The inline array is gone; nothing should write to it.
     */

    /** Who initiated: 'brand' invited, or 'creator' applied to a campaign (§2). */
    requestedBy: { type: String, enum: ['brand', 'creator'], default: 'brand' },

    /**
     * Platform fee breakdown (B3), snapshotted at deal creation so a later rate
     * change never rewrites the economics of a live deal. Percentages are TBD —
     * see services/platformFee.js.
     */
    /**
     * Policy 14.7/14.8 — the applicable commission rate is the one shown at the
     * point of acceptance, and later rate changes do not affect Collaborations
     * already accepted. The rate is therefore snapshotted here at acceptance
     * and read back at release; it is never recomputed from the live rate.
     */
    commission: {
        ratePct: { type: Number },          // snapshotted at acceptance
        snapshotAt: Date,
        amount: { type: Number, default: 0 },  // computed at release
        creatorNet: { type: Number, default: 0 },
        statutoryDeduction: { type: Number, default: 0 }, // PENDING CA (6.8)
    },

    /**
     * Policy 5.2 — the agreed scope recorded at acceptance. Usage rights and
     * exclusivity are part of scope under Policy 8 and must be captured before
     * agreement, not assumed afterwards.
     */
    usageRights: {
        // Policy 8.2 default licence: non-exclusive, worldwide, organic social,
        // website and owned marketing, 12 months from publication.
        licenceType: { type: String, enum: ['default', 'extended', 'full_assignment'], default: 'default' },
        durationMonths: { type: Number, default: 12 },
        paidAdvertising: { type: Boolean, default: false },   // excluded by default (8.3)
        whitelisting: { type: Boolean, default: false },
        broadcastOrOutdoor: { type: Boolean, default: false },
        modificationAllowed: { type: Boolean, default: false },
        notes: String,
    },
    exclusivity: { type: String, default: '' },

    /** Policy 5.3 — the 7-day review window, set on submission. */
    reviewDeadline: Date,
    /** Which review reminders have gone out, so a restart cannot resend. */
    reviewRemindersSent: { type: [Number], default: [] },
    /** Policy 5.5 — the 7-day window before option C applies automatically. */
    resolutionDeadline: Date,
    resolutionOption: { type: String, enum: ['A', 'B', 'C', 'D'] },

    /**
     * Policy 15 — advertising disclosure. Confirmed by the Creator before
     * deliverables may be submitted; the record is part of the audit trail.
     */
    disclosure: {
        method: { type: String, enum: ['#ad', '#advertisement', '#sponsored', '#paidpartnership', '#collab', 'platform_tool'] },
        placement: String,
        language: String,
        confirmedAt: Date,
        confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },

    /** Policy 5.8 — published content must stay live for at least 30 days. */
    publishedAt: Date,
    liveUntil: Date,

    /** Policy 24 — which policy version governed this Collaboration. */
    policyVersionAtAcceptance: String,

    /**
     * Dual terms confirmation (§5). Accepting an offer is NOT confirmation —
     * both parties must separately confirm, and only when both are present
     * does the deal move `negotiating → terms_agreed`. Once that happens the
     * terms above are immutable; changing them requires a new offer/deal.
     */
    termsConfirmation: {
        brand: { at: Date, by: { type: Schema.Types.ObjectId, ref: 'User' } },
        creator: { at: Date, by: { type: Schema.Types.ObjectId, ref: 'User' } },
        // Set when the second confirmation lands.
        agreedAt: Date,
    },

    /** Which offer produced this deal (§4 — an accepted offer creates a deal). */
    sourceOffer: { type: Schema.Types.ObjectId, index: true },

    /**
     * 48-hour escrow funding window (§6, A49). Set when the brand clicks
     * "Proceed to payment" and the deal enters `escrow_pending`. Once passed,
     * A50 says funding is BLOCKED until an Admin acts — `fundingOverdue` is the
     * flag the payment endpoint checks.
     */
    escrowFundingDeadline: Date,
    fundingOverdue: { type: Boolean, default: false },

    /**
     * Policy 7 — the cancellation record: which stage it happened at, who did
     * it and why. Stored because the financial outcome depends on the stage and
     * must remain auditable after the fact (Policy 24).
     */
    cancellation: {
        stage: String,
        byRole: String,
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        reason: String,
        at: Date,
    },

    /** Why a deal was declined or cancelled — visible to both parties. */
    closure: {
        reason: String,
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        byRole: String,
        at: Date,
        ticket: { type: Schema.Types.ObjectId, ref: 'Ticket' },
    },
    state: {
        type: String,
        // Cleared business rules §1. `rejected` (refused before terms) and
        // `cancelled` (ended after terms, via ticket/Admin) stay distinct.
        // Policy 5.1 vocabulary. `declined` is distinct from `cancelled`
        // because Policy 7.2 says declining a brief is not a cancellation.
        enum: ['invitation', 'negotiation', 'accepted', 'escrow_pending', 'in_progress',
            'submitted', 'revision', 'resolution', 'disputed', 'completed',
            'declined', 'cancelled'],
        default: 'invitation',
        index: true,
    },
    escrow: {
        funded: { type: Boolean, default: false },
        amount: { type: Number, default: 0 },
        fundedAt: Date,
        releasedAt: Date,
        transactionRef: { type: Schema.Types.ObjectId, ref: 'Transaction' },
        /** Admin's escrow decision (§8) — full refund, full payout, or split. */
        settlement: {
            creatorPayout: Number,
            brandRefund: Number,
            at: Date,
        },
        /** §6/A11 — payment failed; goes to Admin, never auto-retried or auto-cancelled. */
        lastFailure: { reason: String, at: Date },
        needsAdminReview: { type: Boolean, default: false },
    },
    workSubmissions: { type: [submissionSchema], default: [] },
    revisionCount: { type: Number, default: 0 },
    dispute: {
        raisedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        reason: String,
        resolution: String,
        resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        raisedAt: Date,
        resolvedAt: Date,
    },
    timeline: {
        type: [{
                from: String, to: String,
                by: { type: Schema.Types.ObjectId, ref: 'User' },
                byRole: String, note: String,
                at: { type: Date, default: Date.now },
                _id: false,
            }],
        default: [],
    },
}, { timestamps: true });
dealSchema.index({ brand: 1, state: 1 });
dealSchema.index({ creator: 1, state: 1 });
export const Deal = model('Deal', dealSchema);

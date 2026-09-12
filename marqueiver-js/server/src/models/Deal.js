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
/**
 * Revisions included in the agreed price.
 *
 * A fourth request is not free work: it has to go through an additional-terms
 * proposal that the creator accepts, with its own price. Defined here because
 * the schema default and the enforcement in deals.service.js must be the same
 * number — when they were separate, the schema said 1 and the requirement said
 * 3, and neither was enforced anywhere.
 */
export const INCLUDED_REVISIONS = 3;

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
        /**
         * The structured half of the brief, carried over from whichever proposal
         * version was accepted. Added alongside `deliverables` rather than
         * replacing it: the free-text line is what a summary renders, and the
         * rows are what a deliverable count can be checked against.
         *
         * Usage rights and exclusivity are NOT here — they live at the top level
         * of this schema, which Policy 5.2 already designates as the agreed
         * scope. One home each, so nothing has to decide which copy is true.
         */
        contentItems: {
            type: [{
                contentType: String, quantity: Number, platform: String, notes: String, _id: false,
            }],
            default: [],
        },
        guidelines: {
            dos: { type: [String], default: [] },
            donts: { type: [String], default: [] },
            hashtags: { type: [String], default: [] },
            mentions: { type: [String], default: [] },
            notes: { type: String, default: '' },
        },
        /** When work begins. `deadline` is when it is due. */
        startDate: Date,
        otherTerms: { type: String, default: '' },
        revisionsAllowed: { type: Number, default: INCLUDED_REVISIONS },
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
     * Policy 5.5 option B — a further revision, paid for.
     *
     * This is what stops a fourth revision becoming free work. The included
     * rounds are exhausted; the brand wants more; that is new scope, and new
     * scope is a proposal the creator can refuse, not an instruction.
     *
     * The sequence is deliberately three separate states rather than one flag:
     *
     *   proposed  — the brand has offered a fee for N further rounds
     *   accepted  — the creator has agreed; nothing has been paid yet
     *   funded    — the money is in escrow, and only now do the rounds exist
     *
     * `accepted` and `funded` are distinct because agreement and payment are
     * distinct events, and work must not restart on a promise. `revisionsAdded`
     * is applied to `terms.revisionsAllowed` at funding and nowhere else, which
     * is what makes "the brand cannot simply raise the revision limit" true in
     * the data rather than only in the handler.
     */
    additionalTerms: {
        status: {
            type: String,
            enum: ['none', 'proposed', 'accepted', 'declined', 'funded'],
            default: 'none',
        },
        /** Fee for the further rounds, in the same units as terms.amount. */
        amount: { type: Number, min: 0 },
        /** How many further revision rounds this buys. */
        revisionsAdded: { type: Number, min: 1 },
        /** Any change to what is being delivered — Policy 5.2, scope is explicit. */
        scopeNote: String,
        /** New deadline, if the further work needs one. */
        deadline: Date,
        proposedAt: Date,
        proposedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        respondedAt: Date,
        /** Why the creator declined — shown to the brand. */
        declineReason: String,
        fundedAt: Date,
        /**
         * The commission rate for THIS addition.
         *
         * Snapshotted at acceptance like the original (Policy 14.7): the
         * addition is agreed at a later date and may fall under a different
         * published rate than the collaboration it extends.
         */
        commissionPct: Number,
    },

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

    /** Which proposal version the deal's current terms came from. */
    sourceOffer: { type: Schema.Types.ObjectId, index: true },

    /**
     * ── The final agreed terms ─────────────────────────────────────────────
     *
     * Written once, when the second party confirms, and never again. `terms`
     * above is the working copy — it changes each time a proposal is accepted
     * during negotiation. This is the frozen record of what was actually agreed,
     * stamped with the proposal version it came from and the moment it locked.
     *
     * The two are separate on purpose. A single mutable `terms` object can only
     * answer "what are the terms now", and the question that matters in a
     * dispute is "what did both parties agree to, and when" — which a field
     * that anything may still write cannot answer honestly.
     *
     * Nothing writes here outside `terms.service.js`, and `assertTermsEditable`
     * refuses any edit to a deal whose state is in TERMS_LOCKED_STATES.
     */
    agreedTerms: {
        amount: Number,
        deliverables: String,
        contentItems: {
            type: [{
                contentType: String, quantity: Number, platform: String, notes: String, _id: false,
            }],
            default: undefined,
        },
        guidelines: {
            dos: { type: [String], default: undefined },
            donts: { type: [String], default: undefined },
            hashtags: { type: [String], default: undefined },
            mentions: { type: [String], default: undefined },
            notes: String,
        },
        startDate: Date,
        deadline: Date,
        usageRights: {
            licenceType: String,
            durationMonths: Number,
            paidAdvertising: Boolean,
            whitelisting: Boolean,
            modificationAllowed: Boolean,
            notes: String,
        },
        exclusivity: String,
        otherTerms: String,
        revisionsAllowed: Number,

        /** Provenance: which proposal, and when it became binding. */
        fromOffer: { type: Schema.Types.ObjectId },
        fromOfferSeq: Number,
        lockedAt: Date,
    },

    /**
     * ── Accepted changes to the locked terms ───────────────────────────────
     *
     * `agreedTerms` above is written once and never touched again — not even by
     * a change both parties agreed to. Every later change lands here instead,
     * append-only, carrying the before and after of each field it moved.
     *
     * Two reasons it works this way rather than by editing `agreedTerms`:
     *
     *  1. "Neither party can silently change locked terms" is then a property
     *     of the data, not a rule someone has to keep remembering. There is no
     *     code path that rewrites the agreement, so there is nothing to audit.
     *  2. A dispute asks what was agreed *and when it changed*. An `agreedTerms`
     *     edited in place can answer the first question only, and answers it
     *     with the latest version while presenting it as the original.
     *
     * `bindingTerms(deal)` in `terms.service.js` is what everything reads when
     * it wants the terms in force now: the agreement with its amendments
     * applied. Nothing should reconstruct that by hand.
     *
     * Policy 5.5 option B (paid extra revisions) writes an amendment here too —
     * it was already changing `terms.revisionsAllowed`, `terms.deadline` and
     * `terms.deliverables` on a locked deal without recording anything, so the
     * frozen summary kept showing three revisions on a deal that had five.
     */
    /**
     * Asks to change the locked terms, answered or awaiting an answer.
     *
     * Kept apart from `termsAmendments` because a request and a change are
     * different facts: most requests are declined, and a declined one is still
     * part of the record — "they asked for three more weeks and I said no" is
     * exactly what a party needs to be able to show later. Only an accepted
     * request produces an amendment.
     */
    changeRequests: {
        type: [{
            /** The fields it wants to move: `{ field: newValue }`. */
            changes: { type: Schema.Types.Mixed, required: true },
            reason: { type: String, default: '' },
            status: {
                type: String,
                enum: ['pending', 'accepted', 'rejected', 'withdrawn'],
                default: 'pending',
            },
            proposedBy: { type: Schema.Types.ObjectId, ref: 'User' },
            proposedByRole: { type: String, enum: ['brand', 'creator'] },
            proposedAt: { type: Date, default: Date.now },
            respondedBy: { type: Schema.Types.ObjectId, ref: 'User' },
            respondedAt: Date,
            responseNote: { type: String, default: '' },
        }],
        default: [],
    },

    termsAmendments: {
        type: [{
            /** What moved: `{ field: { from, to } }`. */
            changes: { type: Schema.Types.Mixed, required: true },
            reason: { type: String, default: '' },
            /** Which workflow produced it, so the record says how it happened. */
            source: {
                type: String,
                enum: ['change_request', 'additional_terms', 'admin'],
                required: true,
            },
            changeRequest: { type: Schema.Types.ObjectId },
            proposedBy: { type: Schema.Types.ObjectId, ref: 'User' },
            proposedByRole: { type: String, enum: ['brand', 'creator', 'admin'] },
            acceptedBy: { type: Schema.Types.ObjectId, ref: 'User' },
            acceptedAt: { type: Date, default: Date.now },
        }],
        default: [],
    },

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

        /**
         * ── The two tranches ───────────────────────────────────────────────
         *
         * The confirmed requirement is a 50% advance and a 50% balance
         * (`modules/messaging/messaging.policy.js` quotes it, and the chat gate
         * is built on it). The money code, however, charged the whole agreed
         * value in one order — `createPaymentSession` used `deal.terms.amount`
         * and `computeCollaborationMoney` returned `brandPays: agreedValue`. So
         * the policy documents and the payment path disagreed, and the payment
         * path was what actually ran.
         *
         * These fields are the schedule, recorded per tranche. **Charging is
         * deliberately not wired to them yet** — `createPaymentSession` still
         * raises a single order, and changing that is a separate piece of work
         * on the Cashfree path and the funding window. What is true today is
         * that the agreed schedule is stored and shown; what is not yet true is
         * that two orders are raised. `paymentSchedule()` in
         * commission.service.js computes the figures, and nothing here is
         * derived a second time.
         *
         * Both sides of every figure are stored, not just the brand's. The Final
         * Terms summary shows a creator what they will receive, and a summary
         * that recomputes that from the gross will eventually disagree with the
         * payout that actually runs — the same class of drift the commission
         * snapshot exists to prevent. Nothing downstream does money arithmetic
         * on these; it reads them.
         */
        schedule: {
            advancePct: { type: Number, default: 50 },
            /** Frozen at acceptance, with the rate they were computed from. */
            commissionPct: Number,
            commission: Number,
            creatorNet: Number,
            creatorAdvance: Number,
            creatorBalance: Number,
            advance: {
                /** What the brand pays on this tranche. */
                amount: { type: Number, default: 0 },
                funded: { type: Boolean, default: false },
                fundedAt: Date,
                releasedAt: Date,
                transactionRef: { type: Schema.Types.ObjectId, ref: 'Transaction' },
            },
            balance: {
                amount: { type: Number, default: 0 },
                funded: { type: Boolean, default: false },
                fundedAt: Date,
                releasedAt: Date,
                transactionRef: { type: Schema.Types.ObjectId, ref: 'Transaction' },
            },
        },
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
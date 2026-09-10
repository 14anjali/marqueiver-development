import { Schema, model } from 'mongoose';

/**
 * Campaign + applications.
 *
 * Applications are the creator-initiated entry into the deal lifecycle:
 * cleared rules §2 — "A Creator application produces a `requested` deal" and
 * "The receiving party must accept before negotiation starts." So an applicant
 * row is not a standalone concept; it points at the Deal it produced, and the
 * brand's Accept moves that deal on rather than just flipping a string.
 */
const applicantSchema = new Schema({
    creator: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    appliedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    /** The `requested` deal created when this application was submitted (§2). */
    deal: { type: Schema.Types.ObjectId, ref: 'Deal' },
    decidedAt: Date,
}, { _id: false });

const campaignSchema = new Schema({
    brand: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    brief: { type: String, default: '' },
    contentTypes: { type: [String], default: [] },
    budget: { type: Number, default: 0 },
    location: { type: String, default: 'India' },
    tags: { type: [String], default: [] },
    deadline: Date,
    /**
     * Campaign lifecycle.
     *
     *   draft          — being written; only the brand sees it.
     *   pending_review — submitted, waiting on Marqueiver. Not discoverable.
     *   open           — approved and live; creators can find and apply.
     *   rejected       — refused, with a reason the brand can act on.
     *   closed         — no longer accepting applications.
     *
     * `pending_review` is the default because approval is the point: a campaign
     * that defaulted to `open` would be live the instant it was created, which
     * is what the model did before and what the flow document says it must not.
     *
     * `rejected` is a distinct state rather than a flag on `closed`, because a
     * brand needs to tell "we turned this down, here is why, fix it and
     * resubmit" apart from "this ran its course".
     */
    status: {
        type: String,
        enum: ['draft', 'pending_review', 'open', 'rejected', 'closed'],
        default: 'pending_review',
        index: true,
    },

    /**
     * The review record. Kept on the campaign rather than only in the audit log
     * because the brand has to be shown the reason, and the audit log is
     * admin-only.
     */
    review: {
        submittedAt: Date,
        decidedAt: Date,
        decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        /** Shown to the brand verbatim when a campaign is rejected. */
        reason: String,
        /** Not shown to the brand — context for the next reviewer. */
        internalNote: String,
        /** How many times this campaign has been submitted for review. */
        submissionCount: { type: Number, default: 0 },
    },

    /** Set when an approved campaign first became visible to creators. */
    publishedAt: Date,

    applicants: { type: [applicantSchema], default: [] },
}, { timestamps: true });

/** Statuses a creator may discover. Everything else is invisible to them. */
export const CREATOR_VISIBLE_STATUSES = ['open'];

/** Editing is allowed only before a campaign is live. */
export const CAMPAIGN_EDITABLE_STATUSES = ['draft', 'pending_review', 'rejected'];

/** The reviewer's queue, oldest submission first. */
campaignSchema.index({ status: 1, 'review.submittedAt': 1 });

/**
 * Duplicate-application prevention at the database level, not just in the
 * controller. A partial unique index on the subdocument key means two
 * concurrent apply requests cannot both win a race — the second gets a
 * duplicate-key error, which the controller turns into a clean 409.
 */
campaignSchema.index(
    { _id: 1, 'applicants.creator': 1 },
    { unique: true, partialFilterExpression: { 'applicants.creator': { $exists: true } } },
);

/** Fast lookup of "which campaigns has this creator applied to" (§10). */
campaignSchema.index({ 'applicants.creator': 1, 'applicants.status': 1 });

export const Campaign = model('Campaign', campaignSchema);

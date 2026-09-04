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
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    applicants: { type: [applicantSchema], default: [] },
}, { timestamps: true });

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

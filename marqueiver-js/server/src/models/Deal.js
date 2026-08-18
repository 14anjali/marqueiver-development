import { Schema, model } from 'mongoose';
const submissionSchema = new Schema({
    urls: { type: [String], default: [] },
    note: String,
    submittedAt: { type: Date, default: Date.now },
    reviewStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewNote: String,
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
    },
    state: {
        type: String,
        enum: ['invited', 'negotiating', 'accepted', 'escrow_funded', 'in_progress',
            'submitted', 'revision', 'completed', 'disputed', 'cancelled'],
        default: 'invited',
        index: true,
    },
    escrow: {
        funded: { type: Boolean, default: false },
        amount: { type: Number, default: 0 },
        fundedAt: Date,
        releasedAt: Date,
        transactionRef: { type: Schema.Types.ObjectId, ref: 'Transaction' },
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

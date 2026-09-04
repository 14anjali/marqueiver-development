import { Schema, model } from 'mongoose';
const verificationSchema = new Schema({
    subject: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subjectRole: { type: String, enum: ['creator', 'brand'], required: true },
    kind: { type: String, enum: ['business', 'gst', 'website', 'social', 'email'], required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    documents: { type: [String], default: [] },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decisionNote: String,
}, { timestamps: true });
verificationSchema.index({ subject: 1, kind: 1 }, { unique: true });
export const Verification = model('Verification', verificationSchema);

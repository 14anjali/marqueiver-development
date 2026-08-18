import { Schema, model } from 'mongoose';
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
    applicants: {
        type: [{
                creator: { type: Schema.Types.ObjectId, ref: 'User' },
                appliedAt: { type: Date, default: Date.now },
                status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
                _id: false,
            }],
        default: [],
    },
}, { timestamps: true });
export const Campaign = model('Campaign', campaignSchema);

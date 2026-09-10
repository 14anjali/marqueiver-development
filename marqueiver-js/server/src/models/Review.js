import { Schema, model } from 'mongoose';
const reviewSchema = new Schema({
    deal: { type: Schema.Types.ObjectId, ref: 'Deal', required: true, index: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    target: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    direction: { type: String, enum: ['brand_to_creator', 'creator_to_brand'], required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: String,
    breakdown: {
        paymentReliability: Number,
        communication: Number,
        campaignExperience: Number,
        repeatCollaboration: Number,
    },
    hidden: { type: Boolean, default: false },
}, { timestamps: { createdAt: true, updatedAt: false } });
// one review per author per deal
reviewSchema.index({ deal: 1, author: 1 }, { unique: true });
export const Review = model('Review', reviewSchema);

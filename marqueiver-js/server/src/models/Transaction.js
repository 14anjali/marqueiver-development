import { Schema, model } from 'mongoose';
const txnSchema = new Schema({
    // Optional — wallet withdrawals and deposits aren't tied to a specific deal.
    deal: { type: Schema.Types.ObjectId, ref: 'Deal', index: true },
    fromUser: { type: Schema.Types.ObjectId, ref: 'User' },
    toUser: { type: Schema.Types.ObjectId, ref: 'User' },
    type: {
        type: String,
        enum: ['escrow_fund', 'escrow_release', 'refund', 'payout', 'fee'],
        required: true,
        index: true,
    },
    status: {
        type: String,
        enum: ['pending', 'success', 'failed', 'reversed'],
        default: 'pending',
        index: true,
    },
    amount: { type: Number, required: true },
    fee: { type: Number, default: 0 },
    gateway: { type: String, enum: ['cashfree', 'mock'], default: 'mock' },
    gatewayRef: String,
    idempotencyKey: { type: String, index: true, sparse: true },
    meta: Schema.Types.Mixed,
}, { timestamps: true });
export const Transaction = model('Transaction', txnSchema);

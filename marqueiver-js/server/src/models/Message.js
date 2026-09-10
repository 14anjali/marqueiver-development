import { Schema, model } from 'mongoose';
const messageSchema = new Schema({
    deal: { type: Schema.Types.ObjectId, ref: 'Deal', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['creator', 'brand', 'admin'], required: true },
    body: { type: String, required: true },
    attachments: { type: [String], default: [] },
    readBy: { type: [Schema.Types.ObjectId], default: [] },
}, { timestamps: { createdAt: true, updatedAt: false } });
messageSchema.index({ deal: 1, createdAt: 1 });
export const Message = model('Message', messageSchema);

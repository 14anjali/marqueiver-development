import { Schema, model } from 'mongoose';
const notificationSchema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    channel: { type: String, enum: ['in_app', 'email', 'sms', 'whatsapp'], default: 'in_app' },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    data: Schema.Types.Mixed,
    read: { type: Boolean, default: false, index: true },
    sent: { type: Boolean, default: false },
    // Per-channel delivery outcome (feature: notification queue) — lets the
    // durable Notification record double as the delivery log, without adding
    // a separate queue infrastructure dependency.
    channelResults: {
        type: [{ channel: String, status: { type: String, enum: ['sent', 'failed'] }, error: String, _id: false }],
        default: [],
    },
}, { timestamps: { createdAt: true, updatedAt: false } });
export const Notification = model('Notification', notificationSchema);

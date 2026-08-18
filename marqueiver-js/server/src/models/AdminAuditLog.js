import { Schema, model } from 'mongoose';
const auditSchema = new Schema({
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    ip: String,
}, { timestamps: { createdAt: true, updatedAt: false } });
export const AdminAuditLog = model('AdminAuditLog', auditSchema);

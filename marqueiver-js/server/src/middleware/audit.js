import { AdminAuditLog } from '../models/index.js';
/** Helper to record a mutating admin action (proposal §6 admin audit logging). */
export async function recordAudit(params) {
    await AdminAuditLog.create(params);
}

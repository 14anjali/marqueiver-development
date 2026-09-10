import { z } from 'zod';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok, created } from '../../utils/respond.js';
import { Verification } from '../../models/index.js';
/** User submits a verification request (business/gst/website/social/email). */
export const submitSchema = z.object({
    kind: z.enum(['business', 'gst', 'website', 'social', 'email']),
    documents: z.array(z.string()).default([]),
});
export const submit = catchAsync(async (req, res) => {
    const role = req.auth.role;
    if (role !== 'creator' && role !== 'brand')
        throw ApiError.forbidden();
    const b = req.body;
    const v = await Verification.findOneAndUpdate({ subject: req.auth.sub, kind: b.kind }, { subject: req.auth.sub, subjectRole: role, kind: b.kind, documents: b.documents, status: 'pending' }, { upsert: true, new: true });
    created(res, v);
});
export const myVerifications = catchAsync(async (req, res) => {
    ok(res, await Verification.find({ subject: req.auth.sub }).lean());
});

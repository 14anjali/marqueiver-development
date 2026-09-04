import { z } from 'zod';
import { catchAsync } from '../../utils/apiError.js';
import { ok } from '../../utils/respond.js';
import { listNotifications, markRead } from './notifications.service.js';
export const list = catchAsync(async (req, res) => {
    const unread = req.query.unread === 'true';
    ok(res, await listNotifications(req.auth.sub, unread));
});
export const readSchema = z.object({ ids: z.array(z.string()).min(1) });
export const read = catchAsync(async (req, res) => {
    await markRead(req.auth.sub, req.body.ids);
    ok(res, { ok: true });
});

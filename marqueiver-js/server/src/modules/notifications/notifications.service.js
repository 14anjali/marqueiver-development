import { Notification, User } from '../../models/index.js';
import { sendEmail } from '../../services/email.service.js';
import { sendSms, sendWhatsApp } from '../../services/whatsapp.service.js';
/**
 * Templated, multi-channel notification dispatch (proposal §6). Always writes an
 * in-app record; optionally fans out to email/SMS/WhatsApp. Emitted to the user's
 * Socket.io room by the realtime layer (see messaging gateway).
 */
export async function notify(params) {
    const channels = params.channels ?? ['in_app'];
    const created = await Notification.create({
        user: params.user,
        channel: 'in_app',
        type: params.type,
        title: params.title,
        body: params.body,
        data: params.data,
        sent: true,
    });

    const channelResults = [];
    let user;
    const needsUser = channels.includes('email') || channels.includes('sms') || channels.includes('whatsapp');
    if (needsUser) user = await User.findById(params.user).select('email phone').lean();

    if (channels.includes('email') && user?.email) {
        try {
            await sendEmail(user.email, params.title, `<p>${params.body}</p>`);
            channelResults.push({ channel: 'email', status: 'sent' });
        } catch (e) {
            channelResults.push({ channel: 'email', status: 'failed', error: e.message });
        }
    }
    if (channels.includes('sms') && user?.phone) {
        try {
            await sendSms(user.phone, `${params.title}: ${params.body}`);
            channelResults.push({ channel: 'sms', status: 'sent' });
        } catch (e) {
            channelResults.push({ channel: 'sms', status: 'failed', error: e.message });
        }
    }
    if (channels.includes('whatsapp') && user?.phone) {
        try {
            await sendWhatsApp(user.phone, `${params.title}: ${params.body}`);
            channelResults.push({ channel: 'whatsapp', status: 'sent' });
        } catch (e) {
            channelResults.push({ channel: 'whatsapp', status: 'failed', error: e.message });
        }
    }
    if (channelResults.length) {
        created.channelResults = channelResults;
        await created.save();
    }

    // Emit realtime if the socket layer is attached.
    emitter?.(params.user, created);
    return created;
}
/** Allow the realtime layer to register a push callback without a hard dependency. */
let emitter;
export function registerNotificationEmitter(fn) {
    emitter = fn;
}
export async function listNotifications(userId, unreadOnly = false) {
    const filter = { user: userId };
    if (unreadOnly)
        filter.read = false;
    return Notification.find(filter).sort({ createdAt: -1 }).limit(100).lean();
}
export async function markRead(userId, ids) {
    await Notification.updateMany({ user: userId, _id: { $in: ids } }, { read: true });
}

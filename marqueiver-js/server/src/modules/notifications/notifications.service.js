import { Notification, User } from '../../models/index.js';
import { sendEmail } from '../../services/email.service.js';
import { sendSms, sendWhatsApp } from '../../services/whatsapp.service.js';
/**
 * The `data` payload for a notification about a deal.
 *
 * Every deal notification in the product was emitted with `data: { dealId }`
 * and nothing else, which left the notifications list able to say *that*
 * something happened and never *what*. "Escrow funded" with no amount and
 * "Deal updated" with no state are both a navigation away from being useful,
 * and a notification you have to open to understand is a notification that
 * failed at its job.
 *
 * Three fields, all already in hand at every call site:
 *
 *   dealId  as before
 *   state   the deal's status, so the list can show the same status pill the
 *           deals table does — and show it in the same colour
 *   amount  the agreed value, in the same units as `terms.amount`, so a money
 *           notification can carry the figure it is about
 *   title   the collaboration's title (a top-level path on Deal), so a row
 *           can name the deal it concerns
 *
 * Returning a plain object rather than writing it at each call site is what
 * stops the four payload shapes from drifting apart again.
 */
export function dealPayload(deal, extra = {}) {
    if (!deal) return { ...extra };
    return {
        dealId: deal.id ?? String(deal._id ?? ''),
        // `Deal` names this path `state`, not `status` — `status` on a Deal is
        // the additional-terms sub-document's own field.
        state: deal.state,
        amount: deal.terms?.amount,
        title: deal.title,
        ...extra,
    };
}

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

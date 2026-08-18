import { z } from 'zod';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok, created } from '../../utils/respond.js';
import { Deal, Message, BrandProfile, CreatorProfile } from '../../models/index.js';
import { emitToDeal } from './messaging.gateway.js';
async function assertParty(dealId, userId, role) {
    const deal = await Deal.findById(dealId).select('brand creator').lean();
    if (!deal)
        throw ApiError.notFound('Deal not found');
    const isParty = [deal.brand.toString(), deal.creator.toString()].includes(userId);
    if (!isParty && role !== 'admin')
        throw ApiError.forbidden();
    return deal;
}
export const listMessages = catchAsync(async (req, res) => {
    await assertParty(req.params.dealId, req.auth.sub, req.auth.role);
    const messages = await Message.find({ deal: req.params.dealId }).sort({ createdAt: 1 }).limit(200).lean();
    ok(res, messages);
});
export const sendSchema = z.object({ body: z.string().min(1), attachments: z.array(z.string()).optional() });
export const sendMessage = catchAsync(async (req, res) => {
    await assertParty(req.params.dealId, req.auth.sub, req.auth.role);
    const b = req.body;
    const msg = await Message.create({
        deal: req.params.dealId,
        sender: req.auth.sub,
        senderRole: req.auth.role,
        body: b.body,
        attachments: b.attachments ?? [],
        readBy: [req.auth.sub],
    });
    emitToDeal(req.params.dealId, 'message:new', msg); // realtime fan-out
    created(res, msg);
});
export const markRead = catchAsync(async (req, res) => {
    await Message.updateMany({ deal: req.params.dealId, readBy: { $ne: req.auth.sub } }, { $addToSet: { readBy: req.auth.sub } });
    ok(res, { ok: true });
});

/**
 * List conversation threads for the current user — one per deal they're a
 * party to, with the latest message and unread count. Messaging is deal-scoped
 * (there's no standalone chat), so a "threads" view groups by deal rather than
 * by counterpart. Needed because the frontend previously showed a hardcoded
 * list of fake brand names instead of real conversations.
 */
export const listThreads = catchAsync(async (req, res) => {
    const role = req.auth.role === 'creator' ? 'creator' : 'brand';
    const deals = await Deal.find({ [role]: req.auth.sub }).select('title brand creator state').lean();
    if (!deals.length) return ok(res, []);

    const dealIds = deals.map((d) => d._id);
    const [latestByDeal, unreadCounts] = await Promise.all([
        Message.aggregate([
            { $match: { deal: { $in: dealIds } } },
            { $sort: { createdAt: -1 } },
            { $group: { _id: '$deal', body: { $first: '$body' }, createdAt: { $first: '$createdAt' }, senderRole: { $first: '$senderRole' } } },
        ]),
        Message.aggregate([
            { $match: { deal: { $in: dealIds }, readBy: { $ne: req.auth.sub } } },
            { $group: { _id: '$deal', count: { $sum: 1 } } },
        ]),
    ]);
    const latestMap = new Map(latestByDeal.map((m) => [String(m._id), m]));
    const unreadMap = new Map(unreadCounts.map((u) => [String(u._id), u.count]));

    // Resolve the counterpart's display name (brand company / creator display name).
    const counterpartIds = deals.map((d) => (role === 'creator' ? d.brand : d.creator).toString());
    const CounterpartModel = role === 'creator' ? BrandProfile : CreatorProfile;
    const nameField = role === 'creator' ? 'companyName' : 'displayName';
    const profiles = await CounterpartModel.find({ user: { $in: counterpartIds } }).select(`user ${nameField}`).lean();
    const nameMap = new Map(profiles.map((p) => [String(p.user), p[nameField]]));

    const threads = deals.map((d) => {
        const counterpartId = (role === 'creator' ? d.brand : d.creator).toString();
        const latest = latestMap.get(String(d._id));
        return {
            dealId: d._id,
            dealTitle: d.title,
            dealState: d.state,
            counterpartName: nameMap.get(counterpartId) || 'Unknown',
            lastMessage: latest?.body || null,
            lastMessageAt: latest?.createdAt || null,
            unreadCount: unreadMap.get(String(d._id)) || 0,
        };
    }).sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));

    ok(res, threads);
});

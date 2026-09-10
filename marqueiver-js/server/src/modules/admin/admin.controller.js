import { z } from 'zod';
import { Types } from 'mongoose';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { env } from '../../config/env.js';
import { ok } from '../../utils/respond.js';
import { User, Deal, Verification, Transaction, Review, AdminAuditLog, CreatorProfile, BrandProfile, Wallet, Campaign, } from '../../models/index.js';
import { transitionDeal } from '../deals/deals.service.js';
import { recordAudit } from '../../middleware/audit.js';
import { notify } from '../notifications/notifications.service.js';
import { signAccess, signRefresh } from '../../utils/tokens.js';
/** Platform overview dashboard (proposal §5.3). */
export const overview = catchAsync(async (_req, res) => {
    const [totalUsers, creators, brands, activeDeals, openDisputes, verifQueue, gmvAgg] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: 'creator' }),
        User.countDocuments({ role: 'brand' }),
        Deal.countDocuments({ state: { $in: ['escrow_pending', 'in_progress', 'submitted', 'revision', 'resolution'] } }),
        // Disputes live on tickets now (§13); until the ticket module exists,
        // surface deals whose escrow needs an admin decision.
        Deal.countDocuments({ 'escrow.needsAdminReview': true }),
        Verification.countDocuments({ status: 'pending' }),
        Transaction.aggregate([
            { $match: { type: 'escrow_release', status: 'success' } },
            { $group: { _id: null, gmv: { $sum: '$amount' } } },
        ]),
    ]);
    ok(res, {
        totalUsers, creators, brands, activeDeals, openDisputes,
        verificationQueue: verifQueue, gmv: gmvAgg[0]?.gmv ?? 0,
    });
});
/**
 * Time-series analytics for the admin dashboard charts (feature: charts/graphs).
 * All series are real aggregations grouped by calendar month from actual
 * document timestamps — no synthetic data points.
 */
export const analytics = catchAsync(async (_req, res) => {
    const byMonth = (Model, match, sumField) => Model.aggregate([
        { $match: match },
        { $group: { _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } }, value: sumField ? { $sum: `$${sumField}` } : { $sum: 1 } } },
        { $sort: { '_id.y': 1, '_id.m': 1 } },
    ]);

    const [usersByMonth, dealsByMonth, gmvByMonth, dealsByState, txnsByType, roleSplit] = await Promise.all([
        byMonth(User, {}),
        byMonth(Deal, {}),
        byMonth(Transaction, { type: 'escrow_release', status: 'success' }, 'amount'),
        Deal.aggregate([{ $group: { _id: '$state', count: { $sum: 1 } } }]),
        Transaction.aggregate([{ $match: { status: 'success' } }, { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
        User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    ]);

    const shape = (rows) => rows.map((r) => ({ year: r._id.y, month: r._id.m, value: r.value }));
    ok(res, {
        usersByMonth: shape(usersByMonth),
        dealsByMonth: shape(dealsByMonth),
        gmvByMonth: shape(gmvByMonth),
        dealsByState: dealsByState.map((d) => ({ state: d._id, count: d.count })),
        transactionsByType: txnsByType.map((t) => ({ type: t._id, total: t.total, count: t.count })),
        roleSplit: roleSplit.map((r) => ({ role: r._id, count: r.count })),
    });
});

/** Verification queue + decision (proposal §5.3). */
export const listVerificationQueue = catchAsync(async (req, res) => {
    const status = req.query.status ?? 'pending';
    ok(res, await Verification.find({ status }).populate('subject', 'phone email role').sort({ createdAt: 1 }).lean());
});
export const decideVerificationSchema = z.object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().optional(),
});
export const decideVerification = catchAsync(async (req, res) => {
    const b = req.body;
    const v = await Verification.findById(req.params.id);
    if (!v)
        throw ApiError.notFound();
    const before = v.toObject();
    v.status = b.decision;
    v.decidedBy = new Types.ObjectId(req.auth.sub);
    v.decisionNote = b.note;
    await v.save();
    // Reflect approval onto the profile's verification badges.
    if (b.decision === 'approved') {
        const Model = v.subjectRole === 'brand' ? BrandProfile : CreatorProfile;
        if (v.subjectRole === 'brand') {
            await Model.updateOne({ user: v.subject }, { [`verifications.${v.kind}`]: true });
        }
    }
    await recordAudit({
        actor: req.auth.sub, action: `verification.${b.decision}`,
        entityType: 'Verification', entityId: v._id, before, after: v.toObject(), ip: req.ip,
    });
    ok(res, v);
});
/** Deal oversight — every deal across the 10-state lifecycle, filterable. */
export const listDeals = catchAsync(async (req, res) => {
    const filter = {};
    if (req.query.state)
        filter.state = req.query.state;
    if (req.query.disputed)
        filter['escrow.needsAdminReview'] = true;
    const page = Number(req.query.page ?? 1);
    const limit = Math.min(Number(req.query.limit ?? 25), 100);
    const [items, total] = await Promise.all([
        Deal.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Deal.countDocuments(filter),
    ]);
    ok(res, items, { page, limit, total });
});
/**
 * Dispute resolution / force actions (proposal §5.3 — deliberately deferred in v1,
 * rebuilt as first-class here). Admin drives a deal transition and it's audited.
 */
export const resolveDealSchema = z.object({
    to: z.enum(['completed', 'cancelled', 'in_progress', 'submitted']),
    note: z.string().min(3),
});
export const resolveDeal = catchAsync(async (req, res) => {
    const b = req.body;
    const before = await Deal.findById(req.params.id).lean();
    if (!before)
        throw ApiError.notFound();
    const deal = await transitionDeal({
        dealId: req.params.id, to: b.to, actor: 'admin', actorId: req.auth.sub, note: b.note,
    });
    await recordAudit({
        actor: req.auth.sub, action: `deal.admin_${b.to}`,
        entityType: 'Deal', entityId: deal._id, before, after: deal.toObject(), ip: req.ip,
    });
    ok(res, deal);
});
/** User directory — search/list for the admin user-management page. */
export const listUsers = catchAsync(async (req, res) => {
    const filter = {};
    if (req.query.role) filter.role = req.query.role;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.q) filter.$or = [{ phone: new RegExp(req.query.q, 'i') }, { email: new RegExp(req.query.q, 'i') }];
    const page = Number(req.query.page ?? 1);
    const limit = Math.min(Number(req.query.limit ?? 25), 100);
    const [items, total] = await Promise.all([
        User.find(filter).select('phone email role status createdAt onboardingComplete').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        User.countDocuments(filter),
    ]);
    ok(res, items, { page, limit, total });
});

/** Suspend / reactivate a user (proposal §5.3, finance/support gated). */
export const suspendSchema = z.object({ suspend: z.boolean(), reason: z.string().optional() });
export const suspendUser = catchAsync(async (req, res) => {
    const b = req.body;
    const user = await User.findById(req.params.id);
    if (!user)
        throw ApiError.notFound();
    const before = { status: user.status };
    user.status = b.suspend ? 'suspended' : 'active';
    await user.save();
    await recordAudit({
        actor: req.auth.sub, action: b.suspend ? 'user.suspend' : 'user.reactivate',
        entityType: 'User', entityId: user._id, before, after: { status: user.status }, ip: req.ip,
    });
    ok(res, { id: user.id, status: user.status });
});
/** Review directory — browse for moderation (previously only moderate-by-id existed). */
export const listReviews = catchAsync(async (req, res) => {
    const filter = {};
    if (req.query.hidden === 'true') filter.hidden = true;
    const page = Number(req.query.page ?? 1);
    const limit = Math.min(Number(req.query.limit ?? 25), 100);
    const [items, total] = await Promise.all([
        Review.find(filter).populate('author', 'phone email role').populate('target', 'phone email role')
            .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Review.countDocuments(filter),
    ]);
    ok(res, items, { page, limit, total });
});

/** Content moderation — hide a review (proposal §5.3). */
export const moderateReview = catchAsync(async (req, res) => {
    const review = await Review.findById(req.params.id);
    if (!review)
        throw ApiError.notFound();
    review.hidden = req.body.hidden !== false;
    await review.save();
    await recordAudit({
        actor: req.auth.sub, action: 'review.moderate',
        entityType: 'Review', entityId: review._id, after: { hidden: review.hidden }, ip: req.ip,
    });
    ok(res, review);
});
/** Team management — invite an admin with a permission level (super only). */
export const inviteAdminSchema = z.object({
    phone: z.string(),
    adminLevel: z.enum(['super', 'support', 'finance']),
});
export const inviteAdmin = catchAsync(async (req, res) => {
    const b = req.body;
    let user = await User.findOne({ phone: b.phone });
    if (user) {
        user.role = 'admin';
        user.adminLevel = b.adminLevel;
        user.adminApprovalStatus = 'approved'; // super-initiated — trusted, skips the self-signup approval loop
        await user.save();
    }
    else {
        user = await User.create({ phone: b.phone, role: 'admin', adminLevel: b.adminLevel, adminApprovalStatus: 'approved', phoneVerified: true });
    }
    await recordAudit({
        actor: req.auth.sub, action: 'admin.invite',
        entityType: 'User', entityId: user._id, after: { adminLevel: b.adminLevel }, ip: req.ip,
    });
    ok(res, { id: user.id, adminLevel: user.adminLevel });
});

/** Pending self-signup admin requests (super-only). */
export const listPendingAdmins = catchAsync(async (req, res) => {
    const items = await User.find({ role: 'admin', adminApprovalStatus: 'pending' })
        .select('phone email adminLevel createdAt').sort({ createdAt: 1 }).lean();
    ok(res, items);
});

/** Approve or reject a self-signed-up admin (super-only). Rejected accounts
 * keep role='admin' with adminApprovalStatus='rejected' so requireApprovedAdmin
 * blocks them permanently — they aren't deleted, in case a decision needs
 * auditing or reversal later. */
export const decideAdminApprovalSchema = z.object({ decision: z.enum(['approved', 'rejected']) });
export const decideAdminApproval = catchAsync(async (req, res) => {
    const target = await User.findOne({ _id: req.params.id, role: 'admin' });
    if (!target) throw ApiError.notFound('Pending admin not found');
    if (target.adminApprovalStatus !== 'pending') throw ApiError.conflict('This request has already been decided');
    const before = { adminApprovalStatus: target.adminApprovalStatus };
    target.adminApprovalStatus = req.body.decision;
    await target.save();
    await recordAudit({
        actor: req.auth.sub, action: `admin.signup_${req.body.decision}`,
        entityType: 'User', entityId: target._id, before, after: { adminApprovalStatus: target.adminApprovalStatus }, ip: req.ip,
    });
    ok(res, { id: target.id, adminLevel: target.adminLevel, adminApprovalStatus: target.adminApprovalStatus });
});
/** Full audit log, filterable + exportable (proposal §5.3). */
export const auditLog = catchAsync(async (req, res) => {
    const filter = {};
    if (req.query.action)
        filter.action = req.query.action;
    if (req.query.entityType)
        filter.entityType = req.query.entityType;
    ok(res, await AdminAuditLog.find(filter).sort({ createdAt: -1 }).limit(500).lean());
});
/** CSV export for finance/ops (proposal §5.3). */
export const exportData = catchAsync(async (req, res) => {
    const kind = req.params.kind;
    let rows = [];
    let header = '';
    if (kind === 'transactions') {
        const txns = await Transaction.find().limit(5000).lean();
        header = 'id,deal,type,status,amount,gateway,createdAt';
        rows = txns.map((t) => [t._id, t.deal, t.type, t.status, t.amount, t.gateway, t.createdAt].join(','));
    }
    else if (kind === 'deals') {
        const deals = await Deal.find().limit(5000).lean();
        header = 'id,brand,creator,state,amount,createdAt';
        rows = deals.map((d) => [d._id, d.brand, d.creator, d.state, d.terms.amount, d.createdAt].join(','));
    }
    else {
        throw ApiError.badRequest('Unknown export kind');
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${kind}.csv"`);
    res.send([header, ...rows].join('\n'));
});
/** Wallet oversight (feature: internal wallet system) — aggregate balances +
 * top holders, so admin can see total creator funds held before withdrawal. */
export const walletsOverview = catchAsync(async (_req, res) => {
    const [agg, top] = await Promise.all([
        Wallet.aggregate([{ $group: { _id: null, totalBalance: { $sum: '$balance' }, totalCredited: { $sum: '$lifetimeCredited' }, totalWithdrawn: { $sum: '$lifetimeWithdrawn' }, count: { $sum: 1 } } }]),
        Wallet.find().sort({ balance: -1 }).limit(20).populate('user', 'phone email').lean(),
    ]);
    ok(res, {
        totalBalance: agg[0]?.totalBalance ?? 0,
        totalCredited: agg[0]?.totalCredited ?? 0,
        totalWithdrawn: agg[0]?.totalWithdrawn ?? 0,
        walletCount: agg[0]?.count ?? 0,
        topWallets: top,
    });
});

/* ─────────────────────── campaign review queue ────────────────────────────── */

/**
 * Campaigns waiting on Marqueiver, oldest submission first.
 *
 * Oldest-first rather than newest-first because this is a queue a brand is
 * waiting in, and newest-first quietly starves whatever is at the bottom.
 */
export const listCampaignReviewQueue = catchAsync(async (req, res) => {
    const status = req.query.status ?? 'pending_review';

    const items = await Campaign.find({ status })
        .sort({ 'review.submittedAt': 1 })
        .limit(200)
        .populate('brand', 'email phone role')
        .lean();

    ok(res, items.map((c) => ({
        ...c,
        applicantCount: c.applicants?.length ?? 0,
        // The full applicant list is not a reviewer's business and can be long.
        applicants: undefined,
        // Surfaced because a campaign on its fourth submission deserves a
        // closer read than one on its first.
        resubmission: (c.review?.submissionCount ?? 0) > 1,
    })));
});

export const decideCampaignSchema = z.object({
    decision: z.enum(['approved', 'rejected']),
    /** Shown to the brand verbatim. Required on rejection. */
    reason: z.string().max(1000).optional(),
    /** Never shown to the brand. */
    internalNote: z.string().max(1000).optional(),
}).strict();

/**
 * Approve or reject a campaign.
 *
 * Approval is the only route to `open` — the brand-facing PATCH deliberately
 * cannot set it. A rejection must carry a reason: "rejected" with no
 * explanation gives the brand nothing to act on and generates a support ticket
 * instead of a corrected campaign.
 */
export const decideCampaign = catchAsync(async (req, res) => {
    const { decision, reason, internalNote } = req.body;

    if (decision === 'rejected' && !reason?.trim())
        throw ApiError.unprocessable('A rejection must tell the brand what to change');

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) throw ApiError.notFound('Campaign not found');

    if (campaign.status !== 'pending_review')
        throw ApiError.unprocessable(
            `This campaign is ${campaign.status}, not awaiting review. It may have been decided already.`,
        );

    const before = campaign.toObject();

    campaign.status = decision === 'approved' ? 'open' : 'rejected';
    campaign.review.decidedAt = new Date();
    campaign.review.decidedBy = new Types.ObjectId(req.auth.sub);
    campaign.review.reason = reason;
    if (internalNote) campaign.review.internalNote = internalNote;

    // Only on the first approval — a campaign closed and reopened keeps the
    // date creators originally saw it.
    if (decision === 'approved' && !campaign.publishedAt) campaign.publishedAt = new Date();

    await campaign.save();

    await recordAudit({
        actor: req.auth.sub,
        action: `campaign.${decision}`,
        entityType: 'Campaign',
        entityId: campaign._id,
        before,
        after: campaign.toObject(),
        ip: req.ip,
    });

    /**
     * Tell the brand. A decision the brand never sees is the same as no
     * decision, and a rejection is worthless without its reason attached.
     * Notification failure must not roll back the decision itself.
     */
    await notify({
        user: campaign.brand,
        type: `campaign.${decision}`,
        title: decision === 'approved' ? 'Campaign approved' : 'Campaign needs changes',
        body: decision === 'approved'
            ? `"${campaign.title}" is live and creators can now apply.`
            : `"${campaign.title}" was not approved: ${reason}`,
        data: { campaignId: campaign.id },
    }).catch(() => void 0);

    ok(res, campaign);
});

/**
 * Dev helper: bootstrap the first super-admin.
 *
 * This route is mounted BEFORE `authenticate` in admin.routes.js, so it is
 * reachable with no credentials at all. Its only other guard is "no admin row
 * exists yet", which on a fresh production database is true — meaning whoever
 * POSTs here first receives a super-admin access + refresh token pair. That is
 * a full account takeover of the platform by an unauthenticated stranger.
 *
 * The comment always called this a dev helper; now the code enforces it.
 * Production admins are created by seeding a user directly, or by the team
 * invite flow (`inviteTeamMember`), both of which require an existing admin.
 */
export const bootstrapAdmin = catchAsync(async (req, res) => {
    if (env.nodeEnv === 'production')
        throw ApiError.notFound('Not found');

    const exists = await User.exists({ role: 'admin' });
    if (exists)
        throw ApiError.forbidden('Admin already exists');
    const phone = req.body.phone ?? '+910000000000';
    const user = await User.create({ phone, role: 'admin', adminLevel: 'super', adminApprovalStatus: 'approved', phoneVerified: true });
    ok(res, {
        id: user.id,
        accessToken: signAccess({ sub: user.id, role: 'admin', adminLevel: 'super' }),
        refreshToken: signRefresh(user.id),
    });
});

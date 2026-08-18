import { z } from 'zod';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok } from '../../utils/respond.js';
import { User, CreatorProfile, BrandProfile, InstagramAccount, Deal, Transaction, Review } from '../../models/index.js';
import { fetchSocialStats } from '../../services/meta.service.js';
import { getUploadUrl } from '../../services/storage.service.js';
import { analyzeProfile } from '../../services/ai.service.js';
import { renderMediaKitPdf } from '../../services/mediakit.service.js';
import { PLATFORMS } from '../../../../shared/types.js';
/** GET own profile (creator or brand). */
export const getMyProfile = catchAsync(async (req, res) => {
    const { sub, role } = req.auth;
    const profile = role === 'brand'
        ? await BrandProfile.findOne({ user: sub }).lean()
        : await CreatorProfile.findOne({ user: sub }).lean();
    if (!profile)
        throw ApiError.notFound('Profile not found');
    ok(res, profile);
});
/** Creator onboarding (7 steps, proposal §5.1) — partial updates, resumable. */
export const updateCreatorSchema = z.object({
    displayName: z.string().optional(),
    headline: z.string().optional(),
    bio: z.string().optional(),
    categories: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional(),
    gender: z.enum(['male', 'female', 'other']).optional(),
    dob: z.string().optional(),
    location: z.object({ city: z.string().optional(), country: z.string().optional() }).optional(),
    rateCard: z.array(z.object({ contentType: z.string(), price: z.number() })).optional(),
    collaborationTypes: z.array(z.enum(['paid', 'barter'])).optional(),
    contentTypes: z.array(z.string()).optional(),
    availability: z.boolean().optional(),
});
export const updateCreatorProfile = catchAsync(async (req, res) => {
    if (req.auth.role !== 'creator')
        throw ApiError.forbidden();
    const body = req.body;
    const profile = await CreatorProfile.findOne({ user: req.auth.sub });
    if (!profile)
        throw ApiError.notFound();
    Object.assign(profile, body, body.dob ? { dob: new Date(body.dob) } : {});
    await profile.save(); // pre-save recomputes rollups
    ok(res, profile);
});
/** Brand onboarding (4 steps, proposal §5.2). */
export const updateBrandSchema = z.object({
    companyName: z.string().optional(),
    industry: z.string().optional(),
    companySize: z.string().optional(),
    foundedYear: z.number().optional(),
    about: z.string().optional(),
    website: z.string().optional(),
    logo: z.string().optional(),
    contactPerson: z.string().optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().optional(),
    location: z.object({ city: z.string().optional(), country: z.string().optional() }).optional(),
    teamMembers: z.array(z.object({ name: z.string(), role: z.string() })).optional(),
});
export const updateBrandProfile = catchAsync(async (req, res) => {
    if (req.auth.role !== 'brand')
        throw ApiError.forbidden();
    const profile = await BrandProfile.findOneAndUpdate({ user: req.auth.sub }, req.body, { new: true });
    if (!profile)
        throw ApiError.notFound();
    ok(res, profile);
});
/** Connect a social handle → fetches stats (mock/Meta) and embeds it. */
export const connectSocialSchema = z.object({
    platform: z.enum(PLATFORMS),
    handle: z.string().min(1),
});
export const connectSocial = catchAsync(async (req, res) => {
    const { platform, handle } = req.body;
    const stats = await fetchSocialStats(platform, handle);
    const model = req.auth.role === 'brand' ? BrandProfile : CreatorProfile;
    const profile = await model.findOne({ user: req.auth.sub });
    if (!profile)
        throw ApiError.notFound();
    const idx = profile.socialAccounts.findIndex((s) => s.platform === platform);
    if (idx >= 0)
        profile.socialAccounts[idx] = stats;
    else
        profile.socialAccounts.push(stats);
    await profile.save();
    ok(res, profile);
});
/** The AI-analysis onboarding step (proposal §5.1) — suggest categories, summary, rate card. */
export const runAiAnalysis = catchAsync(async (req, res) => {
    const profile = await CreatorProfile.findOne({ user: req.auth.sub });
    if (!profile)
        throw ApiError.notFound();
    const analysis = await analyzeProfile({ bio: profile.bio, socials: profile.socialAccounts });
    ok(res, analysis);
});
/** Mark onboarding complete. */
export const completeOnboarding = catchAsync(async (req, res) => {
    // SRS FR-2.3: an influencer must connect an Instagram account before being
    // granted dashboard access. Brands have no such requirement (FR-3.4).
    if (req.auth.role === 'creator') {
        const ig = await InstagramAccount.findOne({ user: req.auth.sub, status: 'connected' }).lean();
        if (!ig) {
            throw ApiError.badRequest('Connect your Instagram account to finish onboarding');
        }
    }
    await User.updateOne({ _id: req.auth.sub }, { onboardingComplete: true });
    ok(res, { onboardingComplete: true });
});

/** FR-3.3 — presigned URL for brand logo upload (reuses storage service). */
export const getUploadUrlSchema = z.object({
    fileName: z.string().min(1),
    contentType: z.string().default('image/png'),
    // Which feature this upload is for — determines the storage folder.
    // Previously this endpoint was hard-restricted to brands only (for the
    // logo use case), which silently broke it for creator Portfolio uploads
    // (PortfolioPage.jsx calls this same endpoint) — fixed to be role-agnostic.
    purpose: z.enum(['brand-logo', 'portfolio', 'verification']).default('portfolio'),
});
export const getLogoUploadUrl = catchAsync(async (req, res) => {
    const { fileName, contentType, purpose } = req.body;
    if (purpose === 'brand-logo' && req.auth.role !== 'brand') {
        throw ApiError.forbidden('Only brands upload a company logo');
    }
    const folder = purpose === 'brand-logo' ? 'brand-logos' : purpose === 'verification' ? 'verification-docs' : 'portfolio';
    const key = `${folder}/${req.auth.sub}/${Date.now()}-${fileName}`;
    const urls = await getUploadUrl(key, contentType);
    ok(res, urls);
});

/**
 * Save/resume onboarding (feature #4). The frontend calls this after each
 * onboarding step with a free-form step key; on next load it reads this back
 * (via GET /auth/me, which already returns the user) to resume instead of
 * restarting from step 1. Additive — does not touch onboardingComplete.
 */
export const saveOnboardingStepSchema = z.object({ step: z.string().min(1).max(64) });
export const saveOnboardingStep = catchAsync(async (req, res) => {
    await User.updateOne({ _id: req.auth.sub }, { onboardingStep: req.body.step });
    ok(res, { onboardingStep: req.body.step });
});

/* ── Portfolio (feature #10) ──────────────────────────────────────────────
 * Creator-uploaded work samples. Real data only — items are added by the
 * creator (via a storage upload, reusing getUploadUrl) and stored on their
 * own CreatorProfile document. No fabricated view/like counts: metrics are
 * optional and only shown if the creator supplies them. */
export const addPortfolioItemSchema = z.object({
    title: z.string().max(120).optional(),
    mediaUrl: z.string().min(1),
    thumbnailUrl: z.string().optional(),
    mediaType: z.enum(['image', 'video']).default('image'),
    platform: z.string().optional(),
    metrics: z.object({
        views: z.number().optional(),
        likes: z.number().optional(),
        comments: z.number().optional(),
    }).optional(),
});
export const addPortfolioItem = catchAsync(async (req, res) => {
    if (req.auth.role !== 'creator') throw ApiError.forbidden('Only creators have a portfolio');
    const profile = await CreatorProfile.findOne({ user: req.auth.sub });
    if (!profile) throw ApiError.notFound();
    profile.portfolio.unshift(req.body);
    await profile.save();
    ok(res, profile.portfolio);
});

export const deletePortfolioItem = catchAsync(async (req, res) => {
    if (req.auth.role !== 'creator') throw ApiError.forbidden();
    const profile = await CreatorProfile.findOne({ user: req.auth.sub });
    if (!profile) throw ApiError.notFound();
    profile.portfolio = profile.portfolio.filter((p) => p._id.toString() !== req.params.itemId);
    await profile.save();
    ok(res, profile.portfolio);
});

/**
 * Analytics (feature #9). Built entirely from data already stored on the
 * creator's own documents — current social snapshot, deal history, earnings.
 * IMPORTANT — honest limitation: this project does not (yet) persist a daily
 * social-stats snapshot, so a true day-by-day follower-growth chart cannot be
 * computed without fabricating numbers. Rather than invent one, this endpoint
 * returns real current-state and real historical deal/earnings series
 * (grouped by month from actual document timestamps). See
 * IMPLEMENTATION_CHANGELOG.md "Known gaps" for what a growth-history feature
 * would additionally require.
 */
export const getAnalytics = catchAsync(async (req, res) => {
    if (req.auth.role !== 'creator') throw ApiError.forbidden('Analytics is currently creator-facing');
    const userId = req.auth.sub;
    const profile = await CreatorProfile.findOne({ user: userId }).lean();
    if (!profile) throw ApiError.notFound();

    const [dealsByMonth, earningsByMonth, reviewAgg] = await Promise.all([
        Deal.aggregate([
            { $match: { creator: profile.user } },
            { $group: { _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } }, count: { $sum: 1 } } },
            { $sort: { '_id.y': 1, '_id.m': 1 } },
        ]),
        Transaction.aggregate([
            { $match: { toUser: profile.user, type: 'escrow_release', status: 'success' } },
            { $group: { _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } }, total: { $sum: '$amount' } } },
            { $sort: { '_id.y': 1, '_id.m': 1 } },
        ]),
        Review.aggregate([
            { $match: { target: profile.user, hidden: false } },
            { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
        ]),
    ]);

    ok(res, {
        // Current-state snapshot (real, from the profile's own synced social data).
        platformBreakdown: (profile.socialAccounts || []).map((s) => ({
            platform: s.platform, followers: s.followers, engagementRate: s.engagementRate, dataSource: s.dataSource,
        })),
        totalAudience: profile.totalAudience,
        avgEngagement: profile.avgEngagement,
        creatorScore: profile.creatorScore,
        // Real historical series, grouped by calendar month from actual records.
        dealsByMonth: dealsByMonth.map((d) => ({ year: d._id.y, month: d._id.m, count: d.count })),
        earningsByMonth: earningsByMonth.map((d) => ({ year: d._id.y, month: d._id.m, total: d.total })),
        reviews: { average: reviewAgg[0]?.avg ?? 0, count: reviewAgg[0]?.count ?? 0 },
    });
});

/**
 * Media Kit PDF (feature #13). Streams a PDF generated on-demand from the
 * creator's real profile data (name, categories, socials, rate card,
 * portfolio). No external headless-browser dependency — pdfkit renders
 * directly to the response stream.
 */
export const getMediaKit = catchAsync(async (req, res) => {
    const profile = await CreatorProfile.findOne({ user: req.auth.sub }).lean();
    if (!profile) throw ApiError.notFound();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${(profile.displayName || 'creator').replace(/\s+/g, '-')}-media-kit.pdf"`);
    await renderMediaKitPdf(profile, res);
});

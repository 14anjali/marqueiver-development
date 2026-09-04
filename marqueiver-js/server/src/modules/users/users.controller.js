import { z } from 'zod';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok } from '../../utils/respond.js';
import { User, CreatorProfile, BrandProfile, InstagramAccount, Deal, Transaction, Review } from '../../models/index.js';
import { fetchSocialStats } from '../../services/meta.service.js';
import { getUploadUrl } from '../../services/storage.service.js';
import { renderMediaKitPdf } from '../../services/mediakit.service.js';
import { connectedPlatforms } from '../../services/socialConnect.service.js';
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
    avatarUrl: z.string().max(500).optional(),
    headline: z.string().optional(),
    bio: z.string().optional(),
    categories: z.array(z.string().max(40)).max(15).optional(),
    contactEmail: z.string().email().or(z.literal('')).optional(),
    contactPhone: z.string().max(20).optional(),
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

    /**
     * Advance the onboarding stage as soon as the profile step is genuinely
     * satisfied, so a refresh resumes at "connect a social account" rather than
     * sending the user back through a form they have already filled in.
     * Never moves backwards, and never past a completed onboarding.
     */
    if ((profile.categories?.length ?? 0) >= MIN_CATEGORIES && profile.bio) {
        await User.updateOne(
            { _id: req.auth.sub, onboardingComplete: { $ne: true } },
            { onboardingStage: 'profile_completed' },
        );
    }

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
// AI profile analysis removed — scope §1/§20 take AI integration out of scope.
/** Mark onboarding complete. */
/**
 * Finish onboarding.
 *
 * A creator must have connected **at least one** social account — Instagram,
 * Facebook or YouTube. This previously demanded Instagram specifically, which
 * made the other two integrations decorative: a creator with a large YouTube
 * channel and no Instagram could not finish at all.
 *
 * The profile must also be complete (3+ categories), because the completion
 * button is not the only way to reach this endpoint and the rule has to hold
 * wherever it is called from.
 */
export const completeOnboarding = catchAsync(async (req, res) => {
    if (req.auth.role === 'creator') {
        const profile = await CreatorProfile.findOne({ user: req.auth.sub })
            .select('categories').lean();

        if ((profile?.categories?.length ?? 0) < MIN_CATEGORIES) {
            throw new ApiError(422, 'PROFILE_INCOMPLETE',
                `Select at least ${MIN_CATEGORIES} categories to finish setting up your profile.`,
                { minCategories: MIN_CATEGORIES, selected: profile?.categories?.length ?? 0 });
        }

        const connected = await connectedPlatforms(req.auth.sub);
        if (!connected.length) {
            throw new ApiError(422, 'SOCIAL_CONNECTION_REQUIRED',
                'Connect at least one social account — Instagram, Facebook or YouTube — to finish onboarding.',
                { platforms: ['instagram', 'facebook', 'youtube'] });
        }
    }

    await User.updateOne(
        { _id: req.auth.sub },
        { onboardingComplete: true, onboardingStage: 'onboarding_completed' },
    );
    ok(res, { onboardingComplete: true, onboardingStage: 'onboarding_completed' });
});

/** Policy-independent product rule: a creator picks at least three niches. */
export const MIN_CATEGORIES = 3;

/**
 * Everything the onboarding screens need, in one call.
 *
 * The frontend used to reconstruct this from three separate requests and its own
 * assumptions, which is how a user who had already given their name at signup
 * got asked for it again. The server owns the answer to "what is still missing",
 * so a refresh or a re-login resumes at the right step.
 */
export const getOnboardingState = catchAsync(async (req, res) => {
    const user = await User.findById(req.auth.sub)
        .select('role email phone emailVerified phoneVerified authProviders '
              + 'onboardingComplete onboardingStage onboardingStep')
        .lean();
    if (!user) throw ApiError.unauthorized();

    const profile = user.role === 'brand'
        ? await BrandProfile.findOne({ user: req.auth.sub }).lean()
        : await CreatorProfile.findOne({ user: req.auth.sub }).lean();

    const connected = user.role === 'creator' ? await connectedPlatforms(req.auth.sub) : [];

    const categories = profile?.categories ?? [];
    const profileDone = user.role === 'brand'
        ? Boolean(profile?.companyName)
        : Boolean(profile?.bio) && categories.length >= MIN_CATEGORIES;

    /**
     * An account that finished onboarding under the old rules is finished. The
     * new stage field did not exist when they signed up, and re-deriving their
     * status from today's requirements would drag completed users back through
     * a flow they have no reason to see.
     */
    const stage = user.onboardingComplete
        ? 'onboarding_completed'
        : profileDone ? 'profile_completed' : 'basic_details_completed';

    ok(res, {
        role: user.role,
        stage,
        onboardingComplete: Boolean(user.onboardingComplete),

        // What signup already captured — the screens read these instead of
        // asking for them a second time.
        known: {
            displayName: profile?.displayName ?? profile?.companyName ?? '',
            city: profile?.location?.city ?? '',
            email: user.email ?? null,
            phone: user.phone ?? null,
            emailVerified: Boolean(user.emailVerified),
            phoneVerified: Boolean(user.phoneVerified),
            signedUpWith: user.authProviders ?? [],
            avatarUrl: profile?.avatarUrl ?? '',
            bio: profile?.bio ?? '',
            categories,
        },

        // Which contact detail is still worth asking for. Whichever channel
        // signup verified is already on the account and is never re-requested.
        needs: {
            email: !user.email,
            phone: !user.phone,
            categories: Math.max(0, MIN_CATEGORIES - categories.length),
            social: user.role === 'creator' && connected.length === 0,
        },

        minCategories: MIN_CATEGORIES,
        connected,
    });
});

/** FR-3.3 — presigned URL for brand logo upload (reuses storage service). */
export const getUploadUrlSchema = z.object({
    fileName: z.string().min(1),
    contentType: z.string().default('image/png'),
    // Which feature this upload is for — determines the storage folder.
    // Previously this endpoint was hard-restricted to brands only (for the
    // logo use case), which silently broke it for creator Portfolio uploads
    // (PortfolioPage.jsx calls this same endpoint) — fixed to be role-agnostic.
    purpose: z.enum(['brand-logo', 'portfolio', 'verification', 'avatar']).default('portfolio'),
});
export const getLogoUploadUrl = catchAsync(async (req, res) => {
    const { fileName, contentType, purpose } = req.body;
    if (purpose === 'brand-logo' && req.auth.role !== 'brand') {
        throw ApiError.forbidden('Only brands upload a company logo');
    }
    const folder = purpose === 'brand-logo' ? 'brand-logos'
        : purpose === 'verification' ? 'verification-docs'
        : purpose === 'avatar' ? 'avatars'
        : 'portfolio';
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


/* ── Policy 1.3 — age declaration ────────────────────────────────────── */

export const declareAgeSchema = z.object({ dob: z.string().min(8) });

/**
 * Records the date of birth and the 18+ declaration. Verified server-side —
 * the client's own arithmetic is feedback, not the control — and refused
 * outright for anyone under 18, so an under-age account can never be created
 * by editing the request.
 */
export const declareAge = catchAsync(async (req, res) => {
    const dob = new Date(req.body.dob);
    if (Number.isNaN(dob.getTime())) throw ApiError.badRequest('Enter a valid date of birth');

    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    if (dob > cutoff)
        throw new ApiError(403, 'UNDER_18', 'Marqueiver is only available to people aged 18 or over.');

    await User.updateOne({ _id: req.auth.sub }, {
        dob, ageDeclared18Plus: true, ageVerifiedAt: new Date(),
    });
    ok(res, { ageDeclared18Plus: true });
});

/* ── Policy 3.3 — profile visibility ─────────────────────────────────── */

export const setVisibilitySchema = z.object({ isPublished: z.boolean() });

/**
 * Publish or unpublish the Creator profile. Unpublishing removes it from
 * discovery only — the profile, its history and any live Collaborations are
 * untouched, which is what makes this safe to toggle freely.
 */
export const setProfileVisibility = catchAsync(async (req, res) => {
    if (req.auth.role !== 'creator') throw ApiError.forbidden('Creators only');

    const profile = await CreatorProfile.findOneAndUpdate(
        { user: req.auth.sub },
        {
            isPublished: req.body.isPublished,
            ...(req.body.isPublished ? { $unset: { unpublishedAt: 1 } } : { unpublishedAt: new Date() }),
        },
        { new: true },
    );
    if (!profile) throw ApiError.notFound('Profile not found');
    ok(res, { isPublished: profile.isPublished, unpublishedAt: profile.unpublishedAt });
});

/* ── Policy 3.2 / 13.2 — self-reported metrics ───────────────────────── */

export const selfReportedSchema = z.object({
    followers: z.number().min(0).optional(),
    avgViews: z.number().min(0).optional(),
    engagementRate: z.number().min(0).max(100).optional(),
    note: z.string().max(300).optional(),
});

/**
 * Declared figures. Stored under `selfReportedMetrics` and never merged into
 * `socialAccounts`, so nothing downstream can render them as verified.
 */
export const setSelfReportedMetrics = catchAsync(async (req, res) => {
    if (req.auth.role !== 'creator') throw ApiError.forbidden('Creators only');
    const profile = await CreatorProfile.findOneAndUpdate(
        { user: req.auth.sub },
        { selfReportedMetrics: { ...req.body, declaredAt: new Date() } },
        { new: true },
    );
    if (!profile) throw ApiError.notFound('Profile not found');
    ok(res, profile.selfReportedMetrics);
});

/* ── Account deletion ────────────────────────────────────────────────── */

export const deleteAccountSchema = z.object({
    confirm: z.literal('DELETE'),
    reason: z.string().max(500).optional(),
});

/**
 * Delete the account.
 *
 * Implemented as **deactivation with anonymisation**, not a hard delete,
 * because Policy 24 requires immutable audit records for money movement,
 * escrow, payouts and disputes — a hard delete would destroy records the
 * platform is required to retain. Personal data is cleared, the account is
 * terminated and can no longer authenticate, and the financial trail survives
 * attached to an anonymised user.
 *
 * Refused while money is at stake: a Collaboration with funded escrow has to
 * reach an outcome first, otherwise the counterparty is left with a deal
 * against a deleted account.
 */
export const deleteAccount = catchAsync(async (req, res) => {
    const userId = req.auth.sub;

    const blocking = await Deal.find({
        $or: [{ brand: userId }, { creator: userId }],
        state: { $in: ['escrow_pending', 'in_progress', 'submitted', 'revision', 'resolution', 'disputed'] },
    }).select('_id title state').lean();

    if (blocking.length)
        throw new ApiError(409, 'ACTIVE_COLLABORATIONS',
            'You have collaborations in progress. They must be completed, cancelled or resolved before your account can be deleted.',
            { collaborations: blocking.map((d) => ({ id: d._id, title: d.title, state: d.state })) });

    const user = await User.findById(userId);
    if (!user) throw ApiError.notFound();

    // Anonymise the identifiers so the account cannot be used or re-matched,
    // while leaving the row in place for the audit trail.
    const stamp = Date.now();
    user.phone = `deleted_${stamp}_${String(user._id).slice(-6)}`;
    user.email = undefined;
    user.googleId = undefined;
    user.passwordHash = undefined;
    user.accountStatus = 'terminated';
    user.status = 'suspended';
    user.deletedAt = new Date();
    user.deletionReason = req.body.reason;
    await user.save();

    if (user.role === 'creator') {
        await CreatorProfile.findOneAndUpdate({ user: userId }, {
            isPublished: false,
            unpublishedAt: new Date(),
            displayName: 'Deleted account',
            bio: '',
            avatarUrl: '',
            coverUrl: '',
            $unset: { payoutMethod: 1, socialAccounts: 1, selfReportedMetrics: 1 },
        });
    } else {
        await BrandProfile.findOneAndUpdate({ user: userId }, { companyName: 'Deleted account', about: '', logoUrl: '' });
    }

    ok(res, { deleted: true });
});

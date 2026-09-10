import { z } from 'zod';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok } from '../../utils/respond.js';
import { CreatorProfile, BrandProfile, SavedCreator } from '../../models/index.js';
/**
 * Faceted creator discovery (proposal §5.2). All filters map to indexed fields.
 * Results paginate; the list view never fans out per-row (proposal §4.1).
 */
export const searchCreatorsSchema = z.object({
    q: z.string().optional(),
    category: z.string().optional(),
    platform: z.string().optional(),
    minFollowers: z.coerce.number().optional(),
    maxFollowers: z.coerce.number().optional(),
    minEngagement: z.coerce.number().optional(),
    location: z.string().optional(),
    gender: z.enum(['male', 'female', 'other']).optional(),
    minRate: z.coerce.number().optional(),
    maxRate: z.coerce.number().optional(),
    availableOnly: z.coerce.boolean().optional(),
    sort: z.enum(['relevance', 'followers', 'engagement', 'rate']).default('relevance'),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(50).default(20),
});
/**
 * Policy 2.4 — "A Creator's telephone number and email address are never
 * disclosed to a Brand... Payout details, PAN and private contact information
 * are never visible to Brands."
 *
 * Every creator-facing read must be projected. These endpoints previously ran
 * `.lean()` with no projection, which returned `payoutMethod` — bank account
 * number, IFSC, UPI VPA and account holder name — to any authenticated caller.
 * This constant is the single definition of what must never leave the server
 * on a discovery response.
 */
const PRIVATE_CREATOR_FIELDS = '-payoutMethod -pan -phone -email -kyc';

export const searchCreators = catchAsync(async (req, res) => {
    const p = req.query;
    // Policy 3.3 — an unpublished profile is excluded from discovery. Applied
    // to the filter rather than to the results, so it also fixes the counts.
    const filter = { isPublished: { $ne: false } };
    if (p.q)
        filter.$text = { $search: p.q };
    if (p.category)
        filter.categories = p.category;
    if (p.location)
        filter['location.country'] = p.location;
    if (p.gender)
        filter.gender = p.gender;
    if (p.availableOnly)
        filter.availability = true;
    if (p.platform)
        filter['socialAccounts.platform'] = p.platform;
    if (p.minFollowers != null || p.maxFollowers != null) {
        filter.totalAudience = {
            ...(p.minFollowers != null ? { $gte: p.minFollowers } : {}),
            ...(p.maxFollowers != null ? { $lte: p.maxFollowers } : {}),
        };
    }
    if (p.minEngagement != null)
        filter.avgEngagement = { $gte: p.minEngagement };
    if (p.minRate != null || p.maxRate != null) {
        filter.minRate = {
            ...(p.minRate != null ? { $gte: p.minRate } : {}),
            ...(p.maxRate != null ? { $lte: p.maxRate } : {}),
        };
    }
    const sortMap = {
        relevance: { totalAudience: -1 },
        followers: { totalAudience: -1 },
        engagement: { avgEngagement: -1 },
        rate: { minRate: 1 },
    };
    const [items, total] = await Promise.all([
        CreatorProfile.find(filter)
            .select(PRIVATE_CREATOR_FIELDS)
            .sort(sortMap[p.sort])
            .skip((p.page - 1) * p.limit)
            .limit(p.limit)
            .lean(),
        CreatorProfile.countDocuments(filter),
    ]);
    ok(res, items, { page: p.page, limit: p.limit, total });
});
/** Brand discovery (creator-facing "Find Brands"). */
export const searchBrands = catchAsync(async (req, res) => {
    const q = req.query.q ?? '';
    const industry = req.query.industry;
    const filter = {};
    if (q)
        filter.$text = { $search: q };
    if (industry)
        filter.industry = industry;
    const items = await BrandProfile.find(filter).sort({ 'trust.overall': -1 }).limit(20).lean();
    ok(res, items);
});

/** Single brand profile by BrandProfile id — was missing entirely; the brand
 * profile page previously had no way to fetch a specific brand's real data. */
export const getBrandProfile = catchAsync(async (req, res) => {
    const brand = await BrandProfile.findById(req.params.id).lean();
    if (!brand) throw ApiError.notFound('Brand not found');
    ok(res, brand);
});
/**
 * Creator deep-dive. The AI compatibility score that used to be attached here
 * was removed per scope §1/§20 (AI integration is out of scope). The response
 * shape keeps the `{ profile }` envelope so existing callers don't break.
 */
export const getCreatorProfile = catchAsync(async (req, res) => {
    // Projected — see PRIVATE_CREATOR_FIELDS (Policy 2.4).
    const profile = await CreatorProfile.findById(req.params.id)
        .select(PRIVATE_CREATOR_FIELDS).lean();
    if (!profile)
        throw ApiError.notFound('Creator not found');
    ok(res, { profile });
});
/** Bulk export of the current filtered result set (proposal §5.2 — CSV export). */
export const exportCreators = catchAsync(async (req, res) => {
    const p = req.query;
    const filter = { isPublished: { $ne: false } };  // Policy 3.3
    if (p.category)
        filter.categories = p.category;
    if (p.availableOnly)
        filter.availability = true;
    const items = await CreatorProfile.find(filter).select(PRIVATE_CREATOR_FIELDS).limit(1000).lean();
    const header = 'displayName,categories,totalAudience,avgEngagement,minRate,country';
    const rows = items.map((i) => [i.displayName, `"${i.categories.join('|')}"`, i.totalAudience, i.avgEngagement, i.minRate,
        i.location?.country ?? ''].join(','));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="creators.csv"');
    res.send([header, ...rows].join('\n'));
});

/* ── Save / Bookmark creators (feature #21) ───────────────────────────────
 * Brand-only. A saved row is a real DB record (SavedCreator); the unique
 * (brand, creator) index makes save idempotent — saving twice is a no-op. */
export const saveCreator = catchAsync(async (req, res) => {
    if (req.auth.role !== 'brand') throw ApiError.forbidden('Only brands can save creators');
    const creatorProfile = await CreatorProfile.findById(req.params.id).select('user').lean();
    if (!creatorProfile) throw ApiError.notFound('Creator not found');
    await SavedCreator.findOneAndUpdate(
        { brand: req.auth.sub, creator: creatorProfile.user },
        { brand: req.auth.sub, creator: creatorProfile.user },
        { upsert: true },
    );
    ok(res, { saved: true });
});

export const unsaveCreator = catchAsync(async (req, res) => {
    if (req.auth.role !== 'brand') throw ApiError.forbidden();
    const creatorProfile = await CreatorProfile.findById(req.params.id).select('user').lean();
    if (!creatorProfile) throw ApiError.notFound('Creator not found');
    await SavedCreator.deleteOne({ brand: req.auth.sub, creator: creatorProfile.user });
    ok(res, { saved: false });
});

export const listSavedCreators = catchAsync(async (req, res) => {
    if (req.auth.role !== 'brand') throw ApiError.forbidden();
    const saved = await SavedCreator.find({ brand: req.auth.sub }).sort({ createdAt: -1 }).lean();
    const creatorUserIds = saved.map((s) => s.creator);
    const profiles = await CreatorProfile.find({ user: { $in: creatorUserIds } })
        .select(PRIVATE_CREATOR_FIELDS).lean();
    // preserve save-order
    const byUser = new Map(profiles.map((p) => [String(p.user), p]));
    const ordered = creatorUserIds.map((id) => byUser.get(String(id))).filter(Boolean);
    ok(res, ordered);
});

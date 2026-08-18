import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok } from '../../utils/respond.js';
import { CreatorProfile, BrandProfile } from '../../models/index.js';
import { compatibilityScore } from '../../services/ai.service.js';
/** On-demand AI compatibility for a brand viewing a creator (proposal §5.2). */
export const compatibility = catchAsync(async (req, res) => {
    if (req.auth.role !== 'brand')
        throw ApiError.forbidden();
    const creator = await CreatorProfile.findById(req.params.creatorId).lean();
    const brand = await BrandProfile.findOne({ user: req.auth.sub }).lean();
    if (!creator || !brand)
        throw ApiError.notFound();
    const score = await compatibilityScore({ categories: creator.categories, location: creator.location?.country,
        avgEngagement: creator.avgEngagement, totalAudience: creator.totalAudience }, { industry: brand.industry, location: brand.location?.country });
    ok(res, score);
});

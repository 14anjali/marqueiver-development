import { z } from 'zod';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok, created } from '../../utils/respond.js';
import { Deal, Review, BrandProfile } from '../../models/index.js';
export const createReviewSchema = z.object({
    rating: z.number().min(1).max(5),
    text: z.string().optional(),
    breakdown: z.object({
        paymentReliability: z.number().min(1).max(5).optional(),
        communication: z.number().min(1).max(5).optional(),
        campaignExperience: z.number().min(1).max(5).optional(),
        repeatCollaboration: z.number().min(1).max(5).optional(),
    }).optional(),
});
/** Two-way reviews, only after a deal is completed (proposal §6). */
export const createReview = catchAsync(async (req, res) => {
    const deal = await Deal.findById(req.params.dealId);
    if (!deal)
        throw ApiError.notFound();
    if (deal.state !== 'completed')
        throw ApiError.unprocessable('Can only review completed deals');
    const me = req.auth.sub;
    const isBrand = deal.brand.toString() === me;
    const isCreator = deal.creator.toString() === me;
    if (!isBrand && !isCreator)
        throw ApiError.forbidden();
    const b = req.body;
    const direction = isBrand ? 'brand_to_creator' : 'creator_to_brand';
    const target = isBrand ? deal.creator : deal.brand;
    const review = await Review.create({
        deal: deal._id, author: me, target, direction,
        rating: b.rating, text: b.text, breakdown: b.breakdown,
    });
    // Recompute brand trust score when a creator reviews a brand.
    if (direction === 'creator_to_brand')
        await recomputeBrandTrust(target.toString());
    created(res, review);
});
export const listForUser = catchAsync(async (req, res) => {
    const reviews = await Review.find({ target: req.params.userId, hidden: false })
        .sort({ createdAt: -1 }).limit(100).lean();
    ok(res, reviews);
});
async function recomputeBrandTrust(brandUserId) {
    const reviews = await Review.find({ target: brandUserId, direction: 'creator_to_brand', hidden: false }).lean();
    if (!reviews.length)
        return;
    const avg = (k) => {
        const vals = reviews.map((r) => r.breakdown?.[k]).filter((v) => typeof v === 'number');
        return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)) : 0;
    };
    const overall = Number((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1));
    await BrandProfile.updateOne({ user: brandUserId }, {
        'trust.paymentReliability': avg('paymentReliability'),
        'trust.communication': avg('communication'),
        'trust.campaignExperience': avg('campaignExperience'),
        'trust.repeatCollaboration': avg('repeatCollaboration'),
        'trust.overall': overall,
        'trust.reviewCount': reviews.length,
    });
}

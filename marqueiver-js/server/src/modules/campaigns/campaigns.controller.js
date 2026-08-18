import { z } from 'zod';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok, created } from '../../utils/respond.js';
import { Campaign, CreatorProfile } from '../../models/index.js';
import { notify } from '../notifications/notifications.service.js';

/**
 * Campaign/deal management (feature #23). The `Campaign` model already
 * existed (deliberately deferred scope in the original proposal) but had no
 * API surface at all — this module is that surface. Brands create open
 * campaigns; creators browse and apply; brands review applicants and
 * accept/reject. Accepting an applicant does not itself create a Deal — that
 * stays a deliberate next step via the existing "invite creator" flow, so
 * this doesn't duplicate the deal-creation logic already in `modules/deals`.
 */

export const createCampaignSchema = z.object({
    title: z.string().min(3),
    brief: z.string().max(2000).optional(),
    contentTypes: z.array(z.string()).default([]),
    budget: z.number().min(0),
    location: z.string().optional(),
    tags: z.array(z.string()).default([]),
    deadline: z.string().optional(),
});
export const createCampaign = catchAsync(async (req, res) => {
    if (req.auth.role !== 'brand') throw ApiError.forbidden('Only brands can create campaigns');
    const b = req.body;
    const campaign = await Campaign.create({
        brand: req.auth.sub,
        title: b.title,
        brief: b.brief ?? '',
        contentTypes: b.contentTypes,
        budget: b.budget,
        location: b.location || 'India',
        tags: b.tags,
        deadline: b.deadline ? new Date(b.deadline) : undefined,
    });
    created(res, campaign);
});

/** Browse open campaigns (creator-facing, optionally filtered to one brand) or
 * list the requesting brand's own (brand-facing). */
export const listCampaigns = catchAsync(async (req, res) => {
    let filter;
    if (req.auth.role === 'brand') {
        filter = { brand: req.auth.sub };
    } else {
        filter = { status: 'open' };
        if (req.query.brand) filter.brand = req.query.brand;
    }
    const items = await Campaign.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    ok(res, items);
});

export const getCampaign = catchAsync(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) throw ApiError.notFound('Campaign not found');
    const isOwner = campaign.brand.toString() === req.auth.sub;
    if (!isOwner) delete campaign.applicants;
    ok(res, campaign);
});

export const updateCampaignSchema = z.object({
    title: z.string().min(3).optional(),
    brief: z.string().max(2000).optional(),
    budget: z.number().min(0).optional(),
    status: z.enum(['open', 'closed']).optional(),
});
export const updateCampaign = catchAsync(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) throw ApiError.notFound('Campaign not found');
    if (campaign.brand.toString() !== req.auth.sub) throw ApiError.forbidden();
    Object.assign(campaign, req.body);
    await campaign.save();
    ok(res, campaign);
});

/** Creator applies to an open campaign. Idempotent — re-applying is a no-op. */
export const applyToCampaign = catchAsync(async (req, res) => {
    if (req.auth.role !== 'creator') throw ApiError.forbidden('Only creators can apply');
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) throw ApiError.notFound('Campaign not found');
    if (campaign.status !== 'open') throw ApiError.unprocessable('This campaign is closed');
    const already = campaign.applicants.some((a) => a.creator.toString() === req.auth.sub);
    if (!already) {
        campaign.applicants.push({ creator: req.auth.sub, status: 'pending' });
        await campaign.save();
        await notify({
            user: campaign.brand.toString(),
            type: 'campaign.application',
            title: 'New campaign application',
            body: `A creator applied to "${campaign.title}".`,
            data: { campaignId: campaign.id },
        }).catch(() => void 0);
    }
    ok(res, { applied: true });
});

/** Brand accepts/rejects an applicant. */
export const decideApplicantSchema = z.object({ status: z.enum(['accepted', 'rejected']) });
export const decideApplicant = catchAsync(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) throw ApiError.notFound('Campaign not found');
    if (campaign.brand.toString() !== req.auth.sub) throw ApiError.forbidden();
    const applicant = campaign.applicants.find((a) => a.creator.toString() === req.params.creatorId);
    if (!applicant) throw ApiError.notFound('Applicant not found');
    applicant.status = req.body.status;
    await campaign.save();
    await notify({
        user: req.params.creatorId,
        type: `campaign.${req.body.status}`,
        title: req.body.status === 'accepted' ? 'Application accepted' : 'Application update',
        body: `Your application to "${campaign.title}" was ${req.body.status}.`,
        data: { campaignId: campaign.id },
    }).catch(() => void 0);
    ok(res, campaign);
});

/** Applicant list with creator display info, for the owning brand's UI. */
export const listApplicants = catchAsync(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) throw ApiError.notFound('Campaign not found');
    if (campaign.brand.toString() !== req.auth.sub) throw ApiError.forbidden();
    const creatorIds = campaign.applicants.map((a) => a.creator);
    const profiles = await CreatorProfile.find({ user: { $in: creatorIds } })
        .select('user displayName headline totalAudience avgEngagement location').lean();
    const byUser = new Map(profiles.map((p) => [String(p.user), p]));
    const enriched = campaign.applicants.map((a) => ({ ...a, profile: byUser.get(String(a.creator)) || null }));
    ok(res, enriched);
});

import { z } from 'zod';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok, created } from '../../utils/respond.js';
import { Campaign, CreatorProfile, Deal } from '../../models/index.js';
import { notify } from '../notifications/notifications.service.js';
import { computeFees } from '../../services/platformFee.js';
import { openThread } from '../deals/negotiation.service.js';
import { transitionDeal } from '../deals/deals.service.js';

/**
 * Campaign/deal management (feature #23). The `Campaign` model already
 * existed (deliberately deferred scope in the original proposal) but had no
 * API surface at all — this module is that surface. Brands create open
 * campaigns; creators browse and apply; brands review applicants and
 * accept/reject.
 *
 * Applications ARE part of the deal lifecycle (cleared rules §2): applying
 * produces a `requested` deal owned by the creator side, and the brand's
 * Accept is the receiving party's acceptance that opens negotiation (§3).
 * The deal work is delegated to `modules/deals` — `transitionDeal` and
 * `openThread` — so the state machine stays the single authority and no
 * lifecycle logic is duplicated here.
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

    if (req.auth.role === 'brand') return ok(res, items);

    // Creators get their own application state on every row, so the browse
    // list can render Applied/Accepted from server data rather than from
    // local React state that dies on refresh.
    const shaped = items.map((c) => {
        const mine = c.applicants?.find((a) => a.creator.toString() === req.auth.sub) ?? null;
        const { applicants, ...rest } = c;
        return { ...rest, myApplication: mine };
    });
    ok(res, shaped);
});

/**
 * Campaigns this creator has applied to (§10 — "Browse Applied Campaigns").
 * Returns the application status and the deal it produced, so the creator can
 * follow it into the negotiation flow.
 */
export const listMyApplications = catchAsync(async (req, res) => {
    if (req.auth.role !== 'creator') throw ApiError.forbidden('Creators only');

    const campaigns = await Campaign.find({ 'applicants.creator': req.auth.sub })
        .sort({ createdAt: -1 }).lean();

    const items = campaigns.map((c) => {
        const mine = c.applicants.find((a) => a.creator.toString() === req.auth.sub);
        const { applicants, ...rest } = c;
        return { ...rest, myApplication: mine };
    });
    ok(res, items);
});

/**
 * A non-owner must not see the full applicant list, but the previous version
 * deleted `applicants` outright — which left a creator with no way to know it
 * had already applied. The Apply button therefore came back on every refresh.
 * Now the creator's OWN application is returned as `myApplication`, and only
 * other people's applications are hidden.
 */
export const getCampaign = catchAsync(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) throw ApiError.notFound('Campaign not found');

    const isOwner = campaign.brand.toString() === req.auth.sub;
    if (!isOwner) {
        const mine = campaign.applicants?.find((a) => a.creator.toString() === req.auth.sub) ?? null;
        delete campaign.applicants;
        campaign.myApplication = mine;
        campaign.applicantCount = undefined;
    }
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

/**
 * Creator applies to an open campaign.
 *
 * Cleared rules §2 — the application produces a `requested` deal. The brand is
 * the receiving party and must accept it before negotiation starts (§3), which
 * is exactly what `decideApplicant` below does.
 *
 * Duplicate applications are rejected rather than silently ignored (§9). The
 * previous version returned `{ applied: true }` either way, which hid the
 * duplicate from the caller and made the bug harder to see.
 */
export const applyToCampaign = catchAsync(async (req, res) => {
    if (req.auth.role !== 'creator') throw ApiError.forbidden('Only creators can apply');

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) throw ApiError.notFound('Campaign not found');
    if (campaign.status !== 'open') throw ApiError.unprocessable('This campaign is closed');

    const existing = campaign.applicants.find((a) => a.creator.toString() === req.auth.sub);
    if (existing)
        throw new ApiError(409, 'ALREADY_APPLIED', 'You have already applied to this campaign');

    // The deal that this application produces. Terms come from the campaign
    // budget as the opening position; nothing is agreed until an offer is
    // accepted and both parties confirm (§5).
    const fees = computeFees(campaign.budget ?? 0);
    const deal = await Deal.create({
        brand: campaign.brand,
        creator: req.auth.sub,
        campaign: campaign._id,
        title: campaign.title,
        state: 'invitation',
        requestedBy: 'creator',
        terms: {
            amount: campaign.budget ?? 0,
            deliverables: (campaign.contentTypes ?? []).join(', '),
            deadline: campaign.deadline,
            revisionsAllowed: 1,
        },
        fees: {
            brandFeePct: fees.brandFeePct, creatorFeePct: fees.creatorFeePct,
            brandFee: fees.brandFee, creatorFee: fees.creatorFee,
            brandCharge: fees.brandCharge, creatorPayout: fees.creatorPayout,
        },
        escrow: { amount: fees.escrowAmount },
        timeline: [{
            from: null, to: 'invitation', by: req.auth.sub, byRole: 'creator',
            note: `Applied to campaign "${campaign.title}"`, at: new Date(),
        }],
    });

    campaign.applicants.push({ creator: req.auth.sub, status: 'pending', deal: deal._id });

    try {
        await campaign.save();
    } catch (err) {
        // Lost a race against a concurrent apply — the unique index caught it.
        await Deal.deleteOne({ _id: deal._id });
        if (err?.code === 11000)
            throw new ApiError(409, 'ALREADY_APPLIED', 'You have already applied to this campaign');
        throw err;
    }

    await notify({
        user: campaign.brand.toString(),
        type: 'campaign.application',
        title: 'New campaign application',
        body: `A creator applied to "${campaign.title}".`,
        data: { campaignId: campaign.id, dealId: deal.id },
    }).catch(() => void 0);

    created(res, {
        applied: true,
        application: { status: 'pending', deal: deal._id, appliedAt: new Date() },
    });
});

/**
 * Brand accepts or rejects an applicant.
 *
 * Accepting is the receiving party's acceptance of the `requested` deal the
 * application created (§2/§3), so it moves that deal into `negotiating` and
 * opens the negotiation thread — the same path a brand-initiated invite takes.
 * The lifecycle work is delegated to `modules/deals`; nothing about states or
 * threads is reimplemented here.
 *
 * Rejecting closes the deal as `rejected` (distinct from `cancelled`, §1/§6).
 */
export const decideApplicantSchema = z.object({ status: z.enum(['accepted', 'rejected']) });
export const decideApplicant = catchAsync(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) throw ApiError.notFound('Campaign not found');
    if (campaign.brand.toString() !== req.auth.sub) throw ApiError.forbidden();

    const applicant = campaign.applicants.find((a) => a.creator.toString() === req.params.creatorId);
    if (!applicant) throw ApiError.notFound('Applicant not found');
    if (applicant.status !== 'pending')
        throw ApiError.unprocessable(`This application is already ${applicant.status}`);

    applicant.status = req.body.status;
    applicant.decidedAt = new Date();
    await campaign.save();

    let deal = applicant.deal ? await Deal.findById(applicant.deal) : null;

    if (deal) {
        if (req.body.status === 'accepted') {
            // Receiving party accepts → negotiation opens (§3).
            deal = await transitionDeal({
                dealId: deal.id, to: 'negotiation', actor: 'brand', actorId: req.auth.sub,
                note: `Application accepted for "${campaign.title}"`,
            });
            await openThread({ deal, actorId: req.auth.sub, actorRole: 'brand' });
        } else {
            deal = await transitionDeal({
                dealId: deal.id, to: 'declined', actor: 'brand', actorId: req.auth.sub,
                note: `Application rejected for "${campaign.title}"`,
            });
        }
    }

    await notify({
        user: req.params.creatorId,
        type: `campaign.${req.body.status}`,
        title: req.body.status === 'accepted' ? 'Application accepted' : 'Application update',
        body: req.body.status === 'accepted'
            ? `Your application to "${campaign.title}" was accepted. Negotiation is open — send or review an offer.`
            : `Your application to "${campaign.title}" was not taken forward.`,
        data: { campaignId: campaign.id, dealId: deal?.id },
    }).catch(() => void 0);

    ok(res, { campaign, deal });
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

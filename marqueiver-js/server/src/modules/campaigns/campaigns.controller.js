import { z } from 'zod';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok, created } from '../../utils/respond.js';
import { Campaign, CreatorProfile, Deal } from '../../models/index.js';
import { CREATOR_VISIBLE_STATUSES, CAMPAIGN_EDITABLE_STATUSES } from '../../models/Campaign.js';
import { INCLUDED_REVISIONS } from '../../models/Deal.js';
import { notify } from '../notifications/notifications.service.js';
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
    /** false keeps it as a draft; anything else submits it for review. */
    submit: z.boolean().optional(),
});
export const createCampaign = catchAsync(async (req, res) => {
    if (req.auth.role !== 'brand') throw ApiError.forbidden('Only brands can create campaigns');
    const b = req.body;

    /**
     * A new campaign is not live.
     *
     * `draft` when the brand is still working on it, `pending_review` when they
     * are submitting it now. Neither is discoverable by creators — the campaign
     * becomes visible only when a reviewer approves it.
     */
    const submitting = b.submit !== false;

    const campaign = await Campaign.create({
        brand: req.auth.sub,
        title: b.title,
        brief: b.brief ?? '',
        contentTypes: b.contentTypes,
        budget: b.budget,
        location: b.location || 'India',
        tags: b.tags,
        deadline: b.deadline ? new Date(b.deadline) : undefined,
        status: submitting ? 'pending_review' : 'draft',
        review: submitting
            ? { submittedAt: new Date(), submissionCount: 1 }
            : { submissionCount: 0 },
    });

    created(res, campaign);
});

/**
 * Submit a draft or a rejected campaign for review.
 *
 * Separate from `updateCampaign` so that saving an edit and asking for review
 * are distinct acts — a brand fixing a rejection reason over several sittings
 * should not re-enter the queue on every keystroke, and each entry increments
 * `submissionCount`, which is what a reviewer uses to spot a campaign being
 * pushed through repeatedly.
 */
export const submitCampaignForReview = catchAsync(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) throw ApiError.notFound('Campaign not found');
    if (campaign.brand.toString() !== req.auth.sub) throw ApiError.forbidden();

    if (!['draft', 'rejected'].includes(campaign.status)) {
        throw ApiError.unprocessable(
            campaign.status === 'pending_review'
                ? 'This campaign is already waiting for review.'
                : `A ${campaign.status} campaign cannot be submitted for review.`,
        );
    }

    campaign.status = 'pending_review';
    campaign.review = {
        ...(campaign.review?.toObject?.() ?? campaign.review ?? {}),
        submittedAt: new Date(),
        submissionCount: (campaign.review?.submissionCount ?? 0) + 1,
        // The previous decision is cleared so a stale rejection reason is never
        // shown next to a campaign that is now waiting.
        decidedAt: undefined,
        decidedBy: undefined,
        reason: undefined,
    };
    await campaign.save();

    ok(res, campaign);
});

/** Browse open campaigns (creator-facing, optionally filtered to one brand) or
 * list the requesting brand's own (brand-facing). */
export const listCampaigns = catchAsync(async (req, res) => {
    let filter;
    if (req.auth.role === 'brand') {
        // A brand sees its own campaigns in every state, including drafts and
        // rejections — that list is where it acts on a review decision.
        filter = { brand: req.auth.sub };
        if (req.query.status) filter.status = req.query.status;
    } else {
        /**
         * Creators see approved campaigns only.
         *
         * The status list is imported rather than written inline so that adding
         * a state to the model cannot silently expose it here — which is
         * exactly how a `pending_review` campaign would leak into discovery.
         */
        filter = { status: { $in: CREATOR_VISIBLE_STATUSES } };
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
    const isAdmin = req.auth.role === 'admin';

    if (!isOwner && !isAdmin) {
        /**
         * Filtering the *list* is not enough — a campaign id is guessable and
         * shareable, so an unapproved campaign fetched directly would be
         * readable by anyone. A creator gets 404 rather than 403: whether a
         * pending campaign exists is itself not their business.
         */
        if (!CREATOR_VISIBLE_STATUSES.includes(campaign.status))
            throw ApiError.notFound('Campaign not found');

        const mine = campaign.applicants?.find((a) => a.creator.toString() === req.auth.sub) ?? null;
        delete campaign.applicants;
        campaign.myApplication = mine;
        campaign.applicantCount = undefined;
        // Review notes are between the brand and Marqueiver.
        delete campaign.review;
    }
    ok(res, campaign);
});

/**
 * A brand may edit content, and may close its own campaign. It may NOT set the
 * status to anything else.
 *
 * `status` used to be `z.enum(['open','closed'])` and was applied with a blind
 * `Object.assign`, so a brand could PATCH `{ status: 'open' }` and publish its
 * own campaign without review — which would make the entire approval queue
 * decorative. Publication is a decision only a reviewer can make, so `open` is
 * not offered here at all.
 */
export const updateCampaignSchema = z.object({
    title: z.string().min(3).optional(),
    brief: z.string().max(2000).optional(),
    budget: z.number().min(0).optional(),
    contentTypes: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    location: z.string().optional(),
    deadline: z.string().optional(),
    // Closing early is the brand's own call; reopening is not.
    status: z.literal('closed').optional(),
}).strict();

export const updateCampaign = catchAsync(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) throw ApiError.notFound('Campaign not found');
    if (campaign.brand.toString() !== req.auth.sub) throw ApiError.forbidden();

    const { status, deadline, ...content } = req.body;

    /**
     * Content is frozen once a campaign is live.
     *
     * Creators apply against what they were shown; letting the brief or the
     * budget change underneath an open campaign would rewrite the terms of
     * applications already submitted. To change a live campaign, close it and
     * submit a new one.
     */
    if (Object.keys(content).length || deadline !== undefined) {
        if (!CAMPAIGN_EDITABLE_STATUSES.includes(campaign.status)) {
            throw ApiError.unprocessable(
                `A ${campaign.status} campaign cannot be edited — creators have already seen these terms. `
                + 'Close it and create a new campaign instead.',
            );
        }
        Object.assign(campaign, content);
        if (deadline !== undefined) campaign.deadline = deadline ? new Date(deadline) : undefined;
    }

    if (status === 'closed') {
        if (!['open', 'pending_review', 'draft'].includes(campaign.status))
            throw ApiError.unprocessable(`A ${campaign.status} campaign cannot be closed`);
        campaign.status = 'closed';
    }

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
    /**
     * Only an approved campaign accepts applications.
     *
     * `open` is now one of five states, so the old `!== 'open'` message ("this
     * campaign is closed") would have been wrong for four of them — and a
     * creator must not learn that an unapproved campaign exists at all, hence
     * 404 rather than a status-specific refusal.
     */
    if (!CREATOR_VISIBLE_STATUSES.includes(campaign.status)) {
        if (campaign.status === 'closed')
            throw ApiError.unprocessable('This campaign is no longer accepting applications');
        throw ApiError.notFound('Campaign not found');
    }

    const existing = campaign.applicants.find((a) => a.creator.toString() === req.auth.sub);
    if (existing)
        throw new ApiError(409, 'ALREADY_APPLIED', 'You have already applied to this campaign');

    // The deal that this application produces. Terms come from the campaign
    // budget as the opening position; nothing is agreed until an offer is
    // accepted and both parties confirm (§5).
    /**
     * No commission is computed here, and none is stored.
     *
     * Policy 14.7 fixes the applicable rate at the point of *acceptance*, not
     * at application — a creator applying today and accepting next month is
     * charged the rate they saw when they accepted. `terms.service.js`
     * snapshots it onto `deal.commission.ratePct` at that moment, and every
     * later calculation reads that snapshot back.
     *
     * What was here before wrote a `fees` block from platformFee.js. That block
     * was never declared on the Deal schema, so Mongoose's strict mode dropped
     * it on every write: the numbers were computed, assigned, and silently
     * discarded. Nothing ever read them back.
     *
     * `escrow.amount` is the agreed value and nothing more (Policy 14.5) — the
     * brand funds the collaboration value; the commission comes out of the
     * creator's side at release.
     */
    const budget = campaign.budget ?? 0;
    const deal = await Deal.create({
        brand: campaign.brand,
        creator: req.auth.sub,
        campaign: campaign._id,
        title: campaign.title,
        state: 'invitation',
        requestedBy: 'creator',
        terms: {
            amount: budget,
            deliverables: (campaign.contentTypes ?? []).join(', '),
            deadline: campaign.deadline,
            revisionsAllowed: INCLUDED_REVISIONS,
        },
        escrow: { amount: budget },
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

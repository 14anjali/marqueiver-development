import { z } from 'zod';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok, created } from '../../utils/respond.js';
import { Campaign, CreatorProfile, Deal, User, Verification } from '../../models/index.js';
import {
    CREATOR_VISIBLE_STATUSES, CAMPAIGN_EDITABLE_STATUSES,
    BRAND_DECISION_STATUSES, TERMINAL_APPLICATION_STATUSES,
    normaliseApplicationStatus,
} from '../../models/Campaign.js';
import {
    briefSchema, draftIssues, publishReadiness, deriveContentTypes,
} from './campaignBrief.schema.js';
import { brandSummariesFor, brandSummaryFor } from './brandSummary.service.js';
import {
    applicationSchema, validateAgainstCampaign, pruneAnswers,
} from './application.schema.js';
import { creatorEligibility, applicationWindow } from './campaignEligibility.service.js';
import { INCLUDED_REVISIONS } from '../../models/Deal.js';
import { notify } from '../notifications/notifications.service.js';
import { openThread } from '../deals/negotiation.service.js';
import { transitionDeal } from '../deals/deals.service.js';

/** Re-exported so `campaigns.routes.js` wires validation from one module. */
export { applicationSchema };

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

/**
 * The wizard's own fields, on top of the structured brief.
 *
 * `budget` and `deadline` are here rather than inside the brief because they
 * predate it and the rest of the product reads them — see the comments on the
 * model. The wizard's "Creator fee" and "Deliverable deadline" inputs write
 * these two, so there is one copy of each number, not two.
 */
const coreFields = {
    title: z.string().trim().min(3).max(120),
    brief: z.string().max(2000),
    budget: z.number().min(0),
    location: z.string().trim().max(80),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    deadline: z.string().nullable(),
};

export const createCampaignSchema = briefSchema.extend({
    title: coreFields.title,
    brief: coreFields.brief.optional(),
    /**
     * Still accepted, still ignored on write: `contentTypes` is derived from
     * `deliverables`. Kept in the schema because the object is `.strict()`
     * elsewhere and an older client may still send it — refusing a request over
     * a field the server computes itself would be a breaking change for no gain.
     */
    contentTypes: z.array(z.string()).optional(),
    budget: coreFields.budget.optional(),
    location: coreFields.location.optional(),
    tags: coreFields.tags.optional(),
    deadline: coreFields.deadline.optional(),
    /** false keeps it as a draft; anything else submits it for review. */
    submit: z.boolean().optional(),
});

/**
 * Fold a validated payload onto a campaign document.
 *
 * Nested groups are merged rather than replaced: the wizard autosaves one
 * section at a time, so a save from Section D that carried a bare
 * `{ commercials: { creatorCount: 3 } }` would otherwise wipe the product and
 * travel blocks the brand filled in a minute earlier.
 *
 * Arrays are the exception — they are replaced wholesale, because removing the
 * third deliverable has to be expressible, and a merge cannot express a
 * deletion.
 */
const GROUPS = ['guidelines', 'creatorRequirements', 'commercials', 'schedule', 'usageRights', 'extras'];

function applyBrief(campaign, body) {
    for (const key of ['title', 'brief', 'budget', 'location', 'tags', 'category', 'objective', 'images', 'platforms']) {
        if (body[key] !== undefined) campaign[key] = body[key];
    }

    if (body.deadline !== undefined) {
        campaign.deadline = body.deadline ? new Date(body.deadline) : undefined;
    }

    if (body.deliverables !== undefined) {
        campaign.deliverables = body.deliverables;
        // Derived on every write so the flat list the rest of the product reads
        // can never disagree with the structured one.
        campaign.contentTypes = deriveContentTypes(body.deliverables);
    }

    for (const group of GROUPS) {
        if (body[group] === undefined) continue;
        campaign.set(group, mergeGroup(campaign.get(group), body[group]));
    }
}

/** One level of merge, deep enough for the nested blocks the brief actually has. */
function mergeGroup(current, incoming) {
    const base = current?.toObject?.() ?? current ?? {};
    const out = { ...base };
    for (const [k, v] of Object.entries(incoming)) {
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            out[k] = { ...(base[k]?.toObject?.() ?? base[k] ?? {}), ...v };
        } else {
            out[k] = v;
        }
    }
    return out;
}

/**
 * Contradictions are refused even on a draft.
 *
 * Not completeness — a draft is allowed to be as unfinished as the brand likes.
 * These are the values that are wrong whatever else gets filled in later: a
 * timeline that runs backwards, a minimum above its maximum, a deliverable on a
 * platform the campaign does not use.
 */
function assertDraftIsCoherent(campaign) {
    const issues = draftIssues(campaign.toObject ? campaign.toObject() : campaign);
    if (issues.length) throw ApiError.unprocessable(issues[0], { issues });
}

export const createCampaign = catchAsync(async (req, res) => {
    if (req.auth.role !== 'brand') throw ApiError.forbidden('Only brands can create campaigns');
    const b = req.body;

    /**
     * A new campaign is not live.
     *
     * `draft` when the brand is still working on it, `pending_review` when they
     * are submitting it now. Neither is discoverable by creators — the campaign
     * becomes visible only when a reviewer approves it. The wizard's "Publish"
     * is this submission: Marqueiver's review stands between a finished brief
     * and a live one, and the wizard says so rather than implying instant
     * publication.
     */
    const submitting = b.submit === true;

    const campaign = new Campaign({ brand: req.auth.sub, location: 'India' });
    applyBrief(campaign, b);
    assertDraftIsCoherent(campaign);

    if (submitting) {
        assertPublishable(campaign);
        campaign.status = 'pending_review';
        campaign.review = { submittedAt: new Date(), submissionCount: 1 };
    } else {
        campaign.status = 'draft';
        campaign.review = { submissionCount: 0 };
    }

    await campaign.save();
    created(res, campaign);
});

/** The publish gate, in one place so create and submit cannot diverge. */
function assertPublishable(campaign) {
    const readiness = publishReadiness(campaign.toObject ? campaign.toObject() : campaign);
    if (!readiness.ready) {
        throw ApiError.unprocessable(
            'This campaign is not ready to publish yet.',
            { blocking: readiness.blocking, sections: readiness.sections },
        );
    }
}

/**
 * What is still missing before this campaign can be published.
 *
 * The wizard's review step reads this rather than recomputing completeness, so
 * "ready to publish" means the same thing on both sides of the wire. Owner-only:
 * it describes an unpublished campaign.
 */
export const getPublishReadiness = catchAsync(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) throw ApiError.notFound('Campaign not found');
    if (campaign.brand.toString() !== req.auth.sub) throw ApiError.forbidden();
    ok(res, publishReadiness(campaign));
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

    /**
     * The publish gate.
     *
     * A campaign a creator cannot act on must not reach the review queue: no
     * deliverables, no fee, no deadline means a reviewer rejecting it and a
     * brand waiting a day to find out what the wizard could have told them
     * immediately. The wizard shows the same list — it reads
     * `GET /:id/readiness`, which calls the same function — so this is the
     * backstop rather than the first time the brand hears about it.
     */
    assertPublishable(campaign);

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
        Object.assign(filter, discoveryFilters(req.query));
    }
    const items = await Campaign.find(filter).sort({ createdAt: -1 }).limit(100).lean();

    if (req.auth.role === 'brand') return ok(res, items);

    /**
     * Creators get three things the raw document does not carry.
     *
     *  - `myApplication`, so the browse list renders Applied/Accepted from
     *    server data rather than from local React state that dies on refresh.
     *  - `brandSummary`, so a card can show who is asking and whether they are
     *    verified — a campaign stores only the brand's User id.
     *  - `applicationWindow`, so a campaign whose deadline has passed says so
     *    instead of offering an Apply button that leads nowhere useful.
     *
     * The brand summaries are fetched in one batch for the whole page; a
     * lookup per campaign would be forty queries on a page of twenty.
     */
    const summaries = await brandSummariesFor(items);

    const shaped = items.map((c) => {
        const mine = c.applicants?.find((a) => a.creator.toString() === req.auth.sub) ?? null;
        const { applicants, review, ...rest } = c;
        return {
            ...rest,
            myApplication: mine ? shapeApplication(mine) : null,
            brandSummary: summaries.get(String(c.brand)) ?? null,
            applicationWindow: applicationWindow(c),
        };
    });
    ok(res, shaped);
});

/**
 * The creator-facing search and filters.
 *
 * Built onto the existing `GET /api/campaigns` rather than a second discovery
 * endpoint: the visibility rule that keeps unapproved campaigns invisible lives
 * in that handler, and a parallel endpoint is how a second copy of that rule
 * ends up drifting from the first.
 *
 * Every clause is additive to the status filter, never a replacement for it —
 * `Object.assign` onto the caller's filter cannot remove the status constraint,
 * and a test asserts that.
 */
function discoveryFilters(query = {}) {
    const filter = {};

    const q = String(query.q ?? '').trim();
    if (q) {
        // No text index exists on Campaign, so this is a case-insensitive
        // match on the two fields a creator actually searches by. Escaped,
        // because an unescaped "(" from a search box is a thrown error.
        const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(safe, 'i');
        filter.$or = [{ title: rx }, { brief: rx }, { tags: rx }];
    }

    if (query.category) filter.category = String(query.category);
    if (query.platform) filter.platforms = String(query.platform);

    const min = Number(query.minBudget);
    const max = Number(query.maxBudget);
    if (Number.isFinite(min) || Number.isFinite(max)) {
        filter.budget = {
            ...(Number.isFinite(min) ? { $gte: min } : {}),
            ...(Number.isFinite(max) ? { $lte: max } : {}),
        };
    }

    return filter;
}

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
        // `review` is Marqueiver's correspondence with the brand, not the
        // creator's — the same rule getCampaign applies.
        const { applicants, review, ...rest } = c;
        return { ...rest, myApplication: mine ? shapeApplication(mine) : null };
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
        campaign.myApplication = mine ? shapeApplication(mine) : null;
        campaign.applicantCount = undefined;
        // Review notes are between the brand and Marqueiver.
        delete campaign.review;

        /**
         * Everything the creator needs to decide whether to apply, answered
         * here rather than in the browser.
         *
         * `eligibility` is advisory — see `campaignEligibility.service.js`.
         * Nothing in it blocks an application, and `applyToCampaign` is
         * unchanged: the brand decides who it works with, and a creator just
         * under a follower floor may still be exactly who it wants.
         */
        const [summary, profile, user] = await Promise.all([
            brandSummaryFor(campaign.brand),
            CreatorProfile.findOne({ user: req.auth.sub }).lean(),
            User.findById(req.auth.sub).select('phoneVerified emailVerified').lean(),
        ]);

        const verifiedSocial = await Verification.exists({
            subject: req.auth.sub, kind: 'social', status: 'approved',
        });

        campaign.brandSummary = summary;
        campaign.applicationWindow = applicationWindow(campaign);
        campaign.eligibility = creatorEligibility(campaign, profile, user, {
            verifiedSocial: Boolean(verifiedSocial),
        });
    } else {
        // The owner sees who is asking too — the same summary, so the brand's
        // own preview and the creator's view render from one shape.
        campaign.brandSummary = await brandSummaryFor(campaign.brand);
        campaign.applicationWindow = applicationWindow(campaign);
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
export const updateCampaignSchema = briefSchema.extend({
    title: coreFields.title.optional(),
    brief: coreFields.brief.optional(),
    budget: coreFields.budget.optional(),
    /** Accepted and ignored — derived from `deliverables`. See createCampaignSchema. */
    contentTypes: z.array(z.string()).optional(),
    tags: coreFields.tags.optional(),
    location: coreFields.location.optional(),
    deadline: coreFields.deadline.optional(),
    // Closing early is the brand's own call; reopening is not.
    status: z.literal('closed').optional(),
}).strict();

export const updateCampaign = catchAsync(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) throw ApiError.notFound('Campaign not found');
    if (campaign.brand.toString() !== req.auth.sub) throw ApiError.forbidden();

    const { status, ...content } = req.body;

    /**
     * Content is frozen once a campaign is live.
     *
     * Creators apply against what they were shown; letting the brief or the
     * budget change underneath an open campaign would rewrite the terms of
     * applications already submitted. To change a live campaign, close it and
     * submit a new one.
     */
    if (Object.keys(content).length) {
        if (!CAMPAIGN_EDITABLE_STATUSES.includes(campaign.status)) {
            throw ApiError.unprocessable(
                `A ${campaign.status} campaign cannot be edited — creators have already seen these terms. `
                + 'Close it and create a new campaign instead.',
            );
        }
        applyBrief(campaign, content);
        assertDraftIsCoherent(campaign);
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

    /**
     * One application per creator per campaign, withdrawn ones included.
     *
     * A withdrawal is a decision the brand may already have seen, so letting a
     * creator withdraw and re-apply would be a way to erase it. The message
     * says which case this is, because "you have already applied" is confusing
     * to someone who remembers withdrawing.
     */
    const existing = campaign.applicants.find((a) => a.creator.toString() === req.auth.sub);
    if (existing) {
        throw new ApiError(409, 'ALREADY_APPLIED',
            normaliseApplicationStatus(existing.status) === 'withdrawn'
                ? 'You withdrew from this campaign. An application cannot be sent again.'
                : 'You have already applied to this campaign');
    }

    // Shape and cross-field checks that need the campaign itself: which
    // questions exist, which are required, and whether a price may be proposed.
    const problems = validateAgainstCampaign(req.body ?? {}, campaign);
    if (problems.length) throw ApiError.unprocessable(problems[0], { problems });

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

    const body = req.body ?? {};
    campaign.applicants.push({
        creator: req.auth.sub,
        status: 'applied',
        deal: deal._id,
        submission: {
            pitch: body.pitch ?? '',
            // Only kept when the campaign takes one — validation has already
            // refused a price on a fixed-fee campaign, so this is the shape
            // guard rather than the rule.
            proposedPrice: campaign.commercials?.allowProposedPrice === false
                ? null
                : (body.proposedPrice ?? null),
            portfolioLinks: body.portfolioLinks ?? [],
            attachments: body.attachments ?? [],
            answers: pruneAnswers(body.answers, campaign),
        },
        history: [{
            status: 'applied', at: new Date(), by: req.auth.sub, byRole: 'creator',
        }],
    });

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

    const saved = campaign.applicants[campaign.applicants.length - 1];
    created(res, { applied: true, application: shapeApplication(saved) });
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
/**
 * The brand moves an application along.
 *
 * Four destinations, and only two of them touch the Deal:
 *
 *  - `under_review` and `shortlisted` are the brand saying where a creator
 *    stands. The deal stays exactly where it is, because nothing has been
 *    agreed — these exist so "we are looking at it" is a thing a creator can
 *    be told rather than something they have to infer from silence.
 *  - `selected` is the receiving party accepting the requested deal (§2/§3):
 *    it moves the deal to `negotiation` and opens the thread, which is what
 *    `accepted` did before and still does under its old name.
 *  - `rejected` declines the deal.
 *
 * `accepted` is still accepted as an input spelling so an older client, or a
 * request written against the previous API, keeps working.
 */
export const decideApplicantSchema = z.object({
    status: z.enum([...BRAND_DECISION_STATUSES, 'accepted']),
    /** Shown to the creator on their status timeline, verbatim. */
    message: z.string().trim().max(500).optional(),
});

export const decideApplicant = catchAsync(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) throw ApiError.notFound('Campaign not found');
    if (campaign.brand.toString() !== req.auth.sub) throw ApiError.forbidden();

    const applicant = campaign.applicants.find((a) => a.creator.toString() === req.params.creatorId);
    if (!applicant) throw ApiError.notFound('Applicant not found');

    const current = normaliseApplicationStatus(applicant.status);
    const next = req.body.status === 'accepted' ? 'selected' : req.body.status;

    /**
     * A finished application does not move again.
     *
     * `selected` and `rejected` have already moved the Deal, and `withdrawn` is
     * the creator's decision — a brand overriding it would be deciding on
     * behalf of someone who has left.
     */
    if (TERMINAL_APPLICATION_STATUSES.includes(current)) {
        throw ApiError.unprocessable(
            current === 'withdrawn'
                ? 'This creator withdrew their application.'
                : `This application is already ${current.replace('_', ' ')}.`,
        );
    }
    if (current === next) {
        throw ApiError.unprocessable(`This application is already ${next.replace('_', ' ')}.`);
    }

    applicant.status = next;
    if (TERMINAL_APPLICATION_STATUSES.includes(next)) applicant.decidedAt = new Date();
    applicant.history.push({
        status: next,
        at: new Date(),
        by: req.auth.sub,
        byRole: 'brand',
        message: req.body.message ?? '',
    });
    await campaign.save();

    let deal = applicant.deal ? await Deal.findById(applicant.deal) : null;

    // Only the two terminal decisions are deal transitions. A shortlist is not
    // an agreement, and moving the deal on one would let a brand skip §3.
    if (deal && next === 'selected') {
        deal = await transitionDeal({
            dealId: deal.id, to: 'negotiation', actor: 'brand', actorId: req.auth.sub,
            note: `Application selected for "${campaign.title}"`,
        });
        await openThread({ deal, actorId: req.auth.sub, actorRole: 'brand' });
    } else if (deal && next === 'rejected') {
        deal = await transitionDeal({
            dealId: deal.id, to: 'declined', actor: 'brand', actorId: req.auth.sub,
            note: `Application rejected for "${campaign.title}"`,
        });
    }

    const NOTICE = {
        under_review: {
            title: 'Your application is being reviewed',
            body: `"${campaign.title}" — the brand is looking at your application.`,
        },
        shortlisted: {
            title: 'You have been shortlisted',
            body: `"${campaign.title}" — you are on the brand's shortlist.`,
        },
        selected: {
            title: 'You have been selected',
            body: `Your application to "${campaign.title}" was selected. Negotiation is open — send or review an offer.`,
        },
        rejected: {
            title: 'Application update',
            body: `Your application to "${campaign.title}" was not taken forward.`,
        },
    }[next];

    await notify({
        user: req.params.creatorId,
        type: `campaign.${next}`,
        title: NOTICE.title,
        body: req.body.message ? `${NOTICE.body} ${req.body.message}` : NOTICE.body,
        data: { campaignId: campaign.id, dealId: deal?.id },
    }).catch(() => void 0);

    ok(res, { campaign, deal });
});

/**
 * A creator withdraws.
 *
 * Allowed until the application is decided: once a brand has selected or
 * rejected it, the deal has moved and withdrawing would leave the two
 * disagreeing. The produced deal is declined by the creator, which the state
 * machine already permits from `invitation` and `negotiation`.
 *
 * The row is kept rather than deleted. A withdrawal the brand already saw is
 * part of the record, and deleting it would let a creator withdraw and
 * re-apply to erase it.
 */
export const withdrawApplicationSchema = z.object({
    reason: z.string().trim().max(500).optional(),
});

export const withdrawApplication = catchAsync(async (req, res) => {
    if (req.auth.role !== 'creator') throw ApiError.forbidden('Creators only');

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) throw ApiError.notFound('Campaign not found');

    const applicant = campaign.applicants.find((a) => a.creator.toString() === req.auth.sub);
    if (!applicant) throw ApiError.notFound('You have not applied to this campaign');

    const current = normaliseApplicationStatus(applicant.status);
    if (TERMINAL_APPLICATION_STATUSES.includes(current)) {
        throw ApiError.unprocessable(
            current === 'withdrawn'
                ? 'You have already withdrawn this application.'
                : `This application has already been ${current}. Speak to the brand instead.`,
        );
    }

    applicant.status = 'withdrawn';
    applicant.withdrawnAt = new Date();
    applicant.history.push({
        status: 'withdrawn',
        at: new Date(),
        by: req.auth.sub,
        byRole: 'creator',
        message: req.body?.reason ?? '',
    });
    await campaign.save();

    let deal = applicant.deal ? await Deal.findById(applicant.deal) : null;
    if (deal && ['invitation', 'negotiation'].includes(deal.state)) {
        deal = await transitionDeal({
            dealId: deal.id, to: 'declined', actor: 'creator', actorId: req.auth.sub,
            note: `Application withdrawn for "${campaign.title}"`,
        });
    }

    await notify({
        user: campaign.brand.toString(),
        type: 'campaign.withdrawn',
        title: 'An applicant withdrew',
        body: `A creator withdrew their application to "${campaign.title}".`,
        data: { campaignId: campaign.id, dealId: deal?.id },
    }).catch(() => void 0);

    ok(res, { withdrawn: true, application: shapeApplication(applicant) });
});

/** One application, in the shape the creator's tracker renders. */
function shapeApplication(applicant) {
    const raw = applicant.toObject ? applicant.toObject() : applicant;
    return {
        ...raw,
        status: normaliseApplicationStatus(raw.status),
        history: (raw.history ?? []).map((h) => ({ ...h, status: normaliseApplicationStatus(h.status) })),
    };
}

/**
 * Everything the brand's review card shows about a creator — and nothing else.
 *
 * An allow-list, not a `-field` subtraction. `discovery.controller.js` removes
 * `payoutMethod`, `pan`, `phone`, `email` and `kyc` from creator reads, and
 * that is the right boundary; naming the fields wanted rather than the fields
 * feared means a sensitive field added to CreatorProfile tomorrow cannot arrive
 * here by default.
 *
 * `contactEmail` and `contactPhone` are deliberately absent too. Policy 4.2
 * exists so a collaboration stays on the platform, and handing a brand a
 * creator's direct line at the application stage is exactly how it does not.
 */
const APPLICANT_PROFILE_FIELDS = [
    'user', 'displayName', 'headline', 'bio', 'avatarUrl',
    'categories', 'languages', 'location', 'availability',
    'socialAccounts', 'totalAudience', 'avgEngagement', 'creatorScore',
    'portfolio', 'portfolioLink', 'contentTypes', 'collaborationTypes',
].join(' ');

/**
 * Applicants for the brand's own campaign, filtered and sorted.
 *
 * The list is the brand's review queue, so it answers the two questions a
 * reviewer actually has — who is in which state, and who is worth reading
 * first — rather than returning everything in insertion order and leaving the
 * browser to sort a payload it may only have part of.
 */
export const listApplicants = catchAsync(async (req, res) => {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) throw ApiError.notFound('Campaign not found');
    if (campaign.brand.toString() !== req.auth.sub) throw ApiError.forbidden();

    const creatorIds = campaign.applicants.map((a) => a.creator);

    const [profiles, users, socialVerifications] = await Promise.all([
        CreatorProfile.find({ user: { $in: creatorIds } }).select(APPLICANT_PROFILE_FIELDS).lean(),
        // Policy 13.1 Basic is a verified mobile and email. The documents behind
        // any verification are never read here and never shown to a brand.
        User.find({ _id: { $in: creatorIds } }).select('phoneVerified emailVerified').lean(),
        Verification.find({
            subject: { $in: creatorIds }, kind: 'social', status: 'approved',
        }).select('subject').lean(),
    ]);

    const byUser = new Map(profiles.map((p) => [String(p.user), p]));
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const socialVerified = new Set(socialVerifications.map((v) => String(v.subject)));

    let items = campaign.applicants.map((a) => {
        const id = String(a.creator);
        const user = userById.get(id);
        return {
            ...shapeApplication(a),
            profile: byUser.get(id) ?? null,
            verification: {
                identity: Boolean(user?.phoneVerified && user?.emailVerified),
                social: socialVerified.has(id),
            },
        };
    });

    if (req.query.status) {
        const wanted = String(req.query.status);
        items = items.filter((a) => a.status === wanted);
    }

    const SORTS = {
        // Newest first is the default: a reviewer works through what arrived.
        recent: (a, b) => new Date(b.appliedAt ?? 0) - new Date(a.appliedAt ?? 0),
        oldest: (a, b) => new Date(a.appliedAt ?? 0) - new Date(b.appliedAt ?? 0),
        followers: (a, b) => (b.profile?.totalAudience ?? 0) - (a.profile?.totalAudience ?? 0),
        engagement: (a, b) => (b.profile?.avgEngagement ?? 0) - (a.profile?.avgEngagement ?? 0),
        // Ascending: the cheapest proposal first. An application with no price
        // sorts last rather than as zero, which would put it at the top.
        price: (a, b) => (a.submission?.proposedPrice ?? Infinity) - (b.submission?.proposedPrice ?? Infinity),
    };
    items.sort(SORTS[req.query.sort] ?? SORTS.recent);

    /** Counts for every status, so the tabs do not lie when a filter is on. */
    const counts = campaign.applicants.reduce((acc, a) => {
        const status = normaliseApplicationStatus(a.status);
        acc[status] = (acc[status] ?? 0) + 1;
        return acc;
    }, {});

    ok(res, items, { counts, total: campaign.applicants.length });
});
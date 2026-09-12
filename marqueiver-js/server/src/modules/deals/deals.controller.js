import { z } from 'zod';
import { Types } from 'mongoose';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok, created } from '../../utils/respond.js';
import { Deal, User, CreatorProfile, BrandProfile, Campaign, Offer } from '../../models/index.js';
import { INCLUDED_REVISIONS } from '../../models/Deal.js';
import {
    transitionDeal, listDealsForUser, createPaymentSession,
    markPaymentInitiated, paymentRecords,
} from './deals.service.js';
import { canRequestRevision, canCancel, REVIEW_WINDOW_DAYS, RESOLUTION_AUTO_DAYS } from './dealStateMachine.js';
import { brandCancellationOutcome, creatorCancellationOutcome } from '../../services/commission.service.js';
import * as additionalTerms from './additionalTerms.service.js';
import { postOffer, acceptOffer, rejectOffer, rejectDeal, confirmTerms, threadForDeal } from './negotiation.service.js';
import {
    proposeChange as changeRequest_propose,
    respondToChange as changeRequest_respond,
    withdrawChange as changeRequest_withdraw,
    changeHistory as changeRequest_history,
} from './changeRequest.service.js';
import {
    agreedDeliverables, deliverableProgress, toSubmissionFile,
    allDeliverablesApproved, outstandingDeliverables,
} from './deliverables.service.js';
import { notify, dealPayload } from '../notifications/notifications.service.js';
import { DEAL_STATES } from '../../../../shared/types.js';
/**
 * Route 2's entry point: a brand found a creator in discovery and is sending
 * them a requirement.
 *
 * ── One collaboration workflow, two ways in ────────────────────────────────
 *
 * This deliberately creates the same Deal, in the same opening state, running
 * the same state machine as an application does. The only differences are the
 * two fields that record how it started:
 *
 *   Route 1  creator applies   →  origin 'application', requestedBy 'creator'
 *   Route 2  brand invites     →  origin 'invite',      requestedBy 'brand'
 *
 * Everything after that — negotiation, escrow, submission, revisions,
 * resolution, release — is shared. `requestedBy` is what makes the handshake
 * symmetric: `openThread` requires the *receiving* party to accept, so a brand
 * cannot invite a creator and then negotiate with itself, exactly as a creator
 * cannot apply and open negotiation without the brand selecting them.
 *
 * ── What a requirement now carries ─────────────────────────────────────────
 *
 * It used to carry almost nothing. The profile page sent a generated title, the
 * creator's cheapest rate-card line as the amount and the literal string "To be
 * agreed during negotiation" as the deliverables, so every direct invitation
 * arrived identical and said nothing about the work. A creator cannot accept or
 * decline a brief they cannot read, which is what the brief fields below are
 * for — and usage rights are part of scope under Policy 8, so they belong in
 * the requirement rather than being discovered after acceptance.
 */
export const createDealSchema = z.object({
    creatorId: z.string(),
    title: z.string().min(3).max(140),
    contentTypes: z.array(z.string().max(40)).max(10).default([]),
    amount: z.number().min(0),
    /**
     * The brief itself. Required and non-trivial: this is the thing the creator
     * is being asked to say yes or no to.
     */
    deliverables: z.string().min(20).max(4000),
    deadline: z.string().optional(),
    revisionsAllowed: z.number().min(0).max(10).default(INCLUDED_REVISIONS),
    /** A note to the creator, alongside the brief. */
    message: z.string().max(1000).optional(),
    /** Optional: the campaign this requirement belongs to, for the brand's own records. */
    campaignId: z.string().optional(),
    /** Policy 8 — scope, agreed up front rather than assumed afterwards. */
    usageRights: z.object({
        licenceType: z.enum(['default', 'extended', 'full_assignment']).optional(),
        durationMonths: z.number().int().min(1).max(120).optional(),
        paidAdvertising: z.boolean().optional(),
        whitelisting: z.boolean().optional(),
        modificationAllowed: z.boolean().optional(),
        notes: z.string().max(1000).optional(),
    }).optional(),
    exclusivity: z.string().max(500).optional(),
}).strict();

/** States in which an invitation is still live, so a second one would be noise. */
const OPEN_DEAL_STATES = DEAL_STATES.filter(
    (s) => !['declined', 'cancelled', 'completed'].includes(s),
);

export const createDeal = catchAsync(async (req, res) => {
    if (req.auth.role !== 'brand')
        throw ApiError.forbidden('Only brands can invite');
    const b = req.body;

    /**
     * The creator was never validated. `creatorId` went straight into the Deal,
     * so an id belonging to a brand, an admin, a deleted account or nothing at
     * all created a real collaboration pointing at it — and the resulting deal
     * could reach escrow with no creator able to act on it.
     */
    const creator = await User.findById(b.creatorId).select('role status').lean()
        .catch(() => null);
    if (!creator || creator.role !== 'creator')
        throw ApiError.notFound('Creator not found');

    /*
      Policy 3.3 — an unpublished creator has withdrawn from discovery. Existing
      collaborations continue, but they are not open to new approaches.
    */
    const profile = await CreatorProfile.findOne({ user: b.creatorId })
        .select('isPublished displayName').lean();
    if (!profile)
        throw ApiError.notFound('Creator not found');
    if (profile.isPublished === false)
        throw ApiError.unprocessable('This creator is not currently accepting new requests');

    /**
     * One live approach at a time. Without this, the confirm button double-firing
     * — or a brand returning to the profile a week later having forgotten —
     * produces two collaborations for one piece of work, and the creator has to
     * guess which one to accept. A finished or declined one does not block a
     * fresh approach: brands and creators do work together again.
     */
    const existing = await Deal.findOne({
        brand: req.auth.sub,
        creator: b.creatorId,
        state: { $in: OPEN_DEAL_STATES },
    }).select('_id state title').lean();
    if (existing) {
        throw ApiError.conflict(
            `You already have a collaboration open with ${profile.displayName || 'this creator'}. `
            + 'Continue it rather than starting a second one.',
            { dealId: String(existing._id), state: existing.state },
        );
    }

    const deal = await Deal.create({
        brand: req.auth.sub,
        creator: b.creatorId,
        origin: 'invite',
        requestedBy: 'brand',
        campaign: b.campaignId || undefined,
        title: b.title,
        contentTypes: b.contentTypes,
        terms: {
            amount: b.amount,
            deliverables: b.deliverables,
            deadline: b.deadline ? new Date(b.deadline) : undefined,
            revisionsAllowed: b.revisionsAllowed,
        },
        ...(b.usageRights ? { usageRights: b.usageRights } : {}),
        ...(b.exclusivity ? { exclusivity: b.exclusivity } : {}),
        state: 'invitation',
        // Cleared rules §3 — an invitation is NOT the first negotiation offer.
        // Offers can only be posted once the receiving party accepts and the
        // deal reaches `negotiating`.
        offers: [],
        timeline: [{
            from: null, to: 'invitation', by: new Types.ObjectId(req.auth.sub),
            byRole: 'brand', at: new Date(),
            ...(b.message ? { note: b.message } : {}),
        }],
    });
    await notify({
        user: b.creatorId, type: 'deal.invited', title: 'New collaboration request',
        body: `You've been asked to work on "${b.title}".`, data: dealPayload(deal),
    }).catch(() => void 0);
    created(res, deal);
});
export const listMyDeals = catchAsync(async (req, res) => {
    const role = req.auth.role;
    if (role !== 'creator' && role !== 'brand')
        throw ApiError.forbidden();
    const state = req.query.state;
    const deals = await listDealsForUser(req.auth.sub, role, state);
    ok(res, deals);
});
/**
 * Who the parties are, as the other side may see them.
 *
 * Allow-lists, not subtractions — the same discipline as the applicant review
 * queue. A field added to either profile tomorrow does not reach the counterpart
 * by default, which is the whole reason these are named lists.
 *
 * Deliberately absent from both: contact details (Policy 4.2 keeps the work on
 * the platform), and on the creator side `payoutMethod`, `pan` and `kyc`
 * (Policy 2.4). The parties are already in a collaboration together — that
 * entitles each to know who the other is, not to their bank details.
 */
const BRAND_PARTY_FIELDS = 'user companyName logo tagline industry location website verifications';
const CREATOR_PARTY_FIELDS = 'user displayName avatarUrl headline location categories languages';

export const getDeal = catchAsync(async (req, res) => {
    // Not lean: deals predating offers[] get their opening offer written on
    // first read, so it has a real _id the accept/reject endpoints can address.
    const deal = await Deal.findById(req.params.id);
    if (!deal)
        throw ApiError.notFound();
    const isParty = [deal.brand.toString(), deal.creator.toString()].includes(req.auth.sub);
    if (!isParty && req.auth.role !== 'admin')
        throw ApiError.forbidden();

    /**
     * The workspace has to name the brand and the creator, and this returned
     * neither — `brand` and `creator` were raw ObjectIds, so the collaboration
     * screen could show a title and two ids. Batched, not fetched per field:
     * three queries regardless of how the page is rendered.
     */
    const [brand, creator, campaign] = await Promise.all([
        BrandProfile.findOne({ user: deal.brand }).select(BRAND_PARTY_FIELDS).lean(),
        CreatorProfile.findOne({ user: deal.creator }).select(CREATOR_PARTY_FIELDS).lean(),
        deal.campaign
            ? Campaign.findById(deal.campaign).select('title status category images').lean()
            : null,
    ]);

    ok(res, {
        ...deal.toObject(),
        parties: {
            /*
              `null` rather than an invented placeholder when a profile is
              missing. A deleted account is a real state, and "Unknown creator"
              is information the UI should decide how to show, not something
              this endpoint should make up.
            */
            brand: brand ?? null,
            creator: creator ?? null,
        },
        campaignSummary: campaign ?? null,
    });
});
/**
 * Real Cashfree Checkout session (feature: Frontend Cashfree Checkout).
 * Brand-only, deal must be 'accepted'. Returns paymentSessionId for the
 * Cashfree JS SDK; does not itself change the deal state — the frontend
 * calls the normal transition endpoint once Cashfree reports success.
 */
export const startPaymentSession = catchAsync(async (req, res) => {
    const result = await createPaymentSession(req.params.id, req.auth.sub);
    ok(res, result);
});
/** Generic transition endpoint — the state machine enforces legality. */
export const transitionSchema = z.object({
    to: z.enum(DEAL_STATES),
    note: z.string().optional(),
    disputeReason: z.string().optional(),
    payoutAccount: z.string().optional(),
});
export const transition = catchAsync(async (req, res) => {
    const b = req.body;
    const actor = req.auth.role === 'admin' ? 'admin' : req.auth.role;
    const deal = await transitionDeal({
        dealId: req.params.id,
        to: b.to,
        actor,
        actorId: req.auth.sub,
        note: b.note,
        disputeReason: b.disputeReason,
        payoutAccount: b.payoutAccount,
    });
    ok(res, deal);
});
/**
 * Creator submits one deliverable (transitions in_progress/revision → submitted).
 *
 * ── What a submission is now ───────────────────────────────────────────────
 *
 * It was a list of URLs and a note, which is what you send when there is nothing
 * to upload to. A submission now carries the work itself (uploaded files), where
 * it can be seen (links), the caption that will run with it, supporting files,
 * and a message — and it names WHICH agreed deliverable it is for.
 *
 * `.strict()`, and links and files are both optional individually but not
 * together: a submission with neither is an empty review request, and the brand's
 * clock starts on it either way.
 */
const submissionFileInput = z.object({
    url: z.string().url(),
    name: z.string().max(300).optional(),
    contentType: z.string().max(160).optional(),
    size: z.number().nonnegative().optional(),
});

export const submitWorkSchema = z.object({
    /** Which agreed deliverable. Optional — briefs without content items exist. */
    deliverableKey: z.string().max(200).optional(),
    urls: z.array(z.string().url()).max(10).default([]),
    files: z.array(submissionFileInput).max(20).default([]),
    supportingFiles: z.array(submissionFileInput).max(20).default([]),
    caption: z.string().max(4000).optional(),
    note: z.string().max(2000).optional(),
}).strict().refine(
    (b) => b.urls.length > 0 || b.files.length > 0,
    { message: 'Add the finished work — upload a file or add a link to it', path: ['urls'] },
);
export const submitWork = catchAsync(async (req, res) => {
    if (req.auth.role !== 'creator')
        throw ApiError.forbidden();
    const b = req.body;
    const deal = await Deal.findById(req.params.id);
    if (!deal)
        throw ApiError.notFound();
    if (deal.creator.toString() !== req.auth.sub)
        throw ApiError.forbidden();

    /**
     * Policy 15 — required advertising disclosure must be confirmed BEFORE the
     * deliverable can be submitted. Blocking here rather than warning, because
     * 15.5 makes non-disclosure a compliance failure the Platform must prevent,
     * not merely flag.
     */
    if (!deal.disclosure?.confirmedAt)
        throw new ApiError(422, 'DISCLOSURE_REQUIRED',
            'Confirm the advertising disclosure for this collaboration before submitting deliverables (Policy 15).');

    /**
     * Policy 11 — a post-deadline submission is still accepted; it is marked
     * late rather than blocked. "Late" is 24 hours past the agreed deadline.
     */
    const now = new Date();
    const late = Boolean(deal.terms?.deadline && now > new Date(deal.terms.deadline.getTime() + 24 * 3600 * 1000));

    /*
      Which deliverable this is for. The key is checked against the agreed list
      rather than trusted: a key that matches nothing would produce a submission
      that shows up nowhere, and the creator would believe they had delivered.
    */
    const agreed = agreedDeliverables(deal);
    let deliverable;
    if (b.deliverableKey) {
        const match = agreed.find((d) => d.key === b.deliverableKey);
        if (!match)
            throw ApiError.unprocessable('That deliverable is not part of the agreed brief');
        deliverable = {
            key: match.key, label: match.label,
            contentType: match.contentType, platform: match.platform,
        };
    } else if (agreed.length > 1) {
        // With one line there is nothing to choose. With several, an untagged
        // submission leaves the brand guessing what they are reviewing.
        throw ApiError.unprocessable('Say which deliverable this submission is for');
    } else if (agreed.length === 1) {
        deliverable = {
            key: agreed[0].key, label: agreed[0].label,
            contentType: agreed[0].contentType, platform: agreed[0].platform,
        };
    }

    /**
     * Appended, never merged into the previous submission.
     *
     * A resubmission is a new row with its own files, so the first version and
     * what the brand said about it both survive. Replacing files in place would
     * quietly rewrite the thing a revision request was about.
     */
    deal.workSubmissions.push({
        ...(deliverable ? { deliverable } : {}),
        urls: b.urls,
        files: [
            ...b.files.map((f) => toSubmissionFile(f, 'content')),
            ...b.supportingFiles.map((f) => toSubmissionFile(f, 'support')),
        ],
        caption: b.caption ?? '',
        note: b.note,
        submittedAt: now,
        reviewStatus: 'pending',
        late,
    });

    // Policy 5.3 — the Brand's 7-day review window opens now. The scheduler
    // reads this deadline; nothing else needs to know the duration.
    deal.reviewDeadline = new Date(now.getTime() + REVIEW_WINDOW_DAYS * 24 * 3600 * 1000);
    deal.reviewRemindersSent = [];
    await deal.save();

    const updated = await transitionDeal({
        dealId: deal.id, to: 'submitted', actor: 'creator', actorId: req.auth.sub,
        note: late ? 'Deliverables submitted (late)' : 'Deliverables submitted',
    });
    ok(res, updated);
});

/**
 * The agreed deliverables and everything submitted against each.
 *
 * Read by both parties: the creator needs to know what is left to deliver and
 * what came back, and the brand needs the same list to review against. One
 * endpoint, because two derivations of "what is outstanding" is one of them
 * being wrong on somebody's screen.
 */
export const listDeliverables = catchAsync(async (req, res) => {
    const deal = await Deal.findById(req.params.id);
    if (!deal) throw ApiError.notFound('Collaboration not found');

    const isParty = [deal.brand.toString(), deal.creator.toString()].includes(req.auth.sub);
    if (!isParty && req.auth.role !== 'admin') throw ApiError.forbidden();

    const progress = deliverableProgress(deal);
    ok(res, {
        ...progress,
        allApproved: allDeliverablesApproved(deal),
        outstanding: outstandingDeliverables(deal),
        revisions: {
            used: deal.revisionCount ?? 0,
            allowed: deal.terms?.revisionsAllowed ?? INCLUDED_REVISIONS,
        },
        reviewDeadline: deal.reviewDeadline ?? null,
    });
});

/**
 * Move a collaboration into revision, recording who asked and why.
 *
 * Shared by the per-submission review below and the deal-level endpoint, so the
 * Policy 5.4 cap and the Policy 5.5 diversion cannot be enforced on one path and
 * not the other. It was nearly two paths: the obvious way to write the review
 * endpoint is to repeat the cap check, and the two copies then disagree the
 * first time either is changed.
 */
async function moveToRevision(deal, { actorId, note }) {
    const check = canRequestRevision(deal);
    if (!check.allowed) {
        // Move to Resolution rather than refusing outright — the Brand still
        // needs a route forward, and 5.5 defines exactly what it is.
        deal.resolutionDeadline = new Date(Date.now() + RESOLUTION_AUTO_DAYS * 24 * 3600 * 1000);
        await deal.save();
        const moved = await transitionDeal({
            dealId: deal.id, to: 'resolution', actor: 'brand', actorId,
            note: `All ${check.limit} agreed revision rounds used — moved to Resolution (Policy 5.5)`,
        });
        return {
            deal: moved,
            revisionsExhausted: true,
            message: `You have used all ${check.limit} agreed revision rounds. Choose a resolution option.`,
        };
    }

    /**
     * The counter is incremented by `transitionDeal`, not here — see the note on
     * the deal-level endpoint below.
     */
    const updated = await transitionDeal({
        dealId: deal.id, to: 'revision', actor: 'brand', actorId,
        note: note || `Revision ${check.used + 1} of ${check.limit} requested`,
    });
    return {
        deal: updated,
        revisionsUsed: updated.revisionCount,
        revisionsAllowed: check.limit,
        revisionsRemaining: Math.max(0, check.limit - (updated.revisionCount ?? 0)),
    };
}

/**
 * The brand's decision on one submission.
 *
 * ── Nothing here approves content on its own ───────────────────────────────
 *
 * `approved` is written only by this handler, only for a brand, and only with a
 * submission id in the request — a deliberate act on a specific piece of work.
 * The Policy 5.3 sweep completes a collaboration whose review window has run
 * out and releases the money, as the policy requires, but it does NOT mark any
 * submission approved: nobody looked at it, and a record saying otherwise would
 * be a false one. The workspace says which of the two happened.
 *
 * ── Approving is not paying ────────────────────────────────────────────────
 *
 * This records the decision. Releasing the escrow is the separate, explicit
 * `completed` transition, and it is refused until every agreed deliverable has
 * an approval recorded here. Two steps because they are two decisions, and the
 * money one is irreversible.
 *
 * ── Feedback is required on a revision ─────────────────────────────────────
 *
 * A revision request without a reason gives the creator nothing to act on;
 * they resubmit a guess, and it costs one of the agreed rounds.
 */
export const reviewSubmissionSchema = z.object({
    decision: z.enum(['approved', 'revision']),
    feedback: z.string().max(2000).optional(),
}).strict().refine(
    (b) => b.decision !== 'revision' || Boolean(b.feedback?.trim()),
    { message: 'Say what needs to change', path: ['feedback'] },
);

export const reviewSubmission = catchAsync(async (req, res) => {
    const deal = await Deal.findById(req.params.id);
    if (!deal) throw ApiError.notFound('Collaboration not found');
    if (deal.brand.toString() !== req.auth.sub) throw ApiError.forbidden();

    const submission = deal.workSubmissions.id(req.params.submissionId);
    if (!submission) throw ApiError.notFound('Submission not found');

    if (submission.reviewStatus !== 'pending')
        throw ApiError.conflict('This submission has already been reviewed', {
            reviewStatus: submission.reviewStatus,
            decidedAt: submission.review?.at ?? null,
        });

    const { decision, feedback } = req.body;
    const at = new Date();

    /*
      The status and the decision record are written together, here and nowhere
      else. A status with no record cannot answer "when, and on what basis" —
      the question that matters when a release is disputed later.
    */
    submission.review = {
        decision,
        feedback: feedback?.trim() ?? '',
        at,
        by: new Types.ObjectId(req.auth.sub),
    };
    submission.reviewStatus = decision === 'approved' ? 'approved' : 'rejected';
    submission.reviewNote = feedback?.trim() ?? '';

    if (decision === 'revision') {
        await deal.save();
        const result = await moveToRevision(deal, { actorId: req.auth.sub, note: feedback?.trim() });
        await notify({
            user: deal.creator.toString(),
            type: 'deal.revision_requested',
            title: 'A revision was requested',
            body: `"${deal.title}" — ${feedback?.trim() || 'the brand asked for changes'}`,
            data: dealPayload(deal),
        }).catch(() => void 0);
        return ok(res, result);
    }

    await deal.save();

    const allApproved = allDeliverablesApproved(deal);
    await notify({
        user: deal.creator.toString(),
        type: 'deal.submission_approved',
        title: 'Your submission was approved',
        body: allApproved
            ? `"${deal.title}" — every deliverable is approved. Payment is released when the brand closes the collaboration.`
            : `"${deal.title}" — ${submission.deliverable?.label ?? 'your submission'} was approved.`,
        data: dealPayload(deal),
    }).catch(() => void 0);

    ok(res, {
        deal,
        submission: submission.toObject(),
        allApproved,
        outstanding: outstandingDeliverables(deal),
    });
});

/**
 * Policy 5.4 — a revision request is only valid while agreed rounds remain.
 * Once they are exhausted the Collaboration moves to Resolution (Policy 5.5)
 * instead of silently accepting a third round.
 *
 * Kept as the collaboration-level route. The workspace reviews a specific
 * submission (above), which records the decision against it; this stays for
 * callers that have no submission in hand, and both run the same cap check.
 */
export const requestRevision = catchAsync(async (req, res) => {
    const deal = await Deal.findById(req.params.id);
    if (!deal) throw ApiError.notFound();
    if (deal.brand.toString() !== req.auth.sub) throw ApiError.forbidden();

    /**
     * The revision counter is incremented by `transitionDeal`, not here.
     *
     * Both used to do it: this handler added one and saved, then
     * `applyStateSideEffects` in deals.service.js added another on the
     * `→ revision` transition. Every revision request therefore consumed two
     * rounds, so a deal with three included revisions was pushed into
     * Resolution after the brand's *second* request — and the note told them
     * they had used "revision 2 of 3" while the stored count was 4.
     *
     * The state machine owns state changes; that is the rule this module states
     * everywhere else, and it is the half that has to stay.
     */
    ok(res, await moveToRevision(deal, { actorId: req.auth.sub, note: req.body?.note }));
});

/** Policy 15 — the Creator confirms the disclosure that will appear on the content. */
export const confirmDisclosureSchema = z.object({
    method: z.enum(['#ad', '#advertisement', '#sponsored', '#paidpartnership', '#collab', 'platform_tool']),
    placement: z.string().max(200).optional(),
    language: z.string().max(40).optional(),
});
export const confirmDisclosure = catchAsync(async (req, res) => {
    const deal = await Deal.findById(req.params.id);
    if (!deal) throw ApiError.notFound();
    if (deal.creator.toString() !== req.auth.sub) throw ApiError.forbidden();

    deal.disclosure = {
        method: req.body.method,
        placement: req.body.placement,
        language: req.body.language,
        confirmedAt: new Date(),
        confirmedBy: new Types.ObjectId(req.auth.sub),
    };
    await deal.save();
    ok(res, deal.disclosure);
});


/* ── Structured negotiation (scope §11, §12) ─────────────────────────────
 * Offers and counter-offers are versioned records in their own collection.
 * Both parties may hold a live offer at once; immutability, not turn-taking,
 * is what stops terms being silently revised. */

/**
 * A proposal, as one party sends it.
 *
 * Every field is a term of the work rather than a price with a covering note,
 * because a counter-proposal has to be able to say "the money is fine, the
 * usage rights are not" — and with an amount-only offer it could not. The
 * vocabulary is the campaign brief's, so a proposal that followed an
 * application and one sent to a creator found in discovery read the same.
 *
 * `.strict()`: a misspelled field used to be dropped silently, which on a
 * document that becomes binding is the worst possible failure.
 */
export const offerSchema = z.object({
    amount: z.number().min(0),
    deliverables: z.string().max(4000).default(''),

    /** Content type and quantity as rows, not a sentence. */
    contentItems: z.array(z.object({
        contentType: z.string().min(1).max(60),
        quantity: z.number().int().min(1).max(500).default(1),
        platform: z.string().max(40).optional(),
        notes: z.string().max(500).optional(),
    })).max(20).optional(),

    guidelines: z.object({
        dos: z.array(z.string().max(300)).max(20).optional(),
        donts: z.array(z.string().max(300)).max(20).optional(),
        hashtags: z.array(z.string().max(60)).max(20).optional(),
        mentions: z.array(z.string().max(60)).max(20).optional(),
        notes: z.string().max(2000).optional(),
    }).optional(),

    /** Timeline: when work starts, and when it is due. */
    startDate: z.string().optional(),
    deadline: z.string().optional(),

    /** Policy 8 — scope, and therefore negotiable. */
    usageRights: z.object({
        licenceType: z.enum(['default', 'extended', 'full_assignment']).optional(),
        durationMonths: z.number().int().min(1).max(120).optional(),
        paidAdvertising: z.boolean().optional(),
        whitelisting: z.boolean().optional(),
        modificationAllowed: z.boolean().optional(),
        notes: z.string().max(1000).optional(),
    }).optional(),
    exclusivity: z.string().max(500).optional(),
    otherTerms: z.string().max(2000).optional(),

    revisionsAllowed: z.number().min(0).max(10).optional(),

    // Optional, chosen by the proposer (§4).
    expiresAt: z.string().optional(),
    note: z.string().max(500).optional(),
}).strict();

function party(req) {
    if (req.auth.role !== 'brand' && req.auth.role !== 'creator')
        throw ApiError.forbidden('Only the brand or creator on a deal can negotiate');
    return req.auth.role;
}

export const createOffer = catchAsync(async (req, res) => {
    const offer = await postOffer({
        dealId: req.params.id,
        actorId: req.auth.sub,
        actorRole: party(req),
        terms: req.body,
    });
    created(res, offer);
});

/**
 * The negotiation on a collaboration: the thread and every proposal version.
 *
 * There was no way to read this. The panel read `deal.offers`, a field removed
 * when offers moved to their own collection, so it rendered an empty history
 * for every negotiation and could never find the accepted proposal it needed in
 * order to show the confirm step.
 *
 * A read does not open a thread — `create: false`. Looking at a collaboration
 * must not create state, and a deal that has not reached negotiation yet
 * correctly answers "no proposals".
 */
export const getNegotiation = catchAsync(async (req, res) => {
    const { deal, thread } = await threadForDeal(req.params.id);

    const isParty = [deal.brand.toString(), deal.creator.toString()].includes(req.auth.sub);
    if (!isParty && req.auth.role !== 'admin') throw ApiError.forbidden();

    if (!thread) return ok(res, { thread: null, offers: [] });

    // Newest first — the version a person needs to act on is the latest one.
    const offers = await Offer.find({ thread: thread._id }).sort({ seq: -1 });
    ok(res, { thread: thread.toJSON(), offers: offers.map((o) => o.toJSON()) });
});

export const acceptOfferHandler = catchAsync(async (req, res) => {
    const deal = await acceptOffer({
        dealId: req.params.id,
        offerId: req.params.offerId,
        actorId: req.auth.sub,
        actorRole: party(req),
    });
    ok(res, deal);
});

export const rejectOfferSchema = z.object({ note: z.string().max(500).optional() });
export const rejectOfferHandler = catchAsync(async (req, res) => {
    const deal = await rejectOffer({
        dealId: req.params.id,
        offerId: req.params.offerId,
        actorId: req.auth.sub,
        actorRole: party(req),
        note: req.body?.note,
    });
    ok(res, deal);
});

/**
 * Confirm terms (§5). Both parties confirm separately; the second confirmation
 * moves the deal to `terms_agreed` and locks the terms.
 */
export const confirmTermsHandler = catchAsync(async (req, res) => {
    // confirmTerms returns { deal, agreed } — `agreed` is true only on the
    // second confirmation, which is what moved the deal to terms_agreed. The
    // UI needs it to know whether to show "waiting on them" or "fund escrow".
    const { deal, agreed } = await confirmTerms({
        dealId: req.params.id,
        actorId: req.auth.sub,
        actorRole: party(req),
    });
    ok(res, { deal, agreed });
});

/** Reject the whole deal — only before terms are agreed (§7). */
export const rejectDealSchema = z.object({ note: z.string().max(500).optional() });
export const rejectDealHandler = catchAsync(async (req, res) => {
    const deal = await rejectDeal({
        dealId: req.params.id,
        actorId: req.auth.sub,
        actorRole: party(req),
        note: req.body?.note,
    });
    ok(res, deal);
});


/* ── Cancellation (Policy 7.1, 7.2, 28) ──────────────────────────────────
 * Policy 28: "Never make the user confirm a cancellation without showing the
 * applicable consequence first." So cancellation is two calls: a preview that
 * computes the exact money outcome for the current stage, and an execute that
 * performs it. The preview is a GET and changes nothing.
 */

/** What cancelling right now would cost. Read-only. */
export const previewCancellation = catchAsync(async (req, res) => {
    const deal = await Deal.findById(req.params.id).lean();
    if (!deal) throw ApiError.notFound('Collaboration not found');

    const role = req.auth.role;
    const isParty = [deal.brand.toString(), deal.creator.toString()].includes(req.auth.sub);
    if (!isParty && role !== 'admin') throw ApiError.forbidden();

    const check = canCancel(deal.state, role);
    if (!check.allowed) {
        return ok(res, {
            allowed: false,
            reason: check.reason,
            state: deal.state,
        });
    }

    const agreedValue = deal.escrow?.amount ?? deal.terms?.amount ?? 0;
    const funded = Boolean(deal.escrow?.funded);

    // Nothing is held yet, so there is nothing to settle.
    if (!funded) {
        return ok(res, {
            allowed: true,
            state: deal.state,
            escrowFunded: false,
            agreedValue,
            creatorReceives: 0,
            brandRefund: 0,
            commission: 0,
            summary: 'No payment has been made yet, so nothing will be charged or refunded.',
        });
    }

    const outcome = role === 'creator'
        ? creatorCancellationOutcome({ state: deal.state, agreedValue, commissionPct: deal.commission?.ratePct })
        : brandCancellationOutcome({ state: deal.state, agreedValue, commissionPct: deal.commission?.ratePct });

    // Plain-language summary per stage, so the consequence is understandable
    // rather than a table of numbers (Policy 28).
    const SUMMARY = {
        accepted: 'Work has not started, so the full amount is refunded to the Brand.',
        escrow_pending: 'Work has not started, so the full amount is refunded to the Brand.',
        in_progress: role === 'brand'
            ? 'Work has begun, so the Creator keeps 25% as a cancellation fee and 75% is refunded to you.'
            : 'You are cancelling work you have begun, so the Brand is refunded in full unless they accept partial deliverables.',
        submitted: 'The Creator has already delivered, so they receive the full fee and no refund is due.',
        revision: 'The Creator has already delivered, so they receive the full fee and no refund is due.',
    };

    ok(res, {
        allowed: true,
        state: deal.state,
        escrowFunded: true,
        agreedValue,
        creatorReceives: outcome.creatorNet,
        creatorGross: outcome.creatorGross,
        commission: outcome.commission,
        commissionPct: outcome.commissionPct,
        brandRefund: outcome.brandRefund,
        summary: SUMMARY[deal.state] ?? 'The outcome will follow the cancellation policy for this stage.',
        irreversible: true,
    });
});

export const cancelDealSchema = z.object({ reason: z.string().max(500).optional() });

/**
 * Execute the cancellation. The settlement is computed server-side from the
 * stage — the client cannot propose amounts, because Policy 7.1 fixes them.
 */
export const cancelDeal = catchAsync(async (req, res) => {
    const deal = await Deal.findById(req.params.id).lean();
    if (!deal) throw ApiError.notFound('Collaboration not found');

    const role = req.auth.role;
    const isParty = [deal.brand.toString(), deal.creator.toString()].includes(req.auth.sub);
    if (!isParty && role !== 'admin') throw ApiError.forbidden();

    const check = canCancel(deal.state, role);
    if (!check.allowed) throw ApiError.unprocessable(check.reason);

    const updated = await transitionDeal({
        dealId: req.params.id,
        to: 'cancelled',
        actor: role,
        actorId: req.auth.sub,
        note: req.body?.reason,
    });
    ok(res, updated);
});

/* ───────────────── Policy 5.5 option B — additional paid revisions ─────────── */

export const proposeAdditionalTermsSchema = z.object({
    amount: z.number().positive(),
    revisionsAdded: z.number().int().min(1).max(10),
    scopeNote: z.string().max(2000).optional(),
    deadline: z.string().optional(),
}).strict();

/**
 * The brand offers to pay for further revisions.
 *
 * A fourth revision is new scope, not an entitlement: this creates a proposal
 * the creator can refuse. Nothing about the deal changes until they accept AND
 * the money is in escrow.
 */
export const proposeAdditionalTerms = catchAsync(async (req, res) => {
    const deal = await additionalTerms.proposeAdditionalTerms({
        dealId: req.params.id,
        actorId: req.auth.sub,
        ...req.body,
    });
    ok(res, { deal, preview: additionalTerms.previewAdditionalTerms(deal) });
});

export const respondAdditionalTermsSchema = z.object({
    accept: z.boolean(),
    declineReason: z.string().max(1000).optional(),
}).strict();

/** The creator accepts or declines. Only they can. */
export const respondToAdditionalTerms = catchAsync(async (req, res) => {
    const deal = await additionalTerms.respondToAdditionalTerms({
        dealId: req.params.id,
        actorId: req.auth.sub,
        ...req.body,
    });
    ok(res, { deal, preview: additionalTerms.previewAdditionalTerms(deal) });
});

/** Checkout session for accepted additional terms. */
export const startAdditionalTermsPayment = catchAsync(async (req, res) => {
    ok(res, await additionalTerms.createAdditionalTermsPaymentSession(req.params.id, req.auth.sub));
});

/* ── Change Requests (locked terms) ────────────────────────────────────────
 *
 * The only way agreed terms may change. One party asks, the other answers, and
 * an accepted request appends an amendment rather than rewriting the agreement
 * — see modules/deals/changeRequest.service.js.
 */

/**
 * `.strict()` and a field allow-list. A change request is the one document in
 * this system that edits something already binding, so a misspelled field must
 * be refused loudly rather than dropped into a no-op the other party then
 * "accepts".
 */
export const changeRequestSchema = z.object({
    changes: z.object({
        amount: z.number().min(0).optional(),
        deliverables: z.string().max(4000).optional(),
        contentItems: z.array(z.object({
            contentType: z.string().min(1).max(60),
            quantity: z.number().int().min(1).max(500).default(1),
            platform: z.string().max(40).optional(),
            notes: z.string().max(500).optional(),
        })).max(20).optional(),
        guidelines: z.object({
            dos: z.array(z.string().max(300)).max(20).optional(),
            donts: z.array(z.string().max(300)).max(20).optional(),
            hashtags: z.array(z.string().max(60)).max(20).optional(),
            mentions: z.array(z.string().max(60)).max(20).optional(),
            notes: z.string().max(2000).optional(),
        }).optional(),
        startDate: z.string().optional(),
        deadline: z.string().optional(),
        usageRights: z.object({
            licenceType: z.enum(['default', 'extended', 'full_assignment']).optional(),
            durationMonths: z.number().int().min(1).max(120).optional(),
            paidAdvertising: z.boolean().optional(),
            whitelisting: z.boolean().optional(),
            modificationAllowed: z.boolean().optional(),
            notes: z.string().max(1000).optional(),
        }).optional(),
        exclusivity: z.string().max(500).optional(),
        otherTerms: z.string().max(2000).optional(),
        revisionsAllowed: z.number().int().min(0).max(20).optional(),
    }).strict(),
    /** Required: the other party is being asked to give something up. */
    reason: z.string().min(10).max(1000),
}).strict();

export const proposeChangeRequest = catchAsync(async (req, res) => {
    const { changeRequest } = await changeRequest_propose({
        dealId: req.params.id,
        actorId: req.auth.sub,
        actorRole: party(req),
        changes: req.body.changes,
        reason: req.body.reason,
    });
    created(res, changeRequest);
});

export const respondChangeRequestSchema = z.object({
    accept: z.boolean(),
    note: z.string().max(1000).optional(),
}).strict();

export const respondChangeRequest = catchAsync(async (req, res) => {
    const { deal, changeRequest, amendment } = await changeRequest_respond({
        dealId: req.params.id,
        requestId: req.params.requestId,
        actorId: req.auth.sub,
        actorRole: party(req),
        accept: req.body.accept,
        note: req.body.note,
    });
    ok(res, { deal, changeRequest, amendment });
});

export const withdrawChangeRequest = catchAsync(async (req, res) => {
    const { changeRequest } = await changeRequest_withdraw({
        dealId: req.params.id,
        requestId: req.params.requestId,
        actorId: req.auth.sub,
        actorRole: party(req),
    });
    ok(res, changeRequest);
});

/** The agreement, what applies now, and every change asked for along the way. */
export const getTermsHistory = catchAsync(async (req, res) => {
    const deal = await Deal.findById(req.params.id);
    if (!deal) throw ApiError.notFound('Collaboration not found');

    const isParty = [deal.brand.toString(), deal.creator.toString()].includes(req.auth.sub);
    if (!isParty && req.auth.role !== 'admin') throw ApiError.forbidden();

    ok(res, changeRequest_history(deal));
});

/* ── Payment records and state ─────────────────────────────────────────────
 *
 * The ledger for one collaboration. Both parties may read it: a creator waiting
 * to start needs to see whether the advance is pending, failed or verified, and
 * "ask the brand" is not an answer a platform should give.
 */
export const listDealPayments = catchAsync(async (req, res) => {
    const deal = await Deal.findById(req.params.id).select('brand creator').lean();
    if (!deal) throw ApiError.notFound('Collaboration not found');

    const isParty = [deal.brand.toString(), deal.creator.toString()].includes(req.auth.sub);
    if (!isParty && req.auth.role !== 'admin') throw ApiError.forbidden();

    ok(res, await paymentRecords(req.params.id));
});

/**
 * The brand opened checkout.
 *
 * Client-reported, and therefore trusted for nothing beyond showing both
 * parties that a payment is under way. It cannot verify anything — only the
 * signature-verified webhook writes `verified`.
 */
export const paymentInitiated = catchAsync(async (req, res) => {
    const txn = await markPaymentInitiated(req.params.id, req.auth.sub);
    ok(res, txn);
});
import { Schema, model } from 'mongoose';

/**
 * Campaign + applications.
 *
 * Applications are the creator-initiated entry into the deal lifecycle:
 * cleared rules §2 — "A Creator application produces a `requested` deal" and
 * "The receiving party must accept before negotiation starts." So an applicant
 * row is not a standalone concept; it points at the Deal it produced, and the
 * brand's Accept moves that deal on rather than just flipping a string.
 */
/**
 * What a creator actually sent.
 *
 * Stored on the application rather than in its own collection: it is read in
 * exactly one place — the brand looking at this campaign's applicants — and it
 * is written once. A separate collection would buy a join and nothing else.
 *
 * Nothing here reaches the Deal. `terms.amount` comes from `campaign.budget`,
 * and `proposedPrice` is what the creator would like, shown to the brand and
 * settled in negotiation. Letting an application set the deal's price would be
 * negotiation, which is deliberately not part of this.
 */
const submissionSchema = new Schema({
    /** "Why are you the right creator?" — the body of the application. */
    pitch: { type: String, default: '', maxlength: 2000 },
    /**
     * Optional, and only when the campaign allows it. A number the brand reads,
     * never a number the escrow is funded from.
     */
    proposedPrice: { type: Number, default: null },
    /** Links to work that is already public. */
    portfolioLinks: { type: [String], default: [] },
    /**
     * Files the creator attached, through the same signed-upload flow as every
     * other upload in the product. `kind` is what the browser reported, kept so
     * the brand's list can show a video differently from a PDF.
     */
    attachments: {
        type: [new Schema({
            url: { type: String, required: true },
            name: { type: String, default: '' },
            kind: { type: String, default: '' },
        }, { _id: false })],
        default: [],
    },
    /**
     * Answers to the campaign's own questions, keyed by the question's stable
     * `key` so rewording a prompt does not orphan the answers already given.
     */
    answers: {
        type: [new Schema({
            key: { type: String, required: true },
            /** Free text, a link, a number as text, or the chosen option(s). */
            value: { type: String, default: '' },
            values: { type: [String], default: [] },
        }, { _id: false })],
        default: [],
    },
}, { _id: false });

/**
 * The status vocabulary, and why two of these look redundant.
 *
 * `applied → under_review → shortlisted → selected/rejected`, plus `withdrawn`
 * for a creator who pulls out. Only `selected` and `rejected` touch the Deal
 * the application produced; the two middle states are the brand telling a
 * creator where they stand, which is the whole reason a creator asks.
 *
 * `pending` and `accepted` are the original two values. They are kept in the
 * enum because mongoose validates on write, not on read: a campaign that still
 * holds an old `pending` applicant would fail to save — including when a new
 * creator applies to it — the moment those values stopped being legal.
 * `utils/migrate-application-statuses.js` normalises them; until it has run
 * everywhere, both spellings are accepted and `normaliseStatus` below maps them.
 */
export const APPLICATION_STATUSES = [
    'applied', 'under_review', 'shortlisted', 'selected', 'rejected', 'withdrawn',
];

/** Historical values. Written by nothing; still readable. */
export const LEGACY_APPLICATION_STATUSES = ['pending', 'accepted'];

const LEGACY_MAP = { pending: 'applied', accepted: 'selected' };

/** One current status, whichever spelling is on the document. */
export function normaliseApplicationStatus(status) {
    return LEGACY_MAP[status] ?? status;
}

/** The statuses a brand may set. A creator withdraws; nobody re-applies. */
export const BRAND_DECISION_STATUSES = ['under_review', 'shortlisted', 'selected', 'rejected'];

/** Once here, the application is over — the deal has moved and cannot un-move. */
export const TERMINAL_APPLICATION_STATUSES = ['selected', 'rejected', 'withdrawn'];

const applicantSchema = new Schema({
    creator: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    appliedAt: { type: Date, default: Date.now },
    status: {
        type: String,
        enum: [...APPLICATION_STATUSES, ...LEGACY_APPLICATION_STATUSES],
        default: 'applied',
    },
    /** The `requested` deal created when this application was submitted (§2). */
    deal: { type: Schema.Types.ObjectId, ref: 'Deal' },
    decidedAt: Date,
    withdrawnAt: Date,

    submission: { type: submissionSchema, default: () => ({}) },

    /**
     * Every status this application has been in, and when.
     *
     * A creator asking "where is my application" is asking for exactly this,
     * and a single mutable `status` field cannot answer it: it says where the
     * application is now and nothing about whether it has moved at all. The
     * optional message is what the brand chose to say at that step.
     */
    history: {
        type: [new Schema({
            status: { type: String, required: true },
            at: { type: Date, default: Date.now },
            by: { type: Schema.Types.ObjectId, ref: 'User' },
            byRole: { type: String, enum: ['creator', 'brand', 'admin'] },
            message: { type: String, default: '', maxlength: 500 },
        }, { _id: false })],
        default: [],
    },
}, { _id: false });

/**
 * One thing the brand is asking for: three reels on Instagram, one 60-second
 * YouTube integration, and so on.
 *
 * A deliverable is a subdocument rather than a string because every field on it
 * is asked about separately downstream — "how many", "how long", "on which
 * platform" — and a campaign whose deliverables are prose cannot answer any of
 * them without a human reading it.
 *
 * `contentType` is not an enum: which content types a platform offers is a
 * product list that changes (Instagram added Reels; YouTube added Shorts), and
 * an enum here would mean a schema migration every time. The allowed set lives
 * in `campaignBrief.schema.js`, which validates it per platform at the API
 * boundary.
 */
const deliverableSchema = new Schema({
    platform: { type: String, required: true },
    contentType: { type: String, required: true },
    quantity: { type: Number, default: 1, min: 1 },
    /** Where the format has a length — a reel, a short, a video integration. */
    durationSeconds: { type: Number, default: null },
    /** Aspect/format note where it matters: "9:16", "carousel, 5 slides". */
    format: { type: String, default: '' },
    notes: { type: String, default: '' },
}, { _id: false });

/**
 * A question the brand wants every applicant to answer.
 *
 * Stored with the campaign rather than as its own collection: the questions are
 * part of the brief, they are versioned with it, and nothing else refers to
 * them. `key` is a stable identifier so an answer can be matched to its
 * question even after the prompt is reworded — which is exactly what
 * `submission.answers` does.
 *
 * `required` is enforced at the API boundary in `application.schema.js`, not
 * here: mongoose cannot express "required, but only if the campaign this
 * subdocument does not know about asked for it".
 */
const campaignQuestionSchema = new Schema({
    key: { type: String, required: true },
    prompt: { type: String, required: true },
    type: { type: String, enum: ['short_text', 'long_text', 'single_choice', 'multi_choice', 'link', 'number'], default: 'short_text' },
    required: { type: Boolean, default: false },
    /** Only for the choice types. */
    options: { type: [String], default: [] },
}, { _id: false });

const campaignSchema = new Schema({
    brand: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Section A — campaign name. */
    title: { type: String, required: true },
    /** Section A — campaign description. The wizard calls it "description". */
    brief: { type: String, default: '' },
    /**
     * Derived, never typed.
     *
     * The flat list of content types across `deliverables`, recomputed by the
     * controller on every write. It predates the structured brief and is still
     * read by campaign cards and by `applyToCampaign`, which seeds a deal's
     * `terms.deliverables` from it — so it is kept in sync rather than
     * duplicated by hand, which is how the two would drift apart.
     */
    contentTypes: { type: [String], default: [] },
    /**
     * Section D — the fee per creator. This IS the creator fee; the wizard's
     * "Creator fee" field writes here. There is deliberately no
     * `commercials.creatorFee`: a second copy of the number the escrow is
     * funded from is a number that can disagree with itself.
     */
    budget: { type: Number, default: 0 },
    location: { type: String, default: 'India' },
    tags: { type: [String], default: [] },
    /**
     * Section E — the deliverable deadline, and the same field the deal
     * inherits as `terms.deadline`. As with `budget`, `schedule` deliberately
     * has no second copy of it.
     */
    deadline: Date,

    /* ── Section A — basic information ─────────────────────────────────── */

    category: { type: String, default: '', index: true },
    objective: { type: String, default: '' },
    /** Product or campaign imagery, uploaded through the existing storage flow. */
    images: { type: [String], default: [] },

    /* ── Section B — platform and content requirements ─────────────────── */

    /**
     * Only the platforms Marqueiver actually integrates with. Validated at the
     * API boundary against the same list the creator-side integrations use —
     * asking for a TikTok deliverable would produce a campaign no creator on
     * this platform can be matched against.
     */
    platforms: { type: [String], default: [] },
    deliverables: { type: [deliverableSchema], default: [] },
    guidelines: {
        dos: { type: [String], default: [] },
        donts: { type: [String], default: [] },
        hashtags: { type: [String], default: [] },
        mentions: { type: [String], default: [] },
        cta: { type: String, default: '' },
        notes: { type: String, default: '' },
    },

    /* ── Section C — creator requirements ──────────────────────────────── */

    creatorRequirements: {
        categories: { type: [String], default: [] },
        locations: { type: [String], default: [] },
        ageMin: { type: Number, default: null },
        ageMax: { type: Number, default: null },
        genders: { type: [String], default: [] },
        followerMin: { type: Number, default: null },
        followerMax: { type: Number, default: null },
        /** Percentage, e.g. 2.5 — matched against CreatorProfile.avgEngagement. */
        minEngagement: { type: Number, default: null },
        languages: { type: [String], default: [] },
        /** The creator's audience, as distinct from the creator themselves. */
        audience: {
            locations: { type: [String], default: [] },
            ageRanges: { type: [String], default: [] },
            genders: { type: [String], default: [] },
            interests: { type: [String], default: [] },
        },
        experience: { type: String, default: '' },
        /**
         * Policy 13.1 levels, as a requirement rather than a claim. Nothing here
         * verifies anything — these say which existing verification states a
         * creator must already hold.
         */
        requireVerifiedIdentity: { type: Boolean, default: false },
        requireVerifiedSocial: { type: Boolean, default: false },
    },

    /* ── Section D — budget and commercials ────────────────────────────── */

    commercials: {
        creatorCount: { type: Number, default: 1, min: 1 },
        /**
         * How the fee is settled. Every option still runs through the same
         * escrow — this records what the fee covers, not a different money
         * path, because there is only one.
         */
        paymentModel: { type: String, default: 'fixed' },
        /**
         * May a creator name their own price when applying?
         *
         * Default `true`, which matches how the brief already reads to a
         * creator — the deliverables list is there so they can price the work.
         * A brand that wants applications at its stated fee and nothing else
         * turns this off, and the application form then hides the field.
         *
         * Whatever a creator proposes is a number the brand reads. It never
         * becomes the deal's `terms.amount`; that is negotiation.
         */
        allowProposedPrice: { type: Boolean, default: true },
        product: {
            offered: { type: Boolean, default: false },
            description: { type: String, default: '' },
            /** Indicative retail value, for the creator to judge barter by. */
            value: { type: Number, default: null },
        },
        travel: {
            offered: { type: Boolean, default: false },
            cap: { type: Number, default: null },
            notes: { type: String, default: '' },
        },
        performanceBonus: {
            offered: { type: Boolean, default: false },
            description: { type: String, default: '' },
        },
    },

    /* ── Section E — timeline ──────────────────────────────────────────── */

    /**
     * The deliverable deadline is `deadline` above, not a field here. The order
     * these must fall in is enforced in `campaignBrief.schema.js`, at the API
     * boundary, so a timeline that cannot happen never reaches the database.
     */
    schedule: {
        campaignStart: Date,
        applicationDeadline: Date,
        selectionDeadline: Date,
        collaborationStart: Date,
        /** Working days the brand gets to approve or request revisions. */
        reviewWindowDays: { type: Number, default: null },
        campaignEnd: Date,
    },

    /* ── Section F — usage rights ──────────────────────────────────────── */

    usageRights: {
        durationMonths: { type: Number, default: null },
        perpetual: { type: Boolean, default: false },
        channels: { type: [String], default: [] },
        paidAds: {
            allowed: { type: Boolean, default: false },
            durationMonths: { type: Number, default: null },
        },
        exclusivity: {
            required: { type: Boolean, default: false },
            category: { type: String, default: '' },
            durationMonths: { type: Number, default: null },
        },
    },

    /* ── Section G — additional requirements ───────────────────────────── */

    extras: {
        specialInstructions: { type: String, default: '' },
        questions: { type: [campaignQuestionSchema], default: [] },
    },
    /**
     * Campaign lifecycle.
     *
     *   draft          — being written; only the brand sees it.
     *   pending_review — submitted, waiting on Marqueiver. Not discoverable.
     *   open           — approved and live; creators can find and apply.
     *   rejected       — refused, with a reason the brand can act on.
     *   closed         — no longer accepting applications.
     *
     * `pending_review` is the default because approval is the point: a campaign
     * that defaulted to `open` would be live the instant it was created, which
     * is what the model did before and what the flow document says it must not.
     *
     * `rejected` is a distinct state rather than a flag on `closed`, because a
     * brand needs to tell "we turned this down, here is why, fix it and
     * resubmit" apart from "this ran its course".
     */
    status: {
        type: String,
        enum: ['draft', 'pending_review', 'open', 'rejected', 'closed'],
        default: 'pending_review',
        index: true,
    },

    /**
     * The review record. Kept on the campaign rather than only in the audit log
     * because the brand has to be shown the reason, and the audit log is
     * admin-only.
     */
    review: {
        submittedAt: Date,
        decidedAt: Date,
        decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        /** Shown to the brand verbatim when a campaign is rejected. */
        reason: String,
        /** Not shown to the brand — context for the next reviewer. */
        internalNote: String,
        /** How many times this campaign has been submitted for review. */
        submissionCount: { type: Number, default: 0 },
    },

    /** Set when an approved campaign first became visible to creators. */
    publishedAt: Date,

    applicants: { type: [applicantSchema], default: [] },
}, { timestamps: true });

/** Statuses a creator may discover. Everything else is invisible to them. */
export const CREATOR_VISIBLE_STATUSES = ['open'];

/** Editing is allowed only before a campaign is live. */
export const CAMPAIGN_EDITABLE_STATUSES = ['draft', 'pending_review', 'rejected'];

/** The reviewer's queue, oldest submission first. */
campaignSchema.index({ status: 1, 'review.submittedAt': 1 });

/**
 * Duplicate-application prevention at the database level, not just in the
 * controller. A partial unique index on the subdocument key means two
 * concurrent apply requests cannot both win a race — the second gets a
 * duplicate-key error, which the controller turns into a clean 409.
 */
campaignSchema.index(
    { _id: 1, 'applicants.creator': 1 },
    { unique: true, partialFilterExpression: { 'applicants.creator': { $exists: true } } },
);

/** Fast lookup of "which campaigns has this creator applied to" (§10). */
campaignSchema.index({ 'applicants.creator': 1, 'applicants.status': 1 });

export const Campaign = model('Campaign', campaignSchema);
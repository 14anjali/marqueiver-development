import { z } from 'zod';

/**
 * The campaign brief: vocabularies, field shapes, and the two rules that cannot
 * be expressed field-by-field — the timeline order, and what makes a campaign
 * complete enough to publish.
 *
 * ── Why this is a separate module ──────────────────────────────────────────
 *
 * `campaigns.controller.js` is already the longest file in the module and owns
 * the application/deal lifecycle. The brief is a large, self-contained shape
 * with rules of its own, and it is needed in three places — create, update, and
 * the publish gate. Keeping it here means the controller reads as "what happens
 * to a campaign" rather than fifty lines of field declarations.
 *
 * ── Draft validation vs publish validation ─────────────────────────────────
 *
 * These are deliberately different, and the difference is the whole design.
 *
 * A **draft** accepts almost anything: a brand halfway through the wizard has a
 * title and three deliverables and nothing else, and autosave fires while they
 * are still typing. Refusing that save would lose their work. So every field is
 * optional on a draft, and only *internally contradictory* values are refused —
 * a deliverable quantity of zero, a follower range whose minimum exceeds its
 * maximum, a timeline that runs backwards. Those are wrong no matter what else
 * the brand later fills in.
 *
 * **Publishing** is where completeness is demanded: `publishReadiness()` lists
 * what is still missing, section by section, and the controller refuses to send
 * an incomplete campaign for review. Creators apply against what they are
 * shown, so a live campaign with no deliverables and no deadline is not a
 * half-finished draft — it is a brief nobody can act on.
 */

/* ───────────────────────────── vocabularies ──────────────────────────────── */

/**
 * Only what Marqueiver actually integrates with.
 *
 * A campaign asking for TikTok deliverables could never be matched against a
 * creator on this platform — there is no TikTok connection, so no follower
 * count, no verification, and nothing for the creator to attach. The list is
 * exported so the wizard offers exactly what the server accepts.
 */
export const PLATFORMS = ['instagram', 'youtube', 'facebook'];

/**
 * Content types per platform. Not an enum on the model: this is a product list
 * that changes when Meta or YouTube ships a format, and it should change here
 * rather than in a schema migration.
 */
export const CONTENT_TYPES = {
    instagram: ['Reel', 'Post', 'Carousel', 'Story', 'Live'],
    youtube: ['Video', 'Short', 'Integration', 'Community post', 'Live'],
    facebook: ['Reel', 'Post', 'Story', 'Video', 'Live'],
};

/** Formats measured in seconds — the wizard asks for a duration only on these. */
export const TIMED_CONTENT_TYPES = new Set(['Reel', 'Short', 'Video', 'Integration', 'Story', 'Live']);

export const OBJECTIVES = [
    'Brand awareness', 'Product launch', 'Sales / conversions', 'App installs',
    'Content for our own channels', 'Event promotion', 'Community growth',
];

export const PAYMENT_MODELS = ['fixed', 'per_deliverable', 'barter_plus_fee', 'barter_only'];

export const USAGE_CHANNELS = [
    'Brand social channels', 'Brand website', 'Email marketing', 'Paid social ads',
    'In-store / point of sale', 'Print', 'OOH / billboards', 'Marketplace listings',
];

export const QUESTION_TYPES = ['short_text', 'long_text', 'single_choice', 'multi_choice', 'link', 'number'];

export const GENDERS = ['female', 'male', 'non-binary', 'any'];

/* ─────────────────────────────── field shapes ────────────────────────────── */

const str = (max) => z.string().trim().max(max);
const strList = (max, items = 30) => z.array(z.string().trim().min(1).max(max)).max(items);
/** An optional number that an empty input may send as null. */
const num = (min, max) => z.number().min(min).max(max).nullable();
/** Dates travel as ISO strings; parsed once, here, so nothing downstream guesses. */
const isoDate = z.string().datetime({ offset: true }).or(z.string().date()).nullable();

export const deliverableSchema = z.object({
    platform: z.enum(PLATFORMS),
    contentType: z.string().trim().min(1).max(40),
    quantity: z.number().int().min(1).max(100),
    durationSeconds: z.number().int().min(1).max(7200).nullable().optional(),
    format: str(60).optional(),
    notes: str(300).optional(),
}).superRefine((d, ctx) => {
    // The content type must belong to the platform it is filed under. Without
    // this a "YouTube Carousel" saves cleanly and then means nothing to anyone.
    const allowed = CONTENT_TYPES[d.platform] ?? [];
    if (!allowed.includes(d.contentType)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['contentType'],
            message: `${d.contentType} is not a ${d.platform} content type`,
        });
    }
});

export const campaignQuestionSchema = z.object({
    key: z.string().trim().min(1).max(40),
    prompt: z.string().trim().min(3).max(300),
    type: z.enum(QUESTION_TYPES),
    required: z.boolean(),
    options: strList(80, 12).optional(),
}).superRefine((q, ctx) => {
    // A choice question with no options is a question nobody can answer.
    if ((q.type === 'single_choice' || q.type === 'multi_choice') && (q.options?.length ?? 0) < 2) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['options'],
            message: 'A choice question needs at least two options',
        });
    }
});

/**
 * Every brief field, all optional.
 *
 * Optional is what makes autosave possible — see the module header. Section
 * completeness is decided by `publishReadiness`, not here.
 */
export const briefSchema = z.object({
    /* A */
    category: str(60).optional(),
    objective: str(80).optional(),
    images: z.array(z.string().url()).max(8).optional(),

    /* B */
    platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).optional(),
    deliverables: z.array(deliverableSchema).max(20).optional(),
    guidelines: z.object({
        dos: strList(200, 15).optional(),
        donts: strList(200, 15).optional(),
        hashtags: strList(60, 20).optional(),
        mentions: strList(60, 20).optional(),
        cta: str(200).optional(),
        notes: str(2000).optional(),
    }).optional(),

    /* C */
    creatorRequirements: z.object({
        categories: strList(60, 20).optional(),
        locations: strList(80, 20).optional(),
        ageMin: num(13, 100).optional(),
        ageMax: num(13, 100).optional(),
        genders: z.array(z.enum(GENDERS)).max(GENDERS.length).optional(),
        followerMin: num(0, 1_000_000_000).optional(),
        followerMax: num(0, 1_000_000_000).optional(),
        minEngagement: num(0, 100).optional(),
        languages: strList(40, 20).optional(),
        audience: z.object({
            locations: strList(80, 20).optional(),
            ageRanges: strList(20, 10).optional(),
            genders: z.array(z.enum(GENDERS)).max(GENDERS.length).optional(),
            interests: strList(60, 20).optional(),
        }).optional(),
        experience: str(300).optional(),
        requireVerifiedIdentity: z.boolean().optional(),
        requireVerifiedSocial: z.boolean().optional(),
    }).optional(),

    /* D — the fee itself is `budget`, at the top level. */
    commercials: z.object({
        creatorCount: z.number().int().min(1).max(500).optional(),
        paymentModel: z.enum(PAYMENT_MODELS).optional(),
        product: z.object({
            offered: z.boolean().optional(),
            description: str(500).optional(),
            value: num(0, 100_000_000).optional(),
        }).optional(),
        travel: z.object({
            offered: z.boolean().optional(),
            cap: num(0, 100_000_000).optional(),
            notes: str(300).optional(),
        }).optional(),
        performanceBonus: z.object({
            offered: z.boolean().optional(),
            description: str(500).optional(),
        }).optional(),
    }).optional(),

    /* E — the deliverable deadline is `deadline`, at the top level. */
    schedule: z.object({
        campaignStart: isoDate.optional(),
        applicationDeadline: isoDate.optional(),
        selectionDeadline: isoDate.optional(),
        collaborationStart: isoDate.optional(),
        reviewWindowDays: z.number().int().min(1).max(60).nullable().optional(),
        campaignEnd: isoDate.optional(),
    }).optional(),

    /* F */
    usageRights: z.object({
        durationMonths: z.number().int().min(1).max(120).nullable().optional(),
        perpetual: z.boolean().optional(),
        channels: z.array(z.enum(USAGE_CHANNELS)).max(USAGE_CHANNELS.length).optional(),
        paidAds: z.object({
            allowed: z.boolean().optional(),
            durationMonths: z.number().int().min(1).max(120).nullable().optional(),
        }).optional(),
        exclusivity: z.object({
            required: z.boolean().optional(),
            category: str(80).optional(),
            durationMonths: z.number().int().min(1).max(120).nullable().optional(),
        }).optional(),
    }).optional(),

    /* G */
    extras: z.object({
        specialInstructions: str(2000).optional(),
        questions: z.array(campaignQuestionSchema).max(10).optional(),
    }).optional(),
});

/* ──────────────────────────── cross-field rules ──────────────────────────── */

/**
 * The timeline, in the order it has to happen.
 *
 * Read as a chain: each date must not fall before the one above it. The
 * deliverable deadline sits in the middle of the chain even though it is stored
 * as `deadline` at the top level, which is why this takes the whole campaign
 * rather than just `schedule`.
 */
export const TIMELINE_ORDER = [
    ['schedule.campaignStart', 'Campaign start'],
    ['schedule.applicationDeadline', 'Application deadline'],
    ['schedule.selectionDeadline', 'Selection deadline'],
    ['schedule.collaborationStart', 'Collaboration start'],
    ['deadline', 'Deliverable deadline'],
    ['schedule.campaignEnd', 'Campaign end'],
];

const at = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const asDate = (v) => (v ? new Date(v) : null);

/**
 * Every way a timeline can be impossible, as a list of messages.
 *
 * Returns `[]` for a valid — or simply incomplete — timeline. Only dates that
 * are actually present are compared, so a half-filled draft is not told its
 * timeline is broken; a pair that is present and out of order always is.
 */
export function timelineIssues(campaign) {
    const issues = [];

    const present = TIMELINE_ORDER
        .map(([path, label]) => ({ path, label, date: asDate(at(campaign, path)) }))
        .filter((e) => e.date && !Number.isNaN(e.date.getTime()));

    for (let i = 1; i < present.length; i += 1) {
        const prev = present[i - 1];
        const cur = present[i];
        if (cur.date < prev.date) {
            issues.push(`${cur.label} cannot be before ${prev.label.toLowerCase()}.`);
        }
    }

    /**
     * The brand's review window has to fit inside the campaign.
     *
     * Without this the dates can each be in order and the campaign still end
     * before the brand has had the days it reserved to approve the work — which
     * is a deadline the creator would be held to and the brand could not meet.
     */
    const deliverable = asDate(campaign?.deadline);
    const end = asDate(campaign?.schedule?.campaignEnd);
    const windowDays = campaign?.schedule?.reviewWindowDays;
    if (deliverable && end && windowDays) {
        const earliestEnd = new Date(deliverable.getTime() + windowDays * 24 * 60 * 60 * 1000);
        if (end < earliestEnd) {
            issues.push(
                `Campaign end leaves less than the ${windowDays}-day review window after the deliverable deadline.`,
            );
        }
    }

    return issues;
}

/** Ranges that contradict themselves. Checked on a draft: these are wrong now. */
export function rangeIssues(campaign) {
    const issues = [];
    const r = campaign?.creatorRequirements ?? {};

    if (r.ageMin != null && r.ageMax != null && r.ageMin > r.ageMax)
        issues.push('Minimum creator age cannot be above the maximum.');
    if (r.followerMin != null && r.followerMax != null && r.followerMin > r.followerMax)
        issues.push('Minimum followers cannot be above the maximum.');

    const u = campaign?.usageRights ?? {};
    // Paid-ads usage inside a finite licence cannot outlast the licence itself.
    if (!u.perpetual && u.durationMonths != null && u.paidAds?.allowed && u.paidAds.durationMonths != null
        && u.paidAds.durationMonths > u.durationMonths) {
        issues.push('Paid advertising usage cannot run longer than the overall usage period.');
    }

    return issues;
}

/** Deliverables that are present but unusable. */
export function deliverableIssues(campaign) {
    const issues = [];
    const list = campaign?.deliverables ?? [];
    const platforms = campaign?.platforms ?? [];

    for (const d of list) {
        // A deliverable on a platform the campaign did not select is how a
        // brand ends up with a YouTube requirement in an Instagram-only brief.
        if (platforms.length && !platforms.includes(d.platform)) {
            issues.push(`A ${d.contentType} deliverable is on ${d.platform}, which is not one of the selected platforms.`);
        }
        if (!(d.quantity >= 1)) {
            issues.push(`${d.platform} ${d.contentType} needs a quantity of at least one.`);
        }
    }

    // The same platform + content type twice is two rows that should be one
    // row with a higher quantity — and a creator reading it cannot tell whether
    // they are additive or a mistake.
    const seen = new Set();
    for (const d of list) {
        const key = `${d.platform}:${d.contentType}`;
        if (seen.has(key)) issues.push(`${d.contentType} on ${d.platform} is listed twice — combine them into one quantity.`);
        seen.add(key);
    }

    return issues;
}

/** Everything that is contradictory regardless of how finished the draft is. */
export function draftIssues(campaign) {
    return [...timelineIssues(campaign), ...rangeIssues(campaign), ...deliverableIssues(campaign)];
}

/* ───────────────────────────── publish readiness ─────────────────────────── */

/**
 * Section-by-section: what is still missing before this campaign can go live.
 *
 * The shape mirrors the wizard's sections so the UI can mark each one complete
 * without a second, divergent checklist of its own. `blocking` is what the
 * publish gate refuses on.
 */
export function publishReadiness(campaign, { now = new Date() } = {}) {
    const c = campaign ?? {};
    const r = c.creatorRequirements ?? {};
    const s = c.schedule ?? {};
    const u = c.usageRights ?? {};

    const sections = [
        {
            id: 'basics',
            label: 'Basic information',
            missing: [
                !c.title || c.title.trim().length < 3 ? 'Campaign name' : null,
                !c.category?.trim() ? 'Category' : null,
                !c.objective?.trim() ? 'Objective' : null,
                !c.brief?.trim() ? 'Description' : null,
            ].filter(Boolean),
        },
        {
            id: 'content',
            label: 'Platform & content',
            missing: [
                !(c.platforms?.length) ? 'At least one platform' : null,
                !(c.deliverables?.length) ? 'At least one deliverable' : null,
            ].filter(Boolean),
        },
        {
            id: 'creators',
            label: 'Creator requirements',
            // Deliberately light. Over-specifying who may apply is the brand's
            // call, not ours; a campaign open to everyone is a valid campaign.
            missing: [
                !(r.categories?.length) ? 'At least one creator category' : null,
            ].filter(Boolean),
        },
        {
            id: 'budget',
            label: 'Budget & commercials',
            missing: [
                !(Number(c.budget) > 0) ? 'Creator fee' : null,
                !(Number(c.commercials?.creatorCount) >= 1) ? 'Number of creators' : null,
            ].filter(Boolean),
        },
        {
            id: 'timeline',
            label: 'Timeline',
            missing: [
                !s.applicationDeadline ? 'Application deadline' : null,
                !c.deadline ? 'Deliverable deadline' : null,
            ].filter(Boolean),
        },
        {
            id: 'usage',
            label: 'Usage rights',
            missing: [
                !(u.channels?.length) ? 'At least one usage channel' : null,
                !u.perpetual && u.durationMonths == null ? 'Usage duration' : null,
            ].filter(Boolean),
        },
        // Section G is optional in full: special instructions and custom
        // questions are additions to a brief, not requirements of one.
        { id: 'extras', label: 'Additional requirements', missing: [] },
    ];

    const blocking = [
        ...sections.flatMap((sec) => sec.missing.map((m) => `${sec.label}: ${m} is required.`)),
        ...draftIssues(c),
    ];

    /**
     * A campaign whose application deadline has already passed would be live
     * and un-appliable at the same moment. Checked only at publish, because a
     * draft written last week and finished today is a normal thing to do.
     */
    const appDeadline = asDate(s.applicationDeadline);
    if (appDeadline && appDeadline <= now) {
        blocking.push('Timeline: the application deadline has already passed.');
    }

    return {
        sections: sections.map((sec) => ({ ...sec, complete: sec.missing.length === 0 })),
        blocking,
        ready: blocking.length === 0,
    };
}

/**
 * The flat content-type list the rest of the product still reads.
 *
 * Derived here so `contentTypes` cannot drift from `deliverables`: campaign
 * cards, discovery and `applyToCampaign` (which seeds a deal's
 * `terms.deliverables`) all read the flat list, and it predates the structured
 * brief.
 */
export function deriveContentTypes(deliverables = []) {
    return [...new Set(deliverables.map((d) => d.contentType).filter(Boolean))];
}
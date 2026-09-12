import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const FRONTEND = path.join(HERE, '..', '..', '..', 'frontend', 'src');
const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const { Campaign } = await import('../src/models/index.js');
const {
    createCampaignSchema, updateCampaignSchema,
} = await import('../src/modules/campaigns/campaigns.controller.js');
const brief = await import('../src/modules/campaigns/campaignBrief.schema.js');

/**
 * The campaign brief: storage, validation, and the two rules that decide
 * whether a campaign can go live.
 *
 * What these prove and what they do not: every assertion runs against the real
 * mongoose schema, the real zod schemas and the real controller source. No
 * MongoDB is reachable in this environment, so nothing here proves a round trip
 * persists — the schema-path tests are the guard against that, because
 * mongoose's strict mode drops an undeclared path silently and a field can look
 * saved in the UI and simply not be.
 */

/* ────────────────────────────── storage ──────────────────────────────────── */

test('Campaign declares every path the wizard writes', () => {
    const paths = [
        'category', 'objective', 'images', 'platforms', 'deliverables',
        'guidelines.dos', 'guidelines.donts', 'guidelines.hashtags',
        'guidelines.mentions', 'guidelines.cta', 'guidelines.notes',
        'creatorRequirements.categories', 'creatorRequirements.locations',
        'creatorRequirements.ageMin', 'creatorRequirements.ageMax',
        'creatorRequirements.genders', 'creatorRequirements.followerMin',
        'creatorRequirements.followerMax', 'creatorRequirements.minEngagement',
        'creatorRequirements.languages', 'creatorRequirements.audience.locations',
        'creatorRequirements.audience.ageRanges', 'creatorRequirements.audience.genders',
        'creatorRequirements.audience.interests', 'creatorRequirements.experience',
        'creatorRequirements.requireVerifiedIdentity', 'creatorRequirements.requireVerifiedSocial',
        'commercials.creatorCount', 'commercials.paymentModel',
        'commercials.product.offered', 'commercials.product.description', 'commercials.product.value',
        'commercials.travel.offered', 'commercials.travel.cap', 'commercials.travel.notes',
        'commercials.performanceBonus.offered', 'commercials.performanceBonus.description',
        'schedule.campaignStart', 'schedule.applicationDeadline', 'schedule.selectionDeadline',
        'schedule.collaborationStart', 'schedule.reviewWindowDays', 'schedule.campaignEnd',
        'usageRights.durationMonths', 'usageRights.perpetual', 'usageRights.channels',
        'usageRights.paidAds.allowed', 'usageRights.paidAds.durationMonths',
        'usageRights.exclusivity.required', 'usageRights.exclusivity.category',
        'usageRights.exclusivity.durationMonths',
        'extras.specialInstructions', 'extras.questions',
    ];

    for (const p of paths) {
        assert.ok(Campaign.schema.path(p), `Campaign must declare "${p}" or strict mode drops it`);
    }
});

test('the fee and the deliverable deadline are not stored twice', () => {
    // The wizard's "Creator fee" writes `budget` and its "Deliverable deadline"
    // writes `deadline`. A second copy inside commercials/schedule is a number
    // that can disagree with the one escrow is funded against.
    assert.ok(Campaign.schema.path('budget'));
    assert.ok(Campaign.schema.path('deadline'));
    assert.equal(Campaign.schema.path('commercials.creatorFee'), undefined);
    assert.equal(Campaign.schema.path('schedule.deliverableDeadline'), undefined);
});

test('contentTypes is derived, never taken from the client', () => {
    const controller = code('modules/campaigns/campaigns.controller.js');
    assert.match(controller, /campaign\.contentTypes = deriveContentTypes\(body\.deliverables\)/);

    assert.deepEqual(
        brief.deriveContentTypes([
            { contentType: 'Reel' }, { contentType: 'Post' }, { contentType: 'Reel' },
        ]),
        ['Reel', 'Post'],
        'duplicates collapse — the flat list is a set',
    );
});

/* ───────────────────────────── deliverables ──────────────────────────────── */

test('a content type must belong to its platform', () => {
    const ok = brief.deliverableSchema.safeParse({
        platform: 'youtube', contentType: 'Short', quantity: 1,
    });
    assert.equal(ok.success, true, JSON.stringify(ok.error?.flatten()));

    const bad = brief.deliverableSchema.safeParse({
        platform: 'youtube', contentType: 'Carousel', quantity: 1,
    });
    assert.equal(bad.success, false, 'a YouTube Carousel does not exist');
});

test('only the platforms Marqueiver integrates with are accepted', () => {
    assert.deepEqual(brief.PLATFORMS, ['instagram', 'youtube', 'facebook']);
    const bad = brief.deliverableSchema.safeParse({
        platform: 'tiktok', contentType: 'Reel', quantity: 1,
    });
    assert.equal(bad.success, false, 'no TikTok connection exists to match a creator against');
});

test('a quantity below one is refused', () => {
    for (const quantity of [0, -1]) {
        assert.equal(
            brief.deliverableSchema.safeParse({ platform: 'instagram', contentType: 'Reel', quantity }).success,
            false,
        );
    }
});

test('a deliverable on an unselected platform is caught', () => {
    const issues = brief.deliverableIssues({
        platforms: ['instagram'],
        deliverables: [{ platform: 'youtube', contentType: 'Video', quantity: 1 }],
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0], /not one of the selected platforms/);
});

test('the same deliverable twice is caught', () => {
    const issues = brief.deliverableIssues({
        platforms: ['instagram'],
        deliverables: [
            { platform: 'instagram', contentType: 'Reel', quantity: 1 },
            { platform: 'instagram', contentType: 'Reel', quantity: 2 },
        ],
    });
    assert.equal(issues.some((i) => /listed twice/.test(i)), true);
});

/* ─────────────────────────────── timeline ────────────────────────────────── */

test('the timeline must run forwards, pair by pair', () => {
    const valid = {
        deadline: '2026-11-20',
        schedule: {
            campaignStart: '2026-10-01',
            applicationDeadline: '2026-10-10',
            selectionDeadline: '2026-10-15',
            collaborationStart: '2026-10-20',
            campaignEnd: '2026-11-30',
        },
    };
    assert.deepEqual(brief.timelineIssues(valid), []);

    // Each date in turn moved before the one above it.
    const cases = [
        ['schedule.applicationDeadline', '2026-09-01'],
        ['schedule.selectionDeadline', '2026-10-05'],
        ['schedule.collaborationStart', '2026-10-12'],
        ['deadline', '2026-10-18'],
        ['schedule.campaignEnd', '2026-11-01'],
    ];

    for (const [pathStr, bad] of cases) {
        const broken = JSON.parse(JSON.stringify(valid));
        if (pathStr === 'deadline') broken.deadline = bad;
        else broken.schedule[pathStr.split('.')[1]] = bad;

        assert.ok(
            brief.timelineIssues(broken).length > 0,
            `${pathStr} set to ${bad} must be reported as out of order`,
        );
    }
});

test('a half-filled timeline is not called broken', () => {
    // A brand partway through the wizard has two of six dates. Refusing that
    // save would lose their work; only dates that are present are compared.
    assert.deepEqual(brief.timelineIssues({ schedule: { campaignStart: '2026-10-01' } }), []);
    assert.deepEqual(
        brief.timelineIssues({ deadline: '2026-11-01', schedule: { campaignStart: '2026-10-01' } }),
        [],
    );
});

test('the campaign must not end before the review window closes', () => {
    const issues = brief.timelineIssues({
        deadline: '2026-11-20',
        schedule: { campaignEnd: '2026-11-22', reviewWindowDays: 7 },
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0], /review window/);

    assert.deepEqual(
        brief.timelineIssues({
            deadline: '2026-11-20',
            schedule: { campaignEnd: '2026-11-28', reviewWindowDays: 7 },
        }),
        [],
    );
});

test('ranges that contradict themselves are refused', () => {
    assert.match(
        brief.rangeIssues({ creatorRequirements: { ageMin: 40, ageMax: 20 } })[0],
        /age/,
    );
    assert.match(
        brief.rangeIssues({ creatorRequirements: { followerMin: 100000, followerMax: 5000 } })[0],
        /followers/,
    );
    assert.match(
        brief.rangeIssues({
            usageRights: { durationMonths: 6, paidAds: { allowed: true, durationMonths: 12 } },
        })[0],
        /Paid advertising/,
    );
    // Perpetual usage has no ceiling for paid ads to exceed.
    assert.deepEqual(
        brief.rangeIssues({
            usageRights: { perpetual: true, durationMonths: 6, paidAds: { allowed: true, durationMonths: 12 } },
        }),
        [],
    );
});

/* ──────────────────────────── publish readiness ──────────────────────────── */

const COMPLETE = {
    title: 'Monsoon hair care launch',
    category: 'Beauty & Personal Care',
    objective: 'Product launch',
    brief: 'Toxin-free hair care for the monsoon.',
    platforms: ['instagram'],
    deliverables: [{ platform: 'instagram', contentType: 'Reel', quantity: 2 }],
    creatorRequirements: { categories: ['Beauty & Personal Care'] },
    budget: 45000,
    commercials: { creatorCount: 5 },
    deadline: '2099-11-20',
    schedule: { applicationDeadline: '2099-10-10', campaignEnd: '2099-11-30' },
    usageRights: { channels: ['Brand social channels'], durationMonths: 12 },
};

test('a complete campaign is publishable', () => {
    const r = brief.publishReadiness(COMPLETE);
    assert.equal(r.ready, true, r.blocking.join(' | '));
    assert.equal(r.sections.every((s) => s.complete), true);
});

test('each required field blocks publication on its own', () => {
    const removals = [
        ['title', 'Campaign name'],
        ['category', 'Category'],
        ['objective', 'Objective'],
        ['brief', 'Description'],
        ['platforms', 'platform'],
        ['deliverables', 'deliverable'],
        ['budget', 'Creator fee'],
    ];

    for (const [field, expected] of removals) {
        const c = { ...COMPLETE };
        delete c[field];
        const r = brief.publishReadiness(c);
        assert.equal(r.ready, false, `removing ${field} must block publication`);
        assert.ok(
            r.blocking.some((b) => b.toLowerCase().includes(expected.toLowerCase())),
            `the reason must name ${expected}; got: ${r.blocking.join(' | ')}`,
        );
    }
});

test('a missing deadline or application deadline blocks publication', () => {
    for (const drop of ['deadline', 'applicationDeadline']) {
        const c = JSON.parse(JSON.stringify(COMPLETE));
        if (drop === 'deadline') delete c.deadline;
        else delete c.schedule.applicationDeadline;

        const r = brief.publishReadiness(c);
        assert.equal(r.ready, false, `${drop} is required to publish`);
    }
});

test('usage rights: a channel and a duration are both required', () => {
    const noChannels = { ...COMPLETE, usageRights: { durationMonths: 12, channels: [] } };
    assert.equal(brief.publishReadiness(noChannels).ready, false);

    const noDuration = { ...COMPLETE, usageRights: { channels: ['Print'] } };
    assert.equal(brief.publishReadiness(noDuration).ready, false);

    // …unless usage is perpetual, in which case a duration is meaningless.
    const perpetual = { ...COMPLETE, usageRights: { channels: ['Print'], perpetual: true } };
    assert.equal(brief.publishReadiness(perpetual).ready, true, brief.publishReadiness(perpetual).blocking.join(' | '));
});

test('a campaign whose application deadline has passed cannot be published', () => {
    const past = JSON.parse(JSON.stringify(COMPLETE));
    past.schedule.applicationDeadline = '2020-01-01';
    past.schedule.campaignEnd = '2020-06-01';
    past.deadline = '2020-03-01';

    const r = brief.publishReadiness(past);
    assert.equal(r.ready, false);
    assert.ok(r.blocking.some((b) => /already passed/.test(b)));
});

test('an incoherent timeline blocks publication as well as saving', () => {
    const backwards = JSON.parse(JSON.stringify(COMPLETE));
    backwards.schedule.campaignStart = '2099-12-01';   // after everything else
    assert.equal(brief.publishReadiness(backwards).ready, false);
    assert.ok(brief.draftIssues(backwards).length > 0);
});

test('Section G is optional in full', () => {
    const r = brief.publishReadiness(COMPLETE);
    const extras = r.sections.find((s) => s.id === 'extras');
    assert.equal(extras.complete, true, 'special instructions and questions are additions, not requirements');
});

/* ───────────────────────────── the publish gate ──────────────────────────── */

test('both routes into review run the same gate', () => {
    const controller = code('modules/campaigns/campaigns.controller.js');

    // create with submit:true …
    const create = controller.slice(
        controller.indexOf('export const createCampaign = '),
        controller.indexOf('function assertPublishable'),
    );
    assert.match(create, /assertPublishable\(campaign\)/);

    // … and the separate submit-for-review endpoint.
    const submit = controller.slice(controller.indexOf('export const submitCampaignForReview'));
    assert.match(submit.slice(0, 1600), /assertPublishable\(campaign\)/);
});

test('a draft save refuses contradictions but not incompleteness', () => {
    const controller = code('modules/campaigns/campaigns.controller.js');
    assert.match(controller, /function assertDraftIsCoherent/);
    assert.match(controller, /draftIssues\(/);

    // An almost-empty draft is a legitimate save.
    const nearlyEmpty = createCampaignSchema.safeParse({ title: 'Untitled campaign' });
    assert.equal(nearlyEmpty.success, true, JSON.stringify(nearlyEmpty.error?.flatten()));
    assert.equal(brief.draftIssues({ title: 'Untitled campaign' }).length, 0);
});

test('a brand still cannot publish its own campaign by PATCH', () => {
    // The approval queue is the point: `open` is not an option here, and only
    // `closed` is. This predates the wizard and must survive it.
    assert.equal(updateCampaignSchema.safeParse({ status: 'open' }).success, false);
    assert.equal(updateCampaignSchema.safeParse({ status: 'pending_review' }).success, false);
    assert.equal(updateCampaignSchema.safeParse({ status: 'closed' }).success, true);
});

test('the update schema is strict, so the wizard cannot send junk unnoticed', () => {
    assert.equal(
        updateCampaignSchema.safeParse({ title: 'Fine', _id: 'abc' }).success,
        false,
        'an _id read back from a loaded draft must be rejected, not silently stored',
    );
});

/* ─────────────────── the wizard offers what the server accepts ───────────── */

test('the wizard vocabularies match the server', () => {
    /**
     * The frontend cannot import from the server package, so the option lists
     * are repeated in `components/campaign/vocab.js`. The failure mode when
     * they drift is silent and confusing: the wizard offers an option, the
     * brand picks it, and the save fails naming a field they never saw.
     */
    const vocabPath = path.join(FRONTEND, 'components', 'campaign', 'vocab.js');
    if (!existsSync(vocabPath)) {
        assert.fail(`the wizard vocabulary file is missing: ${vocabPath}`);
    }
    const vocab = readFileSync(vocabPath, 'utf8');

    const listInFile = (name) => {
        const m = vocab.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\];`));
        assert.ok(m, `${name} must be exported from vocab.js`);
        return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    };

    assert.deepEqual(listInFile('PLATFORMS'), brief.PLATFORMS);
    assert.deepEqual(listInFile('OBJECTIVES'), brief.OBJECTIVES);
    assert.deepEqual(listInFile('PAYMENT_MODELS'), brief.PAYMENT_MODELS);
    assert.deepEqual(listInFile('USAGE_CHANNELS'), brief.USAGE_CHANNELS);
    assert.deepEqual(listInFile('QUESTION_TYPES'), brief.QUESTION_TYPES);
    assert.deepEqual(listInFile('GENDERS'), brief.GENDERS);
    assert.deepEqual(
        listInFile('TIMED_CONTENT_TYPES').sort(),
        [...brief.TIMED_CONTENT_TYPES].sort(),
    );

    // The per-platform content types, which is where a mismatch would actually
    // bite: an option the wizard offers that the deliverable schema refuses.
    const block = vocab.match(/export const CONTENT_TYPES = \{([\s\S]*?)\n\};/);
    assert.ok(block, 'CONTENT_TYPES must be exported from vocab.js');
    for (const platform of brief.PLATFORMS) {
        const row = block[1].match(new RegExp(`${platform}: \\[([^\\]]*)\\]`));
        assert.ok(row, `vocab.js must list content types for ${platform}`);
        const types = [...row[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
        assert.deepEqual(types, brief.CONTENT_TYPES[platform], `${platform} content types drifted`);

        // And every one of them actually validates.
        for (const contentType of types) {
            assert.equal(
                brief.deliverableSchema.safeParse({ platform, contentType, quantity: 1 }).success,
                true,
                `the wizard offers ${platform}/${contentType} but the server refuses it`,
            );
        }
    }
});

/* ─────────────────────── nothing existing was broken ─────────────────────── */

test('applications still read the flat contentTypes list', () => {
    // `applyToCampaign` seeds a deal's terms from `contentTypes`. The structured
    // brief must not have orphaned it.
    const controller = code('modules/campaigns/campaigns.controller.js');
    const apply = controller.slice(controller.indexOf('export const applyToCampaign'));
    assert.match(apply.slice(0, 2500), /campaign\.contentTypes/);
});

test('campaign questions are answered by key, not by position', () => {
    /**
     * This test used to assert that nothing consumed the questions, because
     * applications were out of scope when the wizard was built. They are in
     * scope now, so it asserts the thing that actually matters instead: an
     * answer is matched to its question by the question's stable `key`, so
     * rewording a prompt — or reordering the list — does not silently attach an
     * answer to a different question.
     */
    assert.ok(Campaign.schema.path('extras.questions'));

    const answer = Campaign.schema.path('applicants').schema
        .path('submission').schema.path('answers');
    assert.ok(answer, 'an application stores answers');
    assert.ok(answer.schema.path('key'), 'keyed by the question key');

    const controller = code('modules/campaigns/campaigns.controller.js');
    assert.match(controller, /pruneAnswers\(body\.answers, campaign\)/,
        'answers to questions the campaign does not ask are dropped');
});

test('a choice question needs options', () => {
    const bad = brief.campaignQuestionSchema.safeParse({
        key: 'q1', prompt: 'Pick one', type: 'single_choice', required: true, options: ['only one'],
    });
    assert.equal(bad.success, false);

    const good = brief.campaignQuestionSchema.safeParse({
        key: 'q1', prompt: 'Pick one', type: 'single_choice', required: true, options: ['a', 'b'],
    });
    assert.equal(good.success, true, JSON.stringify(good.error?.flatten()));
});
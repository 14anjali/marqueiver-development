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

const {
    Campaign, APPLICATION_STATUSES, LEGACY_APPLICATION_STATUSES,
    BRAND_DECISION_STATUSES, TERMINAL_APPLICATION_STATUSES,
    normaliseApplicationStatus,
} = await import('../src/models/Campaign.js');
const {
    applicationSchema, validateAgainstCampaign, pruneAnswers,
} = await import('../src/modules/campaigns/application.schema.js');
const {
    decideApplicantSchema, withdrawApplicationSchema,
} = await import('../src/modules/campaigns/campaigns.controller.js');

/**
 * The creator application: what is stored, what is validated, and which
 * transitions are allowed to touch the Deal.
 *
 * The last of those is the one worth guarding. An application produces a Deal
 * (cleared rules §2), and only the brand's acceptance may move it into
 * negotiation (§3) — so a shortlist must not, and a withdrawal must decline it
 * rather than leave a live deal behind a creator who has gone.
 *
 * No database is reachable here, so nothing proves a write persists. What is
 * proven is the schema, the validation rules and the branches in the handler.
 */

/* ─────────────────────────────── storage ────────────────────────────────── */

const applicantSchema = () => Campaign.schema.path('applicants').schema;

test('an application stores everything the form sends', () => {
    const s = applicantSchema();
    for (const p of [
        'submission.pitch', 'submission.proposedPrice', 'submission.portfolioLinks',
        'submission.attachments', 'submission.answers',
        'history', 'status', 'appliedAt', 'decidedAt', 'withdrawnAt', 'deal',
    ]) {
        assert.ok(s.path(p), `applicant must declare "${p}" or strict mode drops it`);
    }

    // The history entry has to carry who and when, or a timeline is a list of
    // words with no dates.
    const history = s.path('history').schema;
    for (const p of ['status', 'at', 'by', 'byRole', 'message']) {
        assert.ok(history.path(p), `history entry must declare "${p}"`);
    }
});

test('the six statuses exist, and start at applied', () => {
    assert.deepEqual(APPLICATION_STATUSES, [
        'applied', 'under_review', 'shortlisted', 'selected', 'rejected', 'withdrawn',
    ]);
    assert.equal(applicantSchema().path('status').defaultValue, 'applied');
});

test('the legacy statuses are still accepted, and map forward', () => {
    /**
     * Mongoose validates on write. If `pending` stopped being legal, a campaign
     * still holding one would fail to save — including when a *new* creator
     * applied to it, which is a failure with nothing in it to suggest the cause.
     */
    const allowed = applicantSchema().path('status').enumValues;
    for (const legacy of LEGACY_APPLICATION_STATUSES) {
        assert.ok(allowed.includes(legacy), `${legacy} must stay writable until the migration has run`);
    }

    assert.equal(normaliseApplicationStatus('pending'), 'applied');
    assert.equal(normaliseApplicationStatus('accepted'), 'selected');
    assert.equal(normaliseApplicationStatus('shortlisted'), 'shortlisted');
});

test('a migration exists to retire the legacy statuses', () => {
    const file = path.join(SRC, 'utils', 'migrate-application-statuses.js');
    assert.ok(existsSync(file), 'the legacy values need a way out, not just tolerance');
    const src = readFileSync(file, 'utf8');
    assert.match(src, /pending: 'applied'/);
    assert.match(src, /accepted: 'selected'/);
    assert.match(src, /--apply/, 'destructive scripts in this repo are dry-run by default');
});

/* ────────────────────────────── validation ──────────────────────────────── */

test('a pitch is required, with a floor as well as a ceiling', () => {
    assert.equal(applicationSchema.safeParse({ pitch: '' }).success, false);
    assert.equal(applicationSchema.safeParse({ pitch: 'yes pls' }).success, false,
        'a one-line pitch is an application the brand cannot act on');

    const good = applicationSchema.safeParse({ pitch: 'x'.repeat(60) });
    assert.equal(good.success, true, JSON.stringify(good.error?.flatten()));

    assert.equal(applicationSchema.safeParse({ pitch: 'x'.repeat(2001) }).success, false);
});

test('portfolio links must be real http links', () => {
    const base = { pitch: 'x'.repeat(60) };
    assert.equal(
        applicationSchema.safeParse({ ...base, portfolioLinks: ['https://example.com/a'] }).success,
        true,
    );
    for (const bad of ['not a link', 'javascript:alert(1)', 'ftp://example.com']) {
        assert.equal(
            applicationSchema.safeParse({ ...base, portfolioLinks: [bad] }).success,
            false,
            `${bad} must be refused`,
        );
    }
});

test('unknown fields are refused rather than stored', () => {
    assert.equal(
        applicationSchema.safeParse({ pitch: 'x'.repeat(60), status: 'selected' }).success,
        false,
        'an application must not be able to set its own status',
    );
});

/* ──────────────── validation that needs the campaign itself ─────────────── */

const campaignWith = (questions, extra = {}) => ({
    extras: { questions },
    commercials: { allowProposedPrice: true, ...(extra.commercials ?? {}) },
    ...extra,
});

const QUESTIONS = [
    { key: 'q1', prompt: 'Are you free on the 14th?', type: 'single_choice', required: true, options: ['Yes', 'No'] },
    { key: 'q2', prompt: 'Link a past collaboration', type: 'link', required: false, options: [] },
    { key: 'q3', prompt: 'How many reels have you made?', type: 'number', required: false, options: [] },
    { key: 'q4', prompt: 'Which formats suit you?', type: 'multi_choice', required: false, options: ['Reel', 'Story'] },
];

test('a required question must be answered, and the message names it', () => {
    const problems = validateAgainstCampaign({ answers: [] }, campaignWith(QUESTIONS));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Are you free on the 14th\?/,
        'a creator cannot act on "q1 is required"');
});

test('an optional question left blank is fine', () => {
    const problems = validateAgainstCampaign(
        { answers: [{ key: 'q1', value: 'Yes' }] },
        campaignWith(QUESTIONS),
    );
    assert.deepEqual(problems, []);
});

test('a choice answer must be one of the options', () => {
    const problems = validateAgainstCampaign(
        { answers: [{ key: 'q1', value: 'Maybe' }] },
        campaignWith(QUESTIONS),
    );
    assert.ok(problems.some((p) => /not one of the options/.test(p)));
});

test('a multi-choice answer is checked option by option', () => {
    const ok = validateAgainstCampaign(
        { answers: [{ key: 'q1', value: 'Yes' }, { key: 'q4', values: ['Reel', 'Story'] }] },
        campaignWith(QUESTIONS),
    );
    assert.deepEqual(ok, []);

    const bad = validateAgainstCampaign(
        { answers: [{ key: 'q1', value: 'Yes' }, { key: 'q4', values: ['Reel', 'Podcast'] }] },
        campaignWith(QUESTIONS),
    );
    assert.ok(bad.some((p) => /Podcast/.test(p)));
});

test('link and number questions are type-checked', () => {
    const bad = validateAgainstCampaign(
        {
            answers: [
                { key: 'q1', value: 'Yes' },
                { key: 'q2', value: 'instagram.com/p/abc' },
                { key: 'q3', value: 'lots' },
            ],
        },
        campaignWith(QUESTIONS),
    );
    assert.ok(bad.some((p) => /needs a link/.test(p)));
    assert.ok(bad.some((p) => /needs a number/.test(p)));
});

test('an answer to a question that no longer exists is refused, not dropped', () => {
    // The form was built from a different version of the campaign. Silently
    // discarding the answer would mean the creator believes they answered.
    const problems = validateAgainstCampaign(
        { answers: [{ key: 'q1', value: 'Yes' }, { key: 'gone', value: 'x' }] },
        campaignWith(QUESTIONS),
    );
    assert.ok(problems.some((p) => /questions have changed/.test(p)));
});

test('a proposed price is refused when the campaign is fixed-fee', () => {
    const fixed = campaignWith([], { commercials: { allowProposedPrice: false } });
    const problems = validateAgainstCampaign({ proposedPrice: 50000, answers: [] }, fixed);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /fixed fee/);

    // And accepted when it is not.
    assert.deepEqual(
        validateAgainstCampaign({ proposedPrice: 50000, answers: [] }, campaignWith([])),
        [],
    );
});

test('pruneAnswers keeps only questions the campaign asks', () => {
    const kept = pruneAnswers(
        [{ key: 'q1', value: 'Yes' }, { key: 'ghost', value: 'x' }],
        campaignWith(QUESTIONS),
    );
    assert.deepEqual(kept.map((a) => a.key), ['q1']);
});

/* ───────────────────────── duplicates and withdrawal ────────────────────── */

test('a second application is refused, withdrawn ones included', () => {
    const controller = code('modules/campaigns/campaigns.controller.js');
    const apply = controller.slice(
        controller.indexOf('export const applyToCampaign'),
        controller.indexOf('export const decideApplicantSchema'),
    );

    assert.match(apply, /ALREADY_APPLIED/);
    // A withdrawal the brand has already seen must not be erasable by
    // withdrawing and applying again.
    assert.match(apply, /withdrew from this campaign/);

    // And the database index is still the backstop against a race.
    const model = code('models/Campaign.js');
    assert.match(model, /'applicants\.creator': \{ \$exists: true \}/);
    assert.match(model, /unique: true/);
});

test('withdrawal is creator-only and stops once a decision is made', () => {
    const controller = code('modules/campaigns/campaigns.controller.js');
    const withdraw = controller.slice(controller.indexOf('export const withdrawApplication ='));

    assert.match(withdraw, /role !== 'creator'/);
    assert.match(withdraw, /TERMINAL_APPLICATION_STATUSES\.includes\(current\)/);
    // The row is kept, not deleted: the record of a withdrawal is part of it.
    assert.equal(/deleteOne|splice|pull\(/.test(withdraw.slice(0, 1800)), false);

    assert.equal(withdrawApplicationSchema.safeParse({}).success, true);
    assert.equal(withdrawApplicationSchema.safeParse({ reason: 'x'.repeat(501) }).success, false);
});

/* ─────────────────── which decisions touch the deal, and which do not ───── */

test('the brand may set four statuses, and "accepted" still works', () => {
    assert.deepEqual(BRAND_DECISION_STATUSES, ['under_review', 'shortlisted', 'selected', 'rejected']);

    for (const status of BRAND_DECISION_STATUSES) {
        assert.equal(decideApplicantSchema.safeParse({ status }).success, true, status);
    }
    // The previous API spelling, so an older client keeps working.
    assert.equal(decideApplicantSchema.safeParse({ status: 'accepted' }).success, true);
    // But not the ones that are not the brand's to set.
    for (const status of ['applied', 'withdrawn', 'open']) {
        assert.equal(decideApplicantSchema.safeParse({ status }).success, false, status);
    }
});

test('only selected and rejected move the deal', () => {
    const controller = code('modules/campaigns/campaigns.controller.js');
    const decide = controller.slice(
        controller.indexOf('export const decideApplicant ='),
        controller.indexOf('export const withdrawApplicationSchema'),
    );

    assert.match(decide, /next === 'selected'/);
    assert.match(decide, /next === 'rejected'/);

    // A shortlist is not an agreement. If it transitioned the deal, a brand
    // could reach negotiation without the acceptance §3 requires.
    for (const status of ['under_review', 'shortlisted']) {
        assert.equal(
            new RegExp(`next === '${status}'[\\s\\S]{0,200}transitionDeal`).test(decide), false,
            `${status} must not transition the deal`,
        );
    }

    // Exactly two transitions in the handler.
    assert.equal((decide.match(/transitionDeal\(/g) ?? []).length, 2);
});

test('a finished application does not move again', () => {
    assert.deepEqual(TERMINAL_APPLICATION_STATUSES, ['selected', 'rejected', 'withdrawn']);

    const controller = code('modules/campaigns/campaigns.controller.js');
    const decide = controller.slice(controller.indexOf('export const decideApplicant ='));
    assert.match(decide.slice(0, 2000), /TERMINAL_APPLICATION_STATUSES\.includes\(current\)/);
    // A brand must not be able to overrule a creator who has left.
    assert.match(decide.slice(0, 2000), /withdrew their application/);
});

test('every status change is recorded, with who made it', () => {
    const controller = code('modules/campaigns/campaigns.controller.js');
    for (const [handler, role] of [
        ['export const applyToCampaign', "byRole: 'creator'"],
        ['export const decideApplicant =', "byRole: 'brand'"],
        ['export const withdrawApplication =', "byRole: 'creator'"],
    ]) {
        const body = controller.slice(controller.indexOf(handler));
        assert.match(body.slice(0, 2600), /history/, `${handler} must record history`);
        assert.match(body.slice(0, 2600), new RegExp(role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

/* ─────────────────────────── nothing else moved ─────────────────────────── */

test('the application does not set the deal’s price', () => {
    /**
     * Negotiation is explicitly not part of this. `proposedPrice` is a number
     * the brand reads; the deal's amount still comes from the campaign fee, and
     * an application that could set it would be a negotiation with one party.
     */
    const controller = code('modules/campaigns/campaigns.controller.js');
    const apply = controller.slice(
        controller.indexOf('export const applyToCampaign'),
        controller.indexOf('export const decideApplicantSchema'),
    );

    assert.match(apply, /const budget = campaign\.budget \?\? 0/);
    assert.match(apply, /amount: budget/);
    assert.equal(
        /amount:\s*(body\.)?proposedPrice/.test(apply), false,
        'the escrow amount must not come from the application',
    );
});

test('eligibility still does not gate applying', () => {
    const controller = code('modules/campaigns/campaigns.controller.js');
    const apply = controller.slice(
        controller.indexOf('export const applyToCampaign'),
        controller.indexOf('export const decideApplicantSchema'),
    );
    assert.equal(/creatorEligibility/.test(apply), false);
});

/* ───────────────── the UI vocabulary matches the server's ───────────────── */

test('the frontend status vocabulary matches the model', () => {
    const file = path.join(FRONTEND, 'components', 'campaign', 'applicationStatus.js');
    assert.ok(existsSync(file), `missing: ${file}`);
    const src = readFileSync(file, 'utf8');

    const listed = src.match(/export const APPLICATION_STATUSES = \[([\s\S]*?)\];/);
    assert.ok(listed, 'APPLICATION_STATUSES must be exported');
    const statuses = [...listed[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(statuses, APPLICATION_STATUSES,
        'a status the server sends and the UI does not know renders as a blank pill');

    // Every status needs a label, or the creator reads a raw enum value.
    for (const status of APPLICATION_STATUSES) {
        assert.ok(src.includes(`${status}: {`), `${status} needs an entry in STATUS_META`);
    }

    // And the legacy spellings map the same way on both sides.
    assert.match(src, /pending: 'applied'/);
    assert.match(src, /accepted: 'selected'/);
});
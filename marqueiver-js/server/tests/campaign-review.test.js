import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';

const { Campaign, CREATOR_VISIBLE_STATUSES, CAMPAIGN_EDITABLE_STATUSES } =
    await import('../src/models/Campaign.js');
const campaigns = await import('../src/modules/campaigns/campaigns.controller.js');
const admin = await import('../src/modules/admin/admin.controller.js');

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (p) => readFileSync(path.join(SRC, p), 'utf8');

/**
 * D-1 — campaigns are reviewed before they are published.
 *
 * The confirmed model is: Campaign → Review → Admin approval → Published.
 * The risk in a review queue is not that approval fails; it is that some other
 * path reaches `open` without passing through it. Most of these tests are
 * about closing those paths.
 */

/* ─────────────────────────── the lifecycle itself ─────────────────────────── */

test('a new campaign is not live', () => {
    const c = new Campaign({ brand: '507f1f77bcf86cd799439011', title: 'Test' });

    assert.equal(c.status, 'pending_review');
    assert.notEqual(c.status, 'open', 'defaulting to open makes the queue decorative');
});

test('the lifecycle has all five states and creators see only one', () => {
    const states = Campaign.schema.path('status').enumValues;

    assert.deepEqual([...states].sort(),
        ['closed', 'draft', 'open', 'pending_review', 'rejected']);
    assert.deepEqual(CREATOR_VISIBLE_STATUSES, ['open']);
});

test('rejected is its own state, not a flavour of closed', () => {
    // A brand must be able to tell "we turned this down, fix it and resubmit"
    // apart from "this campaign ran its course".
    const states = Campaign.schema.path('status').enumValues;

    assert.ok(states.includes('rejected'));
    assert.ok(states.includes('closed'));
});

test('the review record keeps the reason and the submission count', () => {
    const c = new Campaign({ brand: '507f1f77bcf86cd799439011', title: 'Test' });

    // Mongoose strict mode drops undeclared paths silently — this project has
    // lost data to that twice, so the paths are asserted rather than assumed.
    assert.notEqual(Campaign.schema.path('review.reason'), undefined);
    assert.notEqual(Campaign.schema.path('review.submittedAt'), undefined);
    assert.notEqual(Campaign.schema.path('review.decidedBy'), undefined);
    assert.notEqual(Campaign.schema.path('review.internalNote'), undefined);
    assert.equal(c.review.submissionCount, 0);
});

/* ──────────────────── no other route reaches `open` ───────────────────────── */

test('a brand cannot publish its own campaign', () => {
    /**
     * The schema used to accept `status: z.enum(['open','closed'])` and applied
     * it with a blind Object.assign, so a brand could PATCH itself live and
     * skip review entirely. `open` must not be offered here at all.
     */
    const parsed = campaigns.updateCampaignSchema.safeParse({ status: 'open' });
    assert.equal(parsed.success, false, 'PATCH must not accept status: open');

    assert.equal(campaigns.updateCampaignSchema.safeParse({ status: 'closed' }).success, true,
        'a brand may still close its own campaign');
});

test('the brand PATCH schema is strict, so unknown keys cannot slip through', () => {
    // Without .strict() an unexpected key is stripped silently rather than
    // refused, which hides exactly this class of privilege mistake.
    const parsed = campaigns.updateCampaignSchema.safeParse({ publishedAt: new Date().toISOString() });
    assert.equal(parsed.success, false);
});

test('approval is the only writer of the open state', () => {
    // Grep the whole campaigns module: nothing there may assign 'open'.
    const controller = read('modules/campaigns/campaigns.controller.js');

    assert.doesNotMatch(controller, /status\s*=\s*'open'/,
        'only the admin decision handler may publish a campaign');

    const adminSrc = read('modules/admin/admin.controller.js');
    assert.match(adminSrc, /decision === 'approved' \? 'open' : 'rejected'/);
});

/* ───────────────── unapproved campaigns are not discoverable ──────────────── */

test('creator discovery filters on the shared visible-status list', () => {
    // Written inline, a new state could be added to the model and silently
    // appear in discovery. Importing the list makes that impossible.
    const controller = read('modules/campaigns/campaigns.controller.js');

    assert.match(controller, /status: \{ \$in: CREATOR_VISIBLE_STATUSES \}/);
});

test('fetching an unapproved campaign by id is a 404, not a 403', () => {
    /**
     * Filtering the list is not enough: ids are guessable and shareable. 404
     * rather than 403 because whether a pending campaign exists is not a
     * creator's business — a 403 confirms it does.
     */
    const controller = read('modules/campaigns/campaigns.controller.js');
    const handler = controller.slice(controller.indexOf('export const getCampaign'));
    const body = handler.slice(0, handler.indexOf('\n});'));

    assert.match(body, /CREATOR_VISIBLE_STATUSES\.includes\(campaign\.status\)/);
    assert.match(body, /notFound/);
    assert.match(body, /delete campaign\.review/, 'review notes are not shown to creators');
});

test('applying to an unapproved campaign is refused', () => {
    const controller = read('modules/campaigns/campaigns.controller.js');
    const handler = controller.slice(controller.indexOf('export const applyToCampaign'));

    assert.match(handler.slice(0, 1400), /CREATOR_VISIBLE_STATUSES\.includes\(campaign\.status\)/);
});

/* ────────────────────────── the decision itself ───────────────────────────── */

test('a rejection must carry a reason the brand can act on', () => {
    const withoutReason = admin.decideCampaignSchema.safeParse({ decision: 'rejected' });
    // The schema permits it; the handler is what refuses, so assert the handler.
    assert.equal(withoutReason.success, true);

    const adminSrc = read('modules/admin/admin.controller.js');
    const handler = adminSrc.slice(adminSrc.indexOf('export const decideCampaign = catchAsync'));

    assert.match(handler.slice(0, 600), /decision === 'rejected' && !reason\?\.trim\(\)/,
        'rejecting with no explanation produces a support ticket, not a fixed campaign');
});

test('only pending campaigns can be decided', () => {
    // Two reviewers opening the same queue must not both be able to decide,
    // and an approved campaign must not be re-approved into a fresh publish date.
    const adminSrc = read('modules/admin/admin.controller.js');
    const handler = adminSrc.slice(adminSrc.indexOf('export const decideCampaign = catchAsync'));

    assert.match(handler.slice(0, 900), /campaign\.status !== 'pending_review'/);
});

test('a decision is audited and the brand is notified', () => {
    const adminSrc = read('modules/admin/admin.controller.js');
    const handler = adminSrc.slice(adminSrc.indexOf('export const decideCampaign = catchAsync'));
    const body = handler.slice(0, handler.indexOf('\n});'));

    assert.match(body, /recordAudit/, 'a publication decision must be auditable');
    assert.match(body, /notify\(/, 'a decision the brand never sees is no decision');
    assert.match(body, /\.catch\(\(\) => void 0\)/,
        'a failed notification must not roll back the decision');
});

test('the queue is served oldest-submission-first', () => {
    // Newest-first starves whatever is at the bottom, and a brand is waiting.
    const adminSrc = read('modules/admin/admin.controller.js');
    const handler = adminSrc.slice(adminSrc.indexOf('export const listCampaignReviewQueue'));

    assert.match(handler.slice(0, 500), /sort\(\{ 'review\.submittedAt': 1 \}\)/);
});

/* ───────────────────────── resubmission after rejection ───────────────────── */

test('only draft and rejected campaigns may be submitted for review', () => {
    const controller = read('modules/campaigns/campaigns.controller.js');
    const handler = controller.slice(controller.indexOf('export const submitCampaignForReview'));

    assert.match(handler.slice(0, 700), /\['draft', 'rejected'\]\.includes\(campaign\.status\)/);
});

test('resubmitting clears the previous decision', () => {
    // Otherwise a campaign sitting in the queue still shows the old rejection
    // reason next to it.
    const controller = read('modules/campaigns/campaigns.controller.js');
    const handler = controller.slice(controller.indexOf('export const submitCampaignForReview'));
    const body = handler.slice(0, handler.indexOf('\n});'));

    assert.match(body, /reason: undefined/);
    assert.match(body, /submissionCount: \(campaign\.review\?\.submissionCount \?\? 0\) \+ 1/);
});

test('a live campaign cannot have its terms edited underneath applicants', () => {
    // Creators applied against what they were shown; changing the brief or the
    // budget afterwards rewrites the terms of applications already submitted.
    assert.deepEqual([...CAMPAIGN_EDITABLE_STATUSES].sort(), ['draft', 'pending_review', 'rejected']);

    const controller = read('modules/campaigns/campaigns.controller.js');
    assert.match(controller, /CAMPAIGN_EDITABLE_STATUSES\.includes\(campaign\.status\)/);
});

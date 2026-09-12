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

const { CreatorProfile } = await import('../src/models/index.js');
const { TERMINAL_APPLICATION_STATUSES } = await import('../src/models/Campaign.js');
const { decideApplicantSchema } = await import('../src/modules/campaigns/campaigns.controller.js');

/**
 * The brand's side of an application: what it may see, and what a decision does.
 *
 * The privacy half is the one with teeth. A brand reviewing applicants is the
 * closest the product gets to handing one user another user's profile in bulk,
 * so the projection is an allow-list and this asserts that it stays one.
 */

const controller = () => code('modules/campaigns/campaigns.controller.js');
const listApplicants = () => {
    const src = controller();
    return src.slice(src.indexOf('export const listApplicants'));
};

/* ────────────────────────── what a brand may see ────────────────────────── */

test('the applicant projection is an allow-list, not a subtraction', () => {
    const src = controller();
    const match = src.match(/const APPLICANT_PROFILE_FIELDS = \[([\s\S]*?)\]\.join/);
    assert.ok(match, 'the projection must be a named list');

    const fields = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.ok(fields.length > 5, 'the review card needs more than a name');

    for (const f of fields) {
        assert.equal(f.startsWith('-'), false,
            `"${f}" makes the projection subtractive — a field added to CreatorProfile `
            + 'tomorrow would then reach a brand by default');
    }
});

test('no payout, KYC or contact field can reach a brand', () => {
    const src = controller();
    const match = src.match(/const APPLICANT_PROFILE_FIELDS = \[([\s\S]*?)\]\.join/);
    const fields = new Set([...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

    /**
     * `discovery.controller.js` established this boundary after a payout leak.
     * The same fields, plus the two contact fields Policy 4.2 keeps off the
     * platform's own surfaces.
     */
    for (const forbidden of [
        'payoutMethod', 'pan', 'kyc', 'phone', 'email', 'contactEmail', 'contactPhone',
        'dob', 'selfReportedMetrics',
    ]) {
        assert.equal(fields.has(forbidden), false, `${forbidden} must never be selected for a brand`);
    }

    // And the fields exist on the model, so this is a real exclusion rather
    // than a list of names that were never there.
    assert.ok(CreatorProfile.schema.path('payoutMethod.bankAccount')
        || CreatorProfile.schema.path('payoutMethod'), 'payoutMethod exists and is excluded');
    assert.ok(CreatorProfile.schema.path('contactEmail'), 'contactEmail exists and is excluded');
});

test('the card gets everything it renders', () => {
    const src = controller();
    const match = src.match(/const APPLICANT_PROFILE_FIELDS = \[([\s\S]*?)\]\.join/);
    const fields = new Set([...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

    for (const needed of [
        'displayName', 'avatarUrl', 'categories', 'location',
        'socialAccounts', 'totalAudience', 'avgEngagement', 'portfolio',
    ]) {
        assert.ok(fields.has(needed), `the review card shows ${needed}, so it must be selected`);
    }
});

test('verification is derived, never the documents behind it', () => {
    const handler = listApplicants();
    assert.match(handler, /kind: 'social', status: 'approved'/);
    assert.match(handler, /identity: Boolean\(user\?\.phoneVerified && user\?\.emailVerified\)/);

    // Policy 13.5 — a verification's documents are never shown to another user.
    assert.equal(/documentUrl|documents/.test(handler.slice(0, 3000)), false);
});

test('only the owning brand can read the queue', () => {
    const handler = listApplicants();
    assert.match(handler.slice(0, 500), /campaign\.brand\.toString\(\) !== req\.auth\.sub/);
    assert.match(handler.slice(0, 500), /forbidden/);
});

/* ─────────────────────────── filter and sort ────────────────────────────── */

test('filtering never widens the queue beyond this campaign', () => {
    const handler = listApplicants();
    // Every applicant comes from the campaign document that was already
    // ownership-checked; a filter selects from that array.
    assert.match(handler, /campaign\.applicants\.map/);
    assert.match(handler, /items = items\.filter\(\(a\) => a\.status === wanted\)/);
    assert.equal(/Campaign\.find\(/.test(handler), false, 'the queue is one campaign, not a search');
});

test('the five sorts exist, and a missing price sorts last', () => {
    const handler = listApplicants();
    for (const s of ['recent', 'oldest', 'followers', 'engagement', 'price']) {
        assert.ok(handler.includes(`${s}:`), `sort "${s}" must exist`);
    }
    // `?? Infinity`, not `?? 0` — an application with no proposed price is not
    // the cheapest one, and putting it top would mislead every time.
    assert.match(handler, /proposedPrice \?\? Infinity/);
});

test('counts are computed before filtering, so the tabs do not lie', () => {
    const handler = listApplicants();
    const filterAt = handler.indexOf('items = items.filter');
    const countsAt = handler.indexOf('const counts = campaign.applicants.reduce');
    assert.ok(countsAt > -1, 'counts must be returned');
    assert.ok(countsAt > filterAt, 'counts come from the campaign, not the filtered list');
    assert.match(handler, /campaign\.applicants\.reduce/);
});

/* ──────────────────── what each decision actually does ──────────────────── */

test('shortlisting is a review state, not a commitment', () => {
    // The brand may set it …
    assert.equal(decideApplicantSchema.safeParse({ status: 'shortlisted' }).success, true);

    // … and it must not touch the deal. If it did, a brand would reach
    // negotiation without the acceptance §3 requires.
    const src = controller();
    const decide = src.slice(
        src.indexOf('export const decideApplicant ='),
        src.indexOf('export const withdrawApplicationSchema'),
    );
    assert.equal(
        /next === 'shortlisted'[\s\S]{0,200}transitionDeal/.test(decide), false,
        'shortlisting must not transition the deal',
    );
    assert.equal((decide.match(/transitionDeal\(/g) ?? []).length, 2,
        'exactly two transitions: selected and rejected');
});

test('un-shortlisting is allowed — it is not a terminal state', () => {
    /**
     * "Remove from shortlist" is `shortlisted → under_review`. It works because
     * `shortlisted` is not terminal and the two statuses differ; if either of
     * those changed, the button would start returning 422.
     */
    assert.equal(TERMINAL_APPLICATION_STATUSES.includes('shortlisted'), false);
    assert.equal(decideApplicantSchema.safeParse({ status: 'under_review' }).success, true);
});

test('selecting is what opens the collaboration', () => {
    const src = controller();
    const decide = src.slice(src.indexOf('export const decideApplicant ='));
    const body = decide.slice(0, decide.indexOf('export const withdrawApplicationSchema'));

    assert.match(body, /next === 'selected'[\s\S]{0,300}to: 'negotiation'/);
    assert.match(body, /openThread/);
});

test('a decision is recorded with who made it and what they said', () => {
    const src = controller();
    const decide = src.slice(src.indexOf('export const decideApplicant ='));
    const body = decide.slice(0, 2400);

    assert.match(body, /applicant\.history\.push/);
    assert.match(body, /byRole: 'brand'/);
    assert.match(body, /message: req\.body\.message/);
    assert.equal(decideApplicantSchema.safeParse({ status: 'shortlisted', message: 'nice work' }).success, true);
    assert.equal(decideApplicantSchema.safeParse({ status: 'shortlisted', message: 'x'.repeat(501) }).success, false);
});

/* ──────────────────────── escrow stays out of this ──────────────────────── */

test('the review handlers touch no escrow or proposal machinery', () => {
    /**
     * Scoped to the two review handlers rather than the whole file: applying
     * creates the requested Deal and seeds `escrow.amount` from the campaign
     * fee, which predates this feature and is §2's behaviour. What must stay
     * absent is escrow or offer machinery inside *reviewing* an application.
     */
    const src = controller();
    const review = src.slice(
        src.indexOf('export const decideApplicant ='),
        src.indexOf('export const withdrawApplicationSchema'),
    ) + src.slice(src.indexOf('export const listApplicants'));

    for (const forbidden of ['escrow', 'createEscrowOrder', 'paymentSession', 'Offer', 'proposal']) {
        assert.equal(
            review.includes(forbidden), false,
            `${forbidden} belongs to the collaboration flow, not application review`,
        );
    }
});

/* ─────────────────────────── the review page ────────────────────────────── */

test('the review UI exists and links to the creator profile', () => {
    const card = path.join(FRONTEND, 'components', 'campaign', 'ApplicantCard.jsx');
    const page = path.join(FRONTEND, 'pages', 'CampaignApplicantsPage.jsx');
    assert.ok(existsSync(card), `missing: ${card}`);
    assert.ok(existsSync(page), `missing: ${page}`);

    const src = readFileSync(card, 'utf8');
    assert.match(src, /\/creator\/\$\{a\.creator\}/, 'the brand must be able to open the full profile');

    // The four actions the brand needs, and the two that ask first.
    for (const action of ['shortlisted', 'under_review', 'rejected', 'selected']) {
        assert.ok(src.includes(`'${action}'`), `the card must offer ${action}`);
    }
    assert.match(src, /setConfirming\('selected'\)/);
    assert.match(src, /setConfirming\('rejected'\)/);
});

test('the brand is never addressed as the creator', () => {
    /**
     * `STATUS_META.blurb` is second-person creator copy — "The brand chose
     * you." The review card rendered it verbatim, so the brand's own page told
     * the brand that a brand had chosen it. Both voices now live in one map and
     * the brand surfaces read the brand one.
     */
    const vocab = readFileSync(path.join(FRONTEND, 'components', 'campaign', 'applicationStatus.js'), 'utf8');
    assert.match(vocab, /export const brandStatusMeta/);

    // Every status with creator copy needs brand copy, or the fallback silently
    // reintroduces the bug for that one status.
    const entries = [...vocab.matchAll(/^ {2}(\w+): \{([\s\S]*?)^ {2}\},/gm)];
    assert.ok(entries.length >= 6, 'the status map must still be parseable');
    for (const [, status, body] of entries) {
        assert.match(body, /brandBlurb:/, `${status} has no brand-voice blurb`);
    }

    for (const surface of [
        path.join(FRONTEND, 'components', 'campaign', 'ApplicantCard.jsx'),
        path.join(FRONTEND, 'pages', 'CampaignApplicantsPage.jsx'),
    ]) {
        const src = readFileSync(surface, 'utf8');
        assert.match(src, /brandStatusMeta/, `${path.basename(surface)} must use the brand voice`);
        assert.equal(
            /\bstatusMeta\(/.test(src.replace(/brandStatusMeta\(/g, '')), false,
            `${path.basename(surface)} still reads the creator-voice copy`,
        );
    }
});

test('the review card renders no field the server does not send', () => {
    const src = readFileSync(path.join(FRONTEND, 'components', 'campaign', 'ApplicantCard.jsx'), 'utf8');
    // A reference to a private field would be dead code at best and a leak the
    // day someone widened the projection at worst.
    // Word boundaries: "pan" is a substring of every `<span>` on the page, and
    // a substring match here would fail for a reason that has nothing to do
    // with privacy.
    for (const forbidden of ['payoutMethod', 'contactEmail', 'contactPhone', 'pan', 'kyc', 'dob']) {
        assert.equal(
            new RegExp(`\\b${forbidden}\\b`).test(src), false,
            `the card must not reference ${forbidden}`,
        );
    }
});
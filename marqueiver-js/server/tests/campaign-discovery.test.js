import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const {
    creatorEligibility, applicationWindow,
} = await import('../src/modules/campaigns/campaignEligibility.service.js');

/**
 * Campaign publishing and creator discovery.
 *
 * The two things worth guarding here are visibility — an unapproved campaign
 * must not become reachable because a filter was added — and the brand summary
 * that discovery attaches to every campaign, which is the first place a private
 * brand field could leak into a creator-facing payload.
 *
 * Eligibility is tested against the real function with real profile shapes. No
 * database is reachable in this environment, so nothing here proves a query
 * returns the right rows; what it proves is that the rules are what they claim.
 */

/* ───────────────────────────── visibility ───────────────────────────────── */

test('discovery filters are additive — they never replace the status rule', () => {
    const controller = code('modules/campaigns/campaigns.controller.js');

    // The creator branch sets the status filter and then merges the query
    // filters onto it. Assignment instead of merge is how "search" would
    // quietly become "search everything, including drafts".
    const listing = controller.slice(
        controller.indexOf('export const listCampaigns'),
        controller.indexOf('function discoveryFilters'),
    );
    assert.match(listing, /filter = \{ status: \{ \$in: CREATOR_VISIBLE_STATUSES \} \}/);
    assert.match(listing, /Object\.assign\(filter, discoveryFilters\(req\.query\)\)/);

    // And the filter builder itself must not touch status.
    const builder = controller.slice(controller.indexOf('function discoveryFilters'));
    assert.equal(
        /status/.test(builder.slice(0, builder.indexOf('\n}'))), false,
        'discoveryFilters must not set or clear a status clause',
    );
});

test('a creator still gets 404 for an unapproved campaign', () => {
    // The detail page is new; the rule it relies on is not, and enriching the
    // response must not have moved the check.
    const controller = code('modules/campaigns/campaigns.controller.js');
    const handler = controller.slice(controller.indexOf('export const getCampaign = '));
    const body = handler.slice(0, handler.indexOf('\n});'));

    assert.match(body, /CREATOR_VISIBLE_STATUSES\.includes\(campaign\.status\)/);
    assert.match(body, /notFound/);
    assert.match(body, /delete campaign\.review/, 'review notes stay between the brand and Marqueiver');
    assert.match(body, /delete campaign\.applicants/, 'other applicants are not a creator’s business');

    // The enrichment must sit AFTER the visibility check, not before it.
    const guardAt = body.indexOf('CREATOR_VISIBLE_STATUSES');
    const enrichAt = body.indexOf('brandSummaryFor');
    assert.ok(guardAt > -1 && enrichAt > guardAt, 'enrichment must not run before the 404 guard');
});

/* ──────────────────────────── the brand summary ──────────────────────────── */

test('the brand summary names what it exposes rather than subtracting', () => {
    const service = code('modules/campaigns/brandSummary.service.js');

    const projection = service.match(/const PUBLIC_BRAND_FIELDS = '([^']+)'/);
    assert.ok(projection, 'the projection must be a named allow-list');

    const fields = projection[1].split(/\s+/);
    // An allow-list, not a `-field` subtraction: a field added to BrandProfile
    // later must not appear in a creator-facing payload by default.
    for (const f of fields) {
        assert.equal(f.startsWith('-'), false, `"${f}" makes the projection subtractive`);
    }

    for (const forbidden of ['gstin', 'billing', 'contactEmail', 'contactPhone', 'contactPerson', 'teamMembers']) {
        assert.equal(
            fields.includes(forbidden), false,
            `${forbidden} is private and must never be selected for a creator`,
        );
    }
});

test('only the derived verification level is exposed, never the evidence', () => {
    const service = code('modules/campaigns/brandSummary.service.js');
    const shape = service.slice(service.indexOf('function shape'));

    assert.match(shape, /verified: Boolean\(level\.brandVerified\)/);
    // Policy 13.5 — the documents behind a verification are never shown to
    // another user, and neither is the brand's outstanding to-do list.
    assert.equal(/requirements/.test(shape), false, 'the requirement breakdown is the brand’s own business');
    assert.equal(/outstanding/.test(shape), false);
    assert.equal(/documents/.test(shape), false);
});

test('brand summaries are fetched in one batch, not per campaign', () => {
    const service = code('modules/campaigns/brandSummary.service.js');
    const batch = service.slice(
        service.indexOf('export async function brandSummariesFor'),
        service.indexOf('export async function brandSummaryFor'),
    );
    assert.match(batch, /\$in: userIds/, 'a page of twenty campaigns must not be forty queries');
});

/* ───────────────────────────── eligibility ──────────────────────────────── */

const PROFILE = {
    categories: ['Beauty & Personal Care'],
    languages: ['Hindi', 'English'],
    location: { city: 'Mumbai', country: 'India' },
    gender: 'female',
    dob: '1995-06-01',
    totalAudience: 45000,
    avgEngagement: 3.2,
};

const USER = { phoneVerified: true, emailVerified: true };

const campaignWith = (creatorRequirements) => ({ creatorRequirements });

test('a creator who meets everything is eligible', () => {
    const e = creatorEligibility(campaignWith({
        categories: ['Beauty & Personal Care'],
        locations: ['Mumbai'],
        followerMin: 20000,
        minEngagement: 2.5,
        languages: ['Hindi'],
        requireVerifiedIdentity: true,
    }), PROFILE, USER, { verifiedSocial: true });

    assert.equal(e.evaluated, true);
    assert.equal(e.eligible, true, JSON.stringify(e.unmet));
    assert.equal(e.met, e.total);
});

test('each requirement can fail on its own, and says why', () => {
    const cases = [
        [{ categories: ['Gaming'] }, 'categories'],
        [{ locations: ['Chennai'] }, 'location'],
        [{ followerMin: 100000 }, 'followers'],
        [{ followerMax: 1000 }, 'followers'],
        [{ minEngagement: 9 }, 'engagement'],
        [{ languages: ['Tamil'] }, 'languages'],
        [{ ageMin: 60 }, 'age'],
        [{ genders: ['male'] }, 'gender'],
    ];

    for (const [requirement, id] of cases) {
        const e = creatorEligibility(campaignWith(requirement), PROFILE, USER);
        assert.equal(e.eligible, false, `${id} should have failed`);
        const check = e.checks.find((c) => c.id === id);
        assert.ok(check, `a check with id ${id} must be produced`);
        assert.equal(check.ok, false);
        assert.ok(check.detail, 'a failed check has to say what the creator’s own value is');
    }
});

test('an empty requirement is not a requirement', () => {
    const e = creatorEligibility(campaignWith({
        categories: [], locations: [], languages: [], genders: [],
    }), PROFILE, USER);
    assert.equal(e.total, 0, 'a campaign open to everyone produces no checks');
    assert.equal(e.eligible, true);
});

test('"any" gender is not a filter', () => {
    const e = creatorEligibility(campaignWith({ genders: ['any'] }), PROFILE, USER);
    assert.equal(e.checks.some((c) => c.id === 'gender'), false);
});

test('verification requirements read the real verified state', () => {
    const unverified = creatorEligibility(
        campaignWith({ requireVerifiedIdentity: true }),
        PROFILE,
        { phoneVerified: true, emailVerified: false },
    );
    assert.equal(unverified.checks.find((c) => c.id === 'verifiedIdentity').ok, false);

    const noSocial = creatorEligibility(
        campaignWith({ requireVerifiedSocial: true }), PROFILE, USER, { verifiedSocial: false },
    );
    assert.equal(noSocial.checks.find((c) => c.id === 'verifiedSocial').ok, false);

    const withSocial = creatorEligibility(
        campaignWith({ requireVerifiedSocial: true }), PROFILE, USER, { verifiedSocial: true },
    );
    assert.equal(withSocial.checks.find((c) => c.id === 'verifiedSocial').ok, true);
});

test('an unknown value is not reported as a failure the creator caused', () => {
    // No date of birth on record: we cannot tell, and `null` says so. Painting
    // that red would tell a creator they are the wrong age when we have no idea.
    const e = creatorEligibility(
        campaignWith({ ageMin: 18 }), { ...PROFILE, dob: undefined }, USER,
    );
    const age = e.checks.find((c) => c.id === 'age');
    assert.equal(age.ok, null);
    assert.equal(e.eligible, false, 'unknown still means not confirmed eligible');
});

test('zero followers points at the connection, not at the creator', () => {
    const e = creatorEligibility(
        campaignWith({ followerMin: 10000 }), { ...PROFILE, totalAudience: 0 }, USER,
    );
    const check = e.checks.find((c) => c.id === 'followers');
    assert.equal(check.ok, false);
    assert.match(check.detail, /Connect a social account/);
    assert.equal(check.fix, 'social');
});

test('a creator with no profile is told to make one, not failed item by item', () => {
    const e = creatorEligibility(campaignWith({ followerMin: 10000 }), null, USER);
    assert.equal(e.evaluated, false);
    assert.equal(e.checks.length, 0);
    assert.match(e.note, /profile/i);
});

test('eligibility is advisory — applying is not gated on it', () => {
    // The brand decides who it works with. If this ever changes, it is a
    // product decision, not a refactor.
    const controller = code('modules/campaigns/campaigns.controller.js');
    const apply = controller.slice(
        controller.indexOf('export const applyToCampaign'),
        controller.indexOf('export const decideApplicantSchema'),
    );
    assert.equal(
        /eligibility|creatorEligibility/.test(apply), false,
        'applyToCampaign must not consult eligibility',
    );
});

/* ─────────────────────────── the application window ──────────────────────── */

test('a passed application deadline closes the window', () => {
    const now = new Date('2026-10-15T00:00:00Z');

    const open = applicationWindow(
        { status: 'open', schedule: { applicationDeadline: '2026-11-01' } }, { now },
    );
    assert.equal(open.open, true);
    assert.equal(open.closedByDeadline, false);

    const past = applicationWindow(
        { status: 'open', schedule: { applicationDeadline: '2026-09-01' } }, { now },
    );
    assert.equal(past.open, false);
    assert.equal(past.closedByDeadline, true);
});

test('a campaign that is not open is closed whatever its dates say', () => {
    const w = applicationWindow(
        { status: 'closed', schedule: { applicationDeadline: '2099-01-01' } },
    );
    assert.equal(w.open, false);
    assert.equal(w.closedByStatus, true);
});

test('no deadline means the window is governed by status alone', () => {
    assert.equal(applicationWindow({ status: 'open' }).open, true);
    assert.equal(applicationWindow({ status: 'open' }).deadline, null);
});

/* ───────────────────── search does not widen what is visible ─────────────── */

test('the search regex is escaped', () => {
    const builder = code('modules/campaigns/campaigns.controller.js');
    const fn = builder.slice(builder.indexOf('function discoveryFilters'));
    assert.match(fn, /replace\(\/\[\.\*\+\?\^\$\{\}\(\)\|\[\\\]\\\\\]\/g/,
        'an unescaped "(" from a search box is a thrown error');
});

test('filters only narrow — title, category, platform and budget', () => {
    const builder = code('modules/campaigns/campaigns.controller.js');
    const fn = builder.slice(
        builder.indexOf('function discoveryFilters'),
        builder.indexOf('export const listMyApplications'),
    );
    for (const field of ['title', 'category', 'platforms', 'budget']) {
        assert.ok(fn.includes(field), `${field} should be filterable`);
    }
    // Nothing here may reach into applicants or review.
    assert.equal(/applicants|review/.test(fn), false);
});
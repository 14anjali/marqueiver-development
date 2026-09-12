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
const { searchCreatorsSchema } = await import('../src/modules/discovery/discovery.controller.js');
const { createDealSchema } = await import('../src/modules/deals/deals.controller.js');

/**
 * Route 2 — brand searches, opens a profile, sends a requirement.
 *
 * The load-bearing claim of this feature is that it is not a second product:
 * after selection, a direct approach and a campaign application are the same
 * Deal running the same state machine. Most of what follows is there to stop
 * that quietly stopping being true.
 */

const deals = () => code('modules/deals/deals.controller.js');
const discovery = () => code('modules/discovery/discovery.controller.js');
const createDealBody = () => {
    const src = deals();
    return src.slice(src.indexOf('export const createDeal ='), src.indexOf('export const listMyDeals'));
};

/* ─────────────────── one collaboration workflow, two doors ─────────────────── */

test('a direct requirement creates the same Deal an application does', () => {
    const body = createDealBody();

    // The same opening state, and the same machine after it.
    assert.match(body, /state: 'invitation'/);
    assert.match(body, /origin: 'invite'/);
    assert.match(body, /requestedBy: 'brand'/);

    // And nothing parallel: no second model, no second state vocabulary.
    for (const forbidden of ['DirectDeal', 'Outreach', 'directCollaboration', 'InviteDeal']) {
        assert.equal(body.includes(forbidden), false,
            `${forbidden} would be a second collaboration system — there must be one`);
    }
});

test('an invitation is not the first offer, from either direction', () => {
    /**
     * Cleared rules §3. `openThread` refuses unless the *receiving* party acts,
     * so the handshake is symmetric: a brand cannot invite a creator and then
     * negotiate with itself, exactly as a creator cannot apply and open
     * negotiation without the brand selecting them. `requestedBy` is the field
     * that decides which side is receiving, which is why Route 2 must set it.
     */
    const negotiation = code('modules/deals/negotiation.service.js');
    const openThread = negotiation.slice(negotiation.indexOf('export async function openThread'));
    assert.match(openThread.slice(0, 900), /actorRole === initiator/);
    assert.match(openThread.slice(0, 900), /deal\.requestedBy \?\? 'brand'/);

    assert.match(createDealBody(), /offers: \[\]/);
});

/* ──────────────────────── the requirement is a brief ──────────────────────── */

test('a requirement has to describe the work', () => {
    /**
     * The stub this replaced sent `deliverables: 'To be agreed during
     * negotiation'` on every request, so a creator was asked to accept work
     * nobody had described. A minimum length is a blunt instrument, but it is
     * the difference between a brief and a placeholder.
     */
    const ok = {
        creatorId: 'c1', title: 'Monsoon hair care',
        amount: 40000,
        deliverables: 'Two Instagram reels, 30-45 seconds, product shown in use.',
    };
    assert.equal(createDealSchema.safeParse(ok).success, true);

    assert.equal(
        createDealSchema.safeParse({ ...ok, deliverables: 'To be agreed' }).success, false,
        'a placeholder must not pass as a brief',
    );
    assert.equal(createDealSchema.safeParse({ ...ok, deliverables: '' }).success, false);
    assert.equal(createDealSchema.safeParse({ ...ok, title: 'x' }).success, false);
});

test('the schema is strict, so a typo is refused rather than dropped', () => {
    const ok = {
        creatorId: 'c1', title: 'Monsoon hair care', amount: 40000,
        deliverables: 'Two Instagram reels, 30-45 seconds, product shown in use.',
    };
    // `deliverable` (singular) silently becoming nothing is how the placeholder
    // brief got shipped in the first place.
    assert.equal(createDealSchema.safeParse({ ...ok, deliverable: 'oops' }).success, false);
});

test('usage rights travel with the requirement', () => {
    // Policy 8 — scope, including usage, is agreed before the work rather than
    // discovered after it.
    const parsed = createDealSchema.safeParse({
        creatorId: 'c1', title: 'Monsoon hair care', amount: 40000,
        deliverables: 'Two Instagram reels, 30-45 seconds, product shown in use.',
        usageRights: { licenceType: 'extended', durationMonths: 24, paidAdvertising: true },
    });
    assert.equal(parsed.success, true);
    assert.match(createDealBody(), /usageRights/);
});

test('the revision default is the platform standard, not one', () => {
    // The old stub hardcoded 1 against a standard of 3, so every direct
    // collaboration quietly started with two fewer included rounds.
    const parsed = createDealSchema.parse({
        creatorId: 'c1', title: 'Monsoon hair care', amount: 40000,
        deliverables: 'Two Instagram reels, 30-45 seconds, product shown in use.',
    });
    assert.equal(parsed.revisionsAllowed, 3);
});

/* ───────────────────── who may be sent a requirement ───────────────────── */

test('the creator is real, is a creator, and is discoverable', () => {
    const body = createDealBody();

    // `creatorId` used to go straight into the Deal unchecked, so an id
    // belonging to a brand, an admin or nothing at all created a live
    // collaboration pointing at it.
    assert.match(body, /creator\.role !== 'creator'/);
    assert.match(body, /notFound\('Creator not found'\)/);

    // Policy 3.3 — an unpublished creator has withdrawn from discovery.
    assert.match(body, /isPublished === false/);
});

test('a second live approach to the same creator is refused', () => {
    const body = createDealBody();
    assert.match(body, /state: \{ \$in: OPEN_DEAL_STATES \}/);
    assert.match(body, /conflict\(/);

    // The refusal has to name the deal, or the brand is told "you already have
    // one" with no way to reach it.
    assert.match(body, /dealId: String\(existing\._id\)/);
});

test('finished and declined collaborations do not block a new one', () => {
    // Anchored to the declaration rather than sliced to the next export:
    // `indexOf('export const createDeal')` matches `createDealSchema`, which
    // sits *above* this constant, and the slice comes back empty — a test that
    // passes because it examined nothing.
    const src = deals();
    const decl = src.match(/const OPEN_DEAL_STATES = [\s\S]{0,200}?\n\);/);
    assert.ok(decl, 'OPEN_DEAL_STATES must be a single declaration');

    for (const over of ['declined', 'cancelled', 'completed']) {
        assert.ok(decl[0].includes(`'${over}'`),
            `${over} must be excluded — brands and creators work together again`);
    }
});

/* ──────────────────────────── discovery filters ──────────────────────────── */

test('every filter the UI offers is accepted by the server', () => {
    /**
     * The failure mode this catches is silent in the worst way: a filter the
     * page sends and the schema does not know is stripped by `validate`, so the
     * brand narrows a search, the result set does not change, and nothing says
     * why.
     */
    const page = readFileSync(path.join(FRONTEND, 'pages', 'CreatorsPage.jsx'), 'utf8');
    const blank = page.match(/const BLANK = \{([\s\S]*?)\n\};/);
    assert.ok(blank, 'the filter set must be one declared object');

    const keys = [...blank[1].matchAll(/(\w+):/g)].map((m) => m[1])
        .filter((k) => !['q', 'sort'].includes(k));
    assert.ok(keys.length >= 10, 'the brief asked for a wide filter set');

    const shape = searchCreatorsSchema.shape;
    for (const k of keys) {
        assert.ok(k in shape, `the page sends "${k}" and the server would discard it`);
    }
});

test('every audience filter maps to a path that exists on the model', () => {
    const handler = discovery();
    const filterFn = handler.slice(handler.indexOf('function buildCreatorFilter'));

    for (const [param, dbPath] of [
        ['audienceLocation', 'audience.locations'],
        ['audienceAge', 'audience.ageRanges'],
        ['audienceGender', 'audience.genders'],
        ['audienceInterest', 'audience.interests'],
        ['language', 'languages'],
    ]) {
        assert.ok(filterFn.includes(param), `${param} must be applied`);
        assert.ok(
            CreatorProfile.schema.path(dbPath),
            `${dbPath} must exist on CreatorProfile, or ${param} filters on nothing`,
        );
    }
});

test('export downloads the list that is on screen', () => {
    /**
     * These were two filter bodies and they disagreed: export honoured only
     * `category` and `availableOnly`, so a brand that narrowed to eleven
     * creators and pressed Export got a thousand rows. One builder, used twice.
     */
    const handler = discovery();
    const exportFn = handler.slice(handler.indexOf('export const exportCreators'));
    assert.match(exportFn, /buildCreatorFilter\(p, await verifiedUserIds\(p\.verified\)\)/);

    const search = handler.slice(
        handler.indexOf('export const searchCreators'),
        handler.indexOf('export const searchBrands'),
    );
    assert.match(search, /buildCreatorFilter\(p, await verifiedUserIds\(p\.verified\)\)/);
});

test('a creator name with a comma cannot shift the CSV columns', () => {
    const exportFn = discovery().slice(discovery().indexOf('export const exportCreators'));
    assert.match(exportFn, /replace\(\/"\/g, '""'\)/);
    assert.match(exportFn, /cell\(i\.displayName\)/);
});

test('the verified filter distinguishes "nobody" from "no filter"', () => {
    const handler = discovery();
    const fn = handler.slice(
        handler.indexOf('async function verifiedUserIds'),
        handler.indexOf('function buildCreatorFilter'),
    );
    // `null` means no filter; `[]` means the filter matched nobody. Collapsing
    // the two would turn "show me verified creators" into "show me everyone"
    // on a platform where nobody is verified yet.
    assert.match(fn, /if \(!kind\) return null;/);
    assert.match(handler, /if \(verifiedIds\) filter\.user = \{ \$in: verifiedIds \}/);
});

/* ───────────────────────────── privacy holds ───────────────────────────── */

test('the profile a brand opens still carries no payout or contact data', () => {
    const handler = discovery();
    assert.match(handler, /const PRIVATE_CREATOR_FIELDS = '-payoutMethod -pan -phone -email -kyc'/);

    const getProfile = handler.slice(handler.indexOf('export const getCreatorProfile'));
    assert.match(getProfile, /\.select\(PRIVATE_CREATOR_FIELDS\)/);

    // Policy 13.5 — the fact of a verification, never the documents behind it.
    assert.match(getProfile, /kind: 'social', status: 'approved'/);
    assert.equal(/documentUrl|documents/.test(getProfile.slice(0, 2500)), false);
});

test('previous work is a count, not a client list', () => {
    /**
     * A creator's past collaborations are the other brands' business too. The
     * number tells a stranger what they need — first-timer or not — without
     * publishing a list nobody involved agreed to.
     */
    const getProfile = discovery().slice(discovery().indexOf('export const getCreatorProfile'));
    assert.match(getProfile, /Deal\.countDocuments\(\{ creator: profile\.user, state: 'completed' \}\)/);
    assert.equal(/Deal\.find\(/.test(getProfile), false, 'the deals themselves must not be returned');
});

test('no reviews is not a rating of zero', () => {
    const getProfile = discovery().slice(discovery().indexOf('export const getCreatorProfile'));
    // `: null`, never `: 0` — a zero renders as the worst creator on the
    // platform, which is the opposite of what "no reviews yet" means.
    assert.match(getProfile, /reviews\.length[\s\S]{0,180}: null/);
    assert.match(getProfile, /hidden: \{ \$ne: true \}/);
});

/* ──────────────────── the audience claim is never a measurement ──────────── */

test('declared audience is stamped by the server, not the client', () => {
    const users = code('modules/users/users.controller.js');
    assert.match(users, /audience: \{ \.\.\.body\.audience, declaredAt: new Date\(\) \}/);

    // And the client cannot send `declaredAt` itself.
    const schemaSrc = users.slice(users.indexOf('audience: z.object('), users.indexOf('}).optional(),\n});'));
    assert.equal(schemaSrc.includes('declaredAt'), false,
        'declaredAt is a fact about the write, not a value the writer chooses');
});

test('the audience is presented as a claim everywhere it is shown', () => {
    const profilePage = readFileSync(path.join(FRONTEND, 'pages', 'CreatorProfilePage.jsx'), 'utf8');
    const creatorsPage = readFileSync(path.join(FRONTEND, 'pages', 'CreatorsPage.jsx'), 'utf8');

    assert.match(profilePage, /Creator-declared/);
    assert.match(profilePage, /not measured/i);
    assert.match(creatorsPage, /Declared by the creator, not measured/);
});

test('the declared audience is kept apart from synced metrics', () => {
    // Policy 3.2 / 13.2 — the same separation `selfReportedMetrics` exists for.
    assert.ok(CreatorProfile.schema.path('audience.declaredAt'));
    assert.equal(CreatorProfile.schema.path('socialAccounts.audience'), undefined,
        'a declared audience must never live inside the synced account records');
});

/* ─────────────────── brand and creator speak the same words ─────────────── */

test('discovery filters and the campaign brief share one vocabulary', () => {
    /**
     * Audience matching is exact-term. A creator who declares "UK" and a brand
     * who filters "United Kingdom" never meet, and neither can see why — so the
     * creator's picker and the brand's filter have to read from one list.
     */
    const vocab = readFileSync(path.join(FRONTEND, 'components', 'campaign', 'vocab.js'), 'utf8');
    assert.match(vocab, /export const LOCATIONS = \[/);

    for (const file of [
        path.join(FRONTEND, 'pages', 'CreatorsPage.jsx'),
        path.join(FRONTEND, 'components', 'profile', 'sections', 'WorkPreferences.jsx'),
    ]) {
        const src = readFileSync(file, 'utf8');
        assert.match(src, /from '(\.\.\/)+components\/campaign\/vocab'|from '\.\.\/\.\.\/campaign\/vocab'/,
            `${path.basename(file)} must read the shared vocabulary`);
        assert.match(src, /\bLOCATIONS\b/);
        assert.match(src, /AUDIENCE_AGE_RANGES/);
    }

    // The private list that had drifted — discovery offered three categories
    // creators cannot pick, and hid five they can.
    const creatorsPage = readFileSync(path.join(FRONTEND, 'pages', 'CreatorsPage.jsx'), 'utf8');
    assert.equal(
        /const CATEGORIES = \[/.test(creatorsPage), false,
        'CreatorsPage must not redeclare its own category list',
    );
});

/* ───────────────────────────── the UI exists ───────────────────────────── */

test('the requirement form replaced the one-click invite', () => {
    const form = path.join(FRONTEND, 'components', 'deals', 'RequirementForm.jsx');
    assert.ok(existsSync(form), `missing: ${form}`);

    const profilePage = readFileSync(path.join(FRONTEND, 'pages', 'CreatorProfilePage.jsx'), 'utf8');
    assert.match(profilePage, /RequirementForm/);
    assert.equal(
        profilePage.includes('To be agreed during negotiation'), false,
        'the placeholder brief must be gone',
    );
    assert.equal(
        /contentTypes: profile\.contentTypes\?\.length \? profile\.contentTypes : \['reel'\]/.test(profilePage),
        false,
        'the invented default content type must be gone',
    );

    // It lands on the ordinary deal page — there is no separate direct flow.
    assert.match(profilePage, /nav\(`\/deals\/\$\{deal\._id\}`\)/);
});

test('the verification badge reads a field that can be true', () => {
    const profilePage = readFileSync(path.join(FRONTEND, 'pages', 'CreatorProfilePage.jsx'), 'utf8');
    // `d.verified` is not a path on CreatorProfile and never was, so the badge
    // was false for every creator on the platform.
    assert.equal(CreatorProfile.schema.path('verified'), undefined);
    assert.equal(/verified=\{Boolean\(d\.verified\)\}/.test(profilePage), false);
    assert.match(profilePage, /verified=\{Boolean\(verification\.identity\)\}/);
});
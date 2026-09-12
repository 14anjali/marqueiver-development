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

const { Deal } = await import('../src/models/index.js');
const { Offer, PROPOSAL_TERM_FIELDS, termsOf } = await import('../src/models/Negotiation.js');
const { offerSchema } = await import('../src/modules/deals/deals.controller.js');
const { TERMS_LOCKED_STATES } = await import('../src/modules/deals/dealStateMachine.js');
const { DEAL_STATES } = await import('../../shared/types.js');

/**
 * The proposal stage — the one both routes into a collaboration share.
 *
 * V1 → counter → V2 → accepted → both confirm → locked. What these guard is
 * mostly the quiet failures: a version overwritten, a term dropped on the way
 * into the agreement, a panel reading a field that does not exist.
 */

/**
 * Comments are stripped before matching anywhere the subject is code, and kept
 * where the subject is prose. A few of these assertions failed first time round
 * for exactly the wrong reason: the strings they looked for were present, in
 * the comment explaining the bug they were meant to catch.
 */
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const jsx = (...parts) => stripComments(readFileSync(path.join(FRONTEND, ...parts), 'utf8'));

const negotiation = () => code('modules/deals/negotiation.service.js');
const terms = () => code('modules/deals/terms.service.js');
const acceptBody = () => {
    const s = negotiation();
    return s.slice(s.indexOf('export async function acceptOffer'), s.indexOf('export async function rejectOffer'));
};

/* ─────────────────────── one stage, both routes ─────────────────────── */

test('the negotiation is addressed by the deal, so both routes reach it', () => {
    /**
     * This was the break. `postOffer` takes a thread; the route passed it a
     * deal id, so every proposal 404'd — and only campaign selection ever
     * opened a thread at all, so a direct requirement had none to find. The
     * deal is now the address and the thread is resolved from it.
     */
    const src = negotiation();
    assert.match(src, /export async function postOffer\(\{ dealId,/);
    assert.match(src, /export async function threadForDeal\(dealId/);

    const post = src.slice(src.indexOf('export async function postOffer'));
    assert.match(post.slice(0, 600), /threadForDeal\(dealId, \{ create: true \}\)/);

    // And the controller hands it the right thing.
    const controller = code('modules/deals/deals.controller.js');
    const handler = controller.slice(controller.indexOf('export const createOffer'));
    assert.match(handler.slice(0, 400), /dealId: req\.params\.id/);
});

test('reading a negotiation does not create one', () => {
    const controller = code('modules/deals/deals.controller.js');
    const handler = controller.slice(
        controller.indexOf('export const getNegotiation'),
        controller.indexOf('export const acceptOfferHandler'),
    );
    assert.ok(handler.length > 50, 'getNegotiation must exist');
    // No `create: true` on the read path — opening a page must not write.
    assert.equal(/create: true/.test(handler), false);
    assert.match(handler, /forbidden\(\)/);
});

test('the opening requirement is recorded as V1', () => {
    /**
     * Without this the history starts at whatever the first counter was, and
     * "V2" is the first thing either party sees — which reads as a version
     * having gone missing. Authored by `requestedBy`, so a brand's requirement
     * and a creator's application both seed correctly without either route
     * knowing about the other.
     */
    const src = negotiation();
    const seed = src.slice(src.indexOf('async function seedFirstProposal'));
    assert.match(seed.slice(0, 900), /seq: 1/);
    assert.match(seed.slice(0, 900), /deal\.requestedBy === 'creator' \? 'creator' : 'brand'/);
    // Idempotent: a thread that already has proposals is not re-seeded.
    assert.match(seed.slice(0, 400), /if \(existing\) return null;/);
});

/* ──────────────────── versions are never overwritten ─────────────────── */

test('a counter is a new row, not an edit', () => {
    const src = negotiation();
    const post = src.slice(src.indexOf('export async function postOffer'), src.indexOf('export async function acceptOffer'));

    assert.match(post, /Offer\.create\(/);
    assert.match(post, /seq: \(last\?\.seq \?\? 0\) \+ 1/);
    // Nothing in the proposal path updates an existing offer's terms.
    assert.equal(/Offer\.updateOne|Offer\.findByIdAndUpdate|Offer\.updateMany/.test(post), false);

    // And the collection enforces it: one row per version per thread.
    const model = code('models/Negotiation.js');
    assert.match(model, /offerSchema\.index\(\{ thread: 1, seq: 1 \}, \{ unique: true \}\)/);
});

test('responding to a version leaves its terms alone', () => {
    const src = negotiation();
    for (const fn of ['acceptOffer', 'rejectOffer']) {
        const body = src.slice(src.indexOf(`export async function ${fn}`));
        const scoped = body.slice(0, body.indexOf('\n}\n') + 1);
        for (const term of PROPOSAL_TERM_FIELDS) {
            assert.equal(
                new RegExp(`offer\\.${term}\\s*=`).test(scoped), false,
                `${fn} must not rewrite the proposal's ${term} — the version is the record`,
            );
        }
    }
});

/* ─────────────── every term survives into the agreement ─────────────── */

test('the terms of a proposal are defined in exactly one place', () => {
    for (const f of ['amount', 'deliverables', 'contentItems', 'guidelines',
        'startDate', 'deadline', 'usageRights', 'exclusivity', 'otherTerms', 'revisionsAllowed']) {
        assert.ok(PROPOSAL_TERM_FIELDS.includes(f), `${f} is a term and must be listed`);
        assert.ok(Offer.schema.path(f) || Offer.schema.path(`${f}.licenceType`)
            || Offer.schema.path(`${f}.dos`),
        `${f} must exist on the Offer, or a proposal cannot carry it`);
    }

    // `note` is a fact about the offer, not a term of the work.
    assert.equal(PROPOSAL_TERM_FIELDS.includes('note'), false);
    assert.equal(PROPOSAL_TERM_FIELDS.includes('expiresAt'), false);
});

test('accepting carries every term, not four of them', () => {
    /**
     * The old copy took amount, deliverables, deadline and revisions. Usage
     * rights were negotiable, were negotiated, and were then dropped — the deal
     * kept the schema default. Two parties could argue Policy 8 scope through
     * four versions, agree, and be bound by something neither had proposed.
     */
    const body = acceptBody();
    assert.match(body, /termsOf\(offer\)/);
    assert.match(body, /deal\.usageRights = /);
    assert.match(body, /deal\.exclusivity = /);
    for (const f of ['contentItems', 'guidelines', 'startDate', 'otherTerms']) {
        assert.ok(body.includes(f), `accepting must carry ${f}`);
    }
});

test('termsOf drops the covering note and keeps the terms', () => {
    const t = termsOf({
        amount: 40000, deliverables: 'Two reels', exclusivity: '30 days',
        note: 'why I am proposing this', expiresAt: new Date(), seq: 3, byRole: 'brand',
    });
    assert.equal(t.amount, 40000);
    assert.equal(t.exclusivity, '30 days');
    assert.equal('note' in t, false);
    assert.equal('expiresAt' in t, false);
    assert.equal('byRole' in t, false);
});

test('acceptance applies terms to the collaboration instead of spawning a second one', () => {
    /**
     * §4 used to spawn a new deal, which left the original stranded at
     * `negotiation` with nothing that would move it — one piece of work, two
     * rows, one of them permanently wrong. Changed by product decision and
     * recorded in models/Negotiation.js.
     */
    const body = acceptBody();
    assert.match(body, /Deal\.findById\(thread\.originDeal\)/);
    assert.equal(/Deal\.create\(/.test(body), false, 'accepting must not create a deal');

    // Prose, so read the file with its comments intact.
    assert.match(read('models/Negotiation.js'), /A cleared rule that changed/);
});

/* ─────────────────────── final terms, and the lock ────────────────────── */

test('the final agreed terms are generated and stamped', () => {
    const src = terms();
    const confirm = src.slice(src.indexOf('export async function confirmTerms'), src.indexOf('export async function unconfirmTerms'));

    assert.match(confirm, /deal\.agreedTerms = \{/);
    assert.match(confirm, /lockedAt: new Date\(\)/);
    // Provenance: which version became binding.
    assert.match(confirm, /fromOfferSeq: source\?\.seq/);

    // Written only after the second confirmation, never on the first.
    const firstReturn = confirm.indexOf('return { deal, agreed: false };');
    assert.ok(firstReturn > -1);
    assert.ok(confirm.indexOf('deal.agreedTerms = {') > firstReturn,
        'the snapshot must come after the early return for the first confirmation');
});

test('the frozen snapshot is complete on its own', () => {
    // Including usage rights and exclusivity, which acceptance writes to the
    // top level — a record that needs a reader to know where else to look is
    // not a record.
    for (const f of ['amount', 'deliverables', 'contentItems', 'guidelines.dos', 'startDate',
        'deadline', 'usageRights.licenceType', 'exclusivity', 'otherTerms',
        'revisionsAllowed', 'lockedAt', 'fromOfferSeq']) {
        assert.ok(Deal.schema.path(`agreedTerms.${f}`),
            `agreedTerms.${f} must exist on the Deal schema, or strict mode drops it`);
    }
});

test('only terms.service writes the frozen snapshot', () => {
    for (const rel of [
        'modules/deals/negotiation.service.js',
        'modules/deals/deals.controller.js',
        'modules/deals/deals.service.js',
        'modules/deals/additionalTerms.service.js',
    ]) {
        assert.equal(
            /agreedTerms\s*=/.test(code(rel)), false,
            `${rel} must not write agreedTerms — there is one place terms lock`,
        );
    }
});

test('the lock is enforced, not merely documented', () => {
    /**
     * `assertTermsEditable` existed and nothing called it. Worse, it was only
     * `export … from`-ed here, which republishes a name without binding it
     * locally — so this module could not have called it even if it tried.
     */
    const src = negotiation();
    assert.match(src, /^import \{ assertTermsEditable \} from '\.\/terms\.service\.js';$/m);
    assert.match(src.slice(src.indexOf('export async function postOffer')), /assertTermsEditable\(deal\)/);
    assert.match(acceptBody(), /assertTermsEditable\(deal\)/);

    // And it covers every state after agreement.
    for (const s of ['accepted', 'escrow_pending', 'in_progress', 'submitted', 'completed']) {
        assert.ok(TERMS_LOCKED_STATES.has(s), `${s} must be a locked state`);
    }
    assert.equal(TERMS_LOCKED_STATES.has('negotiation'), false, 'negotiation is where terms are still open');
});

test('a timeline that runs backwards is refused when proposed', () => {
    const post = negotiation().slice(negotiation().indexOf('export async function postOffer'));
    assert.match(post, /new Date\(terms\.startDate\) > new Date\(terms\.deadline\)/);
});

/* ─────────────────────────── the API surface ─────────────────────────── */

test('a proposal can express the whole brief', () => {
    const full = {
        amount: 40000,
        deliverables: 'Two reels',
        contentItems: [{ contentType: 'Reel', quantity: 2 }, { contentType: 'Story', quantity: 3 }],
        guidelines: { dos: ['Show it in use'], donts: ['No competing brands'], hashtags: ['ad'] },
        startDate: '2026-10-01',
        deadline: '2026-10-20',
        usageRights: { licenceType: 'extended', durationMonths: 24, paidAdvertising: true },
        exclusivity: '30 days',
        otherTerms: 'Raw files shared on request.',
        revisionsAllowed: 3,
        note: 'Opening position.',
    };
    assert.equal(offerSchema.safeParse(full).success, true);

    // Strict: a misspelling on a document that becomes binding must not be
    // silently dropped.
    assert.equal(offerSchema.safeParse({ ...full, usageRight: {} }).success, false);
    // Quantity is a real quantity.
    assert.equal(offerSchema.safeParse({
        ...full, contentItems: [{ contentType: 'Reel', quantity: 0 }],
    }).success, false);
});

/* ──────────────────────────────── the UI ─────────────────────────────── */

test('the shared state list is the schema enum, in order', () => {
    /**
     * It was not. `shared/types.js` listed `invited`, `negotiating` and
     * `escrow_funded` — names that have never existed — and omitted
     * `resolution` and `declined`. Two things depended on it:
     * `POST /deals/:id/transition` validates `to` against it, so the creator's
     * "Accept and negotiate" button sent the real state name and was refused by
     * the validator; and every `DEAL_STATES.filter(...)` produced a set that
     * matched no document at all.
     */
    assert.deepEqual(DEAL_STATES, Deal.schema.path('state').enumValues);
});

test('the duplicate-request guard covers the state a request is actually in', () => {
    // The guard is built by filtering DEAL_STATES, so the stale list quietly
    // excluded `invitation` — the one state a just-sent requirement is in, and
    // therefore the only case the guard existed to catch.
    const controller = code('modules/deals/deals.controller.js');
    const decl = controller.match(/const OPEN_DEAL_STATES = [\s\S]{0,240}?\n\);/);
    assert.ok(decl, 'OPEN_DEAL_STATES must be one declaration');

    const excluded = ['declined', 'cancelled', 'completed'];
    const open = DEAL_STATES.filter((s) => !excluded.includes(s));
    for (const s of ['invitation', 'negotiation', 'accepted', 'escrow_pending']) {
        assert.ok(open.includes(s), `${s} is a live collaboration and must block a second request`);
    }
});

test('the panel no longer looks for a state that does not exist', () => {
    const src = jsx('components', 'deals', 'NegotiationPanel.jsx');

    // `negotiating` is one of the invented names chart-theme.js records as
    // never having existed. While the panel tested for it, every action in this
    // stage rendered for nobody.
    assert.equal(/'negotiating'/.test(src), false);
    assert.ok(DEAL_STATES.includes('negotiation'));
    assert.match(src, /deal\.state === 'negotiation'/);
});

test('the panel reads offers from the collection they live in', () => {
    const src = jsx('components', 'deals', 'NegotiationPanel.jsx');

    // `deal.offers` is not a path on the Deal schema — it was removed when
    // offers moved to their own collection, so the history was always empty.
    assert.equal(Deal.schema.path('offers'), undefined);
    assert.equal(/deal\.offers/.test(src), false);
    assert.match(src, /api\.getNegotiation\(deal\._id\)/);

    const client = readFileSync(path.join(FRONTEND, 'lib', 'api.js'), 'utf8');
    assert.match(client, /getNegotiation: \(dealId\) =>/);
});

test('the UI shows versions, what changed, and the lock', () => {
    const panel = readFileSync(path.join(FRONTEND, 'components', 'deals', 'NegotiationPanel.jsx'), 'utf8');
    const termsView = path.join(FRONTEND, 'components', 'deals', 'ProposalTerms.jsx');
    const composer = path.join(FRONTEND, 'components', 'deals', 'ProposalComposer.jsx');
    assert.ok(existsSync(termsView), `missing: ${termsView}`);
    assert.ok(existsSync(composer), `missing: ${composer}`);

    assert.match(panel, /Version history/);
    assert.match(panel, /Final agreed terms/);
    assert.match(panel, /changedFrom=\{/);

    // The four things a party can do with a proposal on the table.
    for (const action of ['Accept these terms', 'Counter with V', 'Decline this version', 'Confirm final terms']) {
        assert.ok(panel.includes(action), `the panel must offer "${action}"`);
    }

    // A counter starts from the version it answers, or the diff is meaningless.
    const c = readFileSync(composer, 'utf8');
    assert.match(c, /setForm\(fromTerms\(basedOn \?\? \{\}\)\)/);
});
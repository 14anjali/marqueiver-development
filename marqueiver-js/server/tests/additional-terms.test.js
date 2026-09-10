import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';

const { Deal } = await import('../src/models/Deal.js');
const { previewAdditionalTerms } = await import('../src/modules/deals/additionalTerms.service.js');
const deals = await import('../src/modules/deals/deals.controller.js');

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (p) => readFileSync(path.join(SRC, p), 'utf8');

/**
 * Policy 5.5 option B — the fourth revision.
 *
 * The requirement: a fourth revision must not silently become free work;
 * additional terms and payment are required; the creator's agreement is
 * required; scope is never changed unilaterally.
 *
 * Every test below is really the same question asked from a different angle:
 * can either party get what they want without the other?
 */

/* ─────────────────────────── the shape of it ──────────────────────────────── */

test('the proposal is stored, so nothing here is only in a handler', () => {
    // Mongoose strict mode drops undeclared paths silently. This project has
    // shipped two data-loss bugs that way.
    for (const p of ['additionalTerms.status', 'additionalTerms.amount',
                     'additionalTerms.revisionsAdded', 'additionalTerms.commissionPct',
                     'additionalTerms.fundedAt', 'additionalTerms.declineReason']) {
        assert.notEqual(Deal.schema.path(p), undefined, `${p} is not declared`);
    }
});

test('acceptance and payment are separate states', () => {
    // Collapsing them would restart work on a promise. `accepted` means the
    // price is agreed; `funded` means the money is actually in escrow.
    const states = Deal.schema.path('additionalTerms.status').enumValues;

    assert.deepEqual([...states].sort(),
        ['accepted', 'declined', 'funded', 'none', 'proposed']);
});

test('a deal starts with no additional terms', () => {
    const d = new Deal({
        brand: '507f1f77bcf86cd799439011',
        creator: '507f1f77bcf86cd799439012',
        title: 'T', terms: { amount: 100 },
    });

    assert.equal(d.additionalTerms.status, 'none');
});

/* ──────────────────── neither party can act alone ─────────────────────────── */

test('only the brand can propose, only the creator can respond', () => {
    const svc = read('modules/deals/additionalTerms.service.js');

    assert.match(svc, /assertBrand\(deal, actorId\)[\s\S]{0,2000}?PROPOSABLE_STATES/,
        'proposing must be brand-only');

    const respond = svc.slice(svc.indexOf('export async function respondToAdditionalTerms'));
    assert.match(respond.slice(0, 300), /assertCreator/,
        'a brand must not be able to accept on the creator\'s behalf');
});

test('the routes enforce the same split as the service', () => {
    // Defence in depth: a role check in one layer only is one refactor away
    // from being the check in no layer.
    const routes = read('modules/deals/deals.routes.js');

    assert.match(routes, /'\/:id\/additional-terms',\s*requireRole\('brand'\)/);
    assert.match(routes, /'\/:id\/additional-terms\/respond',\s*requireRole\('creator'\)/);
    assert.match(routes, /'\/:id\/additional-terms\/payment-session',\s*requireRole\('brand'\)/);
});

test('the creator can decline, and the reason reaches the brand', () => {
    const svc = read('modules/deals/additionalTerms.service.js');
    const respond = svc.slice(svc.indexOf('export async function respondToAdditionalTerms'));
    const body = respond.slice(0, respond.indexOf('\n}\n'));

    assert.match(body, /status = 'declined'/);
    assert.match(body, /declineReason/);
    assert.match(body, /user: deal\.brand/, 'a silent decline leaves the brand waiting forever');
});

/* ──────────── revisions appear only when the money has arrived ────────────── */

test('revisionsAllowed is increased in exactly one place', () => {
    /**
     * This is the assertion that makes "the brand cannot simply raise the
     * revision limit" a property of the code rather than a promise. If a second
     * write site ever appears, this fails.
     */
    const files = [
        'modules/deals/additionalTerms.service.js',
        'modules/deals/deals.service.js',
        'modules/deals/deals.controller.js',
        'modules/deals/negotiation.service.js',
        'modules/deals/terms.service.js',
        'modules/campaigns/campaigns.controller.js',
    ];

    const writes = files.flatMap((f) => {
        const hits = read(f).match(/terms\.revisionsAllowed\s*=\s*/g) ?? [];
        return hits.map(() => f);
    });

    assert.deepEqual(writes, ['modules/deals/additionalTerms.service.js'],
        `revisionsAllowed is written in: ${writes.join(', ')}`);
});

test('the rounds are added at funding, not at acceptance', () => {
    const svc = read('modules/deals/additionalTerms.service.js');

    const respond = svc.slice(svc.indexOf('export async function respondToAdditionalTerms'));
    assert.doesNotMatch(respond.slice(0, respond.indexOf('\n}\n')), /revisionsAllowed/,
        'accepting must not grant the rounds — the money has not arrived yet');

    const fund = svc.slice(svc.indexOf('export async function fundAdditionalTerms'));
    assert.match(fund, /revisionsAllowed = \(deal\.terms\.revisionsAllowed \?\? 0\) \+ revisionsAdded/);
});

test('funding requires an accepted proposal', () => {
    const svc = read('modules/deals/additionalTerms.service.js');
    const fund = svc.slice(svc.indexOf('export async function fundAdditionalTerms'));

    assert.match(fund.slice(0, 500), /status !== 'accepted'/,
        'paying for terms the creator never agreed to would be a unilateral scope change');
});

test('escrow grows by the additional amount', () => {
    const svc = read('modules/deals/additionalTerms.service.js');
    const fund = svc.slice(svc.indexOf('export async function fundAdditionalTerms'));

    assert.match(fund, /escrow\.amount = \(deal\.escrow\.amount \?\? 0\) \+ amount/,
        'the addition must be held too, or release would pay out money that is not there');
});

/* ────────────────── the webhook tells the two payments apart ──────────────── */

test('an option B payment is not mistaken for the original advance', () => {
    /**
     * Both arrive as `escrow_fund`. Routing an addition into
     * `confirmEscrowFunded` would run first-funding side effects on a live deal
     * — and the brand would have paid for rounds that never appeared.
     */
    const webhook = read('modules/payments/payments.controller.js');

    assert.match(webhook, /txn\.meta\?\.additionalTerms/);
    assert.match(webhook, /fundAdditionalTerms\(/);

    const svc = read('modules/deals/additionalTerms.service.js');
    assert.match(svc, /additionalTerms: true/, 'the transaction must carry the marker');
});

test('the two payments use different idempotency keys', () => {
    const svc = read('modules/deals/additionalTerms.service.js');
    const original = read('modules/deals/deals.service.js');

    assert.match(original, /`fund_\$\{deal\.id\}`/);
    assert.match(svc, /`addterms_\$\{deal\.id\}_\$\{round\}`/,
        'a shared key would make the addition look like a duplicate of the advance');
});

/* ───────────────────────── what the creator is told ───────────────────────── */

test('the creator sees what they will actually receive', () => {
    // "Accept ₹5,000 for two more rounds" is not an informed decision if the
    // figure that lands is ₹4,375.
    const preview = previewAdditionalTerms({
        additionalTerms: { amount: 5000, revisionsAdded: 2, status: 'proposed', commissionPct: 12.5 },
    });

    assert.equal(preview.amount, 5000);
    assert.equal(preview.commission, 625);
    assert.equal(preview.creatorNet, 4375);
    assert.equal(preview.revisionsAdded, 2);
});

test('the preview is absent when there is nothing proposed', () => {
    assert.equal(previewAdditionalTerms({ additionalTerms: { status: 'none' } }), null);
});

test('the addition carries its own commission snapshot', () => {
    // Policy 14.7 — the addition is agreed later and may fall under a different
    // published rate than the collaboration it extends.
    const preview = previewAdditionalTerms({
        additionalTerms: { amount: 1000, revisionsAdded: 1, status: 'accepted', commissionPct: 10 },
    });

    assert.equal(preview.commissionPct, 10);
    assert.equal(preview.commission, 100);
});

/* ───────────────────────────── request validation ─────────────────────────── */

test('a proposal must name a price and at least one round', () => {
    const s = deals.proposeAdditionalTermsSchema;

    assert.equal(s.safeParse({ amount: 5000, revisionsAdded: 1 }).success, true);
    assert.equal(s.safeParse({ amount: 0, revisionsAdded: 1 }).success, false, 'free is not additional terms');
    assert.equal(s.safeParse({ amount: 5000, revisionsAdded: 0 }).success, false);
    assert.equal(s.safeParse({ amount: 5000 }).success, false, 'rounds must be stated');
    assert.equal(s.safeParse({ amount: 5000, revisionsAdded: 1, status: 'funded' }).success, false,
        'strict schema — a client must not be able to set the status');
});

test('a response is an explicit accept or decline', () => {
    const s = deals.respondAdditionalTermsSchema;

    assert.equal(s.safeParse({ accept: true }).success, true);
    assert.equal(s.safeParse({ accept: false, declineReason: 'Too low' }).success, true);
    assert.equal(s.safeParse({}).success, false, 'silence is not consent');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';

const { Deal, INCLUDED_REVISIONS } = await import('../src/models/Deal.js');
const { canRequestRevision, DEFAULT_REVISION_ROUNDS } = await import('../src/modules/deals/dealStateMachine.js');
const { computeCollaborationMoney, currentCommissionPct } = await import('../src/services/commission.service.js');
const { cashfreeConfigStatus } = await import('../src/services/cashfree.service.js');

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (p) => readFileSync(path.join(SRC, p), 'utf8');

/* ───────────────── D-3 · one commission engine, at 12.5% ──────────────────── */

test('platformFee.js is gone and nothing imports it', () => {
    // It computed a `fees` block that the Deal schema never declared, so strict
    // mode discarded every write. Two engines also meant the figure quoted
    // during negotiation (0%) differed from the one charged at release (12.5%).
    assert.equal(existsSync(path.join(SRC, 'services/platformFee.js')), false);

    for (const f of ['modules/campaigns/campaigns.controller.js',
                     'modules/deals/negotiation.service.js']) {
        assert.doesNotMatch(read(f), /computeFees|platformFee\.js'/,
            `${f} still reaches for the deleted fee engine`);
    }
});

test('the surviving commission rate is the one Policy 14.1 publishes', () => {
    assert.equal(currentCommissionPct(), 12.5);
});

test('the brand funds the agreed value and nothing more', () => {
    // Policy 14.5. The deleted engine added a brand fee on top of the agreed
    // amount, which contradicted the published policy.
    const m = computeCollaborationMoney(10_000);

    assert.equal(m.escrowAmount, 10_000);
    assert.equal(m.brandPays, 10_000);
});

test('commission comes out of the creator side and the arithmetic closes', () => {
    const m = computeCollaborationMoney(10_000);

    assert.equal(m.commission, 1_250);
    assert.equal(m.creatorNet, 8_750);
    assert.equal(m.creatorNet + m.commission, m.escrowAmount,
        'no rupee may be created or lost between escrow and payout');
});

test('a snapshotted rate is honoured over the live one', () => {
    // Policy 14.7 — a rate change must not rewrite a collaboration already
    // accepted at a different rate.
    const m = computeCollaborationMoney(10_000, 10);

    assert.equal(m.commissionPct, 10);
    assert.equal(m.commission, 1_000);
});

test('deals are created without a commission snapshot', () => {
    // The rate is fixed at terms acceptance (terms.service.js), not when the
    // deal row appears — a creator who applies today and accepts next month is
    // charged the rate they saw when they accepted.
    const apply = read('modules/campaigns/campaigns.controller.js');

    assert.doesNotMatch(apply, /commission:\s*\{\s*ratePct/,
        'applying to a campaign must not fix the commission rate');
});

/* ──────────────── F-9 · three included revisions, enforced ────────────────── */

test('the included-revision count is 3 everywhere it appears', () => {
    assert.equal(INCLUDED_REVISIONS, 3);
    assert.equal(DEFAULT_REVISION_ROUNDS, 3, 'the state machine fallback drifted to 2');
    assert.equal(new Deal().terms.revisionsAllowed, 3, 'the schema default drifted to 1');
});

test('a revision request is allowed while rounds remain and refused after', () => {
    const at = (used) => canRequestRevision({ terms: { revisionsAllowed: 3 }, revisionCount: used });

    assert.equal(at(0).allowed, true);
    assert.equal(at(2).allowed, true, 'the third request must still be included');
    assert.equal(at(3).allowed, false, 'the fourth is out of scope and cannot be free');
    assert.match(at(3).reason, /All 3 agreed revision rounds/);
});

test('a revision request increments the counter exactly once', () => {
    /**
     * It used to increment twice — once in the controller and again in
     * applyStateSideEffects on the same transition. Three included revisions
     * were therefore exhausted after the brand's *second* request, while the
     * note shown to them said "revision 2 of 3".
     */
    const controller = read('modules/deals/deals.controller.js');
    const handler = controller.slice(controller.indexOf('export const requestRevision'));
    const body = handler.slice(0, handler.indexOf('\n});'));

    assert.doesNotMatch(body, /deal\.revisionCount\s*=/,
        'the state machine owns the counter; the controller must not also write it');

    const service = read('modules/deals/deals.service.js');
    const increments = service.match(/revisionCount\s*\+=\s*1/g) ?? [];
    assert.equal(increments.length, 1, 'exactly one place may increment');
});

test('exhausted revisions route to Resolution rather than being refused', () => {
    // Policy 5.5 — the brand still needs a way forward. A hard 4xx would leave
    // the deal stuck with no route out.
    const controller = read('modules/deals/deals.controller.js');
    const handler = controller.slice(controller.indexOf('export const requestRevision'));

    assert.match(handler.slice(0, 1200), /to: 'resolution'/);
});

/* ─────────────── F-4 · production cannot boot on mock payments ────────────── */

test('cashfree config names the missing variables without exposing values', () => {
    const status = cashfreeConfigStatus();

    assert.equal(Array.isArray(status.missing), true);
    for (const name of status.missing) {
        assert.match(name, /^CASHFREE_[A-Z_]+$/, 'only variable NAMES may be reported');
    }
});

test('the boot guard runs before the port is bound', () => {
    const server = read('server.js');
    const guard = server.indexOf('assertPaymentsSafeToBoot()');
    const listen = server.indexOf('server.listen');

    assert.ok(guard > -1, 'server.js must call the payment guard');
    assert.ok(guard < listen, 'the guard must fail the deploy, not the first escrow');
});

test('the guard refuses production without Cashfree credentials', async () => {
    // Proven by construction rather than by importing under a mutated NODE_ENV,
    // which would poison the module cache for every other test in this file.
    const svc = read('services/cashfree.service.js');
    const fn = svc.slice(svc.indexOf('export function assertPaymentsSafeToBoot'));

    assert.match(fn.slice(0, 400), /env\.nodeEnv !== 'production'/);
    assert.match(fn.slice(0, 600), /isLive\(\)/);
    assert.match(fn.slice(0, 900), /throw new Error/);
});

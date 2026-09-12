import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const FRONTEND = path.join(HERE, '..', '..', '..', 'frontend', 'src');

const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');
const code = (rel) => stripComments(read(rel));
const jsx = (...p) => stripComments(readFileSync(path.join(FRONTEND, ...p), 'utf8'));

const { Deal } = await import('../src/models/index.js');
const { paymentSchedule, ADVANCE_PCT } = await import('../src/services/commission.service.js');
const { bindingTerms, recordAmendment } = await import('../src/modules/deals/terms.service.js');
const { CHANGEABLE_FIELDS, changeHistory } = await import('../src/modules/deals/changeRequest.service.js');
const { changeRequestSchema } = await import('../src/modules/deals/deals.controller.js');

/**
 * Locked terms: that they are locked, that the only way through the lock is a
 * change both parties accepted, and that the money shown is the money stored.
 */

/* ────────────────── nobody can change locked terms quietly ───────────────── */

test('the agreement itself has exactly one writer, and it writes once', () => {
    /**
     * `agreedTerms` is never rewritten — not by an accepted change, not by paid
     * extra scope, not by an admin. That is what makes "neither party can
     * silently change locked terms" a property of the data rather than a rule
     * someone has to keep remembering.
     */
    const dealsDir = path.join(SRC, 'modules', 'deals');
    const writers = [];
    for (const f of readdirSync(dealsDir).filter((n) => n.endsWith('.js'))) {
        if (/(^|[^.\w])(deal\.)?agreedTerms\s*=/.test(stripComments(readFileSync(path.join(dealsDir, f), 'utf8')))) {
            writers.push(f);
        }
    }
    assert.deepEqual(writers, ['terms.service.js'],
        `only terms.service.js may write agreedTerms; found: ${writers.join(', ')}`);

    // …and only on the second confirmation.
    const confirm = code('modules/deals/terms.service.js');
    assert.equal((confirm.match(/deal\.agreedTerms = \{/g) ?? []).length, 1);
});

test('amendments have one writer too', () => {
    const dealsDir = path.join(SRC, 'modules', 'deals');
    const writers = [];
    for (const f of readdirSync(dealsDir).filter((n) => n.endsWith('.js'))) {
        if (/deal\.termsAmendments\s*=/.test(stripComments(readFileSync(path.join(dealsDir, f), 'utf8')))) {
            writers.push(f);
        }
    }
    assert.deepEqual(writers, ['terms.service.js'],
        'termsAmendments must only be appended through recordAmendment');
});

test('paid extra scope no longer diverges from the locked record', () => {
    /**
     * `fundAdditionalTerms` changes `terms.revisionsAllowed`, `terms.deadline`
     * and `terms.deliverables` on a deal in a locked state. That is legitimate —
     * Policy 5.5 option B, proposed, accepted and paid — but it recorded
     * nothing, so `agreedTerms` still said three revisions on a deal that had
     * five, and the Final Terms summary is generated from `agreedTerms`.
     */
    const src = code('modules/deals/additionalTerms.service.js');
    const fund = src.slice(src.indexOf('export async function fundAdditionalTerms'));

    assert.match(fund, /recordAmendment\(deal, \{/);
    assert.match(fund, /source: 'additional_terms'/);
    // The three fields it actually moves are the three it records.
    assert.match(fund, /revisionsAllowed:/);
    assert.match(fund, /deadline:/);
    assert.match(fund, /deliverables:/);
});

test('every term the working copy holds can be amended', () => {
    // A field that `terms` holds but a change request cannot touch is a field
    // that can only ever be changed by something that bypasses this workflow.
    for (const f of ['amount', 'deliverables', 'deadline', 'startDate',
        'revisionsAllowed', 'contentItems', 'guidelines', 'otherTerms',
        'usageRights', 'exclusivity']) {
        assert.ok(CHANGEABLE_FIELDS.includes(f), `${f} must be changeable through a change request`);
    }
});

/* ──────────────────── amendments never lose the original ─────────────────── */

test('an amendment records what moved, not what it became', () => {
    const deal = {
        agreedTerms: { amount: 62000, deadline: '2026-10-27', revisionsAllowed: 3 },
        termsAmendments: [],
    };

    const a = recordAmendment(deal, {
        changes: { revisionsAllowed: 5 },
        source: 'change_request',
        reason: 'reshoot',
    });

    assert.deepEqual(a.changes, { revisionsAllowed: { from: 3, to: 5 } });
    // The agreement is untouched.
    assert.equal(deal.agreedTerms.revisionsAllowed, 3);
    // And what applies now reflects the change.
    assert.equal(bindingTerms(deal).revisionsAllowed, 5);
    assert.equal(bindingTerms(deal).amount, 62000, 'unamended fields carry through');
});

test('amendments stack, and each diffs against the terms then in force', () => {
    const deal = { agreedTerms: { revisionsAllowed: 3 }, termsAmendments: [] };

    recordAmendment(deal, { changes: { revisionsAllowed: 5 }, source: 'change_request' });
    const second = recordAmendment(deal, { changes: { revisionsAllowed: 6 }, source: 'additional_terms' });

    assert.deepEqual(second.changes, { revisionsAllowed: { from: 5, to: 6 } },
        'the second amendment diffs against 5, not against the original 3');
    assert.equal(deal.termsAmendments.length, 2, 'nothing is overwritten');
    assert.equal(bindingTerms(deal).revisionsAllowed, 6);
});

test('an amendment that changes nothing is not recorded', () => {
    const deal = { agreedTerms: { revisionsAllowed: 3 }, termsAmendments: [] };
    const a = recordAmendment(deal, { changes: { revisionsAllowed: 3 }, source: 'change_request' });
    assert.equal(a, null);
    assert.equal(deal.termsAmendments.length, 0);
});

test('binding terms are read from one function, not reconstructed', () => {
    // A caller that applies amendments by hand will eventually forget to, and
    // quote the original as though it were current.
    assert.equal(bindingTerms({ agreedTerms: null }), null, 'unlocked terms have no binding form');
    const history = changeHistory({
        agreedTerms: { amount: 1000, lockedAt: new Date() },
        termsAmendments: [{ changes: { amount: { from: 1000, to: 1200 } } }],
        changeRequests: [],
        state: 'accepted',
    });
    assert.equal(history.agreedTerms.amount, 1000);
    assert.equal(history.bindingTerms.amount, 1200);
    assert.equal(history.locked, true);
});

/* ───────────────────── the change request itself ─────────────────────────── */

test('a change request needs a stated reason', () => {
    const ok = { changes: { revisionsAllowed: 5 }, reason: 'The reshoot needs another round.' };
    assert.equal(changeRequestSchema.safeParse(ok).success, true);

    // The other party is being asked to give something up.
    assert.equal(changeRequestSchema.safeParse({ ...ok, reason: 'pls' }).success, false);
    assert.equal(changeRequestSchema.safeParse({ changes: ok.changes }).success, false);
});

test('a misspelled field is refused, not dropped', () => {
    // On the one document that edits something already binding, a silently
    // ignored field would be "accepted" by the other party as a no-op.
    assert.equal(changeRequestSchema.safeParse({
        changes: { revisionsAllowd: 5 }, reason: 'The reshoot needs another round.',
    }).success, false);
});

test('only the other party may answer, and only a pending request', () => {
    const src = code('modules/deals/changeRequest.service.js');
    const respond = src.slice(src.indexOf('export async function respondToChange'));

    assert.match(respond, /request\.proposedByRole === actorRole/);
    assert.match(respond, /forbidden\('The other party has to answer a change request'\)/);
    assert.match(respond, /request\.status !== 'pending'/);
});

test('a change request cannot be raised before the lock', () => {
    const src = code('modules/deals/changeRequest.service.js');
    const propose = src.slice(src.indexOf('export async function proposeChange'));
    assert.match(propose.slice(0, 1200), /!deal\.agreedTerms\?\.lockedAt/);
    // Only one open at a time.
    assert.match(propose, /livePending\(deal\)/);
});

test('the fee cannot move once the money is held', () => {
    const src = code('modules/deals/changeRequest.service.js');
    assert.match(src, /'amount' in requested && deal\.escrow\?\.funded/);

    // And the editor does not offer the field it would be refused on.
    const panel = jsx('components', 'deals', 'ChangeRequestPanel.jsx');
    assert.match(panel, /f\.key === 'amount' && escrowFunded/);
});

test('accepting a change appends an amendment — it does not rewrite the agreement', () => {
    const src = code('modules/deals/changeRequest.service.js');
    const respond = src.slice(src.indexOf('export async function respondToChange'));

    assert.match(respond, /recordAmendment\(deal, \{/);
    assert.match(respond, /source: 'change_request'/);
    assert.equal(/agreedTerms\s*=/.test(respond), false);
});

/* ─────────────────────────── the money splits ────────────────────────────── */

test('the advance is half of what the creator actually receives', () => {
    /**
     * Not half the headline figure. Policy 14.1 takes the commission out of the
     * collaboration value, so a creator told "50% advance: ₹31,000" on a ₹62,000
     * deal would receive ₹27,125 — wrong in the direction that costs them money,
     * at the moment they are deciding whether to accept.
     */
    const s = paymentSchedule(62000, 12.5);
    assert.equal(s.commission, 7750);
    assert.equal(s.creatorNet, 54250);
    assert.equal(s.creatorAdvance, 27125);
    assert.equal(s.creatorBalance, 27125);
});

test('the arithmetic closes at every value', () => {
    const round2 = (n) => Math.round(n * 100) / 100;
    for (const v of [0, 1, 999.99, 33333, 62000, 1_000_000, 7]) {
        const s = paymentSchedule(v, 12.5);
        assert.equal(round2(s.creatorAdvance + s.creatorBalance), s.creatorNet,
            `creator tranches must sum to the net at ${v}`);
        assert.equal(round2(s.brandAdvance + s.brandBalance), s.brandPays,
            `brand tranches must sum to the total at ${v}`);
    }
});

test('the split is a named constant, not a literal', () => {
    assert.equal(ADVANCE_PCT, 50);
    // The requirement it comes from is quoted where the chat gate is built on it.
    assert.match(read('modules/messaging/messaging.policy.js'), /50% advance/);
});

test('the schedule is frozen at acceptance with the rate it used', () => {
    const confirm = code('modules/deals/terms.service.js');
    assert.match(confirm, /const schedule = paymentSchedule\(t\.amount \?\? 0, ratePct\)/);
    // Both sides stored, so nothing downstream recomputes a creator's payment.
    for (const f of ['creatorNet', 'creatorAdvance', 'creatorBalance', 'commission', 'commissionPct']) {
        assert.ok(Deal.schema.path(`escrow.schedule.${f}`), `escrow.schedule.${f} must exist on the schema`);
        assert.match(confirm, new RegExp(`${f}: schedule\\.${f}`));
    }
});

test('the summary reads the stored figures rather than recomputing them', () => {
    const src = jsx('components', 'deals', 'FinalTerms.jsx');
    assert.match(src, /sched\.creatorAdvance/);
    assert.match(src, /sched\.creatorBalance/);
    assert.match(src, /sched\.creatorNet/);

    // No money arithmetic in the view.
    assert.equal(/Math\.round\([^)]*(gross|net|amount)/.test(src), false,
        'the summary must not compute payments — a derived figure will drift from the payout');
});

test('the summary does not claim a split charge that does not happen yet', () => {
    // The schedule is agreed and stored; `createPaymentSession` still raises a
    // single order. Saying otherwise would be a false statement about money.
    const src = readFileSync(path.join(FRONTEND, 'components', 'deals', 'FinalTerms.jsx'), 'utf8');
    assert.match(src, /collects the full amount in one/i);

    const service = code('modules/deals/deals.service.js');
    assert.match(service, /createEscrowOrder\(deal\.id, deal\.terms\.amount\)/,
        'if this changes, the copy above has to change with it');
});

/* ──────────────────────────── both sides see it ──────────────────────────── */

test('the history is readable by either party, and writes nothing', () => {
    const controller = code('modules/deals/deals.controller.js');
    const handler = controller.slice(controller.indexOf('export const getTermsHistory'));

    assert.match(handler.slice(0, 600), /deal\.brand\.toString\(\), deal\.creator\.toString\(\)/);
    assert.match(handler.slice(0, 600), /forbidden\(\)/);
    assert.equal(/\.save\(\)|recordAmendment|Deal\.create/.test(handler.slice(0, 600)), false);
});

test('the deal page shows the terms to whoever is looking', () => {
    const page = jsx('pages', 'DealDetailPage.jsx');
    // No role gate on either panel — a creator must be able to read the
    // agreement they are bound by, and the changes asked for against it.
    assert.match(page, /<FinalTerms/);
    assert.match(page, /role=\{role\}/);
    assert.equal(/role === 'brand' && \s*<FinalTerms/.test(page), false);

    const panel = jsx('components', 'deals', 'ChangeRequestPanel.jsx');
    assert.match(panel, /pending\.proposedByRole === role/, 'each side sees its own view of a live request');
});

test('only the fee is rendered as money', () => {
    /**
     * A change request diff showed "Revisions allowed: ₹3 → ₹4" — every value
     * that happened to be a number got a rupee sign, so a count read as a price.
     * `amount` is the only monetary term.
     */
    const panel = jsx('components', 'deals', 'ChangeRequestPanel.jsx');
    assert.match(panel, /function show\(v, field\)/);
    assert.match(panel, /field === 'amount' \? <Money/);
    // Every call site passes the field, or the guard cannot fire.
    const calls = [...panel.matchAll(/show\(([^)]*)\)/g)].map((m) => m[1]);
    for (const c of calls) {
        assert.ok(c.includes(','), `show() must be told which field it is rendering: show(${c})`);
    }
});

test('the summary shows the terms in force, not the superseded ones', () => {
    /**
     * It rendered `agreedTerms`, so after an accepted amendment the headline
     * read "Due 27 Oct, 3 revisions" while the amendment directly beneath it
     * said 10 Nov and 4. The top of that card is where a party looks to answer
     * "what am I bound to".
     */
    const src = jsx('components', 'deals', 'FinalTerms.jsx');
    assert.match(src, /const inForce = binding \?\? agreed;/);
    assert.match(src, /<ProposalTerms terms=\{inForce\} changedFrom=\{amended \? agreed : undefined\} \/>/);

    // And the page hands it the binding terms it loaded.
    const page = jsx('pages', 'DealDetailPage.jsx');
    assert.match(page, /binding=\{terms\.bindingTerms\}/);
});

test('the locked terms are rendered in one place', () => {
    // Both this card and the negotiation panel rendered them, and the panel's
    // copy still said "a change needs a new collaboration" — which stopped
    // being true the moment change requests existed.
    const panel = jsx('components', 'deals', 'NegotiationPanel.jsx');
    assert.equal(/ProposalTerms terms=\{deal\.agreedTerms\}/.test(panel), false);
    assert.equal(panel.includes('a change needs a new collaboration'), false);
});

test('the Final Terms summary carries everything the brief asked for', () => {
    const src = readFileSync(path.join(FRONTEND, 'components', 'deals', 'FinalTerms.jsx'), 'utf8');
    for (const line of ['Creator payment', 'advance', 'Remaining', 'Final terms']) {
        assert.ok(src.includes(line), `the summary must show "${line}"`);
    }
    // Deliverables, deadline, usage rights, revision limit and other terms all
    // come from the shared readout rather than a second copy that can drift.
    assert.match(src, /<ProposalTerms terms=\{inForce\}/);
});
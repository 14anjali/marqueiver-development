import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const FRONTEND = path.join(HERE, '..', '..', '..', 'frontend', 'src');

/**
 * Comments stripped before matching.
 *
 * Not optional: these files explain the bug they fixed, so the old behaviour is
 * quoted in prose a few lines above the new behaviour. Three assertions in
 * earlier phases passed — or failed — against the explanation rather than the
 * code, which is the most embarrassing possible way to get a green suite.
 */
const stripComments = (s) => s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const code = (rel) => stripComments(readFileSync(path.join(SRC, rel), 'utf8'));
const jsx = (...p) => stripComments(readFileSync(path.join(FRONTEND, ...p), 'utf8'));
const raw = (...p) => readFileSync(path.join(FRONTEND, ...p), 'utf8');

/**
 * The status derivation is plain JavaScript with no JSX and no React, so it is
 * imported and actually run rather than pattern-matched. Everything that can be
 * tested by behaviour is tested by behaviour; the source assertions below are
 * only for things that have no runtime signature (which component the page
 * renders, who fetches what).
 */
const status = await import(
    path.join(FRONTEND, 'components', 'deals', 'collaborationStatus.js')
);
const {
    STAGES, OFF_PATH, collaborationStatus, stageStates, nextAction,
    workspaceStatus, advanceVerified,
} = status;

const { DEAL_STATES } = await import('../../shared/types.js');

/* ───────────────────────────── fixtures ─────────────────────────────────── */

const deal = (over = {}) => ({
    _id: 'd1',
    state: 'in_progress',
    requestedBy: 'brand',
    terms: { amount: 62000, deadline: '2026-10-27' },
    escrow: { amount: 62000, funded: true, schedule: { advancePct: 50, advance: { amount: 31000, funded: true }, balance: { amount: 31000, funded: false } } },
    timeline: [],
    workSubmissions: [],
    ...over,
});

/** A collaboration whose terms are agreed and whose advance has not arrived. */
const unpaid = (over = {}) => deal({
    state: 'escrow_pending',
    escrow: {
        amount: 62000, funded: false,
        schedule: { advancePct: 50, advance: { amount: 31000, funded: false }, balance: { amount: 31000, funded: false } },
    },
    ...over,
});

const verifiedPayment = [{ type: 'escrow_fund', tranche: 'advance', status: 'verified', amount: 31000 }];

/* ──────────────────────── what is locked, not pending ───────────────────── */

test('before the advance arrives, the later stages are locked rather than pending', () => {
    /**
     * The distinction this whole component exists for. "Pending" means not yet;
     * "locked" means not yet and nothing you do here will change it — which is
     * the difference between a creator waiting to submit work and a creator who
     * cannot submit because the brand has not paid. As a grey segment on a
     * progress bar these look identical, and the old bar drew them that way.
     */
    const stages = stageStates(unpaid(), { payments: [] });
    const by = Object.fromEntries(stages.map((s) => [s.id, s.state]));

    assert.equal(by.awaiting_payment, 'current');
    assert.equal(by.active, 'locked');
    assert.equal(by.submitted, 'locked');
    assert.equal(by.completed, 'locked');
    assert.equal(stages.some((s) => s.state === 'pending' && s.id === 'submitted'), false);
});

test('once the advance is verified nothing is locked any more', () => {
    const stages = stageStates(deal(), { payments: verifiedPayment });
    assert.equal(stages.some((s) => s.state === 'locked'), false);
});

/* ───────────────── money verified, collaboration not started ─────────────── */

test('a verified payment on a collaboration that did not start says so', () => {
    /**
     * The webhook writes `verified` and the transition then fails: the money is
     * taken and nothing has started. Showing "Awaiting payment" to a brand that
     * has already paid is the worst available answer, and it is the one the deal
     * state alone produces — which is why the payment record is read here.
     */
    const d = unpaid();
    const s = collaborationStatus(d, { payments: verifiedPayment });
    assert.equal(s.id, 'payment_verified');

    for (const role of ['brand', 'creator']) {
        const action = nextAction(d, role, { payments: verifiedPayment });
        assert.equal(action.warn, true);
        assert.equal(action.mine, false, 'neither party can fix this themselves');
        assert.match(action.text, /not started/i);
        // And it does not promise an alert nobody sends: no server-side detector
        // exists for this case.
        assert.equal(/team has been notified/i.test(action.text), false);
    }
});

test('a verified advance never offers the brand a second payment', () => {
    /**
     * Caught in the rendered page: the panel showed a "Verified" pill and a
     * "Pay the advance · ₹31,000" button at the same time, which is an
     * invitation to pay twice for one tranche.
     */
    const advance = jsx('components', 'deals', 'AdvancePayment.jsx');
    assert.match(advance, /const paidButNotStarted = !advanceFunded/);
    assert.match(advance, /\{isBrand && !paidButNotStarted \?/);
});

test('a legacy success spelling counts as verified', () => {
    // `success` is the old name for the same thing; it stays in the Transaction
    // enum because removing an enum value makes existing rows unsaveable.
    const s = collaborationStatus(unpaid(), { payments: [{ status: 'success' }] });
    assert.equal(s.id, 'payment_verified');
});

test('an initiated or processing payment unlocks nothing', () => {
    for (const st of ['pending', 'initiated', 'processing', 'failed']) {
        const s = collaborationStatus(unpaid(), { payments: [{ status: st }] });
        assert.equal(s.id, 'awaiting_payment', `${st} must not read as paid`);
    }
});

/* ──────────────────────────── whose move is it ──────────────────────────── */

test('each state names one side, and never leaves the line blank', () => {
    /**
     * "Waiting on the brand" is a genuine answer; an empty space is not. A
     * person who cannot tell whether they are blocked or blocking asks support,
     * or worse, waits.
     */
    for (const state of DEAL_STATES) {
        for (const role of ['brand', 'creator']) {
            const a = nextAction(deal({ state }), role, { payments: [] });
            assert.ok(a.text, `${state}/${role} produced no next action`);
        }
    }
});

test('the brand pays, the creator submits, and each is told the other is being waited on', () => {
    const awaiting = unpaid();
    assert.equal(nextAction(awaiting, 'brand', { payments: [] }).mine, true);
    assert.equal(nextAction(awaiting, 'creator', { payments: [] }).mine, false);

    const live = deal({ state: 'in_progress' });
    assert.equal(nextAction(live, 'creator', { payments: verifiedPayment }).mine, true);
    assert.equal(nextAction(live, 'brand', { payments: verifiedPayment }).mine, false);

    const sent = deal({ state: 'submitted' });
    assert.equal(nextAction(sent, 'brand', { payments: verifiedPayment }).mine, true);
    assert.equal(nextAction(sent, 'creator', { payments: verifiedPayment }).mine, false);

    const rev = deal({ state: 'revision' });
    assert.equal(nextAction(rev, 'creator', { payments: verifiedPayment }).mine, true);
    assert.equal(nextAction(rev, 'brand', { payments: verifiedPayment }).mine, false);
});

test('a failed advance tells the brand to try again, and does not blame the creator', () => {
    const payments = [{ status: 'failed' }];
    const brand = nextAction(unpaid(), 'brand', { payments });
    assert.match(brand.text, /again/i);
    assert.equal(brand.mine, true);

    const creator = nextAction(unpaid(), 'creator', { payments });
    assert.equal(creator.mine, false);
});

test('an invitation waits on whoever did not send it', () => {
    const sentByBrand = deal({ state: 'invitation', requestedBy: 'brand' });
    assert.equal(nextAction(sentByBrand, 'brand', {}).mine, false);
    assert.equal(nextAction(sentByBrand, 'creator', {}).mine, true);
});

/* ─────────────────────────── completion and money ───────────────────────── */

test('an approved collaboration with no recorded settlement is not called completed', () => {
    /**
     * Approval, the escrow release and the state change happen in one
     * transaction, so this should not occur — which is exactly why it is named.
     * "Completed" over a collaboration whose money never moved is the kind of
     * quiet lie that is only discovered by the creator.
     */
    const d = deal({ state: 'completed', escrow: { amount: 62000, funded: true } });
    assert.equal(collaborationStatus(d, {}).id, 'approved');
    assert.equal(nextAction(d, 'creator', {}).warn, true);
});

test('a settled collaboration is completed, and says the money is in the wallet', () => {
    const d = deal({
        state: 'completed',
        escrow: { amount: 62000, funded: true, releasedAt: '2026-11-02', settlement: { creatorPayout: 54250 } },
    });
    assert.equal(collaborationStatus(d, {}).id, 'completed');

    const creator = nextAction(d, 'creator', {});
    assert.match(creator.text, /wallet/i);
    // Policy honesty: the Payout row is written `pending`, so this must not
    // claim the creator has been paid out.
    assert.match(creator.text, /separate step/i);
});

test('the payment stage is only done when a creator payout was actually recorded', () => {
    const refundedOnly = deal({
        state: 'completed',
        escrow: { amount: 62000, funded: true, releasedAt: '2026-11-02', settlement: { creatorPayout: 0, brandRefund: 62000 } },
    });
    const by = Object.fromEntries(stageStates(refundedOnly, {}).map((s) => [s.id, s.state]));
    assert.notEqual(by.payment_completed, 'done',
        'a full refund is not a payment to the creator');
});

test('nothing derives a payout field the Deal schema does not have', () => {
    /**
     * An earlier draft of this file read `escrow.payoutCompletedAt`, which does
     * not exist on the Deal schema — Mongoose strict mode would have dropped it
     * silently, so the status would have been computed from `undefined` for
     * every collaboration. Payout completion is not recorded anywhere yet; the
     * release is, and that is what this reads.
     */
    const src = readFileSync(
        path.join(FRONTEND, 'components', 'deals', 'collaborationStatus.js'), 'utf8',
    );
    assert.equal(/payoutCompletedAt/.test(stripComments(src)), false);

    const schema = code('models/Deal.js');
    for (const m of stripComments(src).matchAll(/deal\?\.escrow\?\.([a-zA-Z]+)/g)) {
        assert.match(schema, new RegExp(`\\b${m[1]}\\b`),
            `escrow.${m[1]} is read but is not a path on the Deal schema`);
    }
});

/* ───────────────────────── the ten-status vocabulary ────────────────────── */

test('every state the backend can reach has a status to show', () => {
    /**
     * A vocabulary that cannot name a state shows a blank badge at exactly the
     * moment a party most needs to know where they are. `resolution` and
     * `declined` were not in the requested ten and are included for this reason.
     */
    for (const state of DEAL_STATES) {
        const s = collaborationStatus(deal({ state }), { payments: [] });
        assert.ok(s.id && s.label, `${state} has no status`);
        assert.ok(s.pill, `${state} has no pill`);
    }
});

test('the ten requested statuses all exist, by the names that were asked for', () => {
    const all = new Set([...STAGES.map((s) => s.id), ...Object.keys(OFF_PATH)]);
    for (const id of [
        'awaiting_payment', 'payment_verified', 'active', 'submitted',
        'revision_requested', 'approved', 'payment_completed', 'completed',
        'disputed', 'cancelled',
    ]) assert.ok(all.has(id), `${id} is missing from the vocabulary`);
});

test('the pills are classes the design system actually defines', () => {
    /**
     * A status whose pill class does not exist renders as unstyled text, and
     * nothing errors. Checked against the stylesheet rather than a copy of the
     * list here, because the copy is what drifts.
     */
    const css = readFileSync(path.join(FRONTEND, 'styles', 'index.css'), 'utf8');

    /*
      Every status, not every state — three statuses live on the `completed`
      state and one is only reachable with a payment record, so iterating the
      states alone leaves their pills unexercised. (It did: a deliberately
      broken `completed` pill passed.)
      */
    const settled = {
        amount: 62000, funded: true, releasedAt: '2026-11-02',
        settlement: { creatorPayout: 54250 },
    };
    const cases = [
        ...DEAL_STATES.map((state) => [deal({ state }), {}]),
        [deal({ state: 'completed', escrow: settled }), {}],
        [unpaid(), { payments: verifiedPayment }],
    ];

    const seen = new Set();
    for (const [d, opts] of cases) {
        const s = collaborationStatus(d, opts);
        seen.add(s.id);
        assert.match(css, new RegExp(`\\.${s.pill}\\s`),
            `${s.pill} (${s.id}) is not defined in the stylesheet`);
    }
    for (const id of ['awaiting_payment', 'payment_verified', 'active', 'submitted',
        'revision_requested', 'approved', 'completed', 'disputed', 'cancelled']) {
        assert.ok(seen.has(id), `${id} was never produced, so its pill went unchecked`);
    }
});

test('a cancelled collaboration has no current stage, only how far it got', () => {
    const d = deal({ state: 'cancelled' });
    const stages = stageStates(d, { payments: verifiedPayment });
    assert.equal(stages.some((s) => s.state === 'current'), false);
    assert.equal(stages.find((s) => s.id === 'active').state, 'done');
    assert.equal(stages.find((s) => s.id === 'completed').state, 'skipped');
});

test('the revision loop is off the path, not a step on it', () => {
    // Drawing a revision as a forward step draws a path that does not exist.
    assert.equal(STAGES.some((s) => s.id === 'revision_requested'), false);
    assert.ok(OFF_PATH.revision_requested);
    assert.equal(collaborationStatus(deal({ state: 'revision' }), {}).id, 'revision_requested');
});

test('workspaceStatus answers all four questions in one call', () => {
    const w = workspaceStatus(deal(), 'creator', { payments: verifiedPayment });
    assert.ok(w.status.label);
    assert.equal(w.stages.length, STAGES.length);
    assert.ok(w.action.text);
    assert.equal(w.paid, true);
});

test('the advance fact falls back to the pre-split flag', () => {
    // Deals locked before the 50/50 schedule existed have no `schedule` — their
    // single payment was the whole value, and `escrow.funded` is the record.
    assert.equal(advanceVerified({ escrow: { funded: true } }), true);
    assert.equal(advanceVerified({ escrow: { funded: false } }), false);
    assert.equal(advanceVerified({}), false);
});

/* ──────────────────────────── the page assembles it ─────────────────────── */

test('the page shows the workspace header, the stepper and the history', () => {
    const page = jsx('pages', 'DealDetailPage.jsx');
    assert.match(page, /<WorkspaceHeader/);
    assert.match(page, /<ActivityHistory/);
    assert.match(page, /<CollaborationFiles/);

    // And no longer carries its own step table.
    assert.equal(/STEP_LABEL|STEP_FOR|stepIndex/.test(page), false);
    assert.equal(/<Steps\b/.test(page), false);
});

test('the header names the campaign, the brand and the creator', () => {
    const header = jsx('components', 'deals', 'WorkspaceHeader.jsx');
    assert.match(header, /campaignSummary/);
    assert.match(header, /parties\?\.brand/);
    assert.match(header, /parties\?\.creator/);
    // And says when there is no campaign rather than inventing one — Route 2
    // collaborations do not have one.
    assert.match(header, /Direct collaboration/);
});

test('the header quotes the terms in force, not the terms first agreed', () => {
    /**
     * Caught by looking at the rendered page: the header said "Due 27 Oct" a
     * finger's width above a terms card that said 10 Nov. An accepted amendment
     * is recorded in `termsAmendments` and read back through `bindingTerms` —
     * `deal.terms` deliberately keeps the original — so a header reading
     * `deal.terms.deadline` is a fortnight out for the rest of the
     * collaboration, in the place people check the date fastest.
     */
    const header = jsx('components', 'deals', 'WorkspaceHeader.jsx');
    assert.match(header, /const inForce = binding \?\? deal\.terms/);
    assert.equal(/Due \{fmtDate\(deal\.terms/.test(header), false);
    assert.equal(/amount=\{deal\.terms\?\.amount\}/.test(header), false);

    // And the page actually hands it the binding terms.
    assert.match(jsx('pages', 'DealDetailPage.jsx'), /binding=\{terms\?\.bindingTerms\}/);
});

test('the escrow card does not claim the whole value is held', () => {
    /**
     * Also caught by looking at the page: in `submitted` the card read "Amount
     * ₹62,000 · Funded: yes" while only the ₹31,000 advance had been charged.
     * Same class of mistake as the release guard on the server — the agreed
     * total and the money actually collected are two different figures.
     */
    const page = jsx('pages', 'DealDetailPage.jsx');
    assert.match(page, /const balanceOwed =/);
    assert.match(page, /<Money amount=\{heldAmount\}/);
    assert.match(page, /Not collected yet/);
});

test('the history title-cases nothing it did not write', () => {
    // The CSS `capitalize` class over both state names and payment lines gave
    // "Payment Order Created · By Brand".
    const h = jsx('components', 'deals', 'ActivityHistory.jsx');
    assert.equal(/capitalize/.test(h), false);
    assert.match(h, /const sentence =/);
});

test('the header does not present a self-service check as a verification', () => {
    // Policy 13.2 — `email` and `social` are self-reported.
    const header = jsx('components', 'deals', 'WorkspaceHeader.jsx');
    assert.match(header, /verifications\?\.business/);
    assert.equal(/verifications\?\.(email|social)/.test(header), false);
});

test('the header offers no way to change locked terms', () => {
    /**
     * Policy 5.2 — a locked term moves only through a change request, which
     * lives in the terms card. A second entry point in the header would imply
     * the header can amend the agreement.
     */
    const header = jsx('components', 'deals', 'WorkspaceHeader.jsx');
    assert.match(header, /Terms locked/);
    assert.equal(/onRequestChange|requestChange/.test(header), false);
});

test('the stepper states are readable without colour', () => {
    /**
     * Done and locked must not be distinguishable only by jade versus grey. Each
     * stage carries a word.
     */
    const stepper = jsx('components', 'deals', 'CollaborationStepper.jsx');
    for (const word of ['Done', 'Now', 'Pending', 'Locked', 'Not reached']) {
        assert.match(stepper, new RegExp(`'${word}'`), `the stepper never says ${word}`);
    }
});

test('the payment record and the thread are fetched once, by the page', () => {
    /**
     * Three components read the payments and two read the messages. Fetching per
     * component means the same request two or three times and two lists on
     * screen that disagree after a send.
     */
    const page = jsx('pages', 'DealDetailPage.jsx');
    assert.match(page, /api\.paymentRecords\(id\)/);
    assert.match(page, /api\.listMessages\(id\)/);

    const advance = jsx('components', 'deals', 'AdvancePayment.jsx');
    assert.equal(/api\.paymentRecords/.test(advance), false,
        'AdvancePayment must take the records from the page');

    const chat = jsx('components', 'deals', 'DealChat.jsx');
    assert.equal(/api\.listMessages/.test(chat), false,
        'DealChat must take the thread from the page');
});

test('the page does not ask for messages it is not allowed to read', () => {
    const page = jsx('pages', 'DealDetailPage.jsx');
    assert.match(page, /MESSAGING_ALLOWED_STATES\.includes\(data\.state\)/);
});

/* ───────────────────────────── files and history ────────────────────────── */

test('the files list gathers what exists instead of a second record of it', () => {
    const files = jsx('components', 'deals', 'CollaborationFiles.jsx');
    assert.match(files, /m\.attachments/);
    assert.match(files, /workSubmissions/);
    // Image-vs-file comes from the kind the server derived from the content
    // type; a signed URL usually ends in a query string, so the extension lies.
    assert.match(files, /a\.kind === 'image'/);
    assert.equal(/\.(endsWith|split)\(['"]\.\w/.test(files), false);
});

test('the files list says it is locked rather than showing nothing', () => {
    const files = jsx('components', 'deals', 'CollaborationFiles.jsx');
    assert.match(files, /locked \? \[\]/);
    assert.match(files, /once the collaboration is active/);
});

test('the history carries payments, amendments, change requests and submissions', () => {
    /**
     * `deal.timeline` records state transitions and nothing else, so a failed
     * payment, its retry and an accepted amendment left no trace on the page
     * that is meant to be the record of the collaboration.
     */
    const h = jsx('components', 'deals', 'ActivityHistory.jsx');
    assert.match(h, /deal\?\.timeline/);
    assert.match(h, /termsAmendments/);
    assert.match(h, /changeRequests/);
    assert.match(h, /workSubmissions/);
    // Each state a payment passed through, not only where it ended up.
    assert.match(h, /p\.history/);
});

test('the history names changed fields from one list of labels', () => {
    // A second private map is one "usageRights" away from the composer and the
    // history calling the same field two different things.
    const h = jsx('components', 'deals', 'ActivityHistory.jsx');
    assert.match(h, /import \{ FIELD_LABEL \} from '\.\/ChangeRequestPanel'/);
    assert.match(jsx('components', 'deals', 'ChangeRequestPanel.jsx'), /export const FIELD_LABEL/);
});

test('a failed payment is marked as a failure, not as ordinary activity', () => {
    const h = jsx('components', 'deals', 'ActivityHistory.jsx');
    assert.match(h, /h\.status === 'failed' \? 'bad'/);
});

/* ─────────────────────────── nothing was broken ─────────────────────────── */

test('the advance panel still reads every figure from the frozen schedule', () => {
    const advance = jsx('components', 'deals', 'AdvancePayment.jsx');
    assert.equal(/\* 0\.5|\/ 2\b|advancePct \/ 100/.test(advance), false,
        'the panel must not compute the split itself');
});

test('the workspace does not write a payment state of its own', () => {
    // Only the signature-verified webhook may write `verified`.
    for (const f of [
        ['components', 'deals', 'CollaborationStepper.jsx'],
        ['components', 'deals', 'WorkspaceHeader.jsx'],
        ['components', 'deals', 'ActivityHistory.jsx'],
    ]) {
        assert.equal(/api\.(transitionDeal|confirm)/.test(jsx(...f)), false,
            `${f.join('/')} must not move money or state`);
    }
});

test('the status module has no React dependency', () => {
    /**
     * It is imported and run by this suite. A stray React import would make the
     * one piece of logic on this screen untestable, which is how display rules
     * that decide what a party is told end up verified by eye.
     */
    assert.equal(/from 'react'/.test(raw('components', 'deals', 'collaborationStatus.js')), false);
});
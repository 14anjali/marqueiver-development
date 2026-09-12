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

/** Comments stripped — these files quote the old behaviour while explaining it. */
const stripComments = (s) => s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const code = (rel) => stripComments(readFileSync(path.join(SRC, rel), 'utf8'));
const jsx = (...p) => stripComments(readFileSync(path.join(FRONTEND, ...p), 'utf8'));

const {
    revisionState, revisionLimit, revisionHistory,
    recordRevisionRequest, resolveOpenRevision,
} = await import('../src/modules/deals/revisions.service.js');
const { INCLUDED_REVISIONS } = await import('../src/models/Deal.js');
const { canRequestRevision } = await import('../src/modules/deals/dealStateMachine.js');

/**
 * The revision rounds.
 *
 * Three rules: three included rounds unless the parties agreed otherwise, a
 * round is never opened without a reason, and nothing a creator does resets the
 * count.
 */

const deal = (over = {}) => ({
    _id: 'd1',
    state: 'submitted',
    terms: { amount: 62000, revisionsAllowed: INCLUDED_REVISIONS },
    revisionCount: 0,
    revisions: [],
    workSubmissions: [],
    ...over,
});

/* ─────────────────────────── the budget ─────────────────────────────────── */

test('the default included limit is three', () => {
    assert.equal(INCLUDED_REVISIONS, 3);
    assert.equal(revisionLimit(deal()), 3);
    assert.equal(revisionState(deal()).allowed, 3);
});

test('the agreed number wins over the default', () => {
    /**
     * The schema default and the enforcement used to be different numbers — the
     * schema said 1 while the requirement said 3, and neither was enforced. The
     * limit is read from the agreement, never from a constant at the call site.
     */
    const negotiated = deal({ terms: { revisionsAllowed: 5 } });
    assert.equal(revisionLimit(negotiated), 5);
    assert.equal(revisionState(negotiated).remaining, 5);
});

test('the state counts up to the limit and then reports exhausted', () => {
    const two = deal({ revisionCount: 2 });
    assert.deepEqual(
        { used: 2, allowed: 3, remaining: 1, exhausted: false, next: 3 },
        (({ used, allowed, remaining, exhausted, next }) => ({ used, allowed, remaining, exhausted, next }))(revisionState(two)),
    );

    const three = deal({ revisionCount: 3 });
    assert.equal(revisionState(three).exhausted, true);
    assert.equal(revisionState(three).remaining, 0);
    assert.equal(canRequestRevision(three).allowed, false);
});

test('purchased rounds are counted as purchased, not as included', () => {
    // Policy 5.5 option B — funding raises `revisionsAllowed`, and the parties
    // should be able to see that three of the five were bought.
    const bought = deal({
        terms: { revisionsAllowed: 5 },
        revisionCount: 3,
        additionalTerms: { status: 'funded', revisionsAdded: 2 },
    });
    const s = revisionState(bought);
    assert.equal(s.allowed, 5);
    assert.equal(s.purchased, 2);
    assert.equal(s.exhausted, false);
});

/* ──────────────────────────── the rounds ───────────────────────────────── */

test('a round records its number, its reason and what it was about', () => {
    const d = deal({ revisionCount: 1 });
    const entry = recordRevisionRequest(d, {
        reason: 'The product label is out of frame in the first six seconds.',
        actorRole: 'brand',
        submission: { _id: 'sub1', deliverable: { key: 'reel|instagram|0', label: '2 × Reel (Instagram)' } },
    });

    assert.equal(entry.round, 2, 'the round matches what revisionCount becomes');
    assert.match(entry.reason, /out of frame/);
    assert.equal(entry.deliverableLabel, '2 × Reel (Instagram)');
    assert.equal(entry.submission, 'sub1');
    assert.ok(entry.requestedAt);
    assert.equal(d.revisions.length, 1);
});

test('recording a round does not itself move the counter', () => {
    /**
     * `revisionCount` is incremented by the transition into `revision` and
     * nowhere else. Two writers is how a deal with three included revisions
     * ended up in Resolution after the brand's second request, with the note
     * saying "revision 2 of 3" over a stored count of 4.
     */
    const d = deal({ revisionCount: 1 });
    recordRevisionRequest(d, { reason: 'x' });
    assert.equal(d.revisionCount, 1);

    const service = code('modules/deals/deals.service.js');
    assert.equal((service.match(/revisionCount \+= 1/g) ?? []).length, 1);

    const revisions = code('modules/deals/revisions.service.js');
    assert.equal(/revisionCount\s*(\+=|=)/.test(revisions), false,
        'the revisions service must not write the counter');
});

test('a resubmission answers the open round and never resets the count', () => {
    const d = deal({ state: 'revision', revisionCount: 2 });
    recordRevisionRequest(d, { reason: 'Recut the intro' });

    const closed = resolveOpenRevision(d, 'sub9');
    assert.equal(closed.resolvedBySubmission, 'sub9');
    assert.ok(closed.resolvedAt);
    assert.equal(d.revisionCount, 2, 'answering a round is not a reason to forget it');

    // And a second resubmission with nothing open closes nothing.
    assert.equal(resolveOpenRevision(d, 'sub10'), null);
});

test('the submission path never writes the revision counter', () => {
    /**
     * The requirement in one assertion: uploading a new file must not reset or
     * change the count. A counter a resubmission could reset would hand the
     * brand unlimited free rounds and leave the creator no way to show it.
     */
    const controller = code('modules/deals/deals.controller.js');
    const submit = controller.slice(
        controller.indexOf('export const submitWork'),
        controller.indexOf('export const listDeliverables'),
    );
    assert.equal(/revisionCount/.test(submit), false);
    assert.match(submit, /resolveOpenRevision\(deal/);
});

test('the history reads newest first and says which rounds are still open', () => {
    const d = deal({ revisionCount: 0 });
    recordRevisionRequest(d, { reason: 'one' });
    resolveOpenRevision(d, 's1');
    d.revisionCount = 1;
    recordRevisionRequest(d, { reason: 'two' });

    const history = revisionHistory(d);
    assert.equal(history[0].reason, 'two');
    assert.equal(history[0].status, 'awaiting_resubmission');
    assert.equal(history[1].status, 'answered');
});

/* ───────────────────── a round is never opened silently ────────────────── */

test('a revision request without a reason is refused', () => {
    // Enforced in the schema, and the round itself cannot be written without
    // one — `reason` is required on the subdocument.
    const model = code('models/Deal.js');
    const rev = model.slice(model.indexOf('revisions: {'), model.indexOf('dispute: {'));
    assert.match(rev, /reason: \{ type: String, required: true \}/);

    const controller = code('modules/deals/deals.controller.js');
    assert.match(controller, /b\.decision !== 'revision' \|\| Boolean\(b\.feedback\?\.trim\(\)\)/);
});

test('the round is opened by the review path, with the submission it is about', () => {
    const controller = code('modules/deals/deals.controller.js');
    const review = controller.slice(
        controller.indexOf('export const reviewSubmission ='),
        controller.indexOf('export const requestRevision'),
    );
    assert.match(review, /moveToRevision\(deal, \{[\s\S]{0,120}submission,/);

    const helper = controller.slice(
        controller.indexOf('async function moveToRevision'),
        controller.indexOf('export const reviewSubmissionSchema'),
    );
    assert.match(helper, /recordRevisionRequest\(deal, \{ reason: note, actorId, submission \}\)/);
});

/* ───────────────── past the limit it is additional work ────────────────── */

test('past the limit the request is not treated as an included revision', () => {
    /**
     * It does not silently become a fourth free round, and it is not refused
     * either: further work is new scope under Policy 5.5 option B — the creator
     * can decline it and it has its own price.
     */
    const controller = code('modules/deals/deals.controller.js');
    const helper = controller.slice(
        controller.indexOf('async function moveToRevision'),
        controller.indexOf('export const reviewSubmissionSchema'),
    );
    assert.match(helper, /to: 'resolution'/);
    assert.match(helper, /additionalWork: true/);
    assert.match(helper, /additional work/i);

    /*
      No round is opened on that path. Sliced to the exhausted BRANCH — from the
      cap check to its return — rather than "everything before the first
      recordRevisionRequest", which is what this assertion said at first and
      which passes vacuously the moment a call is inserted inside the branch.
      Sabotaging it is how that came out.
    */
    const branchStart = helper.indexOf('if (!check.allowed) {');
    const branch = helper.slice(branchStart, helper.indexOf('};', branchStart));
    assert.ok(branch.includes("to: 'resolution'"), 'sliced the wrong branch');
    assert.equal(/recordRevisionRequest/.test(branch), false,
        'an exhausted request must not open an included round');
});

test('the reason the brand wrote survives the move to additional work', () => {
    // They wrote it to describe work they want done, and it is exactly the scope
    // note the offer needs. Dropping it means asking them to retype it.
    const controller = code('modules/deals/deals.controller.js');
    const helper = controller.slice(
        controller.indexOf('async function moveToRevision'),
        controller.indexOf('export const reviewSubmissionSchema'),
    );
    assert.match(helper, /Requested: \$\{note\}/);
    assert.match(helper, /requested: note/);
});

test('only funding additional terms raises the included limit', () => {
    const add = code('modules/deals/additionalTerms.service.js');
    assert.equal((add.match(/terms\.revisionsAllowed =/g) ?? []).length, 1);

    for (const f of ['modules/deals/deals.controller.js', 'modules/deals/revisions.service.js',
        'modules/deals/deals.service.js']) {
        assert.equal(/revisionsAllowed\s*=[^=]/.test(code(f)), false,
            `${f} must not change the agreed revision limit`);
    }
});

/* ─────────────────────────────── the UI ────────────────────────────────── */

test('the budget is shown before it runs out, not after', () => {
    /**
     * It was a bare progress bar that appeared only once a round had been spent,
     * so the limit was discovered by hitting it — which is how a collaboration
     * reaches Resolution by accident.
     */
    const page = jsx('pages', 'DealDetailPage.jsx');
    assert.match(page, /<RevisionRounds/);
    assert.equal(/revisionsUsed > 0 &&/.test(page), false);

    const panel = jsx('components', 'deals', 'RevisionRounds.jsx');
    assert.match(panel, /none used yet/);
    assert.match(panel, /last included revision/);
});

test('the rounds list shows the number, the reason and whether it was answered', () => {
    const panel = jsx('components', 'deals', 'RevisionRounds.jsx');
    assert.match(panel, /Revision \{r\.round\} of \{allowed\}/);
    assert.match(panel, /\{r\.reason\}/);
    assert.match(panel, /Awaiting resubmission/);
    assert.match(panel, /Resubmitted/);
});

test('a round is answered or not according to the recorded fact', () => {
    /**
     * Caught in the rendered page: a round whose own line read "answered 24 Oct"
     * carried a badge saying "Awaiting resubmission", because the badge read the
     * `status` the endpoint computes rather than the `resolvedAt` it is computed
     * from. One fact, one reader.
     */
    const panel = jsx('components', 'deals', 'RevisionRounds.jsx');
    assert.match(panel, /const answered = Boolean\(r\.resolvedAt\)/);
    assert.equal(/r\.status === 'answered'/.test(panel), false);
});

test('the review button says what it will actually do', () => {
    /**
     * Past the limit, pressing it moves the collaboration to additional work and
     * asks the brand for money. A button that still said "Request a revision"
     * would be one label for two different acts.
     */
    const panel = jsx('components', 'deals', 'DeliverablesPanel.jsx');
    assert.match(panel, /exhausted \? 'Request further work'/);
    assert.match(panel, /exhausted \? 'Continue to additional work'/);
    assert.match(panel, /This uses revision \{revisions\.next\} of \{revisions\.allowed\}/);
});

test('the deliverables endpoint carries the rounds to both parties', () => {
    const controller = code('modules/deals/deals.controller.js');
    const handler = controller.slice(
        controller.indexOf('export const listDeliverables'),
        controller.indexOf('async function moveToRevision'),
    );
    assert.match(handler, /\.\.\.revisionState\(deal\)/);
    assert.match(handler, /history: revisionHistory\(deal\)/);
    // Both parties: the creator needs the reason as much as the brand.
    assert.match(handler, /isParty/);
});
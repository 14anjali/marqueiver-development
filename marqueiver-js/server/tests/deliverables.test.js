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
    agreedDeliverables, deliverableProgress, allDeliverablesApproved,
    outstandingDeliverables, deliverableFileKind, toSubmissionFile, deliverableKey,
} = await import('../src/modules/deals/deliverables.service.js');
const { submitWorkSchema, reviewSubmissionSchema } = await import('../src/modules/deals/deals.controller.js');

/**
 * The deliverable workflow.
 *
 * Two rules underneath all of it: a submission is never replaced, and nothing
 * marks content approved except a brand deciding to.
 */

const ITEMS = [
    { contentType: 'Reel', quantity: 2, platform: 'Instagram' },
    { contentType: 'Story', quantity: 3, platform: 'Instagram' },
];

const deal = (over = {}) => ({
    _id: 'd1',
    state: 'submitted',
    terms: { amount: 62000, contentItems: ITEMS, revisionsAllowed: 3 },
    agreedTerms: { amount: 62000, contentItems: ITEMS, lockedAt: '2026-09-05T11:00:00Z' },
    termsAmendments: [],
    workSubmissions: [],
    ...over,
});

const submission = (over = {}) => ({
    _id: 's1',
    deliverable: { key: deliverableKey(ITEMS[0], 0), label: '2 × Reel (Instagram)' },
    urls: ['https://cdn.example.com/reel.mp4'],
    files: [],
    submittedAt: '2026-10-20T10:00:00Z',
    reviewStatus: 'pending',
    ...over,
});

/* ─────────────────────────── the agreed list ────────────────────────────── */

test('the deliverable list is the agreed brief, with amendments applied', () => {
    /**
     * Not `deal.terms.contentItems`: an accepted amendment can change what is
     * being delivered, and a creator submitting against the original list would
     * be delivering the wrong thing while the page told them they were on track.
     */
    const amended = deal({
        termsAmendments: [{
            changes: { contentItems: { from: ITEMS, to: [{ contentType: 'Reel', quantity: 1 }] } },
        }],
    });
    const list = agreedDeliverables(amended);
    assert.equal(list.length, 1);
    assert.match(list[0].label, /1 × Reel/);
});

test('a reordered brief never re-points an old submission at a different line', () => {
    /**
     * `contentItems` are stored with `_id: false`, so the key is derived from the
     * item's content plus its position. If the brief is reordered by an
     * amendment, an old submission's key stops matching — and it surfaces under
     * "other submissions" rather than being silently attributed to whichever
     * line now sits at that index. Showing it in the wrong place is worse than
     * showing it apart.
     */
    const before = deliverableKey(ITEMS[0], 0);
    const inserted = [{ contentType: 'Post', quantity: 1, platform: 'Instagram' }, ...ITEMS];

    const moved = deal({
        terms: { contentItems: inserted },
        agreedTerms: { contentItems: inserted, lockedAt: 'x' },
        workSubmissions: [submission({ deliverable: { key: before, label: '2 × Reel (Instagram)' } })],
    });

    const { deliverables, untagged } = deliverableProgress(moved);
    assert.equal(new Set(deliverables.map((d) => d.key)).size, 3, 'two lines never share a key');
    assert.equal(deliverables.every((d) => d.submissions.length === 0), true,
        'the old submission is not attached to the wrong line');
    assert.equal(untagged.length, 1, 'and it is still visible');
});

test('quantity stays one line, not N trackable items', () => {
    // The parties agreed "2 × Reel" as one line. Splitting it invents structure
    // the brief does not have.
    const list = agreedDeliverables(deal());
    assert.equal(list.length, 2);
    assert.match(list[0].label, /^2 × Reel/);
});

/* ────────────────────────────── submitting ─────────────────────────────── */

test('a submission must carry the work — a link or a file', () => {
    const empty = submitWorkSchema.safeParse({ urls: [], files: [], note: 'here you go' });
    assert.equal(empty.success, false, 'an empty submission starts the brand’s clock for nothing');

    assert.equal(submitWorkSchema.safeParse({ urls: ['https://x.test/a'] }).success, true);
    assert.equal(submitWorkSchema.safeParse({
        files: [{ url: 'https://x.test/a.mp4', name: 'a.mp4', contentType: 'video/mp4' }],
    }).success, true);
});

test('the submission schema is strict and validates links as links', () => {
    assert.equal(submitWorkSchema.safeParse({ urls: ['not a url'] }).success, false);
    assert.equal(submitWorkSchema.safeParse({
        urls: ['https://x.test/a'], deliverabeKey: 'typo',
    }).success, false, 'a misspelled field must not be dropped silently');
});

test('the file kind comes from the content type, never the URL', () => {
    // A signed storage URL usually ends in a query string, so the extension is
    // not a reliable answer.
    assert.equal(deliverableFileKind('video/mp4'), 'video');
    assert.equal(deliverableFileKind('image/png'), 'image');
    assert.equal(deliverableFileKind('application/pdf'), 'file');
    assert.equal(deliverableFileKind(), 'file');

    const f = toSubmissionFile({ url: 'https://x.test/a?sig=1', contentType: 'video/mp4' });
    assert.equal(f.kind, 'video');
    assert.equal(f.role, 'content');
    assert.equal(toSubmissionFile({ url: 'u' }, 'support').role, 'support');
});

test('the controller refuses a submission against a deliverable nobody agreed', () => {
    const controller = code('modules/deals/deals.controller.js');
    const handler = controller.slice(
        controller.indexOf('export const submitWork'),
        controller.indexOf('export const listDeliverables'),
    );
    assert.match(handler, /not part of the agreed brief/);
    // And refuses an untagged one when there is a choice to be made.
    assert.match(handler, /agreed\.length > 1/);
});

test('submitting appends — it never edits the previous submission', () => {
    const controller = code('modules/deals/deals.controller.js');
    const handler = controller.slice(
        controller.indexOf('export const submitWork'),
        controller.indexOf('export const listDeliverables'),
    );
    assert.match(handler, /deal\.workSubmissions\.push\(/);
    assert.equal(/workSubmissions\[[^\]]*\]\s*=|workSubmissions\.splice|\.urls\s*=/.test(handler), false,
        'a resubmission must add a version, not rewrite one');
});

test('both versions stay readable after a resubmission', () => {
    const d = deal({
        workSubmissions: [
            submission({ _id: 's1', reviewStatus: 'rejected', review: { decision: 'revision', feedback: 'Too dark' } }),
            submission({ _id: 's2', submittedAt: '2026-10-24T10:00:00Z' }),
        ],
    });
    const { deliverables } = deliverableProgress(d);
    const reel = deliverables[0];
    assert.equal(reel.submissions.length, 2);
    assert.equal(reel.latest._id, 's2', 'newest first');
    assert.equal(reel.submissions[1].review.feedback, 'Too dark',
        'what the brand said about the first version must survive');
});

test('a submission naming no deliverable is shown, not dropped', () => {
    // Collaborations agreed before this existed. A submission nobody can see is
    // a submission that did not happen.
    const d = deal({ workSubmissions: [submission({ deliverable: undefined })] });
    const { untagged } = deliverableProgress(d);
    assert.equal(untagged.length, 1);
});

/* ───────────────────────────── reviewing ───────────────────────────────── */

test('a revision request must say what needs to change', () => {
    assert.equal(reviewSubmissionSchema.safeParse({ decision: 'revision' }).success, false);
    assert.equal(reviewSubmissionSchema.safeParse({ decision: 'revision', feedback: '  ' }).success, false);
    assert.equal(reviewSubmissionSchema.safeParse({ decision: 'revision', feedback: 'Recut the intro' }).success, true);
    // Approving needs no words.
    assert.equal(reviewSubmissionSchema.safeParse({ decision: 'approved' }).success, true);
});

test('the review records who decided, when, and what they said', () => {
    const controller = code('modules/deals/deals.controller.js');
    const handler = controller.slice(controller.indexOf('export const reviewSubmission ='));

    assert.match(handler, /submission\.review = \{/);
    assert.match(handler, /decision,/);
    assert.match(handler, /feedback:/);
    assert.match(handler, /at,/);
    assert.match(handler, /by: new Types\.ObjectId\(req\.auth\.sub\)/);
});

test('only a brand, on a specific submission, can write an approval', () => {
    const controller = code('modules/deals/deals.controller.js');
    const handler = controller.slice(
        controller.indexOf('export const reviewSubmission ='),
        controller.indexOf('export const requestRevision'),
    );
    assert.match(handler, /deal\.brand\.toString\(\) !== req\.auth\.sub/);
    assert.match(handler, /workSubmissions\.id\(req\.params\.submissionId\)/);

    // Nowhere else in the module writes an approved review status.
    const others = controller.split('export const reviewSubmission =');
    assert.equal(/reviewStatus = 'approved'/.test(others[0]), false);
});

test('a decided submission cannot be decided again', () => {
    const controller = code('modules/deals/deals.controller.js');
    const handler = controller.slice(controller.indexOf('export const reviewSubmission ='));
    assert.match(handler, /already been reviewed/);
});

test('the review route is brand-only and validated', () => {
    const routes = code('modules/deals/deals.routes.js');
    assert.match(routes, /submissions\/:submissionId\/review'[^\n]*requireRole\('brand'\)/);
    assert.match(routes, /validate\(c\.reviewSubmissionSchema\)/);
});

test('nothing outside the review handler marks a submission approved', () => {
    /**
     * The Policy 5.3 sweep completes a collaboration whose review window ran out
     * and releases the money, as the policy requires — but it must not record an
     * approval on content nobody looked at.
     */
    for (const f of ['jobs/policyJobs.js', 'modules/deals/deals.service.js']) {
        assert.equal(/reviewStatus\s*=\s*'approved'/.test(code(f)), false,
            `${f} must not approve content`);
    }
});

/* ──────────────────── approval gates the release, not the reverse ───────── */

test('every agreed deliverable must be approved before the brand releases', () => {
    const d = deal({
        workSubmissions: [
            submission({ reviewStatus: 'approved' }),
            submission({
                _id: 's2',
                deliverable: { key: deliverableKey(ITEMS[1], 1), label: '3 × Story (Instagram)' },
                reviewStatus: 'pending',
            }),
        ],
    });
    assert.equal(allDeliverablesApproved(d), false);
    assert.deepEqual(outstandingDeliverables(d), ['3 × Story (Instagram)']);

    d.workSubmissions[1].reviewStatus = 'approved';
    assert.equal(allDeliverablesApproved(d), true);
    assert.deepEqual(outstandingDeliverables(d), []);
});

test('a brief with no itemised deliverables falls back to what exists', () => {
    const plain = deal({ terms: { amount: 1 }, agreedTerms: { amount: 1, lockedAt: 'x' } });
    assert.equal(allDeliverablesApproved(plain), false);
    plain.workSubmissions = [submission({ deliverable: undefined, reviewStatus: 'approved' })];
    assert.equal(allDeliverablesApproved(plain), true);
});

test('the release refuses a brand who has not approved the work', () => {
    /**
     * Otherwise "approve and release" is one button that pays out work nobody
     * reviewed — automatic approval with an extra click.
     */
    const service = code('modules/deals/deals.service.js');
    const release = service.slice(service.indexOf("if (effect === 'release_escrow')"));
    assert.match(release.slice(0, 1800), /actor === 'brand' && !allDeliverablesApproved\(deal\)/);
});

test('the deadline sweep and an admin determination are still able to release', () => {
    /**
     * Policy 5.3 releases on the brand's silence, and Policy 10.4 / 5.5 decide
     * *about* unapproved work. A blanket approval requirement would make all
     * three impossible, which is why the guard names the actor.
     */
    const service = code('modules/deals/deals.service.js');
    const release = service.slice(service.indexOf("if (effect === 'release_escrow')"), 0 + service.length)
        .slice(0, 1800);

    // The guard names the actor, so it cannot catch the other two paths.
    assert.match(release, /actor === 'brand' && !allDeliverablesApproved/);
    assert.equal(/^[\s\S]*?if \(!allDeliverablesApproved\(deal\)\)/.test(release), false,
        'an unconditional approval requirement would block the Policy 5.3 sweep');

    // And the sweep really does run as `system`.
    const jobs = code('jobs/policyJobs.js');
    const auto = jobs.slice(jobs.indexOf('export async function runAutoCompletion'));
    assert.match(auto.slice(0, 900), /actor: 'system'/);
    assert.match(auto.slice(0, 900), /releaseReason: 'auto_completion'/);
});

/* ──────────────────── one cap, one place, both callers ──────────────────── */

test('the revision cap is checked in one place for both review paths', () => {
    const controller = code('modules/deals/deals.controller.js');
    assert.match(controller, /async function moveToRevision/);
    assert.equal((controller.match(/canRequestRevision\(deal\)/g) ?? []).length, 1,
        'the cap check must not be re-implemented per caller');

    const review = controller.slice(
        controller.indexOf('export const reviewSubmission ='),
        controller.indexOf('export const requestRevision'),
    );
    assert.match(review, /moveToRevision\(deal/);
});

/* ─────────────────────────────── the UI ────────────────────────────────── */

test('the submit form collects everything a review needs', () => {
    const form = jsx('components', 'deals', 'SubmitWorkDialog.jsx');
    assert.match(form, /Upload content/);
    assert.match(form, /Links to the work/);
    assert.match(form, /Caption \/ copy/);
    assert.match(form, /Supporting files/);
    assert.match(form, /Message with this submission/);
    assert.match(form, /Which deliverable/);
});

test('the submit form uploads through the shared helper, not its own', () => {
    const form = jsx('components', 'deals', 'SubmitWorkDialog.jsx');
    assert.match(form, /uploadFile\(file, api\.deliverableUploadUrl\)/);
    assert.equal(/fetch\(/.test(form), false, 'uploading is not reimplemented here');
});

test('the form is a drawer, so the submit button is not below the fold', () => {
    const form = jsx('components', 'deals', 'SubmitWorkDialog.jsx');
    assert.match(form, /<Drawer/);
    assert.equal(/<Modal/.test(form), false);
});

test('the panel leads with the agreed lines and keeps every version', () => {
    const panel = jsx('components', 'deals', 'DeliverablesPanel.jsx');
    assert.match(panel, /progress\?\.deliverables/);
    assert.match(panel, /earlier version/);
    assert.match(panel, /untagged/);
});

test('only the newest version can be reviewed', () => {
    // Deciding a superseded version rules on something already replaced.
    const panel = jsx('components', 'deals', 'DeliverablesPanel.jsx');
    assert.match(panel, /isLatest={s\._id === history\[0\]\?\._id}/);
    assert.match(panel, /canReview = role === 'brand' && !decided && isLatest/);
});

test('the files list includes uploaded deliverables, not only links', () => {
    /**
     * Caught by looking at the page: the list read `urls` only, so a reel
     * uploaded through the submission form — the file the brand most wants to
     * open — did not appear in the collaboration's files at all.
     */
    const files = jsx('components', 'deals', 'CollaborationFiles.jsx');
    assert.match(files, /for \(const f of s\.files \?\? \[\]\)/);
    assert.match(files, /f\.role === 'support'/);
});

test('a submitted image that fails to load falls back to its name', () => {
    // A signed storage URL expires, and a broken-image icon tells the reviewer
    // neither what it was nor what to do.
    const panel = jsx('components', 'deals', 'DeliverablesPanel.jsx');
    assert.match(panel, /onError=\{\(\) => setBroken\(true\)\}/);
});

test('the review UI says that approving is not paying', () => {
    const panel = jsx('components', 'deals', 'DeliverablesPanel.jsx');
    assert.match(panel, /Payment is released separately/);
});

test('the page hides the release button until the work is approved', () => {
    const page = jsx('pages', 'DealDetailPage.jsx');
    assert.match(page, /to === 'completed' && role === 'brand' && !allApproved/);
    // And the button no longer claims to do both things at once.
    assert.equal(/Approve and release payment/.test(page), false);
});

test('the page reads the approval gate from the server, not its own arithmetic', () => {
    const page = jsx('pages', 'DealDetailPage.jsx');
    assert.match(page, /deliverables\?\.allApproved/);
    assert.equal(/workSubmissions[\s\S]{0,60}every\(/.test(page), false,
        'the page must not decide for itself what "all approved" means');
});

test('the stepper knows the work is approved before the money moves', async () => {
    /**
     * Between the brand's approval and the release, the deal state is still
     * `submitted` — releasing is what closes it. Showing "Deliverable submitted"
     * through that window is a stale answer, and the stepper showed Approved as
     * still pending while every line was approved. Caught in the rendered page.
     */
    const mod = await import(
        path.join(FRONTEND, 'components', 'deals', 'collaborationStatus.js')
    );
    const d = { state: 'submitted', escrow: { funded: true } };

    assert.equal(mod.collaborationStatus(d, {}).id, 'submitted');
    assert.equal(mod.collaborationStatus(d, { deliverablesApproved: true }).id, 'approved');

    const stages = Object.fromEntries(
        mod.stageStates(d, { deliverablesApproved: true }).map((x) => [x.id, x.state]),
    );
    assert.equal(stages.submitted, 'done');
    assert.equal(stages.approved, 'current');

    assert.match(mod.nextAction(d, 'brand', { deliverablesApproved: true }).text, /Release the payment/);
    assert.equal(mod.nextAction(d, 'creator', { deliverablesApproved: true }).mine, false);
});
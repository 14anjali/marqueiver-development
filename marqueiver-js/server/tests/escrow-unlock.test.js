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

const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');
const code = (rel) => stripComments(read(rel));
const jsx = (...p) => stripComments(readFileSync(path.join(FRONTEND, ...p), 'utf8'));

const { Transaction, Message, Deal } = await import('../src/models/index.js');
const {
    PAYMENT_STATES, isVerified, normalisePaymentState,
} = await import('../src/models/Transaction.js');
const { MESSAGE_REFERENCE_KINDS, toAttachment, attachmentKind } = await import('../src/models/Message.js');
const {
    MESSAGING_ALLOWED_STATES, MESSAGING_LOCK_REASON, isMessagingUnlocked,
} = await import('../src/modules/messaging/messaging.policy.js');
const { sendSchema } = await import('../src/modules/messaging/messaging.controller.js');

/**
 * The advance, and what it unlocks.
 *
 * One rule underneath all of these: nothing starts and nothing opens until the
 * gateway confirms the money. Every test here is a way that could stop being
 * true without anyone noticing.
 */

const service = () => code('modules/deals/deals.service.js');
const paymentSessionBody = () => {
    const s = service();
    return s.slice(s.indexOf('export async function createPaymentSession'),
        s.indexOf('export async function markPaymentInitiated'));
};

/* ────────────────────────── what is charged ─────────────────────────────── */

test('the order is raised for the advance, not the whole value', () => {
    /**
     * It was `createEscrowOrder(deal.id, deal.terms.amount)` — the full
     * collaboration value — while the confirmed requirement quoted in
     * messaging.policy.js says "the required 50% escrow payment". The policy
     * documents and the payment path disagreed, and the payment path ran.
     */
    const body = paymentSessionBody();
    assert.match(body, /const advance = deal\.escrow\?\.schedule\?\.advance\?\.amount/);
    assert.match(body, /createEscrowOrder\(orderKey, amount\)/);
    assert.equal(/createEscrowOrder\([^)]*deal\.terms\.amount/.test(body), false);

    // Deals agreed before the schedule existed paid the whole value as one
    // payment, and must keep working.
    assert.match(body, /advance > 0 \? advance : deal\.terms\.amount/);
});

test('the advance figure is read from the frozen schedule, not recomputed', () => {
    // Same reason the commission rate is snapshotted (Policy 14.7/14.8): what
    // both parties saw when they agreed is what applies.
    const body = paymentSessionBody();
    assert.equal(/paymentSchedule\(|ADVANCE_PCT|\* 0\.5|\/ 2/.test(body), false,
        'createPaymentSession must not compute the advance itself');
});

test('the advance cannot be paid twice', () => {
    assert.match(paymentSessionBody(), /deal\.escrow\?\.schedule\?\.advance\?\.funded/);
});

/* ─────────────────────── confirming, and only confirming ────────────────── */

test('only a verified payment confirms escrow', () => {
    const s = service();
    const confirm = s.slice(s.indexOf("if (effect === 'confirm_escrow_funded')"));
    const body = confirm.slice(0, confirm.indexOf('if (effect ==='), 1) || confirm.slice(0, 2500);

    assert.match(body, /isVerified\(txn\)/);
    // `=== 'success'` alone would miss the current spelling; `=== 'verified'`
    // alone would miss every row written before the states were named.
    assert.equal(/txn\.status !== 'success'/.test(body), false);
});

test('the advance is recorded as a tranche, not as the whole escrow', () => {
    /**
     * This wrote `deal.escrow.amount = txn.amount`. Once the advance became
     * half the value that would have overwritten the agreed total with half of
     * it — and `release_escrow` pays out `deal.escrow.amount`, so the creator
     * would have been paid the advance and the rest would have vanished from
     * the record.
     */
    const s = service();
    const confirm = s.slice(s.indexOf("if (effect === 'confirm_escrow_funded')"), s.indexOf("if (effect === 'release_escrow')"));

    assert.equal(/deal\.escrow\.amount = txn\.amount/.test(confirm), false);
    assert.match(confirm, /deal\.escrow\.schedule\.advance = \{/);
    assert.match(confirm, /funded: true/);
});

test('release refuses to pay out money that was never collected', () => {
    // Charging the balance is not built, so a 50/50 collaboration stops here
    // rather than crediting a wallet from thin air. Deals with no schedule —
    // agreed before the split — are unaffected.
    const s = service();
    const release = s.slice(s.indexOf("if (effect === 'release_escrow')"));
    assert.match(release.slice(0, 1600), /sched\?\.balance\?\.amount > 0 && !sched\.balance\.funded/);
    assert.match(release.slice(0, 1600), /has not been paid into escrow/);
});

test('the client cannot verify a payment', () => {
    /**
     * The whole gate rests on this. `markPaymentInitiated` is the only
     * client-reported state change and it writes `initiated` — a state that
     * unlocks nothing.
     */
    const s = service();
    const initiated = s.slice(s.indexOf('export async function markPaymentInitiated'),
        s.indexOf('export async function paymentRecords'));
    assert.match(initiated, /moveTo\('initiated'/);
    assert.equal(/verified/.test(initiated), false, 'nothing client-facing may write verified');

    // And only the signature-verified webhook does.
    const webhook = code('modules/payments/payments.controller.js');
    assert.match(webhook, /verifyWebhook\(raw, signature, timestamp\)/);
    assert.match(webhook, /moveTo\('verified', \{ by: 'gateway'/);

    const controller = code('modules/deals/deals.controller.js');
    assert.equal(/'verified'/.test(controller), false,
        'no deal endpoint may write a verified payment state');
});

/* ───────────────────────────── payment states ───────────────────────────── */

test('the five states exist and legacy rows stay writable', () => {
    assert.deepEqual(PAYMENT_STATES, ['pending', 'initiated', 'processing', 'verified', 'failed']);

    /**
     * Mongoose validates on write, not on read: dropping `success` from the
     * enum would make every historical row holding it unsaveable, and the
     * failure would surface as a later unrelated `save()` throwing. The same
     * lesson the application statuses taught.
     */
    const allowed = Transaction.schema.path('status').enumValues;
    for (const s of [...PAYMENT_STATES, 'success', 'reversed']) {
        assert.ok(allowed.includes(s), `${s} must remain writable`);
    }

    // `success` is the old spelling of the same fact.
    assert.equal(normalisePaymentState('success'), 'verified');
    assert.equal(isVerified({ status: 'success' }), true);
    assert.equal(isVerified({ status: 'verified' }), true);
    assert.equal(isVerified({ status: 'initiated' }), false);
    assert.equal(isVerified({ status: 'processing' }), false);
    assert.equal(isVerified(null), false);
});

test('every state change is recorded with who made it', () => {
    const txn = new Transaction({ type: 'escrow_fund', amount: 100 });
    txn.moveTo('pending', { by: 'brand' });
    txn.moveTo('initiated', { by: 'brand' });
    txn.moveTo('verified', { by: 'gateway', note: 'webhook' });

    assert.equal(txn.status, 'verified');
    assert.deepEqual(txn.history.map((h) => h.status), ['pending', 'initiated', 'verified']);
    assert.deepEqual(txn.history.map((h) => h.by), ['brand', 'brand', 'gateway']);
});

/* ──────────────────────── failure, retry, and pause ─────────────────────── */

test('a failure leaves the collaboration exactly where it was', () => {
    const s = service();
    const fail = s.slice(s.indexOf('export async function flagEscrowFailure'));
    // No transition, no cancellation — A11.
    assert.equal(/transitionDeal/.test(fail.slice(0, 2000)), false);
    assert.match(fail, /deal\.escrow\.lastFailure = \{/);
});

test('both parties are told, not just the brand', () => {
    // The creator was waiting for work to start and it has not. Leaving them to
    // wonder is how a collaboration quietly dies.
    const s = service();
    const fail = s.slice(s.indexOf('export async function flagEscrowFailure'));
    assert.match(fail, /user: deal\.brand\.toString\(\)/);
    assert.match(fail, /user: deal\.creator\.toString\(\)/);
});

test('one declined card does not raise an admin review', () => {
    /**
     * It did — `needsAdminReview = true` on the first failure, with copy telling
     * the brand "no action is needed from you yet". That fills the queue with
     * cases nobody needs to touch and tells the brand to wait when what they
     * should do is try a different card.
     */
    const s = service();
    assert.match(s, /const FAILURES_BEFORE_ADMIN_REVIEW = 3/);
    const fail = s.slice(s.indexOf('export async function flagEscrowFailure'));
    assert.match(fail, /failures >= FAILURES_BEFORE_ADMIN_REVIEW/);
    assert.equal(/no action is needed from you yet/.test(fail), false);
});

test('a retry is a new order, not a reused one', () => {
    // Cashfree refuses a duplicate order id, so without a fresh key the brand
    // could never pay after a single failure.
    const body = paymentSessionBody();
    assert.match(body, /attempt > 0 \? `\$\{deal\.id\}_a\$\{attempt \+ 1\}` : deal\.id/);
    // A failed row is never reused as an open session.
    assert.match(body, /status: \{ \$in: \['pending', 'initiated'\] \}/);
});

test('a successful payment clears an earlier failure', () => {
    const s = service();
    const confirm = s.slice(s.indexOf("if (effect === 'confirm_escrow_funded')"), s.indexOf("if (effect === 'release_escrow')"));
    assert.match(confirm, /deal\.escrow\.lastFailure = undefined/);
    assert.match(confirm, /deal\.escrow\.needsAdminReview = false/);
});

/* ──────────────────────── the communication gate ────────────────────────── */

test('chat opens only after the payment is verified', () => {
    // `in_progress` is reachable only from `confirmEscrowFunded`, whose actor
    // is the webhook.
    assert.equal(isMessagingUnlocked('accepted'), false);
    assert.equal(isMessagingUnlocked('escrow_pending'), false);
    assert.equal(isMessagingUnlocked('in_progress'), true);

    const s = service();
    const confirm = s.slice(s.indexOf('export async function confirmEscrowFunded'));
    assert.match(confirm.slice(0, 900), /to: 'in_progress'/);
    assert.match(confirm.slice(0, 900), /actor: 'system'/);
});

test('the gate is on the server, not only in the page', () => {
    const controller = code('modules/messaging/messaging.controller.js');
    assert.match(controller, /MESSAGING_ALLOWED_STATES\.has\(deal\.state\)/);
    assert.match(controller, /MESSAGING_LOCKED/);
});

test('the page mirrors the server vocabulary exactly', () => {
    /**
     * The two packages cannot import from each other, so the lists are
     * repeated. A state missing on the page shows an open composer whose every
     * send is refused; a state missing on the server opens a chat the policy
     * meant to keep closed. The server file already records this happening
     * once, with a state named `active` that never existed.
     */
    const mirror = path.join(FRONTEND, 'components', 'deals', 'messagingLock.js');
    assert.ok(existsSync(mirror), `missing: ${mirror}`);
    const src = readFileSync(mirror, 'utf8');

    const states = [...src.matchAll(/^\s*'(\w+)',$/gm)].map((m) => m[1]);
    assert.deepEqual(new Set(states), MESSAGING_ALLOWED_STATES,
        'the page and the policy must allow the same states');

    for (const [state, reason] of Object.entries(MESSAGING_LOCK_REASON)) {
        assert.ok(src.includes(reason), `the page is missing the reason for "${state}"`);
    }
});

/* ─────────────────── text, files, images and references ─────────────────── */

test('a message may carry an image with no text', () => {
    /**
     * `body` was `min(1)`, so an image could not be sent on its own and the
     * sender had to type something beside it. What people type in that position
     * is "." — which is worse than nothing, because it is a message.
     */
    const ok = { attachments: [{ url: 'https://example.com/a.png', contentType: 'image/png', name: 'a.png' }] };
    assert.equal(sendSchema.safeParse(ok).success, true);
    assert.equal(sendSchema.safeParse({ references: [{ kind: 'proposal', seq: 2 }] }).success, true);
    assert.equal(sendSchema.safeParse({ body: 'hello' }).success, true);

    // But a message still has to carry something.
    assert.equal(sendSchema.safeParse({}).success, false);
    assert.equal(sendSchema.safeParse({ body: '   ' }).success, false);
});

test('an image is told apart from a file by its type, not its URL', () => {
    // A signed storage URL usually ends in a query string, so the extension is
    // not a reliable answer.
    assert.equal(toAttachment({ url: 'https://x/y?sig=abc', contentType: 'image/jpeg' }).kind, 'image');
    assert.equal(toAttachment({ url: 'https://x/z?sig=abc', contentType: 'application/pdf' }).kind, 'file');
    // A URL that looks like an image but is not typed as one is still a file —
    // the type is what the sender's own file reported.
    assert.equal(attachmentKind(''), 'file');
    assert.equal(attachmentKind(undefined), 'file');
    assert.equal(attachmentKind('IMAGE/PNG'), 'image');

    /*
      And the controller actually calls it. This was first written as a
      `pre('validate')` hook that never fired, so every attachment stored as
      `file` and photographs rendered as download chips.
    */
    assert.match(code('modules/messaging/messaging.controller.js'), /\.map\(toAttachment\)/);
});

test('references point at things this collaboration actually has', () => {
    assert.deepEqual(MESSAGE_REFERENCE_KINDS, ['proposal', 'final_terms', 'amendment', 'change_request']);
    assert.equal(sendSchema.safeParse({ references: [{ kind: 'nonsense' }] }).success, false);

    // The label is frozen at send time — re-deriving it later would silently
    // rewrite an old message when the underlying thing changed.
    assert.ok(Message.schema.path('references').schema.path('label'));
});

test('uploads go through the one shared helper', () => {
    const chat = jsx('components', 'deals', 'DealChat.jsx');
    assert.match(chat, /uploadFile\(file, api\.messageUploadUrl\)/);
    assert.equal(/fetch\(|XMLHttpRequest/.test(chat), false,
        'chat must not reimplement uploading');

    // …pointed at the same endpoint, with its own purpose.
    const users = code('modules/users/users.controller.js');
    assert.match(users, /'application', 'message'/);
});

/* ──────────────────────────── records and UI ────────────────────────────── */

test('the payment record is readable by both parties', () => {
    // A creator waiting to start needs to see whether the advance is pending,
    // failed or verified. "Ask the brand" is not an answer a platform gives.
    const controller = code('modules/deals/deals.controller.js');
    const handler = controller.slice(controller.indexOf('export const listDealPayments'));
    assert.match(handler.slice(0, 600), /deal\.brand\.toString\(\), deal\.creator\.toString\(\)/);
    assert.match(handler.slice(0, 600), /forbidden\(\)/);
});

test('the panel shows the three figures and never computes them', () => {
    const src = jsx('components', 'deals', 'AdvancePayment.jsx');
    assert.match(src, /sched\.creatorAdvance/);
    assert.match(src, /sched\.creatorBalance/);
    assert.match(src, /sched\.advance\?\.amount/);
    assert.equal(/Math\.round|\* 0\.5|\/ 2/.test(src), false,
        'the panel must read the frozen figures, not derive them');

    // Both sides of the same schedule, each shown their own numbers.
    assert.match(src, /isBrand \? deal\.escrow\?\.amount : sched\.creatorNet/);
});

test('the panel offers a retry and does not claim payment itself', () => {
    const src = jsx('components', 'deals', 'AdvancePayment.jsx');
    assert.match(src, /Try the payment again/);
    // Returning from checkout is not confirmation.
    assert.match(src, /waiting for the gateway to confirm/i);
    assert.equal(/transitionDeal/.test(src), false,
        'the page must not move the deal — the webhook does');
});

test('all five states are shown to a person in words', () => {
    const src = jsx('components', 'deals', 'AdvancePayment.jsx');
    for (const s of PAYMENT_STATES) {
        assert.match(src, new RegExp(`\\b${s}:`), `the panel must label "${s}"`);
    }
    // Including the legacy spelling, or old rows render a raw enum value.
    assert.match(src, /success: 'Verified'/);
});
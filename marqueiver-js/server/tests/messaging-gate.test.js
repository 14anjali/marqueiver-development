import test from 'node:test';
import assert from 'node:assert/strict';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';

const { MESSAGING_ALLOWED_STATES, isMessagingUnlocked, messagingLockReason } =
    await import('../src/modules/messaging/messaging.policy.js');
const { ALL_STATES } = await import('../src/modules/deals/dealStateMachine.js');

/**
 * When chat opens.
 *
 * The confirmed requirement: "No collaboration communication before the
 * required 50% escrow payment is successfully verified." Verified payment is
 * the `escrow_pending → in_progress` transition, whose actor is `system` and
 * whose effect is `confirm_escrow_funded`.
 */

test('every state in the gate is a real deal state', () => {
    /**
     * The gate used to contain `active`, which is not and never was a state in
     * this lifecycle — a name left behind by a rename. It matched nothing, so
     * chat was silently locked for the whole of `in_progress`.
     */
    const unknown = [...MESSAGING_ALLOWED_STATES].filter((s) => !ALL_STATES.includes(s));

    assert.deepEqual(unknown, [], `not real deal states: ${unknown.join(', ')}`);
});

test('chat is closed until the advance payment is confirmed', () => {
    // Every state before money is verified.
    for (const state of ['invitation', 'negotiation', 'accepted', 'escrow_pending']) {
        assert.equal(isMessagingUnlocked(state), false,
            `chat must not be open at ${state}`);
    }
});

test('escrow_pending specifically is closed — asked to pay is not paid', () => {
    // This one was open. It is the exact window in which an off-platform
    // payment gets arranged, which Policy 1.5 and 11 exist to prevent.
    assert.equal(isMessagingUnlocked('escrow_pending'), false);
});

test('chat is open for the whole of the collaboration', () => {
    // `in_progress` was closed, which is when the parties most need to talk.
    for (const state of ['in_progress', 'submitted', 'revision', 'completed']) {
        assert.equal(isMessagingUnlocked(state), true,
            `chat must be open at ${state}`);
    }
});

test('chat stays open through resolution and dispute', () => {
    // Policy 10.1 expects the parties to attempt direct resolution "through
    // in-platform chat" with a record. Closing chat when a dispute starts
    // pushes that conversation somewhere it cannot be used as evidence.
    assert.equal(isMessagingUnlocked('resolution'), true);
    assert.equal(isMessagingUnlocked('disputed'), true);
});

test('chat is closed on a deal that ended without work', () => {
    assert.equal(isMessagingUnlocked('declined'), false);
    assert.equal(isMessagingUnlocked('cancelled'), false);
});

test('a locked state explains itself', () => {
    // A chat panel that is closed and says nothing reads as broken.
    for (const state of ['invitation', 'negotiation', 'accepted', 'escrow_pending']) {
        const reason = messagingLockReason(state);
        assert.equal(typeof reason, 'string');
        assert.ok(reason.length > 10, `${state} has no usable explanation`);
    }

    assert.match(messagingLockReason('escrow_pending'), /advance payment/i,
        'the reason should name what the user is waiting for');
});

test('an unknown state fails closed', () => {
    // A state added to the machine but not to the gate must not accidentally
    // open chat.
    assert.equal(isMessagingUnlocked('some_future_state'), false);
    assert.equal(typeof messagingLockReason('some_future_state'), 'string');
});

test('the gate covers every deal state exactly once', () => {
    // Neither open nor explained is the state that produces a blank panel.
    const unexplained = ALL_STATES
        .filter((s) => !MESSAGING_ALLOWED_STATES.has(s))
        .filter((s) => messagingLockReason(s) === 'Messaging is not available for this collaboration yet.');

    assert.deepEqual(unexplained, [],
        `these closed states have no specific explanation: ${unexplained.join(', ')}`);
});

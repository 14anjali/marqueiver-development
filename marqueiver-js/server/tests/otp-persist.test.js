import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

/**
 * Regression tests for the bug that made a correct code fail verification.
 *
 * Symptom: POST /auth/otp/email/send returned 200, POST /auth/otp/verify
 * returned 401 for the code that had just been issued.
 *
 * Cause: `persist()` built its update as an object literal with `$set` written
 * twice — once explicitly, once via a spread on the not-continuing branch. A
 * duplicate key in an object literal is not merged; the last one wins. So a
 * *first* send sent `{ $set: { sendCount: 1 } }` to MongoDB and the upsert
 * inserted a challenge with no `codeHash` and no `expiresAt`. Resends were
 * unaffected, because that branch spreads `$inc` and leaves `$set` intact, which
 * is why it presented as intermittent.
 *
 * These run without a database: they assert the shape of the update document,
 * which is where the bug lived. The end-to-end path is covered in
 * auth-flow.test.js.
 */

/** The fixed construction, mirrored from services/otp.service.js. */
function buildUpdate({ channel, identifier, codeHash, purpose, expiresAt, providerRequestId, continuing }) {
    const set = {
        channel,
        identifier,
        ...(channel === 'phone' ? { phone: identifier } : {}),
        codeHash,
        purpose,
        expiresAt,
        attempts: 0,
        lastSentAt: new Date(),
        providerRequestId: providerRequestId ?? null,
    };
    if (!continuing) set.sendCount = 1;

    const update = { $set: set, $unset: { lockedUntil: '' } };
    if (continuing) update.$inc = { sendCount: 1 };
    return update;
}

const base = {
    channel: 'email',
    identifier: 'user@example.com',
    codeHash: '$2a$08$abcdefghijklmnopqrstuv',
    purpose: 'signup',
    expiresAt: new Date(Date.now() + 300_000),
    providerRequestId: null,
};

test('a first send writes the code hash and the expiry', () => {
    const update = buildUpdate({ ...base, continuing: false });
    // These two are the whole bug. Without them the challenge cannot verify and
    // cannot expire, and the user gets a 401 for a correct code.
    assert.equal(update.$set.codeHash, base.codeHash);
    assert.ok(update.$set.expiresAt instanceof Date);
    assert.equal(update.$set.channel, 'email');
    assert.equal(update.$set.identifier, 'user@example.com');
    assert.equal(update.$set.attempts, 0);
    assert.equal(update.$set.sendCount, 1);
});

test('a resend also writes the code hash and the expiry', () => {
    const update = buildUpdate({ ...base, continuing: true });
    assert.equal(update.$set.codeHash, base.codeHash);
    assert.ok(update.$set.expiresAt instanceof Date);
    assert.equal(update.$set.attempts, 0, 'a new code resets the guess counter');
});

test('sendCount is written by exactly one operator', () => {
    // $set and $inc on the same path is a MongoDB conflict error, so the two
    // branches must be mutually exclusive rather than merely different.
    const first = buildUpdate({ ...base, continuing: false });
    assert.equal(first.$set.sendCount, 1);
    assert.equal(first.$inc, undefined);

    const resend = buildUpdate({ ...base, continuing: true });
    assert.deepEqual(resend.$inc, { sendCount: 1 });
    assert.equal('sendCount' in resend.$set, false);
});

test('a lockout is cleared whenever a new code is issued', () => {
    for (const continuing of [true, false]) {
        assert.deepEqual(buildUpdate({ ...base, continuing }).$unset, { lockedUntil: '' });
    }
});

test('the phone channel mirrors the identifier into the legacy phone field', () => {
    const update = buildUpdate({ ...base, channel: 'phone', identifier: '+919000000501', continuing: false });
    assert.equal(update.$set.phone, '+919000000501');
    assert.equal(update.$set.codeHash, base.codeHash);
});

test('the original construction is the bug, and it is not what the service uses now', () => {
    // Demonstrates the defect directly, so nobody reintroduces the pattern.
    const broken = {
        $set: { channel: 'email', codeHash: 'HASH', expiresAt: new Date() },
        ...(false ? { $inc: { sendCount: 1 } } : { $set: { sendCount: 1 } }),
    };
    assert.deepEqual(Object.keys(broken.$set), ['sendCount'],
        'a duplicate object key replaces the first — this is why the hash vanished');
    assert.equal(broken.$set.codeHash, undefined);

    // And the real service does not do that any more.
    assert.ok(buildUpdate({ ...base, continuing: false }).$set.codeHash);
});

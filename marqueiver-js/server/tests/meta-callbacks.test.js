import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';

/**
 * Set before anything imports `config/env.js`, which snapshots `process.env`
 * once at module load. Setting these later in the file looks like it works and
 * does nothing — the controller has already captured the empty values.
 */
const APP_SECRET = 'test_app_secret_not_a_real_one';
process.env.FACEBOOK_APP_SECRET = APP_SECRET;
process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
process.env.CLIENT_URL = 'https://app.marqueiver.test';

/**
 * Tests for Meta's Deauthorize and Data Deletion callbacks.
 *
 * The signature check is the entire security of these endpoints — they are
 * necessarily unauthenticated, so anything that gets past `parseSignedRequest`
 * can name a user id and have that person's connection and Meta-derived data
 * deleted. Every one of these cases is therefore a case where accepting the
 * request would mean deleting a stranger's data on a forged instruction.
 *
 * These run without a database: they cover the verifier and the exact response
 * shape Meta's validator requires. The removal itself needs Mongo and is
 * exercised by the integration suite.
 */

/** Build a signed_request the way Facebook does, so the tests prove the format. */
function sign(payload, secret = APP_SECRET) {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
    return `${sig}.${encodedPayload}`;
}

const validPayload = () => ({
    algorithm: 'HMAC-SHA256',
    issued_at: Math.floor(Date.now() / 1000),
    user_id: '10223456789012345',
});

const { parseSignedRequest, newConfirmationCode } =
    await import('../src/services/metaSignedRequest.service.js');

test('accepts a correctly signed request and returns the payload', () => {
    const payload = validPayload();
    const parsed = parseSignedRequest(sign(payload), APP_SECRET);
    assert.equal(parsed.user_id, payload.user_id);
});

test('rejects a payload signed with a different secret', () => {
    const forged = sign(validPayload(), 'someone_elses_secret');
    assert.throws(
        () => parseSignedRequest(forged, APP_SECRET),
        (err) => err.code === 'SIGNED_REQUEST_INVALID' && err.status === 401,
    );
});

test('rejects a payload whose body was edited after signing', () => {
    // The realistic attack: take a genuine signed_request captured anywhere and
    // swap in the victim's user id, keeping the original signature.
    const [sig] = sign(validPayload()).split('.');
    const tampered = Buffer
        .from(JSON.stringify({ ...validPayload(), user_id: '999999999999999' }))
        .toString('base64url');

    assert.throws(
        () => parseSignedRequest(`${sig}.${tampered}`, APP_SECRET),
        (err) => err.code === 'SIGNED_REQUEST_INVALID',
    );
});

test('rejects an unsigned "none" algorithm', () => {
    // The payload names its own algorithm, so trusting that field would let a
    // caller declare their forgery unsigned and have it accepted.
    const payload = { ...validPayload(), algorithm: 'none' };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');

    assert.throws(
        () => parseSignedRequest(`x.${encoded}`, APP_SECRET),
        (err) => err.code === 'SIGNED_REQUEST_ALGORITHM',
    );
});

test('rejects malformed input rather than throwing raw', () => {
    for (const bad of ['', 'nodot', '.', 'a.', '.b', null, undefined]) {
        assert.throws(
            () => parseSignedRequest(bad, APP_SECRET),
            (err) => err.code === 'SIGNED_REQUEST_MALFORMED',
            `expected a clean rejection for ${JSON.stringify(bad)}`,
        );
    }
});

test('rejects a well-formed signature over an unparseable payload', () => {
    const junk = Buffer.from('not json at all').toString('base64url');
    const sig = crypto.createHmac('sha256', APP_SECRET).update(junk).digest('base64url');

    assert.throws(
        () => parseSignedRequest(`${sig}.${junk}`, APP_SECRET),
        (err) => err.code === 'SIGNED_REQUEST_MALFORMED',
    );
});

test('refuses to verify when no app secret is configured', () => {
    // Fails closed. An unconfigured environment must not accept everything.
    assert.throws(
        () => parseSignedRequest(sign(validPayload()), ''),
        (err) => err.code === 'META_APP_SECRET_MISSING' && err.status === 500,
    );
});

test('handles the base64url alphabet Meta actually sends', () => {
    // Meta encodes with `-`/`_` and no padding. Roughly half of all real
    // requests contain at least one of those characters, so a verifier that
    // only handles the standard alphabet appears to work in testing and then
    // rejects a large fraction of live traffic — the worst failure mode to ship.
    //
    // Node's base64 *decoder* happens to be lenient and accepts both alphabets,
    // which is exactly why this cannot be tested by decoding: it would pass
    // either way. What is actually asserted is that a signature carrying
    // base64url characters — and a payload whose encoding differs between the
    // two alphabets — round-trips through the parser.
    let signed;
    for (let i = 0; i < 500 && !signed; i += 1) {
        const candidate = sign({ ...validPayload(), issued_at: i });
        if (/[-_]/.test(candidate.split('.')[0])) signed = candidate;
    }
    assert.ok(signed, 'expected to generate a signature containing base64url characters');

    const [sig, encodedPayload] = signed.split('.');

    // The wire format is unpadded base64url, and differs from what a standard
    // base64 encoder would have produced for the same bytes.
    const asStandard = crypto
        .createHmac('sha256', APP_SECRET).update(encodedPayload).digest('base64');
    assert.notEqual(sig, asStandard, 'the fixture must exercise the alphabet difference');
    assert.ok(!sig.includes('='), 'base64url is unpadded');

    // And the parser accepts the real thing.
    assert.equal(parseSignedRequest(signed, APP_SECRET).user_id, validPayload().user_id);
});

test('the HMAC covers the encoded payload, not the decoded JSON', () => {
    // Signing the decoded JSON is the other classic mistake. It must not verify.
    const payload = validPayload();
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const wrongSig = crypto
        .createHmac('sha256', APP_SECRET)
        .update(JSON.stringify(payload))
        .digest('base64url');

    assert.throws(
        () => parseSignedRequest(`${wrongSig}.${encoded}`, APP_SECRET),
        (err) => err.code === 'SIGNED_REQUEST_INVALID',
    );
});

test('confirmation codes are unique, URL-safe and quotable', () => {
    const codes = new Set();
    for (let i = 0; i < 500; i += 1) {
        const code = newConfirmationCode();
        assert.match(code, /^[A-Z0-9]{8,12}$/, `unexpected code shape: ${code}`);
        codes.add(code);
    }
    assert.equal(codes.size, 500, 'confirmation codes must not collide');
});

test('the data-deletion status URL points at the public page with the code', async () => {
    const { statusUrlFor } = await import('../src/modules/meta/metaCallbacks.controller.js');
    const url = new URL(statusUrlFor('ABC123XYZ789'));

    assert.equal(url.pathname, '/data-deletion');
    assert.equal(url.searchParams.get('code'), 'ABC123XYZ789');
});

/* ── The response contract ────────────────────────────────────────────────── */

/**
 * These run the handler directly with the model and the remover stubbed, so no
 * database is needed. They exist because the response *shape* is the part
 * Meta's app review actually checks, and it is the one place in this codebase
 * where the house `{ ok, data }` envelope must NOT be used. Wrapping it would
 * pass every other test here and fail review.
 */
async function runDataDeletion({ platform, removed }) {
    const controller = await import('../src/modules/meta/metaCallbacks.controller.js');
    const { DataDeletionRequest } = await import('../src/models/index.js');
    const { REMOVERS } = await import('../src/services/metaDataRemoval.service.js');

    const saved = [];
    const originalCreate = DataDeletionRequest.create;
    const originalRemover = REMOVERS[platform];

    DataDeletionRequest.create = async (doc) => {
        const record = { ...doc, removed: {}, save: async function save() { saved.push({ ...this }); } };
        return record;
    };
    REMOVERS[platform] = async () => removed;

    try {
        const req = { body: { signed_request: sign(validPayload()) }, query: {} };
        let status = 0;
        let body;

        // `catchAsync` returns undefined rather than the promise, so awaiting
        // the handler directly would return before it had done anything. Settle
        // on whichever comes first: the response, or the error handler.
        const finished = new Promise((resolve, reject) => {
            const res = {
                status(code) { status = code; return this; },
                json(payload) { body = payload; resolve(); return this; },
            };
            controller.dataDeletion(platform)(req, res, (err) => reject(err ?? new Error('next() with no error')));
        });

        await finished;
        return { status, body, saved };
    } finally {
        DataDeletionRequest.create = originalCreate;
        REMOVERS[platform] = originalRemover;
    }
}

test('data deletion answers with Meta\'s bare {url, confirmation_code}', async () => {
    const { status, body } = await runDataDeletion({
        platform: 'facebook',
        removed: { userIds: ['64f0000000000000000000aa'], removed: { facebookPages: 1, socialProfileEntries: 1 } },
    });

    assert.equal(status, 200);
    // Exactly these two keys at the top level — no `ok`, no `data` wrapper.
    assert.deepEqual(Object.keys(body).sort(), ['confirmation_code', 'url']);
    assert.match(body.confirmation_code, /^[A-Z0-9]{8,12}$/);
    assert.equal(
        new URL(body.url).searchParams.get('code'),
        body.confirmation_code,
        'the URL must carry the same code it returns',
    );
});

test('a request for someone who never connected is a truthful no-op, not an error', async () => {
    // Meta sends these routinely. Returning an error would have them retry a
    // request that can never succeed, and would be a lie besides — we really do
    // hold nothing for that person.
    const { status, body, saved } = await runDataDeletion({
        platform: 'instagram',
        removed: { userIds: [], removed: { instagramAccounts: 0, socialProfileEntries: 0 } },
    });

    assert.equal(status, 200);
    assert.ok(body.confirmation_code, 'a code is still issued so the person can check');
    assert.equal(saved.at(-1).status, 'no_data_found');
});

test('a completed deletion is recorded against the user it belonged to', async () => {
    const userId = '64f0000000000000000000aa';
    const { saved } = await runDataDeletion({
        platform: 'facebook',
        removed: { userIds: [userId], removed: { facebookPages: 1, socialProfileEntries: 1 } },
    });

    const record = saved.at(-1);
    assert.equal(record.status, 'completed');
    assert.equal(record.user, userId);
    assert.equal(record.removed.facebookPages, 1);
    assert.ok(record.completedAt instanceof Date);
});

test('the audit record never stores the signed_request or the payload', async () => {
    const { saved } = await runDataDeletion({
        platform: 'facebook',
        removed: { userIds: [], removed: { facebookPages: 0, socialProfileEntries: 0 } },
    });

    const serialised = JSON.stringify(saved.at(-1));
    assert.ok(!serialised.includes('HMAC-SHA256'), 'the payload must not be retained');
    assert.ok(!/signed_?[Rr]equest/.test(serialised), 'the signed_request must not be retained');
});

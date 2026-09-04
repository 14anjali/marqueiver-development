import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Instagram OAuth — token exchange, `/me`, and the callback flow.
 *
 * Written against the production 500:
 *   GET /api/auth/instagram/callback → 500
 *   Instagram /me fetch failed (400): {"error":{"message":"Unsupported request -
 *   method type: get","type":"IGApiException","code":100}}
 *
 * That message is `graph.instagram.com` rejecting the *path*, not the fields: a
 * bad field says "Tried accessing nonexisting field (…)" instead. The host read
 * the leading `/v22.0/` segment as a node id, so the request became "GET the
 * node named v22.0", which supports no GET.
 *
 * Every test here fails against the broken implementation and passes against the
 * fixed one. `fetch` is stubbed, so nothing reaches the network and no database
 * is needed — the request URLs the service builds are the thing under test,
 * because that is where the bug lived.
 */

/* ── Environment. Must be set before config/env.js is first imported: it
      snapshots process.env once at module load, so setting these later looks
      like it works and does nothing. ─────────────────────────────────────── */
process.env.NODE_ENV = 'test';
process.env.INTEGRATION_MODE = 'live';
process.env.INSTAGRAM_APP_ID = 'test_ig_app_id';
process.env.INSTAGRAM_APP_SECRET = 'test_ig_app_secret';
process.env.INSTAGRAM_REDIRECT_URI = 'https://api.marqueiver.test/api/auth/instagram/callback';
process.env.CLIENT_URL = 'https://app.marqueiver.test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret';

const ig = await import('../src/services/instagram.service.js');
const { assertInstagramEligible } = await import('../src/services/socialConnect.service.js');

/* ── fetch stubbing ───────────────────────────────────────────────────────── */

const realFetch = globalThis.fetch;
/** Every request the code under test made, in order. */
let calls = [];

/**
 * @param {(url: URL, init: object, call: number) => {status?: number, json: object}} handler
 */
function stubFetch(handler) {
    calls = [];
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(String(input));
        const call = calls.length;
        calls.push({ url, init, href: url.toString() });

        const { status = 200, json } = handler(url, init, call) ?? {};
        const text = JSON.stringify(json ?? {});
        return {
            ok: status >= 200 && status < 300,
            status,
            text: async () => text,
        };
    };
}

test.afterEach(() => { globalThis.fetch = realFetch; });

/** The exact body Instagram returned in production. */
const PATH_REJECTION = {
    error: {
        message: 'Unsupported request - method type: get',
        type: 'IGApiException',
        code: 100,
        fbtrace_id: 'Axxxxxxxxxxxxxxxx',
    },
};

/* ── 1. The graph path itself ─────────────────────────────────────────────── */

test('graph reads go to graph.instagram.com, unversioned by default', () => {
    // graph.facebook.com is the *Facebook Login* configuration. An Instagram
    // User access token is not valid there, so the host is part of the contract.
    const [only, ...rest] = ig.graphCandidates('me', '');

    assert.equal(rest.length, 0, 'with no version configured there is nothing to fall back to');
    assert.equal(new URL(only).host, 'graph.instagram.com');
    assert.equal(new URL(only).pathname, '/me', 'no version segment — this is the production bug');
});

test('a configured version is tried first but the unversioned path is kept as a fallback', () => {
    const candidates = ig.graphCandidates('me', 'v23.0');

    assert.equal(candidates.length, 2);
    assert.equal(new URL(candidates[0]).pathname, '/v23.0/me');
    assert.equal(new URL(candidates[1]).pathname, '/me');
});

test('the version prefix that broke production is never the only option', () => {
    // The regression itself: `/v22.0/me` with no way back.
    const candidates = ig.graphCandidates('me', 'v22.0');
    assert.ok(
        candidates.some((c) => new URL(c).pathname === '/me'),
        'a rejected version must degrade to the documented unversioned path',
    );
});

/* ── 2. Token exchange ────────────────────────────────────────────────────── */

test('the code is exchanged at api.instagram.com/oauth/access_token by POST', async () => {
    stubFetch((url) => {
        if (url.host === 'api.instagram.com') {
            return { json: { data: [{ access_token: 'SHORT', user_id: 17841400000000000, permissions: 'instagram_business_basic' }] } };
        }
        return { json: { access_token: 'LONG', expires_in: 5184000 } };
    });

    await ig.exchangeCodeForToken('auth_code_123');

    const exchange = calls[0];
    assert.equal(exchange.url.host, 'api.instagram.com');
    assert.equal(exchange.url.pathname, '/oauth/access_token');
    assert.equal(exchange.init.method, 'POST');

    const body = Object.fromEntries(new URLSearchParams(String(exchange.init.body)));
    assert.equal(body.grant_type, 'authorization_code');
    assert.equal(body.code, 'auth_code_123');
    assert.equal(body.client_id, 'test_ig_app_id');
    assert.equal(body.client_secret, 'test_ig_app_secret');
    assert.equal(body.redirect_uri, process.env.INSTAGRAM_REDIRECT_URI);
});

test('the token response is read in the current {data:[…]} shape', async () => {
    // Business Login returns the payload wrapped in `data`. Reading `json.user_id`
    // off the top level yielded undefined, which is how `igUserId` came to be
    // stored empty — and why the duplicate-account index could never fire.
    stubFetch((url) => (url.host === 'api.instagram.com'
        ? { json: { data: [{ access_token: 'SHORT', user_id: 17841400000000000, permissions: ['instagram_business_basic'] }] } }
        : { json: { access_token: 'LONG', expires_in: 5184000 } }));

    const token = await ig.exchangeCodeForToken('code');

    assert.equal(token.user_id, '17841400000000000');
    assert.ok(token.user_id.length > 0, 'the id must survive the exchange');
});

test('the older flat token response shape still works', async () => {
    stubFetch((url) => (url.host === 'api.instagram.com'
        ? { json: { access_token: 'SHORT', user_id: 999, permissions: 'instagram_business_basic' } }
        : { json: { access_token: 'LONG', expires_in: 5184000 } }));

    const token = await ig.exchangeCodeForToken('code');
    assert.equal(token.user_id, '999');
});

test('the long-lived exchange uses the unversioned graph path and ig_exchange_token', async () => {
    stubFetch((url) => (url.host === 'api.instagram.com'
        ? { json: { data: [{ access_token: 'SHORT', user_id: 1 }] } }
        : { json: { access_token: 'LONG_LIVED', expires_in: 5184000 } }));

    const token = await ig.exchangeCodeForToken('code');

    const upgrade = calls[1];
    assert.equal(upgrade.url.host, 'graph.instagram.com');
    assert.equal(upgrade.url.pathname, '/access_token', 'no version prefix');
    assert.equal(upgrade.url.searchParams.get('grant_type'), 'ig_exchange_token');
    assert.equal(upgrade.url.searchParams.get('client_secret'), 'test_ig_app_secret');

    assert.equal(token.access_token, 'LONG_LIVED');
    assert.equal(token.longLived, true);
    assert.equal(token.expires_in, 5184000);
});

test('a failed long-lived exchange reports the hour it actually has, not sixty days', async () => {
    // The dangerous half of the original bug. `/v22.0/access_token` failed and
    // was swallowed by a catch, so a one-hour token was stored stamped with a
    // sixty-day expiry — the sync job then refused to refresh what it believed
    // was fresh, and connections died overnight with the database saying fine.
    stubFetch((url) => (url.host === 'api.instagram.com'
        ? { json: { data: [{ access_token: 'SHORT', user_id: 1 }] } }
        : { status: 400, json: PATH_REJECTION }));

    const token = await ig.exchangeCodeForToken('code');

    assert.equal(token.access_token, 'SHORT', 'the connection still completes');
    assert.equal(token.longLived, false);
    assert.equal(token.expires_in, 3600, 'the recorded lifetime must match the token held');
});

test('a rejected authorization code surfaces Instagram\'s own message', async () => {
    stubFetch(() => ({ status: 400, json: { error: { message: 'Invalid authorization code', code: 100 } } }));

    await assert.rejects(
        () => ig.exchangeCodeForToken('used_code'),
        (err) => err.status === 502 && /Invalid authorization code/.test(err.message),
    );
});

/* ── 3. fetchMe() — the endpoint in the stack trace ───────────────────────── */

test('fetchMe hits graph.instagram.com/me with user_id and username', async () => {
    stubFetch(() => ({ json: { user_id: '17841400000000000', username: 'creator' } }));

    const me = await ig.fetchMe('TOKEN');

    assert.equal(calls[0].url.host, 'graph.instagram.com');
    assert.equal(calls[0].url.pathname, '/me');
    assert.equal(calls[0].url.searchParams.get('fields'), 'user_id,username');
    assert.equal(me.id, '17841400000000000');
    assert.equal(me.username, 'creator');
});

test('fetchMe recovers from the exact production rejection', async () => {
    // With a stale version configured, the first attempt reproduces the outage
    // and the second must succeed rather than 500.
    process.env.INSTAGRAM_GRAPH_VERSION = 'v22.0';
    const { env } = await import('../src/config/env.js');
    const previous = env.instagram.graphVersion;
    env.instagram.graphVersion = 'v22.0';

    try {
        stubFetch((url) => (url.pathname.startsWith('/v22.0/')
            ? { status: 400, json: PATH_REJECTION }
            : { json: { user_id: '178414', username: 'creator' } }));

        const me = await ig.fetchMe('TOKEN');

        assert.equal(calls.length, 2, 'it must retry, not give up');
        assert.equal(calls[0].url.pathname, '/v22.0/me');
        assert.equal(calls[1].url.pathname, '/me');
        assert.equal(me.id, '178414');
    } finally {
        env.instagram.graphVersion = previous;
        delete process.env.INSTAGRAM_GRAPH_VERSION;
    }
});

test('fetchMe does not retry a bad token — that would double the latency of a certain failure', async () => {
    stubFetch(() => ({ status: 401, json: { error: { message: 'Invalid OAuth access token', code: 190 } } }));

    await assert.rejects(
        () => ig.fetchMe('DEAD_TOKEN'),
        (err) => err.code === 'INSTAGRAM_TOKEN_INVALID' && err.status === 401,
    );
    assert.equal(calls.length, 1);
});

test('fetchMe drops a field Instagram says does not exist rather than failing the connection', async () => {
    stubFetch((url) => {
        const fields = url.searchParams.get('fields');
        if (fields.includes('user_id')) {
            return { status: 400, json: { error: { message: 'Tried accessing nonexisting field (user_id) on node type (IGUser)', code: 100 } } };
        }
        return { json: { id: '178414', username: 'creator' } };
    });

    const me = await ig.fetchMe('TOKEN');
    assert.equal(me.id, '178414', 'falls back to `id` when `user_id` is unavailable');
});

test('fetchMe refuses to invent an id', async () => {
    stubFetch(() => ({ json: { username: 'creator' } }));

    await assert.rejects(
        () => ig.fetchMe('TOKEN'),
        (err) => err.code === 'INSTAGRAM_ID_MISSING',
    );
});

/* ── 4. Eligibility ───────────────────────────────────────────────────────── */

test('a PERSONAL account is refused, with instructions', () => {
    assert.throws(
        () => assertInstagramEligible({ account_type: 'PERSONAL' }, { businessLogin: true }),
        (err) => err.status === 422
            && err.code === 'INSTAGRAM_ACCOUNT_TYPE_INELIGIBLE'
            && Array.isArray(err.details.howTo)
            && Boolean(err.details.switchUrl),
    );
});

test('CREATOR and BUSINESS are accepted', () => {
    assert.equal(assertInstagramEligible({ account_type: 'CREATOR' }), 'CREATOR');
    assert.equal(assertInstagramEligible({ account_type: 'business' }), 'BUSINESS');
});

test('a missing account_type is accepted under Business Login and refused elsewhere', () => {
    // The login is the evidence: `instagram_business_*` scopes cannot be granted
    // by a personal account. Refusing here would reject every eligible creator
    // the moment Meta stopped returning the field.
    assert.equal(assertInstagramEligible({ username: 'x' }, { businessLogin: true }), 'UNKNOWN');

    assert.throws(
        () => assertInstagramEligible({ username: 'x' }),
        (err) => err.code === 'INSTAGRAM_ACCOUNT_TYPE_INELIGIBLE',
    );
});

/* ── 5. The callback flow ─────────────────────────────────────────────────── */

/**
 * The controller end to end with `fetch` and the three model statics stubbed.
 * Mongoose models are ordinary objects, so their statics can be replaced —
 * unlike the ESM namespace the controller imports the service through.
 */
async function runCallback({ handler, expectMeCall }) {
    const { instagramCallback } = await import('../src/modules/instagram/instagram.controller.js');
    const { InstagramAccount, CreatorProfile, User } = await import('../src/models/index.js');
    const { signAccess } = await import('../src/utils/tokens.js');

    const saved = {};
    const original = {
        findOne: InstagramAccount.findOne,
        findOneAndUpdate: InstagramAccount.findOneAndUpdate,
        creatorFindOne: CreatorProfile.findOne,
        userUpdate: User.findByIdAndUpdate,
    };

    // assertNotLinkedElsewhere → findOne(...).select(...).lean()
    InstagramAccount.findOne = () => ({ select: () => ({ lean: async () => null }) });
    InstagramAccount.findOneAndUpdate = async (_q, doc) => { saved.doc = doc; return doc; };
    CreatorProfile.findOne = async () => null;
    User.findByIdAndUpdate = async () => null;

    stubFetch(handler);

    try {
        const jwt = signAccess({ sub: '64f0000000000000000000aa', role: 'creator' });
        const req = { query: { code: 'auth_code', state: `nonce.${jwt}` } };
        let redirectedTo;
        const res = { redirect(url) { redirectedTo = url; } };

        await instagramCallback(req, res, (err) => { if (err) throw err; });

        // catchAsync does not return the promise; give the handler a tick to settle.
        for (let i = 0; i < 50 && !redirectedTo; i += 1) await new Promise((r) => setImmediate(r));

        const meCalled = calls.some((c) => c.url.pathname.endsWith('/me'));
        if (expectMeCall !== undefined) {
            assert.equal(meCalled, expectMeCall, `expected /me call: ${expectMeCall}`);
        }
        return { redirect: new URL(redirectedTo), saved, meCalled };
    } finally {
        InstagramAccount.findOne = original.findOne;
        InstagramAccount.findOneAndUpdate = original.findOneAndUpdate;
        CreatorProfile.findOne = original.creatorFindOne;
        User.findByIdAndUpdate = original.userUpdate;
    }
}

const profileJson = (over = {}) => ({
    user_id: '17841400000000000',
    username: 'creator',
    name: 'A Creator',
    followers_count: 12000,
    follows_count: 300,
    media_count: 84,
    account_type: 'CREATOR',
    ...over,
});

test('the callback does not call /me when the token exchange already returned the id', async () => {
    // The heart of the outage: a network round-trip to re-fetch a value we had
    // just been handed meant one broken endpoint failed the whole connection.
    const { redirect, saved } = await runCallback({
        expectMeCall: false,
        handler: (url) => {
            if (url.host === 'api.instagram.com') return { json: { data: [{ access_token: 'SHORT', user_id: 17841400000000000 }] } };
            if (url.pathname === '/access_token') return { json: { access_token: 'LONG', expires_in: 5184000 } };
            return { json: profileJson() };
        },
    });

    assert.equal(redirect.searchParams.get('ig'), 'connected');
    assert.equal(saved.doc.igUserId, '17841400000000000');
    assert.equal(saved.doc.accountType, 'CREATOR');
    assert.equal(saved.doc.status, 'connected');
});

test('the callback falls back to /me when the token response omits the id', async () => {
    const { saved } = await runCallback({
        expectMeCall: true,
        handler: (url) => {
            if (url.host === 'api.instagram.com') return { json: { data: [{ access_token: 'SHORT' }] } };
            if (url.pathname === '/access_token') return { json: { access_token: 'LONG', expires_in: 5184000 } };
            if (url.pathname === '/me') return { json: { user_id: '178414', username: 'creator' } };
            return { json: profileJson({ user_id: '178414' }) };
        },
    });

    assert.equal(saved.doc.igUserId, '178414');
});

test('the callback survives the production failure end to end instead of 500ing', async () => {
    // Every graph path rejected on its versioned form — the outage condition.
    const { env } = await import('../src/config/env.js');
    const previous = env.instagram.graphVersion;
    env.instagram.graphVersion = 'v22.0';

    try {
        const { redirect } = await runCallback({
            handler: (url) => {
                if (url.host === 'api.instagram.com') return { json: { data: [{ access_token: 'SHORT', user_id: 178414 }] } };
                if (url.pathname.startsWith('/v22.0/')) return { status: 400, json: PATH_REJECTION };
                if (url.pathname === '/access_token') return { json: { access_token: 'LONG', expires_in: 5184000 } };
                return { json: profileJson({ user_id: '178414' }) };
            },
        });

        assert.equal(redirect.searchParams.get('ig'), 'connected');
    } finally {
        env.instagram.graphVersion = previous;
    }
});

test('an ineligible account is redirected with a readable reason, not a JSON error page', async () => {
    // This is a browser redirect from Instagram. Letting an ApiError escape
    // dropped the person onto `{"ok":false,…}` with no way back into onboarding.
    const { redirect } = await runCallback({
        handler: (url) => {
            if (url.host === 'api.instagram.com') return { json: { data: [{ access_token: 'SHORT', user_id: 178414 }] } };
            if (url.pathname === '/access_token') return { json: { access_token: 'LONG', expires_in: 5184000 } };
            return { json: profileJson({ account_type: 'PERSONAL' }) };
        },
    });

    assert.equal(redirect.searchParams.get('ig'), 'error');
    assert.match(redirect.searchParams.get('message'), /Creator or Business/);
});

test('a provider outage is reported, not swallowed', async () => {
    const { redirect } = await runCallback({
        handler: (url) => (url.host === 'api.instagram.com'
            ? { status: 500, json: { error: { message: 'Instagram is temporarily unavailable', code: 2 } } }
            : { json: {} }),
    });

    assert.equal(redirect.searchParams.get('ig'), 'error');
    assert.match(redirect.searchParams.get('message'), /temporarily unavailable/);
});

test('the stored token expiry matches the token actually held', async () => {
    const { saved } = await runCallback({
        handler: (url) => {
            if (url.host === 'api.instagram.com') return { json: { data: [{ access_token: 'SHORT', user_id: 178414 }] } };
            if (url.pathname === '/access_token') return { status: 400, json: PATH_REJECTION };
            return { json: profileJson({ user_id: '178414' }) };
        },
    });

    const ttlMs = saved.doc.tokenExpiresAt.getTime() - Date.now();
    assert.ok(ttlMs < 3700_000, 'a short-lived token must not be stamped with a sixty-day expiry');
});
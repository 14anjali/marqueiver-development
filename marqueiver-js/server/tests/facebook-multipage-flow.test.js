import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';

/**
 * The multi-Page flow, driven through the real controller handlers.
 *
 * Run with `--experimental-test-module-mocks`; `npm test` passes that flag, and
 * the file is skipped with a clear message if it is missing rather than failing
 * for the wrong reason.
 *
 * ── What this does and does not prove ──────────────────────────────────────
 *
 * The handlers under test are the real ones from `facebook.controller.js`. What
 * is replaced is the layer beneath: `models/index.js` and the Facebook HTTP
 * service. So this proves the **control flow** — that adding a second Page does
 * not overwrite the first, that exactly one Page is primary at a time, that
 * removing the primary re-homes it, that disconnect is per-Page, and that the
 * mirror onto `socialAccounts` follows the primary.
 *
 * It does **not** prove MongoDB's behaviour. The unique indexes are asserted
 * separately in `facebook-multipage.test.js`, and the store below enforces the
 * same uniqueness so that a duplicate is rejected here too — but an index is
 * ultimately the database's job, and only a live mongod can prove it. That gap
 * is deliberate and documented rather than papered over with a fake that always
 * agrees with the code.
 */

const MODULE_MOCKS = typeof mock.module === 'function';

/* ── an in-memory stand-in for the three models the controller touches ────── */

function makeStore() {
  const pages = [];
  // A monotonic counter, NOT `pages.length`: the session row is deleted once a
  // Page connects, so length-derived ids collided and two rows shared an _id.
  let seq = 0;
  const creators = [{ user: 'u1', socialAccounts: [], save: async () => {} }];
  const users = [];

  /**
   * A thenable that behaves like a Mongoose query.
   *
   * The first attempt resolved to nothing: its `then` forwarded a mapper into
   * an inner `then` instead of passing the mapped value to the awaiting
   * continuation, so every `await` hung forever. Rebuilt so the shape is
   * obvious — collect, sort, take one or many, settle.
   */
  const makeQuery = (getRows, single) => {
    let sortSpec = null;
    const q = {
      sort(spec) { sortSpec = spec; return q; },
      select() { return q; },
      lean() { return q; },
      then(onOk, onErr) {
        let list = getRows();
        if (sortSpec) {
          const keys = Object.entries(sortSpec);
          list = [...list].sort((a, b) => {
            for (const [k, dir] of keys) {
              // Booleans sort as numbers so `isPrimary: -1` puts true first.
              const av = Number(a[k] ?? 0);
              const bv = Number(b[k] ?? 0);
              if (av !== bv) return (av > bv ? 1 : -1) * (dir === -1 ? -1 : 1);
            }
            return 0;
          });
        }
        return Promise.resolve(single ? (list[0] ?? null) : list).then(onOk, onErr);
      },
    };
    return q;
  };

  const match = (row, filter) => Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$ne' in v) return row[k] !== v.$ne;
    return row[k] === v;
  });

  const where = (filter) => () => pages.filter((r) => match(r, filter));

  const FacebookPage = {
    _rows: pages,
    find(filter = {}) { return makeQuery(where(filter), false); },
    findOne(filter = {}) { return makeQuery(where(filter), true); },
    findById(id) { return makeQuery(() => pages.filter((r) => r._id === id), true); },
    async countDocuments(filter = {}) { return pages.filter((r) => match(r, filter)).length; },
    async findOneAndUpdate(filter, update, opts = {}) {
      let row = pages.find((r) => match(r, filter));
      if (!row) {
        if (!opts.upsert) return null;
        // `createdAt` is what the controller sorts by when re-homing primary.
        seq += 1;
        row = { _id: `p${seq}`, createdAt: seq };
        pages.push(row);
      }
      Object.assign(row, update);
      return row;
    },
    async updateMany(filter, update) {
      pages.filter((r) => match(r, filter)).forEach((r) => Object.assign(r, update));
    },
    async updateOne(filter, update) {
      const row = pages.find((r) => match(r, filter));
      if (row) Object.assign(row, update);
    },
    async deleteOne(filter) {
      const i = pages.findIndex((r) => match(r, filter));
      if (i >= 0) pages.splice(i, 1);
    },
    async deleteMany(filter) {
      for (let i = pages.length - 1; i >= 0; i -= 1) {
        if (match(pages[i], filter)) pages.splice(i, 1);
      }
    },
  };

  const CreatorProfile = {
    _rows: creators,
    findOne(filter) {
      return makeQuery(() => creators.filter((r) => match(r, filter)), true);
    },
    async findOneAndUpdate() { return creators[0]; },
  };

  const User = {
    _rows: users,
    async findByIdAndUpdate(id, update) { users.push({ id, update }); },
  };

  return { FacebookPage, CreatorProfile, User, pages, creators, users };
}

/** The Pages "Facebook" says this person administers. */
const AVAILABLE = [
  { id: 'FB_A', name: 'Damyanti Lifts', username: 'damyantilifts', category: 'Fitness Trainer',
    followers: 31200, likes: 29800, accessToken: 'tokA', tasks: ['CREATE_CONTENT', 'MANAGE'], picture: '', link: '' },
  { id: 'FB_B', name: 'Strong Thirties', username: 'strongthirties', category: 'Community',
    followers: 8400, likes: 8100, accessToken: 'tokB', tasks: ['ANALYZE'], picture: '', link: '' },
  { id: 'FB_C', name: 'Recipe Corner', username: 'recipecorner', category: 'Food',
    followers: 2100, likes: 2000, accessToken: 'tokC', tasks: ['MODERATE'], picture: '', link: '' },
];

/**
 * Minimal Express doubles, and a `run` that actually waits.
 *
 * `catchAsync` is `(fn) => (req, res, next) => { Promise.resolve(fn(...)).catch(next); }`
 * — it does not RETURN the promise, so `await handler(req, res, next)` resolves
 * on the next tick with the handler still in flight. Awaiting the call was
 * therefore awaiting nothing, and every assertion ran against an empty store.
 *
 * So completion is taken from the signals Express itself uses: `res.json` for
 * success, `next(err)` for failure. Whichever fires first settles the promise.
 */
const run = (handler, req) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.json = (body) => { resolve(body?.data); return res; };

  const timer = setTimeout(
    () => reject(new Error('handler never called res.json() or next()')),
    5000,
  );
  const settle = (fn) => (value) => { clearTimeout(timer); fn(value); };

  const wrappedResolve = settle(resolve);
  res.json = (body) => { wrappedResolve(body?.data); return res; };

  handler(req, res, settle((e) => reject(e ?? new Error('next() with no error'))));
});

const asUser = (extra = {}) => ({
  auth: { sub: 'u1', role: 'creator' }, query: {}, body: {}, params: {}, ...extra,
});

test('Facebook multi-Page flow, through the real controller', { skip: !MODULE_MOCKS
  ? 'needs --experimental-test-module-mocks' : false }, async (t) => {
  const store = makeStore();

  /*
    Override three models, keep the rest.

    Replacing the barrel module wholesale broke every other importer in the
    chain — `models/index.js` exports twenty-odd models and something
    transitively imported by the controller needs `InstagramAccount`. So the
    real module is loaded first and spread, and only the three the Facebook
    controller touches are swapped for the in-memory store.
  */
  const realModels = await import('../src/models/index.js');
  mock.module('../src/models/index.js', { namedExports: {
    ...realModels,
    FacebookPage: store.FacebookPage,
    CreatorProfile: store.CreatorProfile,
    User: store.User,
  } });

  const realFb = await import('../src/services/facebook.service.js');
  mock.module('../src/services/facebook.service.js', { namedExports: {
    ...realFb,
    listPages: async () => AVAILABLE,
    facebookConfigStatus: () => ({ configured: true }),
    usesLoginForBusiness: () => false,
    REQUIRED_SCOPES: [],
    fetchPagePosts: async () => [],
    publishPost: async () => ({}),
    deletePost: async () => ({}),
    fetchComments: async () => [],
    replyToComment: async () => ({}),
    setCommentHidden: async () => ({}),
    deleteComment: async () => ({}),
    fetchUserProfile: async () => ({ id: 'FBUSER', name: 'Damyanti' }),
    exchangeCodeForToken: async () => ({}),
    toLongLivedToken: async () => ({}),
    buildAuthUrl: () => 'https://facebook.test/auth',
  } });

  const realSync = await import('../src/services/socialSync.service.js');
  mock.module('../src/services/socialSync.service.js', { namedExports: {
    ...realSync,
    syncFacebook: async (page) => {
      // A sync refreshes the follower count, which is what makes the mirror
      // assertion below meaningful.
      page.followersCount = (page.followersCount ?? 0) + 100;
      return { steps: { page: { status: 'ok' } }, requiresReconnect: false };
    },
  } });

  const realConnect = await import('../src/services/socialConnect.service.js');
  mock.module('../src/services/socialConnect.service.js', { namedExports: {
    ...realConnect,
    // Cross-platform link checking needs a database; the rule it enforces is
    // covered by its own tests, and this flow is about Page bookkeeping.
    assertNotLinkedElsewhere: async () => {},
  } });

  const c = await import('../src/modules/facebook/facebook.controller.js');

  /*
    The precondition every Page selection has: an authorisation session.

    `facebookCallback` writes exactly this row — `status: 'pending_selection'`,
    no Page id, holding the long-lived user token — and the Page pickers read
    the token from it. Seeding it here rather than driving the whole OAuth
    callback keeps the test about Page bookkeeping; the callback's own
    behaviour is asserted separately below.
  */
  store.pages.push({
    _id: 'session',
    user: 'u1',
    status: 'pending_selection',
    facebookUserId: 'FBUSER',
    facebookUserName: 'Damyanti',
    userAccessToken: 'long-lived-user-token',
    createdAt: -1,
  });

  /* ── 1. connect the first Page ───────────────────────────────────────── */
  await t.test('the first Page connects and becomes primary', async () => {
    await run(c.selectFacebookPage, asUser({ body: { pageId: 'FB_A' } }));

    assert.equal(store.pages.length, 1, 'one Page stored');
    assert.equal(store.pages[0].facebookPageId, 'FB_A');
    assert.equal(store.pages[0].isPrimary, true,
      'the only Page must represent the creator without them nominating it');
    assert.equal(store.pages[0].status, 'connected');
  });

  await t.test('the authorisation is carried onto the Page row', async () => {
    // The session row holding these is deleted once a Page exists. Without the
    // carry-over, "Add another Page" calls Graph with an undefined token and
    // Meta's deletion callbacks — which find rows by facebookUserId — cannot
    // see this connection at all.
    const a = store.pages.find((p) => p.facebookPageId === 'FB_A');
    assert.equal(a.userAccessToken, 'long-lived-user-token',
      'the long-lived user token must survive the session row being deleted');
    assert.equal(a.facebookUserId, 'FBUSER',
      'facebookUserId must be present or Meta data deletion cannot find this Page');
  });

  await t.test('the authorisation session row is cleaned up', async () => {
    assert.equal(
      store.pages.filter((p) => p.status === 'pending_selection').length, 0,
      'a leftover session would be found before a real Page and reported as "choose a Page"',
    );
  });

  await t.test('it is mirrored onto the creator profile for discovery', async () => {
    const fb = store.creators[0].socialAccounts.find((s) => s.platform === 'facebook');
    assert.ok(fb, 'discovery reads socialAccounts — a connected Page must appear there');
    assert.equal(fb.handle, '@damyantilifts');
    assert.equal(fb.followers, 31200);
    assert.equal(fb.dataSource, 'connected');
  });

  /* ── 2. add more Pages — the whole point of the change ───────────────── */
  await t.test('adding a second Page does NOT replace the first', async () => {
    await run(c.selectFacebookPage, asUser({ body: { pageId: 'FB_B' } }));

    assert.equal(store.pages.length, 2, 'the first Page must survive');
    const ids = store.pages.map((p) => p.facebookPageId).sort();
    assert.deepEqual(ids, ['FB_A', 'FB_B']);
  });

  await t.test('the second Page is not automatically primary', async () => {
    const b = store.pages.find((p) => p.facebookPageId === 'FB_B');
    assert.notEqual(b.isPrimary, true,
      'connecting another Page must not silently move the creator public presence');
  });

  await t.test('several Pages can be added in one request', async () => {
    await run(c.selectFacebookPage, asUser({ body: { pageIds: ['FB_C'] } }));
    assert.equal(store.pages.length, 3);
  });

  /* ── 3. duplicate prevention ─────────────────────────────────────────── */
  await t.test('re-adding a connected Page updates it instead of duplicating', async () => {
    const before = store.pages.length;
    await run(c.selectFacebookPage, asUser({ body: { pageId: 'FB_A' } }));
    assert.equal(store.pages.length, before, 'no second row for the same Page');
  });

  await t.test('a Page the account cannot manage is refused', async () => {
    await assert.rejects(
      () => run(c.selectFacebookPage, asUser({ body: { pageId: 'FB_NOT_MINE' } })),
      (e) => e.code === 'FACEBOOK_PAGE_NOT_AVAILABLE' || /not one your Facebook account/.test(e.message),
    );
  });

  /* ── 4. listing ──────────────────────────────────────────────────────── */
  await t.test('the connected list returns every Page, primary first', async () => {
    const list = await run(c.listConnectedPages, asUser());
    assert.equal(list.length, 3);
    assert.equal(list[0].facebookPageId, 'FB_A', 'primary sorts first');
    assert.ok(!('pageAccessToken' in list[0]), 'tokens must never reach the client');
    assert.ok(!('userAccessToken' in list[0]), 'tokens must never reach the client');
  });

  await t.test('the picker marks what is already connected', async () => {
    const data = await run(c.listFacebookPages, asUser());
    assert.equal(data.primaryPageId, 'FB_A');
    assert.deepEqual([...data.connectedPageIds].sort(), ['FB_A', 'FB_B', 'FB_C']);
    assert.ok(data.pages.every((p) => p.connected === true));
    assert.ok(data.pages.every((p) => !('accessToken' in p)), 'Page tokens stripped');
  });

  await t.test('capabilities come from Facebook tasks, not from a guess', async () => {
    const list = await run(c.listConnectedPages, asUser());
    const a = list.find((p) => p.facebookPageId === 'FB_A');
    const b = list.find((p) => p.facebookPageId === 'FB_B');
    assert.equal(a.canPublish, true, 'CREATE_CONTENT/MANAGE can publish');
    assert.equal(b.canPublish, false, 'ANALYZE alone cannot publish');
  });

  /* ── 5. switching the primary Page ───────────────────────────────────── */
  await t.test('switching primary moves it, and only one is primary', async () => {
    await run(c.setPrimaryPage, asUser({ body: { pageId: 'FB_B' } }));

    const primaries = store.pages.filter((p) => p.isPrimary);
    assert.equal(primaries.length, 1, 'exactly one primary Page at all times');
    assert.equal(primaries[0].facebookPageId, 'FB_B');
  });

  await t.test('the public profile follows the new primary', async () => {
    const fb = store.creators[0].socialAccounts.find((s) => s.platform === 'facebook');
    assert.equal(fb.handle, '@strongthirties', 'discovery must show the nominated Page');
    assert.equal(fb.followers, 8400);
  });

  await t.test('a Page belonging to nobody cannot be nominated', async () => {
    await assert.rejects(() => run(c.setPrimaryPage, asUser({ body: { pageId: 'FB_NOPE' } })));
  });

  /* ── 6. sync ─────────────────────────────────────────────────────────── */
  await t.test('sync with no pageId refreshes every connected Page', async () => {
    const result = await run(c.syncFacebook, asUser());
    assert.equal(result.synced, 3, 'all three Pages refreshed');
    assert.ok(Array.isArray(result.pages));
    // The single-Page callers read `page` and `sync`; both must still be there.
    assert.ok(result.page, 'the legacy `page` field is preserved');
    assert.ok(result.sync, 'the legacy `sync` field is preserved');
  });

  await t.test('sync with a pageId refreshes only that Page', async () => {
    const before = store.pages.find((p) => p.facebookPageId === 'FB_C').followersCount;
    const result = await run(c.syncFacebook, asUser({ body: { pageId: 'FB_A' } }));
    assert.equal(result.synced, 1);
    assert.equal(
      store.pages.find((p) => p.facebookPageId === 'FB_C').followersCount, before,
      'an unnamed Page must not be touched',
    );
  });

  await t.test('a sync updates the public figure when the primary changes', async () => {
    const fb = store.creators[0].socialAccounts.find((s) => s.platform === 'facebook');
    const b = store.pages.find((p) => p.facebookPageId === 'FB_B');
    assert.equal(fb.followers, b.followersCount,
      'the mirrored follower count must track the primary Page after a sync');
  });

  /* ── 7. per-Page disconnect ──────────────────────────────────────────── */
  await t.test('removing a non-primary Page leaves the others alone', async () => {
    const result = await run(c.disconnectFacebookPage, asUser({ params: { pageId: 'FB_C' } }));
    assert.equal(result.remaining, 2);
    assert.equal(store.pages.length, 2);
    assert.ok(store.pages.find((p) => p.facebookPageId === 'FB_A'));
    assert.ok(store.pages.find((p) => p.facebookPageId === 'FB_B'));
  });

  await t.test('removing the PRIMARY Page re-homes the flag', async () => {
    // FB_B is primary at this point.
    await run(c.disconnectFacebookPage, asUser({ params: { pageId: 'FB_B' } }));

    assert.equal(store.pages.length, 1);
    const primaries = store.pages.filter((p) => p.isPrimary);
    assert.equal(primaries.length, 1,
      'the survivor must inherit primary, or the creator silently loses Facebook from their profile');
    assert.equal(primaries[0].facebookPageId, 'FB_A');
  });

  await t.test('the public profile follows the re-homed primary', async () => {
    const fb = store.creators[0].socialAccounts.find((s) => s.platform === 'facebook');
    assert.equal(fb.handle, '@damyantilifts');
  });

  await t.test('removing the last Page clears Facebook from the profile', async () => {
    await run(c.disconnectFacebookPage, asUser({ params: { pageId: 'FB_A' } }));

    assert.equal(store.pages.length, 0);
    const fb = store.creators[0].socialAccounts.find((s) => s.platform === 'facebook');
    assert.equal(fb, undefined,
      'a creator with no Pages must not appear in discovery with a Facebook audience of zero');

    // And the platform is no longer listed as connected on the user.
    const pulled = store.users.some((u) => JSON.stringify(u.update).includes('$pull'));
    assert.ok(pulled, 'connectedAccounts must have facebook pulled when the last Page goes');
  });

  await t.test('a Page id that is not connected 404s rather than 500s', async () => {
    await assert.rejects(
      () => run(c.disconnectFacebookPage, asUser({ params: { pageId: 'FB_GONE' } })),
      (e) => e.status === 404 || /not connected/.test(e.message),
    );
  });
});
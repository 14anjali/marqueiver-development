import test from 'node:test';
import assert from 'node:assert/strict';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';

const { FacebookPage } = await import('../src/models/FacebookPage.js');
const { CreatorProfile } = await import('../src/models/CreatorProfile.js');

/**
 * Several Facebook Pages per creator.
 *
 * These assert the *schema*, not a running database, because the constraint
 * that decides whether this feature works at all is an index declaration — and
 * an index declaration is exactly the kind of thing that can be silently wrong
 * while every other test passes.
 *
 * The failure this guards against is specific and quiet. `FacebookPage.user`
 * carried `unique: true`, so a second Page for the same creator was rejected by
 * MongoDB with E11000 *after* the OAuth round trip and the Page token exchange
 * had already succeeded. The application code looked correct; the write failed.
 * If someone restores that flag, this test fails immediately rather than a
 * creator discovering it when they try to add their second Page.
 *
 * A live-database test of the same behaviour lives in the integration suite,
 * which needs a real mongod. These run everywhere.
 */

/** Mongoose records declared indexes as `[fields, options]` pairs. */
const indexes = () => FacebookPage.schema.indexes();

const findIndex = (predicate) => indexes().find(([fields, options]) => predicate(fields, options ?? {}));

test('FacebookPage: a creator may hold more than one Page', async (t) => {
  await t.test('`user` is indexed but NOT unique', () => {
    const userPath = FacebookPage.schema.path('user');
    assert.ok(userPath, 'the user path should exist');

    // The flag that used to make this a one-Page-per-creator model.
    assert.notEqual(
      userPath.options.unique,
      true,
      'FacebookPage.user must not be unique — it is what limits a creator to one Page',
    );
    assert.equal(userPath.options.index, true, 'user should still be indexed');
  });

  await t.test('no standalone unique index on user alone', () => {
    const offending = findIndex(
      (fields, options) => options.unique === true
        && Object.keys(fields).length === 1
        && fields.user === 1
        // The pending-selection index is a unique index on `user` alone, but it
        // is partial — it constrains only the authorisation session, not Pages.
        && !options.partialFilterExpression,
    );

    assert.equal(
      offending,
      undefined,
      'a unique index on { user } alone would reject a second Page',
    );
  });
});

test('FacebookPage: duplicates are prevented by Page id', async (t) => {
  await t.test('facebookPageId is globally unique and sparse', () => {
    const found = findIndex((fields) => fields.facebookPageId === 1);
    assert.ok(found, 'there should be an index on facebookPageId');

    const [, options] = found;
    assert.equal(options.unique, true,
      'the same Page must not be connectable twice, nor claimable by two users');
    assert.equal(options.sparse, true,
      'sparse — a pending_selection row has no Page id yet');
  });
});

test('FacebookPage: one authorisation session per user', async (t) => {
  await t.test('a partial unique index covers pending_selection only', () => {
    const found = findIndex(
      (fields, options) => fields.user === 1 && options.partialFilterExpression,
    );

    assert.ok(found, 'there should be a partial index for the pending session');

    const [, options] = found;
    assert.equal(options.unique, true);
    assert.deepEqual(
      options.partialFilterExpression,
      { status: 'pending_selection' },
      'the constraint must apply only to the authorisation session, never to connected Pages',
    );
  });
});

test('FacebookPage: a primary Page can be nominated', async (t) => {
  await t.test('isPrimary exists and defaults to false', () => {
    const path = FacebookPage.schema.path('isPrimary');
    assert.ok(path, 'isPrimary must exist — the public profile reads it');
    assert.equal(path.options.default, false,
      'a newly connected Page is not automatically the public one');
  });

  await t.test('status still allows the pending-selection state', () => {
    const states = FacebookPage.schema.path('status').options.enum;
    assert.ok(states.includes('pending_selection'));
    assert.ok(states.includes('connected'));
  });
});

/**
 * The fields the Account Center added, for the same reason: Mongoose's strict
 * mode drops an undeclared path on write without an error, so a field that is
 * missing from the schema fails by silently discarding what the user typed.
 */
test('CreatorProfile: the Account Center fields exist', async (t) => {
  await t.test('portfolioLink is declared', () => {
    assert.ok(
      CreatorProfile.schema.path('portfolioLink'),
      'portfolioLink must be declared or strict mode discards it on save',
    );
  });

  await t.test('coverUrl is declared', () => {
    assert.ok(CreatorProfile.schema.path('coverUrl'));
  });
});

/**
 * The write path, not just the model.
 *
 * `coverUrl` was on the model for the whole life of the project and absent from
 * `updateCreatorSchema`, so `PATCH /me/creator` stripped it before it reached
 * Mongoose. A field can be correctly declared and still be unwritable, and that
 * combination is what this checks.
 */
test('updateCreatorSchema accepts the fields the profile editor sends', async (t) => {
  const { updateCreatorSchema } = await import('../src/modules/users/users.controller.js');

  await t.test('coverUrl survives validation', () => {
    const parsed = updateCreatorSchema.parse({ coverUrl: 'https://cdn.example.com/banner.jpg' });
    assert.equal(parsed.coverUrl, 'https://cdn.example.com/banner.jpg');
  });

  await t.test('portfolioLink survives validation', () => {
    const parsed = updateCreatorSchema.parse({ portfolioLink: 'https://behance.net/someone' });
    assert.equal(parsed.portfolioLink, 'https://behance.net/someone');
  });

  await t.test('an empty portfolioLink is allowed, so the link can be removed', () => {
    const parsed = updateCreatorSchema.parse({ portfolioLink: '' });
    assert.equal(parsed.portfolioLink, '');
  });

  await t.test('a portfolioLink that is not a URL is rejected', () => {
    assert.throws(() => updateCreatorSchema.parse({ portfolioLink: 'not a url' }));
  });
});

/** The banner upload needs its own purpose, or it lands in the portfolio folder. */
test('the upload endpoint accepts a banner purpose', async () => {
  const { getUploadUrlSchema } = await import('../src/modules/users/users.controller.js');
  const parsed = getUploadUrlSchema.parse({ fileName: 'b.jpg', purpose: 'banner' });
  assert.equal(parsed.purpose, 'banner');
});
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.INTEGRATION_MODE = 'mock';

const { assertInstagramEligible, assertFacebookEligible } =
    await import('../src/services/socialConnect.service.js');
const { InstagramAccount, FacebookPage, YouTubeChannel, CreatorProfile, User } =
    await import('../src/models/index.js');

/**
 * Onboarding rules that hold without a database.
 *
 * The uniqueness rules need real queries and are covered in auth-flow.test.js;
 * what is checked here is eligibility, the schema constraints that make
 * duplicate detection possible at all, and the field-name mismatches that made
 * three integrations silently drop the very ids uniqueness depends on.
 */

/* ───────────────────────── Instagram account type ──────────────────────────── */

test('Creator and Business Instagram accounts are eligible', () => {
    for (const t of ['CREATOR', 'BUSINESS', 'MEDIA_CREATOR', 'creator', 'business']) {
        assert.equal(assertInstagramEligible({ account_type: t }), t.toUpperCase());
    }
});

test('a personal Instagram account is refused with instructions', () => {
    assert.throws(() => assertInstagramEligible({ account_type: 'PERSONAL' }), (err) => {
        assert.equal(err.status, 422);
        assert.equal(err.code, 'INSTAGRAM_ACCOUNT_TYPE_INELIGIBLE');
        assert.match(err.message, /Creator or Business/);
        // The UI offers the fix, so the error has to carry it.
        assert.ok(err.details.howTo.length >= 3);
        assert.ok(err.details.switchUrl.startsWith('https://'));
        return true;
    });
});

test('an unknown Instagram account type is refused rather than assumed', () => {
    for (const profile of [{}, { account_type: undefined }, { account_type: 'UNKNOWN' }]) {
        assert.throws(() => assertInstagramEligible(profile),
            (err) => err.code === 'INSTAGRAM_ACCOUNT_TYPE_INELIGIBLE');
    }
});

test('the model accepts either shape the Graph API returns', () => {
    // Instagram's REST field is `account_type`; our own stored doc uses
    // `accountType`. Both reach this guard depending on the call site.
    assert.equal(assertInstagramEligible({ accountType: 'CREATOR' }), 'CREATOR');
});

/* ─────────────────────────── Facebook page presence ────────────────────────── */

test('a Facebook connection with no Page is refused', () => {
    for (const pages of [[], null, undefined]) {
        assert.throws(() => assertFacebookEligible(pages), (err) => {
            assert.equal(err.status, 422);
            assert.equal(err.code, 'FACEBOOK_PAGE_REQUIRED');
            assert.ok(err.details.howTo.length);
            return true;
        });
    }
});

test('a Facebook connection with a Page is accepted', () => {
    const pages = [{ id: '1', name: 'Acme' }];
    assert.deepEqual(assertFacebookEligible(pages), pages);
});

/* ───────────────── one social account, one Marqueiver user ─────────────────── */

test('each social model makes its provider id globally unique', () => {
    const uniqueOn = (model, field) => Object.entries(model.schema.indexes())
        .some(([, spec]) => spec[0][field] === 1 && spec[1]?.unique);

    assert.ok(uniqueOn(InstagramAccount, 'igUserId'),
        'igUserId must be unique — it was indexed but not unique, so one Instagram '
        + 'account could back any number of creator profiles');
    assert.ok(uniqueOn(FacebookPage, 'facebookPageId'),
        'facebookPageId must be unique on its own — the old { user, facebookPageId } '
        + 'index constrained the wrong thing');
    assert.ok(uniqueOn(YouTubeChannel, 'youtubeChannelId'),
        'youtubeChannelId had no uniqueness constraint at all');
});

test('the provider id fields the controllers write actually exist on the schemas', () => {
    // Mongoose drops undeclared paths in strict mode. The Instagram controller
    // wrote `instagramId` and the Facebook controller wrote `pageName`, neither
    // of which the schemas declare — so the values vanished on every save, and
    // the Instagram account id that uniqueness depends on was never stored.
    assert.ok(InstagramAccount.schema.path('igUserId'), 'igUserId must be a declared path');
    assert.ok(FacebookPage.schema.path('facebookPageId'), 'facebookPageId must be a declared path');
    assert.ok(FacebookPage.schema.path('name'), 'name must be a declared path');
    assert.ok(YouTubeChannel.schema.path('youtubeChannelId'), 'youtubeChannelId must be a declared path');
});

/* ──────────────────────── profile shape for onboarding ─────────────────────── */

test('the creator profile can hold everything onboarding collects', () => {
    for (const p of ['avatarUrl', 'bio', 'categories', 'contactEmail', 'contactPhone']) {
        assert.ok(CreatorProfile.schema.path(p), `CreatorProfile.${p} is missing`);
    }
});

test('categories is a list, not a single value', () => {
    assert.equal(CreatorProfile.schema.path('categories').instance, 'Array');
});

test('the unverified contact fields are kept off the identity fields', () => {
    // Writing an unverified phone or email onto User would occupy a unique
    // index and lock the real owner out of ever registering it.
    assert.ok(CreatorProfile.schema.path('contactPhone'));
    assert.ok(CreatorProfile.schema.path('contactEmail'));
    assert.ok(User.schema.path('phone').options.unique);
    assert.ok(User.schema.path('email').options.unique);
});

test('the account carries a server-owned onboarding stage', () => {
    const stage = User.schema.path('onboardingStage');
    assert.ok(stage, 'onboardingStage is missing');
    assert.deepEqual(stage.enumValues,
        ['basic_details_completed', 'profile_completed', 'onboarding_completed']);
});

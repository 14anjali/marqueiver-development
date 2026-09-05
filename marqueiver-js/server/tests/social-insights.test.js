import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { unsupportedMetric, requestSupportedMetrics, normaliseInsights } =
    await import('../src/utils/metricDiscovery.js');
const { ApiError } = await import('../src/utils/apiError.js');

/**
 * Metric discovery and the "unavailable ≠ zero" contract.
 *
 * The reason this exists: two pages of Meta's own documentation disagree about
 * whether `impressions` is a valid Instagram metric. The API reference says it
 * was removed for all versions on 21 April 2025 and replaced by `views`; the
 * Insights guide still presents `impressions` as the example. There is no way
 * to tell from outside which a given app, account type and Graph version will
 * be served — and because one bad name fails the WHOLE comma-separated
 * `metric=` request, guessing wrong costs every other metric too.
 */

/* ── Recognising a metric rejection ───────────────────────────────────────── */

test('the metric Meta names is the one dropped', () => {
    const cases = [
        ['(#100) The following are invalid metrics: impressions', ['impressions']],
        ['(#100) Invalid metric for this endpoint: plays, video_views', ['plays', 'video_views']],
        ['The account does not support the metric: profile_views', ['profile_views']],
        ['page_engaged_users is not a valid metric', ['page_engaged_users']],
    ];
    for (const [message, expected] of cases) {
        assert.deepEqual(unsupportedMetric(message), expected, message);
    }
});

test('a rejection that names nothing still signals a metric problem', () => {
    // Some phrasings refuse the set without naming a culprit.
    const named = unsupportedMetric('metric[0] must be one of the following values: reach, views');
    assert.deepEqual(named, ['*']);
});

test('auth and permission errors are never treated as metric problems', () => {
    /**
     * The dangerous false positive. Dropping metrics in response to "your token
     * expired" would shed the whole list one at a time and then report "nothing
     * available" — turning a fixable, reconnectable problem into a permanent
     * empty analytics page, with the real error swallowed on the way.
     */
    for (const message of [
        'Error validating access token: Session has expired',
        '(#200) Requires pages_read_engagement permission',
        'Invalid OAuth access token',
        'The access token could not be decrypted',
    ]) {
        assert.equal(unsupportedMetric(message), null, message);
    }
});

/* ── Discovery ────────────────────────────────────────────────────────────── */

const metricError = (message) =>
    new ApiError(502, 'INSTAGRAM_API_ERROR', `fetch failed: ${message}`,
        { providerMessage: message, providerCode: 100 });

test('a deprecated metric is dropped and the rest still come back', async () => {
    // The exact scenario: impressions is gone, everything else works.
    const attempts = [];
    const { data, requested, unavailable } = await requestSupportedMetrics(
        ['reach', 'views', 'impressions'],
        async (metrics) => {
            attempts.push([...metrics]);
            if (metrics.includes('impressions')) {
                throw metricError('(#100) The following are invalid metrics: impressions');
            }
            return { data: metrics.map((name) => ({ name, total_value: { value: 10 } })) };
        },
    );

    assert.equal(attempts.length, 2);
    assert.deepEqual(unavailable, ['impressions']);
    assert.deepEqual(requested, ['reach', 'views']);
    assert.equal(data.data.length, 2);
});

test('several bad metrics are shed one pass at a time', async () => {
    const { requested, unavailable } = await requestSupportedMetrics(
        ['reach', 'impressions', 'plays', 'views'],
        async (metrics) => {
            const bad = metrics.filter((m) => ['impressions', 'plays'].includes(m));
            if (bad.length) throw metricError(`(#100) The following are invalid metrics: ${bad.join(',')}`);
            return { data: metrics.map((name) => ({ name, total_value: { value: 1 } })) };
        },
    );

    assert.deepEqual(requested, ['reach', 'views']);
    assert.deepEqual(unavailable.sort(), ['impressions', 'plays']);
});

test('a token failure aborts discovery instead of being retried away', async () => {
    let attempts = 0;
    await assert.rejects(
        () => requestSupportedMetrics(['reach', 'views'], async () => {
            attempts += 1;
            throw new ApiError(401, 'INSTAGRAM_TOKEN_INVALID', 'expired',
                { providerMessage: 'Error validating access token: Session has expired' });
        }),
        (err) => err.code === 'INSTAGRAM_TOKEN_INVALID',
    );
    assert.equal(attempts, 1, 'a dead token must not be retried down the metric list');
});

test('discovery terminates even when Meta names a metric we never asked for', async () => {
    // Dropping nothing would loop forever; shedding the last candidate makes
    // progress guaranteed on every pass.
    let attempts = 0;
    const { unavailable } = await requestSupportedMetrics(
        ['reach', 'views'],
        async (metrics) => {
            attempts += 1;
            if (metrics.length > 1) throw metricError('(#100) The following are invalid metrics: something_else');
            return { data: [{ name: metrics[0], total_value: { value: 5 } }] };
        },
    );
    assert.ok(attempts <= 3, `expected termination, took ${attempts} attempts`);
    assert.equal(unavailable.length, 1);
});

/* ── Unavailable is not zero ──────────────────────────────────────────────── */

test('a metric Meta refused is unavailable, not zero', () => {
    /**
     * The product requirement, enforced at the data layer: "Not available from
     * Meta API" must read differently from "0". A `?? 0` anywhere on this path
     * turns a gap in the data into a claim about the creator's performance —
     * and a brand reading a media kit cannot tell the difference.
     */
    const metrics = normaliseInsights(
        [{ name: 'reach', total_value: { value: 0 } }],
        ['impressions'],
    );

    assert.deepEqual(metrics.reach, { available: true, value: 0, title: null, period: null });
    assert.equal(metrics.impressions.available, false);
    assert.equal(metrics.impressions.value, null);
    assert.match(metrics.impressions.reason, /Not available/i);

    // A real zero and an unavailable metric must not be confusable.
    assert.notEqual(metrics.reach.available, metrics.impressions.available);
});

test('both Meta response shapes are read', () => {
    // total_value and a values[] series appear on the same account depending on
    // metric_type; a reader that handles only one silently loses the other.
    const metrics = normaliseInsights([
        { name: 'views', total_value: { value: 4200 } },
        {
            name: 'reach',
            values: [
                { value: 100, end_time: '2026-09-01T07:00:00+0000' },
                { value: 180, end_time: '2026-09-02T07:00:00+0000' },
            ],
        },
    ]);

    assert.equal(metrics.views.value, 4200);
    assert.equal(metrics.reach.value, 180, 'the latest point is the headline value');
    assert.equal(metrics.reach.series.length, 2, 'the series is kept for charting');
});

test('a null value from Meta is unavailable rather than zero', () => {
    const metrics = normaliseInsights([{ name: 'saves', total_value: { value: null } }]);
    assert.equal(metrics.saves.available, false);
    assert.equal(metrics.saves.value, null);
});

/* ── The metric lists actually shipped ────────────────────────────────────── */

test('Instagram account metrics match the current API reference', async () => {
    process.env.INTEGRATION_MODE = 'live';
    process.env.INSTAGRAM_APP_ID = 'id';
    process.env.INSTAGRAM_APP_SECRET = 'secret';
    const ig = await import('../src/services/instagram.service.js');

    // Verified against Meta's Instagram User insights reference.
    for (const metric of ['reach', 'views', 'total_interactions', 'likes', 'comments', 'shares', 'saves']) {
        assert.ok(ig.ACCOUNT_METRICS.includes(metric), `${metric} should be requested`);
    }

    // Removed for all versions on 21 April 2025, replaced by `views`.
    assert.ok(!ig.ACCOUNT_METRICS.includes('impressions'),
        'impressions is deprecated and must not be a candidate');

    // These are media-edge FIELDS, not account insight metrics. The previous
    // implementation asked for them and would have failed on every call.
    assert.ok(!ig.ACCOUNT_METRICS.includes('follower_count'));
    assert.ok(!ig.ACCOUNT_METRICS.includes('media_count'));
});

test('read_insights is requested, because Page analytics need it', async () => {
    const fb = await import('../src/services/facebook.service.js');

    // Separate from pages_read_engagement: engagement reads content, insights
    // reads metrics, and holding one does not grant the other.
    assert.ok(fb.REQUIRED_SCOPES.includes('read_insights'));
    assert.ok(fb.REQUIRED_SCOPES.includes('pages_read_engagement'));
    assert.ok(Array.isArray(fb.PAGE_METRICS) && fb.PAGE_METRICS.length > 0);
});

/* ── The media model that makes re-sync idempotent ────────────────────────── */

test('media is keyed per account so a re-sync updates instead of duplicating', async () => {
    const { InstagramMedia } = await import('../src/models/InstagramMedia.js');

    const unique = InstagramMedia.schema.indexes()
        .find(([keys, opts]) => opts?.unique && keys.account === 1 && keys.mediaId === 1);

    assert.ok(unique, 'an (account, mediaId) unique index is what makes upsert idempotent');
});

test('unknown engagement counts default to null, never zero', async () => {
    const { InstagramMedia } = await import('../src/models/InstagramMedia.js');
    const doc = new InstagramMedia({
        user: '64f0000000000000000000aa',
        account: '64f0000000000000000000bb',
        mediaId: 'm_1',
    });

    // A post whose like count Instagram would not serve has not had zero likes.
    assert.equal(doc.likeCount, null);
    assert.equal(doc.commentsCount, null);
    assert.equal(doc.validateSync(), undefined);
});
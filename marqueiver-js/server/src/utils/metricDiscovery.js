/**
 * Ask Meta which metrics it still supports, instead of hard-coding a list.
 *
 * ── Why this is not over-engineering ───────────────────────────────────────
 * While implementing this, two pages of Meta's own documentation disagreed:
 *
 *   /docs/instagram-platform/api-reference/instagram-user/insights
 *     "`impressions` … deprecated for v22.0 and will be deprecated for all
 *      versions on April 21, 2025", replaced by `views`.
 *
 *   /docs/instagram-platform/insights/
 *     still presents `impressions`, `engagement` and `profile_views` as the
 *     account and media examples.
 *
 * One of those pages is stale, and there is no way to tell from the outside
 * which metric a *particular app on a particular Graph version for a particular
 * account type* will be served. Hard-coding either answer means the analytics
 * page silently loses a panel the day Meta retires a name — and worse, a single
 * bad metric in a comma-separated `metric=` list fails the WHOLE request, so one
 * retired name takes every other metric down with it.
 *
 * So the list here is a set of *candidates*. Meta names the metric it will not
 * serve; that one is dropped and the rest are requested again. What survived is
 * reported back, so the UI can distinguish a metric that came back zero from
 * one this account cannot provide at all — the distinction the product spec
 * calls for, and one that cannot be made by a caller that assumes its list was
 * right.
 *
 * The same shape already proved itself in `igGetFields`, which drops
 * unsupported *fields* the same way.
 */

/**
 * Does this provider error name a metric that cannot be served?
 *
 * Meta phrases it several ways depending on endpoint and version, so the match
 * is deliberately broad — but it must never match a permission or token error,
 * because dropping metrics in response to "your token expired" would retry the
 * whole set to zero and report "nothing available" for a fixable problem.
 */
export function unsupportedMetric(message) {
    const text = String(message ?? '');

    // Never treat auth/permission problems as metric problems.
    if (/access token|permission|OAuthException|expired|revoked/i.test(text)) return null;

    const patterns = [
        /\(#100\)\s*(?:The following are invalid metrics?|Invalid metric)[^:]*:\s*([a-z0-9_,\s]+)/i,
        /metric\[\d+\]\s+must be one of the following values[^:]*:/i,
        /(?:does not support the metric|Unsupported (?:get )?metric)[:\s]+([a-z0-9_]+)/i,
        /([a-z0-9_]+)\s+is not a valid metric/i,
        /invalid metric[:\s]+([a-z0-9_]+)/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            // Some phrasings name the offender, others only say the set is wrong.
            const named = (match[1] ?? '')
                .split(/[,\s]+/)
                .map((s) => s.trim().toLowerCase())
                .filter((s) => /^[a-z0-9_]+$/.test(s) && s.length > 2);
            return named.length ? named : ['*'];
        }
    }
    return null;
}

/**
 * Request a metric set, dropping whatever Meta refuses, until something works.
 *
 * @param {string[]} candidates      metric names to try, most wanted first
 * @param {(metrics: string[]) => Promise<any>} request
 * @param {object} [opts]
 * @param {(info: object) => void} [opts.onDrop]  called with each drop, for logging
 * @returns {Promise<{data: any, requested: string[], unavailable: string[]}>}
 */
export async function requestSupportedMetrics(candidates, request, { onDrop } = {}) {
    let remaining = [...new Set(candidates)];
    const unavailable = [];

    // Bounded by the candidate count: each pass drops at least one name.
    for (let attempt = 0; attempt <= candidates.length; attempt += 1) {
        if (!remaining.length) {
            return { data: null, requested: [], unavailable };
        }

        try {
            const data = await request(remaining);
            return { data, requested: remaining, unavailable };
        } catch (err) {
            const message = err?.details?.providerMessage ?? err?.message;
            const named = unsupportedMetric(message);

            // Not a metric problem — a token, permission or network failure.
            // Those must surface, not be retried into an empty result.
            if (!named) throw err;

            let dropped;
            if (named[0] === '*') {
                // Meta refused the set without naming a culprit. Drop the last
                // candidate: the list is ordered most-wanted first, so this
                // sheds the least important metric on each pass.
                dropped = [remaining[remaining.length - 1]];
            } else {
                dropped = named.filter((m) => remaining.includes(m));
                // It named something we did not ask for — dropping nothing would
                // loop forever, so fall back to shedding the last candidate.
                if (!dropped.length) dropped = [remaining[remaining.length - 1]];
            }

            remaining = remaining.filter((m) => !dropped.includes(m));
            unavailable.push(...dropped);
            onDrop?.({ dropped, remaining, providerMessage: String(message ?? '') });
        }
    }

    return { data: null, requested: [], unavailable };
}

/**
 * Normalise a Meta insights response into values the UI can render honestly.
 *
 * The product requirement is that "Not available from Meta API" reads
 * differently from "0", and that only holds if the two are different shapes all
 * the way through. A metric that Meta served with a value of zero is a real
 * zero; a metric it refused is absent. Collapsing both to `0` — which is what
 * `?? 0` anywhere in this path would do — turns a gap in the data into a claim
 * about the creator's performance.
 *
 * @param {Array} rows            Meta's `data` array
 * @param {string[]} unavailable  metric names dropped during discovery
 */
export function normaliseInsights(rows, unavailable = []) {
    const metrics = {};

    for (const row of rows ?? []) {
        const name = row?.name;
        if (!name) continue;

        // Meta returns either `total_value.value` or a `values[]` series
        // depending on metric_type; both shapes appear on the same account.
        const total = row.total_value?.value;
        const series = Array.isArray(row.values) ? row.values : null;
        const latest = series?.length ? series[series.length - 1]?.value : undefined;

        const value = total ?? latest;

        metrics[name] = {
            available: value !== undefined && value !== null,
            value: value ?? null,
            title: row.title ?? null,
            period: row.period ?? null,
            ...(series && series.length > 1
                ? { series: series.map((p) => ({ at: p.end_time ?? null, value: p.value })) }
                : {}),
        };
    }

    // Explicitly present, explicitly unavailable — so the UI never has to guess
    // whether a missing key means zero or means Meta would not serve it.
    for (const name of unavailable) {
        if (!(name in metrics)) {
            metrics[name] = {
                available: false,
                value: null,
                reason: 'Not available from the Meta API for this account',
            };
        }
    }

    return metrics;
}
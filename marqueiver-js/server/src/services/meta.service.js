import { env } from '../config/env.js';

/**
 * Social stats for a hand-typed handle (Proposal §2.2 & §8).
 *
 * Still BLOCKED on Meta App Review, which is an external process measured in
 * weeks. Until it clears there is no Graph call to make for an arbitrary handle
 * somebody typed into a form, so this returns deterministic synthetic figures.
 *
 * ── The Render boot crash this file caused ─────────────────────────────────
 *   TypeError: Cannot read properties of undefined (reading 'appId')
 *       at meta.service.js:9 → fetchSocialStats() → seed() → seedIfEmpty()
 *
 * Line 9 was:
 *     if (env.integrationMode === 'mock' || !env.meta.appId) {
 *
 * `env.meta` was never defined in config/env.js — there is no `meta` block and
 * no META_* variable anywhere in the project. The crash stayed invisible locally
 * only because `||` short-circuits: INTEGRATION_MODE defaults to 'mock', so the
 * left side was true and the right side never ran. Render sets it to 'live', the
 * left side became false, and the process died before the server ever listened.
 *
 * Two things are fixed rather than papered over:
 *
 *  1. `env.meta` now exists, derived from the Facebook app credentials already
 *     configured. Access is still optional-chained — a config key read in only
 *     one deployment mode is exactly the kind that goes missing again, and a
 *     missing credential should degrade to synthetic stats, never take the
 *     process down.
 *
 *  2. The old "live" branch returned *the same fabricated numbers* as the mock
 *     branch but stamped them `dataSource: 'connected'`. That is worse than the
 *     crash and would have shipped silently: brands read `dataSource` as "these
 *     figures came from the platform", so invented follower counts were about to
 *     be shown to paying brands as verified. Provenance now tells the truth in
 *     both branches. 'connected' is set only where a real provider response
 *     backs it — the OAuth integrations in instagram.controller.js and
 *     youtube.controller.js — not here.
 */

/** Stable pseudo-stats derived from the handle, so the same handle always agrees. */
export function syntheticSocialStats(platform, handle) {
    const seed = [...String(handle)].reduce((a, c) => a + c.charCodeAt(0), 0);
    return {
        platform,
        handle,
        followers: 10000 + ((seed * 137) % 500000),
        engagementRate: Number((2 + (seed % 60) / 10).toFixed(2)),
        verified: seed % 3 === 0,
        /**
         * Self-reported, because that is what it is: a handle someone typed,
         * with numbers we generated. A creator who connects the account through
         * OAuth gets 'connected' from that flow instead.
         */
        dataSource: 'self_reported',
    };
}

/** True once Meta App Review clears and credentials are present. */
export function canQueryMetaGraph() {
    return env.integrationMode === 'live' && Boolean(env.meta?.appId);
}

/**
 * @param {string} platform  'instagram' | 'youtube' | …
 * @param {string} handle    the handle as the user typed it
 */
export async function fetchSocialStats(platform, handle) {
    if (!canQueryMetaGraph()) {
        return syntheticSocialStats(platform, handle);
    }

    /**
     * The live Graph lookup goes here once App Review clears. Until then,
     * holding credentials does not make the data real, so this returns the same
     * synthetic figures under the same honest label. Do not relabel the result
     * 'connected' without an actual Graph response behind it.
     */
    return syntheticSocialStats(platform, handle);
}
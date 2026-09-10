import { User, Campaign, Deal } from '../../models/index.js';
import { currentCommissionPct } from '../../services/commission.service.js';

/**
 * The four numbers on the landing page.
 *
 * These were hard-coded in the marketing page as a literal array —
 * `2,843 creators`, `320+ campaigns`, `₹2Cr+ paid out`. A trust page whose
 * trust numbers are invented is the one thing worse than a page with no
 * numbers on it, and "no hardcoded platform statistics" is an explicit product
 * rule. So they are counted, from the same collections the product runs on.
 *
 * ── What each number is, precisely ──────────────────────────────────────────
 *
 *  creators   Accounts with role `creator` that are not suspended. Not "signed
 *             up at some point" — a suspended account is not a creator a brand
 *             can hire, so counting it would overstate the marketplace.
 *
 *  campaigns  Campaigns that actually reached creators: `open` or `closed`.
 *             `draft`, `pending_review` and `rejected` never became a campaign
 *             anybody could apply to, and counting a rejected submission as a
 *             campaign run is exactly the kind of flattery this endpoint exists
 *             to avoid.
 *
 *  paidOut    The sum of `escrow.amount` over deals whose escrow has actually
 *             been released (`escrow.releasedAt` set). Money that is sitting in
 *             escrow right now has not been paid to anyone, and money that was
 *             refunded was not paid to a creator either — `releasedAt` is set
 *             only on release, so both are excluded by construction.
 *
 *  commission The live rate from commission.service, not a number typed into a
 *             page. If the rate ever changes under Policy 14.7, the landing
 *             page changes with it rather than quietly lying.
 *
 * ── Why it is cached ────────────────────────────────────────────────────────
 *
 * This is unauthenticated and sits on the busiest page in the product. Three
 * aggregate queries per visitor is a free amplification of any traffic spike
 * onto the primary. The figures move slowly, so a five-minute in-process cache
 * costs nothing real and bounds the database work to a handful of queries per
 * hour per instance.
 *
 * ── Why it is safe to expose ────────────────────────────────────────────────
 *
 * Four aggregates over the whole platform. No user, deal, brand or amount is
 * identifiable from a total, and nothing here is keyed on anything the caller
 * supplies.
 */

const TTL_MS = 5 * 60 * 1000;

/** @type {{ at: number, value: object } | null} */
let cache = null;

async function computeStats() {
    const [creators, campaigns, released] = await Promise.all([
        User.countDocuments({ role: 'creator', status: { $ne: 'suspended' } }),
        Campaign.countDocuments({ status: { $in: ['open', 'closed'] } }),
        Deal.aggregate([
            { $match: { 'escrow.releasedAt': { $ne: null } } },
            { $group: { _id: null, total: { $sum: '$escrow.amount' } } },
        ]),
    ]);

    return {
        creators,
        campaigns,
        // `$sum` over an empty match yields no group at all, not a zero row.
        paidOut: released[0]?.total ?? 0,
        commissionPct: currentCommissionPct(),
        // So the client can say "as of" rather than implying these are live.
        asOf: new Date().toISOString(),
    };
}

export async function platformStats(_req, res, next) {
    try {
        if (cache && Date.now() - cache.at < TTL_MS) {
            return res.json({ ok: true, data: cache.value });
        }

        const value = await computeStats();
        cache = { at: Date.now(), value };

        // Let a CDN or the browser hold it too; the numbers are already stale
        // by up to five minutes on the server, so a matching client TTL adds
        // no additional inaccuracy.
        res.set('Cache-Control', 'public, max-age=300');
        return res.json({ ok: true, data: value });
    } catch (err) {
        return next(err);
    }
}

/** Test hook — the cache is process-global and would leak between cases. */
export function __resetPlatformStatsCache() {
    cache = null;
}

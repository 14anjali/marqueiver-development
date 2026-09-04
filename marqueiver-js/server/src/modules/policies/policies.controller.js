import { z } from 'zod';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok, created } from '../../utils/respond.js';
import { Policy, PolicyAcceptance } from '../../models/index.js';
import { ROUTE_TO_SLUG, POLICY_BY_SLUG } from './policyCatalog.js';

/**
 * Policy publication and acceptance — Policy 24, 1.14.
 *
 * Reading policies is public: a person has to be able to read the terms before
 * they register. Accepting requires authentication, because an acceptance is
 * only meaningful when it is attributable to a user.
 */

/**
 * All policies currently in force, one per slug. Bodies are omitted — the index
 * page lists fifteen policies and does not need ~8,000 words to render a list.
 *
 * `?role=` narrows to the policies that bind that role, which is what makes
 * "Creator policies to Creators, Brand policies to Brands" a property of the
 * API rather than something each screen has to remember.
 */
export const listPolicies = catchAsync(async (req, res) => {
    let rows = await Policy.allCurrent();

    const role = req.query.role;
    if (role) {
        if (!['creator', 'brand', 'admin'].includes(role))
            throw ApiError.badRequest('role must be creator, brand or admin');
        rows = rows.filter((p) => p.requiredFor?.includes(role));
    }

    ok(res, rows
        .sort((a, b) => (a.number ?? 99) - (b.number ?? 99))
        .map(({ body, sections, intro, ...rest }) => ({
            ...rest,
            route: rest.route ?? `/policies/${rest.slug}`,
            sectionCount: sections?.length ?? 0,
        })));
});

/**
 * A single policy, with its full text.
 *
 * The parameter accepts either the slug (`terms-of-use`) or the short public
 * route the signup form links to (`terms`), so `/terms` and
 * `/policies/terms-of-use` resolve to the same document without the frontend
 * having to keep its own mapping in step with the backend's.
 *
 * `?version=` returns a specific historical version, which a user needs in order
 * to read back the terms they actually accepted — an acceptance record naming a
 * version nobody can retrieve is not much of a record.
 */
export const getPolicy = catchAsync(async (req, res) => {
    const key = req.params.slug;
    const slug = ROUTE_TO_SLUG.get(key) ?? key;

    const doc = req.query.version
        ? await Policy.findOne({ slug, version: req.query.version }).lean()
        : await Policy.currentFor(slug);

    if (!doc) {
        // Distinguish "no such policy" from "this policy has not been published
        // to this environment yet" — they need different fixes.
        throw POLICY_BY_SLUG.has(slug)
            ? new ApiError(503, 'POLICY_NOT_PUBLISHED',
                'This policy has not been published on this environment yet.', { slug })
            : ApiError.notFound('Policy not found');
    }

    const versions = await Policy.find({ slug })
        .select('version effectiveFrom')
        .sort({ effectiveFrom: -1, version: -1 })
        .lean();

    ok(res, { ...doc, route: doc.route ?? `/policies/${doc.slug}`, versions });
});

export const acceptPolicySchema = z.object({
    // Accept several at once — registration presents Terms, Privacy and the
    // role policy together.
    slugs: z.array(z.string()).min(1),
    context: z.string().max(64).optional(),
});

/**
 * Record acceptance of the versions currently in force. The version is read
 * server-side rather than taken from the request, so a client cannot claim to
 * have accepted a version that was never in effect.
 */
export const acceptPolicies = catchAsync(async (req, res) => {
    const results = [];

    for (const slug of req.body.slugs) {
        const policy = await Policy.currentFor(slug);
        if (!policy) throw ApiError.notFound(`No policy in force for "${slug}"`);

        try {
            const acceptance = await PolicyAcceptance.create({
                user: req.auth.sub,
                policy: policy._id,
                slug: policy.slug,
                version: policy.version,
                context: req.body.context ?? 'registration',
                ip: req.ip,
                userAgent: req.get('user-agent'),
            });
            results.push({ slug, version: policy.version, acceptedAt: acceptance.acceptedAt });
        } catch (err) {
            // Already accepted this exact version — not an error, just a no-op.
            if (err?.code === 11000) {
                results.push({ slug, version: policy.version, alreadyAccepted: true });
                continue;
            }
            throw err;
        }
    }

    created(res, { accepted: results });
});

/** Everything this user has accepted, newest first. */
export const myAcceptances = catchAsync(async (req, res) => {
    ok(res, await PolicyAcceptance.find({ user: req.auth.sub }).sort({ acceptedAt: -1 }).lean());
});

/**
 * Which required policies this user has NOT accepted at their current version.
 * Drives the re-consent prompt after a policy update (1.14).
 */
export const pendingAcceptances = catchAsync(async (req, res) => {
    const current = await Policy.allCurrent();
    const required = current.filter((p) => p.requiredFor.includes(req.auth.role));

    const accepted = await PolicyAcceptance.find({ user: req.auth.sub, status: 'accepted' })
        .select('slug version').lean();
    const acceptedSet = new Set(accepted.map((a) => `${a.slug}@${a.version}`));

    ok(res, required.filter((p) => !acceptedSet.has(`${p.slug}@${p.version}`)));
});

/**
 * Policy 5.2 / 24 — the versions governing a Collaboration, resolved at
 * Acceptance and stored on the deal. Exposed as a helper rather than a route
 * so the deals module can snapshot without duplicating the lookup.
 */
export async function currentPolicyVersionMap() {
    const current = await Policy.allCurrent();
    return Object.fromEntries(current.map((p) => [p.slug, p.version]));
}

import { createRequire } from 'node:module';

/**
 * The Marqueiver Platform Policies (V2), effective 01 August 2026.
 *
 * `content/policies.v2.json` is generated from the authoritative DOCX — it is
 * the real policy text, not a summary and not placeholder copy. It is checked in
 * rather than read from the document at runtime so that (a) the server has no
 * dependency on a Word file, and (b) re-issuing the policy produces a reviewable
 * diff. Regenerate it, never hand-edit it.
 *
 * Two things this module owns that the DOCX does not express:
 *
 *  - **Role applicability.** Policy 3 binds Creators, Policy 4 binds Brands, the
 *    other thirteen bind both. This is what makes "do not show Creator policies
 *    to Brands" enforceable rather than cosmetic — the same list drives the
 *    signup form and the backend's acceptance check, so the two cannot drift.
 *  - **Public routes.** The four policies named on the signup consent line get
 *    their own short URLs (/terms, /privacy, /creator-policy, /brand-policy)
 *    because a person is asked to read them at the moment they sign up.
 */

const require = createRequire(import.meta.url);
/** @type {Array<import('./policyTypes.js').PolicyDocument>} */
export const POLICY_V2 = require('../../content/policies.v2.json');

export const POLICY_VERSION = '2.0';

/** slug -> policy document. */
export const POLICY_BY_SLUG = new Map(POLICY_V2.map((p) => [p.slug, p]));

/** Short public route -> slug, for /terms, /privacy, /creator-policy, /brand-policy. */
export const ROUTE_TO_SLUG = new Map(
    POLICY_V2.filter((p) => p.route).map((p) => [p.route.replace(/^\//, ''), p.slug]),
);

/**
 * Every policy a role must accept. Policy 1.14 and 24 make acceptance a
 * condition of use, so this is the authority for both the signup UI and the
 * server-side gate — a Brand is never asked for, and never checked against, the
 * Creator Policy.
 */
export function policiesForRole(role) {
    return POLICY_V2.filter((p) => p.requiredFor.includes(role));
}

/**
 * The subset named explicitly on the consent line. The rest are required too
 * (and are listed in full on the form), but these four are the ones the user is
 * pointed at by name, so they carry dedicated routes.
 */
export function primaryPoliciesForRole(role) {
    return policiesForRole(role).filter((p) => p.signupPrimary);
}

/** Slugs only — what the acceptance check compares against. */
export function requiredSlugsForRole(role) {
    return policiesForRole(role).map((p) => p.slug);
}

/** Metadata for the client: no bodies, so the signup form stays small. */
export function policySummary(p) {
    return {
        slug: p.slug,
        title: p.title,
        version: p.version,
        effectiveFrom: p.effectiveFrom,
        route: p.route ?? `/policies/${p.slug}`,
        signupPrimary: Boolean(p.signupPrimary),
        sectionCount: p.sections.length,
    };
}

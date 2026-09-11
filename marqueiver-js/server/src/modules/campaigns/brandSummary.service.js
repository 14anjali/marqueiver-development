import { BrandProfile, User } from '../../models/index.js';
import { brandVerificationLevel } from '../../services/verificationLevel.service.js';

/**
 * The public face of a brand, attached to a campaign a creator is reading.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * A campaign stores `brand` as a User id and nothing else, so a campaign card
 * had no name to show and no way to say whether the brand was verified — which
 * is the first thing a creator looks for before spending an hour on a pitch.
 *
 * ── What it deliberately does not carry ────────────────────────────────────
 *
 * Only what a creator may see. `PRIVATE_BRAND_FIELDS` in
 * `discovery.controller.js` establishes that boundary — GSTIN, invoicing
 * address, contact email, phone, contact person and team members are private —
 * and this projection is narrower still: it names the six fields it wants
 * rather than subtracting the private ones, so a field added to BrandProfile
 * later cannot leak by default.
 *
 * The verification level is derived, never the evidence for it. Policy 13.5:
 * identity and financial documents are never displayed to other users, so a
 * creator gets `brandVerified: true` and nothing about what proved it.
 */

/** Exactly the fields a creator may see. Additive by choice, not subtractive. */
const PUBLIC_BRAND_FIELDS = 'user companyName logo coverUrl tagline industry categories website location verifications';

/**
 * Brand summaries for a set of campaigns, in one round trip each.
 *
 * Batched because the alternative is a lookup per campaign: a page of twenty
 * campaigns would issue forty queries, and the listing is the hottest read a
 * creator makes.
 *
 * @returns Map keyed by the brand's User id (as a string).
 */
export async function brandSummariesFor(campaigns = []) {
    const userIds = [...new Set(campaigns.map((c) => String(c.brand)).filter(Boolean))];
    if (!userIds.length) return new Map();

    const [profiles, users] = await Promise.all([
        BrandProfile.find({ user: { $in: userIds } }).select(PUBLIC_BRAND_FIELDS).lean(),
        User.find({ _id: { $in: userIds } }).select('phoneVerified emailVerified').lean(),
    ]);

    const userById = new Map(users.map((u) => [String(u._id), u]));

    return new Map(profiles.map((p) => {
        const level = brandVerificationLevel(p, userById.get(String(p.user)));
        return [String(p.user), shape(p, level)];
    }));
}

/** One brand, for a single campaign read. */
export async function brandSummaryFor(brandUserId) {
    if (!brandUserId) return null;

    const [profile, user] = await Promise.all([
        BrandProfile.findOne({ user: brandUserId }).select(PUBLIC_BRAND_FIELDS).lean(),
        User.findById(brandUserId).select('phoneVerified emailVerified').lean(),
    ]);
    if (!profile) return null;

    return shape(profile, brandVerificationLevel(profile, user));
}

function shape(profile, level) {
    return {
        /** The BrandProfile id, which is what `/brand/:id` routes on. */
        profileId: String(profile._id),
        companyName: profile.companyName ?? '',
        logo: profile.logo ?? '',
        tagline: profile.tagline ?? '',
        industry: profile.industry ?? '',
        categories: profile.categories ?? [],
        website: profile.website ?? '',
        location: profile.location ?? null,
        /**
         * Derived only. `level.requirements` and `level.outstanding` describe
         * what the brand still has to do and are the brand's own business, so
         * they are dropped here rather than passed through.
         */
        verified: Boolean(level.brandVerified),
        verificationLevel: level.level,
        verificationLabel: level.label,
    };
}
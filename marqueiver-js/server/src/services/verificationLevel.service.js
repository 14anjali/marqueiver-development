/**
 * Policy 13.1 — Levels of verification, derived rather than stored.
 *
 * The policy table is:
 *
 *   Basic              All users at registration   Verified mobile and email.
 *   Creator payout     Creators receiving payment  PAN, and UPI or bank account.
 *   Social verification Creators                   A connected, authorised account.
 *   Brand verification Brands                      Company name, work email on a
 *                                                  business domain, website, and
 *                                                  GSTIN where applicable.
 *   Enhanced           High-value or flagged       Government ID, incorporation
 *                      accounts                    documents, address proof.
 *
 * ── Why this is computed and not a column ──────────────────────────────────
 *
 * Every input already exists: `User.phoneVerified` / `emailVerified`, and the
 * `verifications.{kind}` booleans that `admin.decideVerification` sets when it
 * approves a submission. A stored `level` would be a fourth copy of facts that
 * are already recorded in three places, and it would go stale the moment an
 * admin approved something without remembering to recompute it.
 *
 * So the level is a pure function of state the platform already maintains.
 * Nothing here changes how admins approve a verification, and no new
 * verification can be granted by this module — it only reads.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 *
 * "Enhanced" is listed in the policy for high-value or flagged accounts, and
 * the platform has no mechanism to record that an account has been through it.
 * Rather than invent one, `enhanced` is reported only when an admin has
 * approved a verification of a kind that implies it. Today no such kind exists
 * in the `Verification` model's enum, so `enhanced` is currently unreachable —
 * stated here so it reads as a known gap rather than as dead code.
 */

/** Ordered weakest to strongest, so a UI can compare levels meaningfully. */
export const BRAND_LEVELS = ['none', 'basic', 'brand_verified', 'enhanced'];

export const LEVEL_LABEL = {
    none: 'Not verified',
    basic: 'Basic',
    brand_verified: 'Brand verified',
    enhanced: 'Enhanced',
};

/**
 * Is this email address on a business domain?
 *
 * Policy 13.1 asks for a "work email on a business domain" as part of Brand
 * verification. The only automatable reading of that is "not a free consumer
 * mailbox", which is what this checks. It is a signal shown to the brand, not
 * an approval — an admin still decides, and `verifications.email` is what
 * actually counts toward the level.
 */
const CONSUMER_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com',
    'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me',
    'protonmail.com', 'rediffmail.com', 'zoho.com', 'yandex.com', 'mail.com',
]);

export function emailDomain(email) {
    const at = String(email ?? '').lastIndexOf('@');
    return at === -1 ? '' : String(email).slice(at + 1).trim().toLowerCase();
}

export function isBusinessDomain(email) {
    const domain = emailDomain(email);
    return Boolean(domain) && !CONSUMER_DOMAINS.has(domain);
}

/**
 * The brand's verification level, and what is still outstanding.
 *
 * @param {object} profile  BrandProfile (lean or hydrated)
 * @param {object} user     User, for the Basic tier's mobile/email checks
 */
export function brandVerificationLevel(profile, user) {
    const v = profile?.verifications ?? {};

    // Basic — Policy 13.1, row 1.
    const basic = Boolean(user?.phoneVerified && user?.emailVerified);

    /*
      Brand verification — Policy 13.1, row 4. "GSTIN where applicable" is
      conditional, so a brand without one is not blocked by it; what is checked
      is that an admin approved the business verification, that a work email and
      website are on record, and that the email is on a business domain.
    */
    const requirements = [
        {
            id: 'company',
            label: 'Company name',
            done: Boolean(profile?.companyName?.trim()),
            section: 'business',
        },
        {
            id: 'workEmail',
            label: 'Work email on a business domain',
            done: Boolean(v.email) && isBusinessDomain(profile?.contactEmail),
            section: 'business',
        },
        {
            id: 'website',
            label: 'Website',
            done: Boolean(v.website) && Boolean(profile?.website?.trim()),
            section: 'business',
        },
        {
            id: 'business',
            label: 'Business registration',
            done: Boolean(v.business),
            section: 'verification',
        },
    ];

    const brandVerified = requirements.every((r) => r.done);

    let level = 'none';
    if (brandVerified) level = 'brand_verified';
    else if (basic) level = 'basic';

    return {
        level,
        label: LEVEL_LABEL[level],
        basic,
        brandVerified,
        // GSTIN is reported separately because it is conditional, not required.
        gstOnRecord: Boolean(profile?.gstin?.trim()),
        gstVerified: Boolean(v.gst),
        emailDomain: emailDomain(profile?.contactEmail),
        businessDomain: isBusinessDomain(profile?.contactEmail),
        requirements,
        outstanding: requirements.filter((r) => !r.done),
    };
}
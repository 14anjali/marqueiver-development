import { ApiError } from '../../utils/apiError.js';
import { signAccess, signRefresh } from '../../utils/tokens.js';
import { User, CreatorProfile, BrandProfile, Policy, PolicyAcceptance } from '../../models/index.js';
import { requiredSlugsForRole } from '../policies/policyCatalog.js';

/**
 * Account resolution, session issue and next-step routing.
 *
 * The rule this module exists to enforce: **a role is a property of an account,
 * read from the database, and never a value the client supplies.** Login takes a
 * verified identity and returns whatever role that account holds. Signup takes a
 * role, but only to *create* an account with it — and only after the policies
 * required for that role have been accepted.
 */

export const ROLES = ['creator', 'brand'];

/* ────────────────────────────── finding accounts ───────────────────────────── */

/**
 * The account behind a verified identity, or null.
 *
 * A Google identity is looked up by `googleId` first and by email second, so a
 * user who registered with an email OTP and later clicks "Continue with Google"
 * lands on their existing account rather than being told it does not exist — and
 * the Google id is linked on the way through.
 */
export async function findAccountFor(verification) {
    const { channel, identifier, googleId } = verification;

    if (channel === 'google') {
        const byGoogle = googleId ? await User.findOne({ googleId }) : null;
        if (byGoogle) return byGoogle;
        return User.findOne({ email: identifier });
    }
    if (channel === 'phone') return User.findOne({ phone: identifier });
    return User.findOne({ email: identifier });
}

/** True when the identity is already attached to some account. */
export async function identifierTaken(channel, identifier) {
    if (channel === 'phone') return Boolean(await User.exists({ phone: identifier }));
    return Boolean(await User.exists({ email: identifier }));
}

/* ─────────────────────────── enforcement (Policy 12) ───────────────────────── */

/**
 * Policy 12 — the enforcement ladder. A suspended or terminated account is
 * refused a session outright; a restricted one is allowed to sign in, because
 * 12.2 restricts what a user may *do*, not whether they may see their own
 * account, and a user who cannot log in cannot appeal.
 */
export function assertCanAuthenticate(user) {
    const status = user.accountStatus ?? (user.status === 'suspended' ? 'suspended' : 'active');

    if (user.deletedAt)
        throw new ApiError(403, 'ACCOUNT_DELETED',
            'This account has been closed. Contact support@marqueiver.com if this is unexpected.');

    if (status === 'terminated')
        throw new ApiError(403, 'ACCOUNT_TERMINATED',
            'This account has been terminated. Contact support@marqueiver.com to appeal.');

    if (status === 'suspended')
        throw new ApiError(403, 'ACCOUNT_SUSPENDED',
            'This account is suspended. Contact support@marqueiver.com to appeal.');
}

/* ─────────────────────────────── policy state ──────────────────────────────── */

/**
 * Which policies this role must accept, at the versions currently in force.
 * Read from the database rather than from the catalog constant, because the
 * version in force is what an acceptance is recorded against, and a deployment
 * can publish a new version without a code change.
 */
export async function requiredPoliciesFor(role) {
    const current = await Policy.allCurrent();
    const inForce = current.filter((p) => p.requiredFor?.includes(role));

    // Before any policy row exists (a fresh database mid-boot), fall back to the
    // catalog so signup describes the right documents rather than none.
    if (!inForce.length) {
        return requiredSlugsForRole(role).map((slug) => ({ slug, version: null, title: slug }));
    }
    return inForce.map((p) => ({
        slug: p.slug,
        title: p.title,
        version: p.version,
        effectiveFrom: p.effectiveFrom,
        route: p.route ?? `/policies/${p.slug}`,
        signupPrimary: Boolean(p.signupPrimary),
    }));
}

/** Required policies this user has not accepted at the version in force. */
export async function outstandingPoliciesFor(userId, role) {
    const required = await requiredPoliciesFor(role);
    if (!required.length || required.every((p) => !p.version)) return [];

    const accepted = await PolicyAcceptance
        .find({ user: userId, status: 'accepted' })
        .select('slug version')
        .lean();
    const have = new Set(accepted.map((a) => `${a.slug}@${a.version}`));

    return required.filter((p) => !have.has(`${p.slug}@${p.version}`));
}

/**
 * Record acceptance of the versions in force. The version is resolved
 * server-side and never taken from the request, so a client cannot claim to have
 * accepted a version that was never published. Rows are append-only (Policy 24);
 * a repeat acceptance of the same version is a no-op, not an error.
 */
export async function recordPolicyAcceptances(userId, role, { context, ip, userAgent }) {
    const required = await requiredPoliciesFor(role);
    const written = [];

    for (const p of required) {
        if (!p.version) continue;
        const policy = await Policy.currentFor(p.slug);
        if (!policy) continue;
        try {
            await PolicyAcceptance.create({
                user: userId,
                policy: policy._id,
                slug: policy.slug,
                version: policy.version,
                context: context ?? 'registration',
                ip,
                userAgent,
            });
            written.push({ slug: policy.slug, version: policy.version });
        } catch (err) {
            if (err?.code === 11000) {
                written.push({ slug: policy.slug, version: policy.version, alreadyAccepted: true });
                continue;
            }
            throw err;
        }
    }
    return written;
}

/**
 * Signup gate. The client sends the slugs it showed and the user ticked; this
 * checks that set against the set the server requires for that role. Both
 * directions matter:
 *
 *  - a **missing** slug means the user was not asked to accept something they
 *    must accept, so the account is not created;
 *  - an **unexpected** slug means the client showed a policy that does not apply
 *    to this role — a Brand being shown the Creator Policy — which is a bug worth
 *    surfacing rather than silently recording.
 */
export async function assertPoliciesAccepted(role, acceptedSlugs) {
    const required = await requiredPoliciesFor(role);
    const requiredSlugs = required.map((p) => p.slug);
    const accepted = new Set(acceptedSlugs ?? []);

    const missing = requiredSlugs.filter((s) => !accepted.has(s));
    if (missing.length) {
        throw new ApiError(422, 'POLICY_ACCEPTANCE_REQUIRED',
            'Accept the required policies to create your account.',
            { missing, required: required.map((p) => ({ slug: p.slug, title: p.title, version: p.version })) });
    }

    const unexpected = [...accepted].filter((s) => !requiredSlugs.includes(s));
    if (unexpected.length) {
        throw new ApiError(422, 'POLICY_NOT_APPLICABLE',
            'One of the policies submitted does not apply to this account type.',
            { unexpected, role });
    }
}

/* ───────────────────────────── account creation ────────────────────────────── */

/**
 * Create an account for a verified identity. The channel that was verified is
 * the channel marked verified — a phone signup does not get a verified email,
 * because nothing verified it.
 */
export async function createAccount({ verification, role, dob, ageDeclared18Plus, profile = {} }) {
    if (!ROLES.includes(role))
        throw ApiError.badRequest('Choose whether you are joining as a creator or a brand.');

    const { channel, identifier, googleId, name } = verification;

    const doc = {
        role,
        authProviders: [channel === 'google' ? 'google' : channel],
        accountStatus: 'active',
        status: 'active',
    };

    if (channel === 'phone') {
        doc.phone = identifier;
        doc.phoneVerified = true;
        doc.phoneVerifiedAt = new Date();
    } else {
        doc.email = identifier;
        doc.emailVerified = true;
        doc.emailVerifiedAt = new Date();
        if (channel === 'google') doc.googleId = googleId;
    }

    // Policy 1.3 — 18+ is a condition of using the Platform, so it is captured
    // with the account rather than left to a later profile edit.
    if (dob) {
        doc.dob = new Date(dob);
        doc.ageDeclared18Plus = Boolean(ageDeclared18Plus);
        doc.ageVerifiedAt = new Date();
    }

    let user;
    try {
        user = await User.create(doc);
    } catch (err) {
        if (err?.code === 11000) {
            const field = Object.keys(err.keyValue ?? {})[0];
            throw new ApiError(409,
                field === 'phone' ? 'PHONE_ALREADY_REGISTERED' : 'EMAIL_ALREADY_REGISTERED',
                field === 'phone'
                    ? 'That mobile number is already registered. Log in instead.'
                    : 'That email address is already registered. Log in instead.');
        }
        throw err;
    }

    const displayName = String(profile.displayName ?? profile.companyName ?? name ?? '').trim()
        || (identifier.includes('@') ? identifier.split('@')[0] : 'New account');

    if (role === 'creator') {
        await CreatorProfile.create({
            user: user._id,
            displayName,
            ...(profile.categories?.length ? { categories: profile.categories } : {}),
            ...(profile.city ? { location: { city: profile.city, country: 'India' } } : {}),
        });
    } else {
        await BrandProfile.create({
            user: user._id,
            companyName: displayName,
            ...(profile.website ? { website: profile.website } : {}),
            ...(profile.industry ? { industry: profile.industry } : {}),
        });
    }

    return user;
}

/**
 * Attach a newly verified identity to an existing account — the email a
 * phone-registered user later verifies, or the Google id behind an email they
 * already hold. Policy 13.1 needs both a verified mobile and a verified email,
 * so this is how an account reaches Basic verification without a second signup.
 */
export async function linkIdentity(user, verification) {
    const { channel, identifier, googleId } = verification;
    let changed = false;

    if (channel === 'phone' && !user.phone) {
        if (await User.exists({ phone: identifier, _id: { $ne: user._id } }))
            throw new ApiError(409, 'PHONE_ALREADY_REGISTERED',
                'That mobile number is already linked to another Marqueiver account.');
        user.phone = identifier;
        changed = true;
    }
    if (channel === 'phone' && user.phone === identifier && !user.phoneVerified) {
        user.phoneVerified = true;
        user.phoneVerifiedAt = new Date();
        changed = true;
    }

    if ((channel === 'email' || channel === 'google')) {
        if (!user.email) {
            if (await User.exists({ email: identifier, _id: { $ne: user._id } }))
                throw new ApiError(409, 'EMAIL_ALREADY_REGISTERED',
                    'That email address is already linked to another Marqueiver account.');
            user.email = identifier;
            changed = true;
        }
        if (user.email === identifier && !user.emailVerified) {
            user.emailVerified = true;
            user.emailVerifiedAt = new Date();
            changed = true;
        }
    }

    if (channel === 'google' && googleId && !user.googleId) {
        if (await User.exists({ googleId, _id: { $ne: user._id } }))
            throw new ApiError(409, 'GOOGLE_ALREADY_LINKED',
                'That Google account is already linked to another Marqueiver account.');
        user.googleId = googleId;
        changed = true;
    }

    const provider = channel === 'google' ? 'google' : channel;
    if (!user.authProviders?.includes(provider)) {
        user.authProviders = [...(user.authProviders ?? []), provider];
        changed = true;
    }

    if (changed) await user.save();
    return user;
}

/* ─────────────────────────────── session + routing ─────────────────────────── */

export function issueTokens(user) {
    return {
        accessToken: signAccess({ sub: user.id, role: user.role, adminLevel: user.adminLevel }),
        refreshToken: signRefresh(user.id),
    };
}

/**
 * Where this account belongs right now.
 *
 * Computed on the server from the account's real state, and returned with every
 * session and every /auth/me, so the frontend routes on facts rather than on a
 * role it stashed in localStorage. The order is the order a user meets these
 * requirements, and each step names the one thing standing between them and
 * their dashboard.
 */
export async function resolveNextStep(user) {
    const status = user.accountStatus ?? (user.status === 'suspended' ? 'suspended' : 'active');

    if (status === 'suspended' || status === 'terminated') return { step: 'restricted', path: '/account/restricted', status };
    if (user.role === 'admin') {
        if (user.adminApprovalStatus === 'pending') return { step: 'admin_pending', path: '/admin/pending' };
        return { step: 'admin', path: '/admin' };
    }

    // Policy 1.3 — 18+ declared.
    if (!user.dob || !user.ageDeclared18Plus) return { step: 'age_declaration', path: '/onboarding/age' };

    // Policy 1.14 / 24 — current versions accepted for this role.
    const outstanding = await outstandingPoliciesFor(user._id, user.role);
    if (outstanding.length)
        return { step: 'policy_acceptance', path: '/onboarding/policies', policies: outstanding };

    /**
     * One verified identity is enough to reach onboarding.
     *
     * This used to force *both* a verified mobile and a verified email before a
     * new account could go anywhere — so someone who signed up with email OTP
     * was immediately bounced to "add your phone number", and a Google signup
     * was bounced twice. Signing up with one method and then being told to
     * produce a second is not a choice of methods, it is a longer form.
     *
     * The rule now matches what signup actually promises: Google, email OTP or
     * WhatsApp OTP — any one of them creates a usable account. `createAccount`
     * only ever marks the channel that was genuinely verified, so this cannot be
     * satisfied by an unverified identifier.
     *
     * NOTE — this is a deliberate divergence from Policy V2 clause 13.1, which
     * defines Basic verification as mobile AND email. The policy still governs
     * where it has teeth: `requireBasicVerification` gates collaboration and
     * money actions, and `REQUIRE_DUAL_VERIFICATION=true` restores the strict
     * reading there. It is relaxed at signup only.
     */
    if (!user.phoneVerified && !user.emailVerified) {
        return { step: 'verify_identity', path: '/onboarding/verify-email' };
    }

    if (!user.onboardingComplete) {
        return {
            step: 'onboarding',
            path: user.role === 'creator' ? '/onboarding/influencer' : '/onboarding/brand',
            resumeAt: user.onboardingStep || '',
        };
    }

    if (status === 'restricted') return { step: 'dashboard', path: '/dashboard', status: 'restricted' };
    return { step: 'dashboard', path: '/dashboard' };
}

/** The user shape the client is allowed to see. No payout data, no hashes. */
export function userView(user) {
    return {
        id: user.id ?? String(user._id),
        role: user.role,
        adminLevel: user.adminLevel,
        adminApprovalStatus: user.adminApprovalStatus,
        phone: user.phone ?? null,
        email: user.email ?? null,
        phoneVerified: Boolean(user.phoneVerified),
        emailVerified: Boolean(user.emailVerified),
        authProviders: user.authProviders ?? [],
        /**
         * What the account could still add. Profile/Settings uses this to offer
         * linking the other methods as an *option* — the same `/auth/link`
         * endpoint the old forced step used, just no longer compulsory.
         */
        canLink: {
            phone: !user.phoneVerified,
            email: !user.emailVerified,
            google: !user.googleId,
        },
        accountStatus: user.accountStatus ?? 'active',
        enforcementLevel: user.enforcementLevel ?? 'none',
        ageDeclared18Plus: Boolean(user.ageDeclared18Plus),
        onboardingComplete: Boolean(user.onboardingComplete),
        onboardingStep: user.onboardingStep || '',
    };
}

/** Everything the client needs after a successful authentication. */
export async function buildSession(user) {
    user.lastLoginAt = new Date();
    await user.save();
    return {
        user: userView(user),
        next: await resolveNextStep(user),
        ...issueTokens(user),
    };
}

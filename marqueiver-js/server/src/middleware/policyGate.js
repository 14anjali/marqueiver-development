import { Policy, PolicyAcceptance, User } from '../models/index.js';
import { ApiError } from '../utils/apiError.js';
import { env } from '../config/env.js';

/**
 * Compliance gates — Policy 1.3, 1.14, 13.1.
 *
 * These are conditions of *using* the Platform, not profile details, so they
 * are enforced as middleware rather than checked in individual controllers.
 * Read endpoints stay open so a blocked user can still see why they are
 * blocked and fix it; the gates apply to actions.
 *
 * Each gate returns a machine-readable `code` so the frontend can route the
 * user to the right screen instead of showing a generic error.
 */

/** Policy 1.3 — "You must be at least 18 years old to use the Platform." */
export async function requireAdult(req, res, next) {
    try {
        const user = await User.findById(req.auth.sub).select('dob ageDeclared18Plus role');
        if (!user) return next(ApiError.unauthorized());
        if (user.role === 'admin') return next();

        if (!user.dob || !user.ageDeclared18Plus)
            return next(new ApiError(403, 'AGE_DECLARATION_REQUIRED',
                'Confirm your date of birth to continue. Marqueiver is only available to people aged 18 or over.'));

        if (!user.meetsMinimumAge())
            return next(new ApiError(403, 'UNDER_18',
                'Marqueiver is only available to people aged 18 or over.'));

        next();
    } catch (err) { next(err); }
}

/**
 * Verification required before a collaboration or a payment.
 *
 * Two readings, and which one applies is a business decision rather than a
 * technical one, so it is configuration rather than a hardcoded choice:
 *
 *  - **Default** — at least one verified identity. This matches what signup now
 *    promises: Google, email OTP or WhatsApp OTP, any one of them, and the
 *    account works. A user is never asked at deal time for a second channel
 *    they were never asked for at signup.
 *  - **REQUIRE_DUAL_VERIFICATION=true** — mobile AND email, the strict reading
 *    of Policy V2 clause 13.1. Turn this on when the policy owner confirms it
 *    should bind. It gates *actions*, never sign-in, so a user who hits it can
 *    still reach their account and add the missing channel.
 *
 * Either way the error names the specific missing channel, so the UI can send
 * the user straight to the screen that fixes it instead of showing a dead end.
 */
export async function requireBasicVerification(req, res, next) {
    try {
        const user = await User.findById(req.auth.sub).select('phoneVerified emailVerified role');
        if (!user) return next(ApiError.unauthorized());
        if (user.role === 'admin') return next();

        if (env.requireDualVerification) {
            if (!user.phoneVerified)
                return next(new ApiError(403, 'PHONE_VERIFICATION_REQUIRED', 'Verify your mobile number to continue.'));
            if (!user.emailVerified)
                return next(new ApiError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your email address to continue.'));
            return next();
        }

        if (!user.phoneVerified && !user.emailVerified)
            return next(new ApiError(403, 'VERIFICATION_REQUIRED',
                'Verify your email address or mobile number to continue.'));

        next();
    } catch (err) { next(err); }
}

/**
 * Policy 1.14 / 24 — the user must have accepted the current version of every
 * policy required for their role. A policy update therefore blocks actions
 * until it is re-accepted, which is what makes the acceptance record meaningful.
 */
export async function requirePolicyAcceptance(req, res, next) {
    try {
        const role = req.auth.role;
        if (role === 'admin') return next();

        const current = await Policy.allCurrent();
        const required = current.filter((p) => p.requiredFor?.includes(role));
        // No policies published yet — do not lock the platform out of itself.
        if (!required.length) return next();

        const accepted = await PolicyAcceptance
            .find({ user: req.auth.sub, status: 'accepted' })
            .select('slug version').lean();
        const have = new Set(accepted.map((a) => `${a.slug}@${a.version}`));

        const outstanding = required.filter((p) => !have.has(`${p.slug}@${p.version}`));
        if (outstanding.length)
            return next(new ApiError(403, 'POLICY_ACCEPTANCE_REQUIRED',
                'Review and accept the updated policies to continue.', {
                    policies: outstanding.map((p) => ({ slug: p.slug, title: p.title, version: p.version })),
                }));

        next();
    } catch (err) { next(err); }
}

/** All three, in the order a user would encounter them. */
export const requireCompliance = [requireAdult, requireBasicVerification, requirePolicyAcceptance];

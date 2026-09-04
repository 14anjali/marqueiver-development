import { Schema, model } from 'mongoose';
import bcrypt from 'bcryptjs';
const userSchema = new Schema({
    /**
     * Identity. Neither is required on its own, because a person can register
     * with a phone, an email or a Google account and add the others later —
     * `hasBasicVerification()` is what decides when the account is usable
     * (Policy 13.1), not whether a column happens to be filled in.
     *
     * The previous schema made `phone` required and globally unique, which
     * forced email-only and Google-only signups to store synthetic values
     * (`e_alice@example.com`, `g_10974...`). Those are not phone numbers: they
     * occupied the unique index, so the real number could never be added later,
     * and they made "find the account for this phone" ambiguous. They are
     * removed by `migrate-auth-identity.js` and cannot be created any more.
     */
    phone: { type: String, index: true, sparse: true, unique: true },
    email: { type: String, index: true, sparse: true, unique: true },
    passwordHash: String,
    role: { type: String, enum: ['creator', 'brand', 'admin'], required: true, index: true },
    adminLevel: { type: String, enum: ['super', 'support', 'finance'] },
    // Self-signup admin approval (Finance/Support only — Super is never
    // self-signed-up). Undefined/unused for creator/brand users and for
    // admins created via bootstrap or an existing super admin's Team invite
    // (both of those set this to 'approved' directly — see admin.controller.js).
    adminApprovalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], index: true },
    googleId: { type: String, index: true, sparse: true, unique: true },

    /**
     * Which sign-in methods this account can actually use. Recorded so the login
     * screen can tell someone *how* they signed up when they try a method they
     * never linked, instead of the flat "account not found" that sends a user
     * who registered with Google round the signup loop a second time.
     */
    authProviders: {
        type: [String],
        enum: ['email', 'phone', 'google'],
        default: [],
    },
    lastLoginAt: Date,

    phoneVerified: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    /** Policy 13.1 — Basic verification requires BOTH mobile and email. */
    emailVerifiedAt: Date,
    phoneVerifiedAt: Date,

    /**
     * Policy 1.3 — "You must be at least 18 years old to use the Platform."
     * Stored as a date of birth plus an explicit declaration, because the
     * policy makes the age a condition of eligibility rather than a profile
     * detail. `ageVerifiedAt` records when the declaration was made.
     */
    dob: Date,
    ageDeclared18Plus: { type: Boolean, default: false },
    ageVerifiedAt: Date,

    /**
     * Policy 12 — enforcement ladder. `status` is kept for backward
     * compatibility; `accountStatus` and `enforcementLevel` carry the policy
     * model (Warning → Restriction → Suspension → Termination).
     */
    accountStatus: {
        type: String,
        enum: ['active', 'restricted', 'suspended', 'terminated'],
        default: 'active',
        index: true,
    },
    /** Set when the user deletes their account (deactivation + anonymisation). */
    deletedAt: Date,
    deletionReason: String,

    enforcementLevel: {
        type: String,
        enum: ['none', 'warning', 'restriction', 'suspension', 'termination'],
        default: 'none',
    },
    /**
     * Which social platforms this user has connected.
     *
     * Declared because six places already write it — the Instagram, Facebook
     * and YouTube connect and disconnect handlers all `$addToSet` / `$pull`
     * here — and none of them worked. `connectedAccounts` was not a path on
     * this schema, and in strict mode Mongoose strips undeclared paths out of
     * an update; with nothing left, `$addToSet: { connectedAccounts: … }` cast
     * down to `{}`, an empty update document that the driver refuses.
     *
     * So every social connection ended by either doing nothing or throwing at
     * the last step, after the account record had already been written. The
     * InstagramAccount / FacebookPage / YouTubeChannel collections remain the
     * source of truth; this is the denormalised rollup those handlers assume.
     */
    connectedAccounts: {
        type: [String],
        enum: ['instagram', 'facebook', 'youtube'],
        default: [],
    },
    onboardingComplete: { type: Boolean, default: false },
    // Resumable onboarding (feature #4 — save/resume): last step the user reached,
    // so a reload/relogin mid-onboarding continues where they left off instead of
    // restarting. Values are free-form step keys owned by the frontend
    // (e.g. 'details', 'instagram' for creators; 'company', 'logo' for brands).
    onboardingStep: { type: String, default: '' },

    /**
     * Where the user has reached in onboarding.
     *
     * `onboardingStep` above is a free-form key the frontend owns, which is fine
     * for "which sub-step of a form" and useless for deciding where to send
     * somebody on login. This is the coarse, server-owned answer, so a refresh
     * or a re-login resumes at the right place instead of restarting.
     *
     *   basic_details_completed  account exists, name and city captured at signup
     *   profile_completed        picture, bio, contact and 3+ categories saved
     *   onboarding_completed     at least one social account connected
     *
     * Existing accounts have neither this field nor a reason to redo anything,
     * so `onboardingComplete: true` is still honoured on its own — see
     * `resolveOnboarding()` in users.controller.js.
     */
    onboardingStage: {
        type: String,
        enum: ['basic_details_completed', 'profile_completed', 'onboarding_completed'],
        default: 'basic_details_completed',
        index: true,
    },
    lastSyncedAt: Date,
    status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
}, { timestamps: true });
userSchema.methods.setPassword = async function (pw) {
    this.passwordHash = await bcrypt.hash(pw, 10);
};
userSchema.methods.checkPassword = async function (pw) {
    if (!this.passwordHash)
        return false;
    return bcrypt.compare(pw, this.passwordHash);
};
/**
 * Policy 1.3 — "One person or entity may hold only one account of each type."
 *
 * Enforced at the database level, on the identifiers themselves rather than on
 * (identifier, role) pairs. The compound indexes this replaces allowed the same
 * phone or email to hold both a Creator and a Brand account, which broke login:
 * a person signing in with an email that matched two accounts had no
 * unambiguous role to be given, and the only way to resolve it would have been
 * to ask them which one — the exact question login is not allowed to ask.
 *
 * One identity therefore maps to exactly one account. `migrate-auth-identity.js`
 * reports any existing duplicates before these indexes are built, rather than
 * failing the migration and leaving the collection half-indexed.
 *
 * The uniqueness lives on the `phone`, `email` and `googleId` field definitions
 * above; there is no compound (identifier, role) index any more.
 */

/** Policy 1.3 — 18+ is a condition of using the Platform at all. */
userSchema.methods.meetsMinimumAge = function meetsMinimumAge() {
    if (!this.dob) return false;
    const eighteenYearsAgo = new Date();
    eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
    return this.dob <= eighteenYearsAgo;
};

/**
 * Policy 13.1 — Basic verification: mobile AND email.
 *
 * Kept exactly as the policy defines it. It is no longer what signup requires
 * (one verified method is enough to create and use an account), but it is still
 * the correct question to ask before a collaboration or a payout, so the method
 * keeps the policy's meaning rather than being quietly redefined.
 */
userSchema.methods.hasBasicVerification = function hasBasicVerification() {
    return Boolean(this.phoneVerified && this.emailVerified);
};

/**
 * What signup requires: at least one identity this platform actually verified.
 * A Google sign-in verifies the email; email OTP verifies the email; WhatsApp
 * OTP verifies the phone. An identifier that was merely typed in never sets
 * these flags, so this cannot be satisfied by an unverified value.
 */
userSchema.methods.hasVerifiedIdentity = function hasVerifiedIdentity() {
    return Boolean(this.phoneVerified || this.emailVerified);
};

export const User = model('User', userSchema);
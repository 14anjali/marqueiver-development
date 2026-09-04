import { z } from 'zod';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok, created } from '../../utils/respond.js';
import { env } from '../../config/env.js';
import {
    sendPhoneOtp,
    sendEmailOtp,
    verifyChannelOtp,
    normaliseIdentifier,
    isValidEmail,
    OtpThrottle,
} from '../../services/otp.service.js';
import { isValidPhone, msg91ConfigStatus } from '../../services/msg91.service.js';
import { emailConfigStatus } from '../../services/email.service.js';
import {
    verifyIdToken, buildAuthUrl, exchangeCode, signState, verifyState, googleConfigStatus,
} from '../../services/googleAuth.service.js';
import {
    signVerification, verifyVerification, verifyRefresh, signAccess, signRefresh,
} from '../../utils/tokens.js';
import { User } from '../../models/index.js';
import {
    ROLES,
    findAccountFor,
    identifierTaken,
    assertCanAuthenticate,
    requiredPoliciesFor,
    outstandingPoliciesFor,
    recordPolicyAcceptances,
    assertPoliciesAccepted,
    createAccount,
    linkIdentity,
    buildSession,
    resolveNextStep,
    userView,
} from './auth.service.js';
import { policySummary, POLICY_BY_SLUG } from '../policies/policyCatalog.js';

/**
 * Authentication.
 *
 * The shape of this module is the point of the rebuild, so it is worth stating
 * plainly. Verification and account identity are separate steps:
 *
 *     verify an identity  ──►  verificationToken  ──►  /login   (role from DB)
 *                                                 └──►  /signup  (role + policies)
 *
 * The token proves "this server watched this identity get verified a moment
 * ago". It carries no role and no user id. Login therefore *cannot* be told a
 * role — it looks the account up and reads the stored one. Signup takes a role
 * because it is creating the account, and refuses to finish until the policies
 * required for that role have been accepted.
 *
 * The previous implementation took `role` on every verify call and did
 * find-or-create in one step, which meant a login request could create an
 * account, and the role on a returning user's session came from whatever the
 * login form happened to have selected.
 */

/* ─────────────────────────────── error mapping ─────────────────────────────── */

/** OTP failures, as things a person can act on. */
function otpFailure(result) {
    switch (result.reason) {
        case 'expired':
            return new ApiError(401, 'OTP_EXPIRED', 'That code has expired. Request a new one.');
        case 'too_many_attempts':
            return new ApiError(429, 'OTP_TOO_MANY_ATTEMPTS',
                'Too many incorrect codes. Try again in a few minutes.',
                { retryAfterSeconds: result.retryAfterSeconds });
        case 'locked':
            return new ApiError(429, 'OTP_LOCKED',
                'Verification is temporarily locked for this number. Try again later.',
                { retryAfterSeconds: result.retryAfterSeconds });
        case 'not_found':
            return new ApiError(401, 'OTP_NOT_FOUND', 'No code is waiting to be verified. Request a new one.');
        default:
            return new ApiError(401, 'OTP_INVALID', 'That code is not correct.',
                { attemptsRemaining: result.attemptsRemaining });
    }
}

/** Send-side throttling, as things a person can act on. */
function sendFailure(err) {
    if (!(err instanceof OtpThrottle)) return err;
    if (err.invalidIdentifier)
        return new ApiError(400, err.reason === 'invalid_email' ? 'INVALID_EMAIL' : 'INVALID_PHONE', err.message);
    if (err.reason === 'cooldown')
        return new ApiError(429, 'OTP_COOLDOWN', err.message, { retryAfterSeconds: err.retryAfterSeconds });
    if (err.reason === 'too_many_resends')
        return new ApiError(429, 'OTP_TOO_MANY_RESENDS', err.message, { retryAfterSeconds: err.retryAfterSeconds });
    return new ApiError(429, 'OTP_LOCKED', err.message, { retryAfterSeconds: err.retryAfterSeconds });
}

function readVerification(token) {
    try {
        return verifyVerification(token);
    } catch {
        throw new ApiError(401, 'VERIFICATION_EXPIRED',
            'Your verification has expired. Please verify again.');
    }
}

/* ──────────────────────────── step 1: send a code ──────────────────────────── */

const purpose = z.enum(['signup', 'login']).default('login');

export const sendPhoneOtpSchema = z.object({
    phone: z.string().min(6).max(20),
    purpose,
});

/**
 * WhatsApp OTP via MSG91. `purpose` shapes the copy the client shows; it does
 * not decide anything, because whether an account exists is a database question.
 * The answer is returned so the UI can say "welcome back" or "let's get you set
 * up" on the very next screen instead of after verification.
 */
export const requestPhoneOtp = catchAsync(async (req, res) => {
    const { phone } = req.body;
    if (!isValidPhone(phone)) throw new ApiError(400, 'INVALID_PHONE', 'Enter a valid mobile number.');

    let result;
    try {
        result = await sendPhoneOtp(phone, req.body.purpose);
    } catch (err) { throw sendFailure(err); }

    const identifier = normaliseIdentifier('phone', phone);
    ok(res, {
        channel: 'phone',
        sentTo: maskPhone(identifier),
        accountExists: await identifierTaken('phone', identifier),
        expiresInSeconds: result.expiresInSeconds,
        resendAvailableInSeconds: result.resendAvailableInSeconds,
        ...(result.devCode ? { devCode: result.devCode } : {}),
    });
});

export const sendEmailOtpSchema = z.object({
    email: z.string().min(3).max(200),
    purpose,
});

export const requestEmailOtp = catchAsync(async (req, res) => {
    const { email } = req.body;
    if (!isValidEmail(email)) throw new ApiError(400, 'INVALID_EMAIL', 'Enter a valid email address.');

    let result;
    try {
        result = await sendEmailOtp(email, req.body.purpose);
    } catch (err) { throw sendFailure(err); }

    const identifier = normaliseIdentifier('email', email);
    ok(res, {
        channel: 'email',
        sentTo: maskEmail(identifier),
        accountExists: await identifierTaken('email', identifier),
        expiresInSeconds: result.expiresInSeconds,
        resendAvailableInSeconds: result.resendAvailableInSeconds,
        ...(result.devCode ? { devCode: result.devCode } : {}),
    });
});

/* ─────────────────────── step 2: verify → verification token ────────────────── */

export const verifyOtpSchema = z.object({
    channel: z.enum(['phone', 'email']),
    identifier: z.string().min(3).max(200),
    code: z.string().min(4).max(8),
});

/**
 * Verify a code and hand back a verification token.
 *
 * Note what is *not* here: no role, no account creation, no session. This
 * endpoint answers exactly one question — was this identity verified — and
 * reports whether an account already exists so the client knows whether to go on
 * to /login or /signup.
 */
export const verifyOtp = catchAsync(async (req, res) => {
    const { channel, identifier, code } = req.body;

    const result = await verifyChannelOtp(channel, identifier, code);
    if (!result.ok) throw otpFailure(result);

    const normalised = normaliseIdentifier(channel, identifier);
    const account = await findAccountFor({ channel, identifier: normalised });

    ok(res, {
        verificationToken: signVerification({ channel, identifier: normalised }),
        accountExists: Boolean(account),
        // The role is deliberately *not* returned for a non-existent account.
        // For an existing one it is a convenience for the UI's copy only; the
        // session that follows re-reads it from the database.
        role: account?.role ?? null,
        authProviders: account?.authProviders ?? [],
    });
});

/* ──────────────────────────────── Google ───────────────────────────────────── */

export const googleIdTokenSchema = z.object({ idToken: z.string().min(20) });

/** Google Identity Services in the browser: an id_token, verified server-side. */
export const googleVerify = catchAsync(async (req, res) => {
    const identity = await verifyIdToken(req.body.idToken);
    const account = await findAccountFor({
        channel: 'google', identifier: identity.email, googleId: identity.googleId,
    });

    ok(res, {
        verificationToken: signVerification({
            channel: 'google',
            identifier: identity.email,
            provider: 'google',
            googleId: identity.googleId,
            name: identity.name,
        }),
        accountExists: Boolean(account),
        role: account?.role ?? null,
        email: identity.email,
        name: identity.name,
    });
});

/**
 * Redirect flow. `intent` and `role` ride in a signed `state` so the callback
 * knows which flow it is completing without trusting a query parameter, and so a
 * replayed callback cannot be steered into a different one.
 */
export const googleStart = catchAsync(async (req, res) => {
    const intent = req.query.intent === 'signup' ? 'signup' : 'login';
    const role = ROLES.includes(req.query.role) ? req.query.role : null;
    res.redirect(buildAuthUrl(signState({ intent, role })));
});

/**
 * Google returns here. The result is handed to the frontend as a short-lived
 * verification token in the URL fragment — a fragment, not a query string, so it
 * never reaches the server logs or a Referer header of any page the user visits
 * next.
 */
export const googleCallback = catchAsync(async (req, res) => {
    const back = (params) => res.redirect(`${env.clientUrl}/auth/google/callback#${new URLSearchParams(params)}`);

    if (req.query.error) return back({ error: 'GOOGLE_CANCELLED' });
    if (!req.query.code) return back({ error: 'GOOGLE_NO_CODE' });

    let state;
    try {
        state = verifyState(req.query.state);
    } catch {
        return back({ error: 'GOOGLE_STATE_INVALID' });
    }

    let identity;
    try {
        identity = await exchangeCode(req.query.code);
    } catch (err) {
        return back({ error: err?.code ?? 'GOOGLE_FAILED', message: err?.message ?? '' });
    }

    const account = await findAccountFor({
        channel: 'google', identifier: identity.email, googleId: identity.googleId,
    });

    return back({
        verificationToken: signVerification({
            channel: 'google',
            identifier: identity.email,
            provider: 'google',
            googleId: identity.googleId,
            name: identity.name,
        }),
        accountExists: String(Boolean(account)),
        intent: state.intent,
        ...(state.role ? { role: state.role } : {}),
        email: identity.email,
        ...(identity.name ? { name: identity.name } : {}),
    });
});

/* ─────────────────────────────── step 3a: login ────────────────────────────── */

/**
 * `.strict()` matters here.
 *
 * Zod strips unknown keys by default, so without it a client could POST
 * `{ verificationToken, role: 'brand' }`, the role would be silently discarded,
 * and the client would have no way to know its intent was ignored. Strict turns
 * that into a 400: the request is refused outright, which is a much clearer
 * contract than "we quietly did something else". Either way no role can be
 * honoured — this makes the refusal visible rather than implicit.
 */
export const loginSchema = z.object({
    verificationToken: z.string().min(20),
}).strict();

/**
 * Log in with a verified identity.
 *
 * There is no `role` field on this request, and there is nowhere for one to be
 * accepted. The account is found, its enforcement state checked, its stored role
 * read, and the session is issued with a server-computed destination.
 */
export const login = catchAsync(async (req, res) => {
    const verification = readVerification(req.body.verificationToken);
    const user = await findAccountFor(verification);

    if (!user) {
        throw new ApiError(404, 'ACCOUNT_NOT_FOUND',
            'We could not find an account for that. Create one to get started.',
            { channel: verification.channel, identifier: verification.identifier });
    }

    assertCanAuthenticate(user);

    // A returning user who signed up by phone and is now signing in with Google
    // gets the identity linked, which is how an account reaches the mobile+email
    // verification Policy 13.1 requires.
    await linkIdentity(user, verification);

    ok(res, await buildSession(user));
});

/* ────────────────────────────── step 3b: signup ────────────────────────────── */

export const signupRequirementsSchema = z.object({});

/**
 * What a given role has to accept, before the user has committed to anything.
 * The signup form renders exactly this list — so the Creator Policy is shown to
 * creators, the Brand Policy to brands, and neither to the other, because both
 * the form and the gate below read the same source.
 */
export const signupRequirements = catchAsync(async (req, res) => {
    const role = req.query.role;
    if (!ROLES.includes(role))
        throw ApiError.badRequest('role must be "creator" or "brand"');

    const required = await requiredPoliciesFor(role);
    ok(res, {
        role,
        policies: required.map((p) => {
            const doc = POLICY_BY_SLUG.get(p.slug);
            return { ...(doc ? policySummary(doc) : {}), ...p };
        }),
        primary: required.filter((p) => p.signupPrimary).map((p) => p.slug),
        minimumAge: 18,
    });
});

export const signupSchema = z.object({
    verificationToken: z.string().min(20),
    role: z.enum(['creator', 'brand']),
    /** Policy 1.3 — 18+ is a condition of eligibility, declared here. */
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter your date of birth'),
    ageDeclared18Plus: z.literal(true, {
        errorMap: () => ({ message: 'You must confirm you are 18 or over.' }),
    }),
    /** Policy 24 — the exact policy set the user was shown and accepted. */
    acceptedPolicies: z.array(z.string()).min(1),
    profile: z.object({
        displayName: z.string().max(120).optional(),
        companyName: z.string().max(120).optional(),
        website: z.string().max(200).optional(),
        industry: z.string().max(80).optional(),
        city: z.string().max(80).optional(),
        categories: z.array(z.string().max(40)).max(8).optional(),
    }).strict().optional(),
}).strict();

/**
 * Create the account.
 *
 * The order matters and is enforced, not merely intended:
 *   1. the identity must be verified (verification token),
 *   2. the user must be 18 or over (Policy 1.3),
 *   3. the policies required *for that role* must have been accepted (Policy 24),
 *   4. only then does the account exist,
 *   5. and the acceptance rows are written immediately, against the versions the
 *      server resolved — not the versions the client claimed.
 *
 * If step 5 fails the account is removed again, because an account that exists
 * with no consent record is precisely the state Policy 24 is meant to prevent.
 */
export const signup = catchAsync(async (req, res) => {
    const verification = readVerification(req.body.verificationToken);
    const { role, dob, acceptedPolicies, profile } = req.body;

    const existing = await findAccountFor(verification);
    if (existing) {
        throw new ApiError(409,
            verification.channel === 'phone' ? 'PHONE_ALREADY_REGISTERED' : 'EMAIL_ALREADY_REGISTERED',
            'You already have a Marqueiver account. Log in instead.',
            { role: existing.role });
    }

    if (!isAdult(dob))
        throw new ApiError(422, 'UNDER_18', 'Marqueiver is only available to people aged 18 or over.');

    await assertPoliciesAccepted(role, acceptedPolicies);

    const user = await createAccount({
        verification, role, dob, ageDeclared18Plus: true, profile,
    });

    try {
        await recordPolicyAcceptances(user._id, role, {
            context: 'registration',
            ip: req.ip,
            userAgent: req.get('user-agent'),
        });
    } catch (err) {
        await User.deleteOne({ _id: user._id });
        throw err;
    }

    created(res, await buildSession(user));
});

function isAdult(dob) {
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return false;
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    return d <= cutoff;
}

/* ─────────────────── linking a second identity to a session ─────────────────── */

export const linkSchema = z.object({ verificationToken: z.string().min(20) });

/**
 * Attach a verified email to a phone-registered account, or vice versa. This is
 * how a user satisfies Policy 13.1's mobile-and-email requirement after signing
 * up through a single channel.
 */
export const linkVerifiedIdentity = catchAsync(async (req, res) => {
    const verification = readVerification(req.body.verificationToken);

    const owner = await findAccountFor(verification);
    if (owner && String(owner._id) !== String(req.auth.sub))
        throw new ApiError(409,
            verification.channel === 'phone' ? 'PHONE_ALREADY_REGISTERED' : 'EMAIL_ALREADY_REGISTERED',
            'That is already linked to a different Marqueiver account.');

    const user = await User.findById(req.auth.sub);
    if (!user) throw ApiError.unauthorized();

    await linkIdentity(user, verification);
    ok(res, { user: userView(user), next: await resolveNextStep(user) });
});

/* ──────────────────────── policy acceptance for a session ──────────────────── */

export const acceptPoliciesSchema = z.object({
    acceptedPolicies: z.array(z.string()).min(1),
    context: z.string().max(64).optional(),
});

/**
 * Accept the policies outstanding for the signed-in account — the 1.14
 * re-consent path when a new version is published after registration.
 */
export const acceptOutstandingPolicies = catchAsync(async (req, res) => {
    const user = await User.findById(req.auth.sub);
    if (!user) throw ApiError.unauthorized();

    await assertPoliciesAccepted(user.role, req.body.acceptedPolicies);
    const accepted = await recordPolicyAcceptances(user._id, user.role, {
        context: req.body.context ?? 're-consent',
        ip: req.ip,
        userAgent: req.get('user-agent'),
    });

    ok(res, { accepted, next: await resolveNextStep(user) });
});

/* ──────────────────────────────── session ──────────────────────────────────── */

export const refreshSchema = z.object({ refreshToken: z.string() });

export const refresh = catchAsync(async (req, res) => {
    let sub;
    try {
        ({ sub } = verifyRefresh(req.body.refreshToken));
    } catch {
        throw ApiError.unauthorized('Your session has expired. Please sign in again.');
    }

    const user = await User.findById(sub);
    if (!user) throw ApiError.unauthorized('Your session has expired. Please sign in again.');
    assertCanAuthenticate(user);

    // Re-read the role rather than carrying it over from the old token, so a
    // role or enforcement change takes effect on the next refresh.
    ok(res, {
        accessToken: signAccess({ sub: user.id, role: user.role, adminLevel: user.adminLevel }),
        refreshToken: signRefresh(user.id),
        user: userView(user),
        next: await resolveNextStep(user),
    });
});

/**
 * The authoritative answer to "who am I and where do I belong". The frontend
 * routes on this rather than on anything it has stored locally.
 */
export const me = catchAsync(async (req, res) => {
    const user = await User.findById(req.auth.sub);
    if (!user) throw ApiError.notFound();

    ok(res, {
        user: userView(user),
        next: await resolveNextStep(user),
        outstandingPolicies: await outstandingPoliciesFor(user._id, user.role),
    });
});

/**
 * Which sign-in methods this deployment can actually offer, and — for an
 * operator — which credentials are missing from the ones it cannot.
 *
 * `missing` is a list of environment variable *names*, never values, so this
 * stays safe to serve publicly: it says "MSG91_AUTH_KEY is unset", which any
 * operator can already see, and never what it would have been set to.
 *
 * This is also the answer to "is this server actually using real providers?" —
 * `integrationMode: "live"` with all three `configured: true` is the only state
 * in which real messages are sent, and it is checkable from the browser without
 * reading a log.
 */
export const authConfig = catchAsync(async (_req, res) => {
    const msg91 = msg91ConfigStatus();
    const google = googleConfigStatus();
    const email = emailConfigStatus();
    const live = env.integrationMode === 'live';

    ok(res, {
        integrationMode: env.integrationMode,
        live,
        methods: {
            email: {
                enabled: !live || (email.configured && email.supported),
                provider: email.provider,
                configured: email.configured,
                ...(live && !email.configured ? { missing: email.missing } : {}),
                // The single most common reason a real OTP email never arrives.
                ...(live && email.sandboxSender ? { warning: 'EMAIL_FROM_IS_RESEND_SANDBOX' } : {}),
            },
            phone: {
                enabled: !live || msg91.configured,
                channel: 'whatsapp',
                provider: 'msg91',
                configured: msg91.configured,
                ...(live && !msg91.configured ? { missing: msg91.missing } : {}),
            },
            google: {
                enabled: !live || google.configured,
                clientId: env.googleAuth.clientId || null,
                configured: google.configured,
                ...(live && !google.configured ? { missing: google.missing } : {}),
            },
        },
        otp: {
            length: env.otp.length,
            expiresInSeconds: env.otp.ttlSeconds,
            resendCooldownSeconds: env.otp.resendCooldownSeconds,
            maxAttempts: env.otp.maxAttempts,
        },
    });
});

/* ─────────────────────────────────── helpers ───────────────────────────────── */

function maskPhone(phone) {
    if (!phone) return '';
    return phone.replace(/\d(?=\d{3})/g, '•');
}

function maskEmail(email) {
    const [name, domain] = String(email).split('@');
    if (!domain) return email;
    const head = name.slice(0, Math.min(2, name.length));
    return `${head}${'•'.repeat(Math.max(1, name.length - head.length))}@${domain}`;
}

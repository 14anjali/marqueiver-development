import { z } from 'zod';
import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok, created } from '../../utils/respond.js';
import { sendOtp, sendEmailOtp, verifyOtp, verifyChannelOtp } from '../../services/otp.service.js';
import { signAccess, signRefresh, verifyRefresh } from '../../utils/tokens.js';
import { User, CreatorProfile, BrandProfile } from '../../models/index.js';
export const requestOtpSchema = z.object({
    phone: z.string().min(8).max(20),
    purpose: z.enum(['signup', 'login']).default('login'),
});
export const verifyOtpSchema = z.object({
    phone: z.string().min(8).max(20),
    code: z.string().min(4).max(8),
    role: z.enum(['creator', 'brand']).optional(), // required on signup
});
export const requestOtp = catchAsync(async (req, res) => {
    const { phone, purpose } = req.body;
    const result = await sendOtp(phone, purpose);
    ok(res, { sent: true, ...(result.devCode ? { devCode: result.devCode } : {}) });
});
export const verifyOtpAndAuth = catchAsync(async (req, res) => {
    const { phone, code, role } = req.body;
    const valid = await verifyOtp(phone, code);
    if (!valid)
        throw ApiError.unauthorized('Invalid or expired OTP');
    const { user, isNew } = await findOrCreateUser({ by: 'phone', phone, role, markVerified: 'phone' });
    const tokens = issueTokens(user.id, user.role, user.adminLevel);
    const payload = {
        user: userView(user),
        ...tokens,
        isNew,
    };
    isNew ? created(res, payload) : ok(res, payload);
});

/* ─────────────────────────────────────────────────────────────────────────
 * Email OTP (SRS FR-7) + SRS §5 endpoint aliases.
 *
 * The SRS standardises endpoint names as /auth/send-phone-otp,
 * /auth/verify-phone-otp, /auth/send-email-otp, /auth/verify-email-otp. These
 * handlers implement those names; the existing /auth/otp/request + /auth/otp/verify
 * remain as-is for backward compatibility with the current frontend.
 * ──────────────────────────────────────────────────────────────────────── */

export const sendPhoneOtpSchema = z.object({
    phone: z.string().min(8).max(20),
    purpose: z.enum(['signup', 'login']).default('login'),
});
export const sendPhoneOtp = catchAsync(async (req, res) => {
    const { phone, purpose } = req.body;
    const result = await sendOtp(phone, purpose);
    ok(res, { sent: true, channel: 'phone', ...(result.devCode ? { devCode: result.devCode } : {}) });
});

export const verifyPhoneOtpSchema = z.object({
    phone: z.string().min(8).max(20),
    code: z.string().min(4).max(8),
    role: z.enum(['creator', 'brand']).optional(),
});
export const verifyPhoneOtp = catchAsync(async (req, res) => {
    const { phone, code, role } = req.body;
    const result = await verifyChannelOtp('phone', phone, code);
    if (!result.ok) throw otpError(result.reason);
    const { user, isNew } = await findOrCreateUser({ by: 'phone', phone, role, markVerified: 'phone' });
    const payload = { user: userView(user), ...issueTokens(user.id, user.role, user.adminLevel), isNew };
    isNew ? created(res, payload) : ok(res, payload);
});

export const sendEmailOtpSchema = z.object({
    email: z.string().email(),
    purpose: z.enum(['signup', 'login']).default('login'),
});
export const sendEmailOtpHandler = catchAsync(async (req, res) => {
    const { email, purpose } = req.body;
    const result = await sendEmailOtp(email, purpose);
    ok(res, { sent: true, channel: 'email', ...(result.devCode ? { devCode: result.devCode } : {}) });
});

export const verifyEmailOtpSchema = z.object({
    email: z.string().email(),
    code: z.string().min(4).max(8),
    role: z.enum(['creator', 'brand']).optional(),
});
export const verifyEmailOtp = catchAsync(async (req, res) => {
    const { email, code, role } = req.body;
    const result = await verifyChannelOtp('email', email, code);
    if (!result.ok) throw otpError(result.reason);
    const { user, isNew } = await findOrCreateUser({ by: 'email', email, role, markVerified: 'email' });
    const payload = { user: userView(user), ...issueTokens(user.id, user.role, user.adminLevel), isNew };
    isNew ? created(res, payload) : ok(res, payload);
});

/** Map an OTP failure reason to a clear API error (SRS §8 edge cases). */
function otpError(reason) {
    switch (reason) {
        case 'expired': return ApiError.unauthorized('OTP has expired — request a new one');
        case 'too_many_attempts': return new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts — request a new code');
        case 'not_found': return ApiError.unauthorized('No active OTP — request a new one');
        default: return ApiError.unauthorized('Invalid OTP');
    }
}

/**
 * Find-or-create a user by phone or email and ensure the matching profile exists.
 * Handles SRS FR-1.6/1.7 (existing → dashboard, new → onboarding) via the isNew
 * flag and onboardingComplete, and §8 duplicate-account detection.
 */
async function findOrCreateUser({ by, phone, email, role, markVerified }) {
    let user = by === 'phone' ? await User.findOne({ phone }) : await User.findOne({ email });
    let isNew = false;
    if (!user) {
        if (!role) throw ApiError.badRequest('role is required for signup');
        const doc = by === 'phone'
            ? { phone, role, phoneVerified: true }
            : { phone: `e_${email}`, email, role, emailVerified: true };
        user = await User.create(doc);
        isNew = true;
        if (role === 'creator') await CreatorProfile.create({ user: user._id, displayName: (email || phone || 'Creator').split('@')[0] });
        else await BrandProfile.create({ user: user._id, companyName: (email || phone || 'Brand').split('@')[0] });
    } else {
        if (markVerified === 'phone' && !user.phoneVerified) { user.phoneVerified = true; await user.save(); }
        if (markVerified === 'email' && !user.emailVerified) { user.emailVerified = true; await user.save(); }
    }
    return { user, isNew };
}

function userView(user) {
    return {
        id: user.id,
        phone: user.phone,
        email: user.email,
        role: user.role,
        adminLevel: user.adminLevel,
        onboardingComplete: user.onboardingComplete,
        onboardingStep: user.onboardingStep || '',
    };
}
/** Google OAuth stub — verifies an id_token in live mode; mock trusts the email. */
export const googleAuthSchema = z.object({
    email: z.string().email(),
    googleId: z.string(),
    role: z.enum(['creator', 'brand']).optional(),
});
export const googleAuth = catchAsync(async (req, res) => {
    const { email, googleId, role } = req.body;
    let user = await User.findOne({ $or: [{ googleId }, { email }] });
    if (!user) {
        if (!role)
            throw ApiError.badRequest('role is required for signup');
        // Google-first users still need a phone later; placeholder until provided.
        user = await User.create({
            phone: `g_${googleId}`, email, googleId, role,
            emailVerified: true,
        });
        if (role === 'creator')
            await CreatorProfile.create({ user: user._id, displayName: email.split('@')[0] });
        else
            await BrandProfile.create({ user: user._id, companyName: email.split('@')[0] });
    }
    ok(res, { user: { id: user.id, role: user.role }, ...issueTokens(user.id, user.role, user.adminLevel) });
});
export const refreshSchema = z.object({ refreshToken: z.string() });
export const refresh = catchAsync(async (req, res) => {
    const { refreshToken } = req.body;
    try {
        const { sub } = verifyRefresh(refreshToken);
        const user = await User.findById(sub).select('role adminLevel status').lean();
        if (!user || user.status === 'suspended')
            throw ApiError.unauthorized();
        ok(res, issueTokens(sub, user.role, user.adminLevel));
    }
    catch {
        throw ApiError.unauthorized('Invalid refresh token');
    }
});
export const me = catchAsync(async (req, res) => {
    const user = await User.findById(req.auth.sub).lean();
    if (!user)
        throw ApiError.notFound();
    ok(res, { id: user._id, phone: user.phone, email: user.email, role: user.role, adminLevel: user.adminLevel,
        onboardingComplete: user.onboardingComplete, onboardingStep: user.onboardingStep || '' });
});
function issueTokens(userId, role, adminLevel) {
    return {
        accessToken: signAccess({ sub: userId, role, adminLevel }),
        refreshToken: signRefresh(userId),
    };
}

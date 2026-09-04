import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import * as c from './auth.controller.js';

const router = Router();

/**
 * Two layers of rate limiting, because they stop different things.
 *
 * Per-identifier limits (attempt caps, resend cooldowns, lockouts) live in
 * otp.service.js and follow the phone number or email around. These IP limits
 * sit in front of them and stop one host enumerating many identifiers — an
 * attacker walking a number range never reaches the per-identifier counters,
 * because each number is only touched once.
 */
const sendLimiter = rateLimit({
    windowMs: 60_000, max: 8, standardHeaders: true, legacyHeaders: false,
    message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment.' } },
});
const verifyLimiter = rateLimit({
    windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false,
    message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a moment.' } },
});
const accountLimiter = rateLimit({
    windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false,
    message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment.' } },
});

/** What this deployment can offer — drives which buttons the client renders. */
router.get('/config', c.authConfig);

/* Step 1 — send a code. WhatsApp via MSG91, or email. No SMS path exists. */
router.post('/otp/whatsapp/send', sendLimiter, validate(c.sendPhoneOtpSchema), c.requestPhoneOtp);
router.post('/otp/email/send', sendLimiter, validate(c.sendEmailOtpSchema), c.requestEmailOtp);

/**
 * Resending is the same operation as sending — a new code, a fresh expiry, a
 * reset attempt counter — with the cooldown and resend cap applied in the
 * service. Giving it its own path only so the client can be explicit.
 */
router.post('/otp/whatsapp/resend', sendLimiter, validate(c.sendPhoneOtpSchema), c.requestPhoneOtp);
router.post('/otp/email/resend', sendLimiter, validate(c.sendEmailOtpSchema), c.requestEmailOtp);

/* Step 2 — verify. Returns a verification token; never a session, never a role. */
router.post('/otp/verify', verifyLimiter, validate(c.verifyOtpSchema), c.verifyOtp);

/* Google — id_token from the browser SDK, or the full redirect flow. */
router.post('/google/verify', verifyLimiter, validate(c.googleIdTokenSchema), c.googleVerify);
router.get('/google/start', c.googleStart);
router.get('/google/callback', c.googleCallback);

/* Step 3 — become a session. */
router.get('/signup/requirements', c.signupRequirements);
router.post('/signup', accountLimiter, validate(c.signupSchema), c.signup);
router.post('/login', accountLimiter, validate(c.loginSchema), c.login);

/* Session maintenance and post-registration compliance. */
router.post('/refresh', validate(c.refreshSchema), c.refresh);
router.get('/me', authenticate, c.me);
router.post('/link', authenticate, validate(c.linkSchema), c.linkVerifiedIdentity);
router.post('/policies/accept', authenticate, validate(c.acceptPoliciesSchema), c.acceptOutstandingPolicies);

export default router;

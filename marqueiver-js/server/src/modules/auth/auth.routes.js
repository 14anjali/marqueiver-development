import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import * as c from './auth.controller.js';
const router = Router();
// OTP endpoints are the abuse-prone surface — rate limit hard (proposal §4 rate limiting).
const otpLimiter = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });
router.post('/otp/request', otpLimiter, validate(c.requestOtpSchema), c.requestOtp);
router.post('/otp/verify', otpLimiter, validate(c.verifyOtpSchema), c.verifyOtpAndAuth);
// SRS §5 endpoint names (phone + email OTP). Existing /otp/* kept for compatibility.
router.post('/send-phone-otp', otpLimiter, validate(c.sendPhoneOtpSchema), c.sendPhoneOtp);
router.post('/verify-phone-otp', otpLimiter, validate(c.verifyPhoneOtpSchema), c.verifyPhoneOtp);
router.post('/send-email-otp', otpLimiter, validate(c.sendEmailOtpSchema), c.sendEmailOtpHandler);
router.post('/verify-email-otp', otpLimiter, validate(c.verifyEmailOtpSchema), c.verifyEmailOtp);
router.post('/google', validate(c.googleAuthSchema), c.googleAuth);
router.post('/refresh', validate(c.refreshSchema), c.refresh);
router.get('/me', authenticate, c.me);
export default router;

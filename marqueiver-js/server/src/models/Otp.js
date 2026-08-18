import { Schema, model } from 'mongoose';

/**
 * Short-lived OTP store (TTL-indexed). Backs both phone and email verification
 * (SRS FR-6, FR-7). A record is keyed by (channel, identifier) so a user can have
 * a phone OTP and an email OTP in flight independently.
 *
 * SRS §7.1: OTPs expire 5 minutes after generation (expiresAt, enforced by the
 * TTL index below) and are rate-limited at the route layer.
 */
const otpSchema = new Schema({
    // channel + identifier replace the old phone-only key (back-compatible: phone kept)
    channel: { type: String, enum: ['phone', 'email'], default: 'phone', index: true },
    identifier: { type: String, index: true }, // phone number or email address
    phone: { type: String, index: true },       // retained for backward compatibility
    codeHash: { type: String, required: true },
    purpose: { type: String, enum: ['signup', 'login'], default: 'login' },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
});
// one active OTP per (channel, identifier)
otpSchema.index({ channel: 1, identifier: 1 }, { unique: true, sparse: true });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Otp = model('Otp', otpSchema);

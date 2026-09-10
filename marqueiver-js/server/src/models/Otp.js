import { Schema, model } from 'mongoose';

/**
 * Short-lived verification challenge, keyed by (channel, identifier) so a phone
 * OTP and an email OTP can be in flight for the same person independently.
 *
 * The record carries the whole lifecycle, not just the code, because every one
 * of these is a state the user can reach and must be told about clearly: expiry,
 * a cap on guesses, a cooldown between resends, a cap on resends, and a lockout
 * once the caps are exhausted. Enforcing them here rather than only at the route
 * means they hold per identifier — a rate limit keyed on IP alone lets one
 * attacker rotate addresses, and punishes everyone behind a shared NAT.
 *
 * `expiresAt` has a TTL index, but expiry is *also* checked in code: TTL
 * deletion runs on a background sweep roughly once a minute, so a row can
 * outlive its expiry and must never be accepted in that window.
 */
const otpSchema = new Schema({
    channel: { type: String, enum: ['phone', 'email'], required: true, index: true },
    /** E.164 phone or lowercased email. */
    identifier: { type: String, required: true, index: true },
    /** Retained so records written by the previous phone-only service still read. */
    phone: { type: String, index: true },

    codeHash: { type: String, required: true },
    purpose: { type: String, enum: ['signup', 'login', 'verify'], default: 'login' },

    expiresAt: { type: Date, required: true },

    /** Guesses against the current code. Reset when a new code is issued. */
    attempts: { type: Number, default: 0 },
    /** Codes issued in this challenge, including the first. */
    sendCount: { type: Number, default: 1 },
    lastSentAt: { type: Date, default: Date.now },

    /**
     * Set when the attempt or resend cap is hit. Held separately from
     * `expiresAt` so a lockout survives the code expiring — otherwise waiting
     * five minutes would clear the lockout and the cap would mean nothing.
     */
    lockedUntil: Date,

    /** Delivery reference from the provider, for support and log correlation. */
    providerRequestId: String,
}, { timestamps: true });

otpSchema.index({ channel: 1, identifier: 1 }, { unique: true });

/**
 * TTL reaper with a long grace window rather than `expireAfterSeconds: 0`, so a
 * locked-out record is not deleted — and the lockout defeated — the moment its
 * code expires.
 */
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

/**
 * A challenge with no expiry is not "valid forever" — it is a broken record, and
 * the safe reading of a broken record is that it has expired. The `expiresAt`
 * guard is defence in depth: `persist()` cannot write a row without one any more
 * (it is required, and the write now runs validators), but treating a missing
 * expiry as *not expired* would be the dangerous direction to fail in, so this
 * fails the other way.
 *
 * `new Date(...)` rather than `.getTime()` directly, so a record written by an
 * older build that stored a string still compares correctly instead of throwing.
 */
otpSchema.methods.isExpired = function isExpired(now = Date.now()) {
    if (!this.expiresAt) return true;
    const at = new Date(this.expiresAt).getTime();
    if (Number.isNaN(at)) return true;
    return at <= now;
};

otpSchema.methods.isLocked = function isLocked(now = Date.now()) {
    return Boolean(this.lockedUntil && this.lockedUntil.getTime() > now);
};

export const Otp = model('Otp', otpSchema);

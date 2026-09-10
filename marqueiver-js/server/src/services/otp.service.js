import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { sendEmail } from './email.service.js';
import {
    sendWhatsAppOtp,
    verifyWhatsAppOtpWithProvider,
    normalisePhone,
    toE164,
    isValidPhone,
} from './msg91.service.js';
import { Otp } from '../models/index.js';

/**
 * One-time codes for phone (WhatsApp, via MSG91) and email.
 *
 * What changed and why: the previous implementation routed phone OTP through
 * Twilio Verify over **SMS**, and in live mode delegated the whole lifecycle to
 * Twilio — which meant expiry, attempt caps and resend limits existed only in
 * mock mode, and the code path a real user hit was not the one the tests
 * covered. Both are fixed here. Delivery is WhatsApp-only through MSG91, and the
 * lifecycle is enforced in this service identically in mock and live mode.
 *
 * Every failure is a named reason, never a bare false, because "wrong code",
 * "expired", "too many attempts" and "locked out" need different things from the
 * user and the UI has to be able to tell them apart.
 */

/** @typedef {'invalid'|'expired'|'not_found'|'too_many_attempts'|'locked'} OtpFailure */

const now = () => Date.now();

/**
 * The one place that decides whether this process is handling real users.
 *
 * Every decision that could leak a verification code — returning it to the
 * client as `devCode`, printing it to the log, using a fixed code instead of a
 * random one — reads *this* and nothing else. Previously those decisions each
 * consulted a different combination of `integrationMode` and the per-provider
 * setting, so `INTEGRATION_MODE=live` with `EMAIL_PROVIDER=mock` would still log
 * a live user's code and hand it back over the API. There is now no combination
 * of settings that can do that: live is live.
 */
export const isLiveMode = () => env.integrationMode === 'live';

/**
 * Mock mode uses a fixed code so the flow can be walked without a phone or an
 * inbox. Live mode uses a cryptographically random one — `randomInt` rather than
 * `Math.random`, because a predictable verification code is not a verification.
 */
function generateCode() {
    if (!isLiveMode()) return '123456789012'.slice(0, env.otp.length);
    const max = 10 ** env.otp.length;
    return String(crypto.randomInt(0, max)).padStart(env.otp.length, '0');
}

/**
 * The dev code, or nothing at all in live mode. Returned by both send paths so
 * neither can decide this for itself.
 */
const devCodeFor = (code) => (isLiveMode() ? {} : { devCode: code });

export function normaliseIdentifier(channel, value) {
    if (channel === 'phone') return toE164(value);
    return String(value ?? '').trim().toLowerCase();
}

/** Shape returned to callers when a send is refused. */
class OtpThrottle extends Error {
    constructor(reason, retryAfterSeconds, message) {
        super(message);
        this.reason = reason;
        this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
    }
}
export { OtpThrottle };

/**
 * Decide whether a new code may be issued for this challenge.
 *
 * Three distinct refusals, because they mean different things:
 *  - `locked`   — the caps were exhausted; waiting is the only remedy.
 *  - `cooldown` — a code was just sent; resending immediately is almost always
 *                 an impatient user rather than an attacker, so the wait is short.
 *  - `too_many_resends` — the resend cap for this challenge is spent.
 */
function assertCanSend(rec) {
    if (!rec) return;
    const t = now();

    if (rec.isLocked(t)) {
        throw new OtpThrottle('locked', (rec.lockedUntil.getTime() - t) / 1000,
            'Too many attempts. Try again later.');
    }

    const sinceLast = (t - new Date(rec.lastSentAt ?? 0).getTime()) / 1000;
    if (sinceLast < env.otp.resendCooldownSeconds && !rec.isExpired(t)) {
        throw new OtpThrottle('cooldown', env.otp.resendCooldownSeconds - sinceLast,
            `Please wait ${Math.ceil(env.otp.resendCooldownSeconds - sinceLast)}s before requesting another code.`);
    }

    if (!rec.isExpired(t) && rec.sendCount >= env.otp.maxResends + 1) {
        throw new OtpThrottle('too_many_resends', env.otp.lockoutSeconds,
            'You have requested too many codes. Try again later.');
    }
}

/**
 * Write the challenge. A resend against a live challenge increments `sendCount`
 * and resets `attempts` (the guesses were against a code that no longer exists);
 * a send against an expired or absent challenge starts a fresh one.
 */
async function persist(channel, identifier, code, purpose, providerRequestId) {
    const codeHash = await bcrypt.hash(code, 8);
    const expiresAt = new Date(now() + env.otp.ttlSeconds * 1000);

    const existing = await Otp.findOne({ channel, identifier });
    const continuing = existing && !existing.isExpired();

    /**
     * `sendCount` is the only field whose operator differs between a first send
     * and a resend, and it must appear under exactly one operator: `$set` and
     * `$inc` on the same path is a MongoDB conflict error.
     *
     * This is built as one explicit object rather than by spreading a
     * conditional into an object literal. The previous version did the latter:
     *
     *     {
     *       $set: { channel, identifier, codeHash, expiresAt, ... },
     *       ...(continuing ? { $inc: {...} } : { $set: { sendCount: 1 } }),
     *     }
     *
     * A duplicate key in an object literal is not merged — the last one wins.
     * So on a *first* send the spread replaced the whole `$set`, and the update
     * that reached MongoDB was `{ $set: { sendCount: 1 } }`. The upsert then
     * inserted a row with no `codeHash` and no `expiresAt`, the send returned
     * 200, and verification of a perfectly correct code failed. Resends worked,
     * because that branch spreads `$inc` and leaves `$set` intact — which is why
     * the failure looked intermittent rather than total.
     */
    const set = {
        channel,
        identifier,
        ...(channel === 'phone' ? { phone: identifier } : {}),
        codeHash,
        purpose,
        expiresAt,
        attempts: 0,
        lastSentAt: new Date(),
        providerRequestId: providerRequestId ?? null,
    };
    if (!continuing) set.sendCount = 1;

    const update = { $set: set, $unset: { lockedUntil: '' } };
    if (continuing) update.$inc = { sendCount: 1 };

    // `runValidators` is what turns a repeat of the bug above into a loud
    // failure at write time instead of a silent 401 minutes later: `codeHash`
    // and `expiresAt` are required, and an update that omits them now throws
    // here rather than inserting an unusable challenge.
    await Otp.updateOne({ channel, identifier }, update, {
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
    });

    return { expiresAt };
}

/* ────────────────────────────── phone / WhatsApp ───────────────────────────── */

/**
 * Send a WhatsApp OTP. `purpose` is recorded but never used to decide whether an
 * account may be created — that decision belongs to the auth module, which reads
 * the database rather than trusting a request field.
 */
export async function sendPhoneOtp(rawPhone, purpose = 'login') {
    if (!isValidPhone(rawPhone)) {
        const err = new OtpThrottle('invalid_phone', 1, 'Enter a valid mobile number.');
        err.invalidIdentifier = true;
        throw err;
    }
    const identifier = normaliseIdentifier('phone', rawPhone);

    const existing = await Otp.findOne({ channel: 'phone', identifier });
    assertCanSend(existing);

    const code = generateCode();
    // Same ordering rule as email: MSG91 has to accept the message before a
    // challenge exists, so a failed send leaves nothing to be stuck on.
    const delivery = await sendWhatsAppOtp(normalisePhone(identifier), code, { purpose });
    const { expiresAt } = await persist('phone', identifier, code, purpose, delivery.requestId);

    return {
        channel: 'phone',
        identifier,
        expiresAt,
        expiresInSeconds: env.otp.ttlSeconds,
        resendAvailableInSeconds: env.otp.resendCooldownSeconds,
        ...devCodeFor(code),
    };
}

/* ───────────────────────────────── email ──────────────────────────────────── */

export function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value ?? '').trim());
}

export async function sendEmailOtp(rawEmail, purpose = 'login') {
    if (!isValidEmail(rawEmail)) {
        const err = new OtpThrottle('invalid_email', 1, 'Enter a valid email address.');
        err.invalidIdentifier = true;
        throw err;
    }
    const identifier = normaliseIdentifier('email', rawEmail);

    const existing = await Otp.findOne({ channel: 'email', identifier });
    assertCanSend(existing);

    const code = generateCode();

    /**
     * Send first, persist second, deliberately.
     *
     * `sendEmail` throws on a delivery failure, so an email that never left the
     * building leaves no challenge behind either. The alternative ordering
     * produces the worst possible state: a user staring at "check your inbox"
     * with a valid code they will never receive, blocked from resending by the
     * cooldown that the failed attempt started.
     */
    if (isLiveMode()) {
        await sendEmail(identifier, 'Your Marqueiver verification code', emailBody(code));
    } else {
        logger.info(`✉️  [MOCK EMAIL OTP] ${identifier} → ${code} (${purpose})`);
    }

    const { expiresAt } = await persist('email', identifier, code, purpose, null);

    return {
        channel: 'email',
        identifier,
        expiresAt,
        expiresInSeconds: env.otp.ttlSeconds,
        resendAvailableInSeconds: env.otp.resendCooldownSeconds,
        ...devCodeFor(code),
    };
}

function emailBody(code) {
    const minutes = Math.ceil(env.otp.ttlSeconds / 60);
    return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <h1 style="font-size:20px;color:#1B1130;margin:0 0 8px">Verify your email</h1>
      <p style="color:#6B6480;font-size:14px;line-height:1.6;margin:0 0 24px">
        Use this code to continue on Marqueiver. It expires in ${minutes} minutes.
      </p>
      <div style="font-size:32px;letter-spacing:10px;font-weight:700;color:#6D28D9;
                  background:#F5F3FF;border-radius:12px;padding:20px;text-align:center">${code}</div>
      <p style="color:#6B6480;font-size:12px;line-height:1.6;margin:24px 0 0">
        If you did not request this, you can ignore this email. Nobody can access your account with this code alone.
      </p>
    </div>`;
}

/* ──────────────────────────────── verification ─────────────────────────────── */

/**
 * Check a code. Returns `{ ok: true }` or `{ ok: false, reason }` — never throws
 * on a wrong code, because a wrong code is an expected outcome of a working
 * system, not an error condition.
 *
 * A correct code deletes the challenge, so a code cannot be replayed. An
 * incorrect one increments the counter and, at the cap, sets a lockout that
 * outlives the code's own expiry.
 */
export async function verifyChannelOtp(channel, rawIdentifier, code) {
    const identifier = normaliseIdentifier(channel, rawIdentifier);
    if (!identifier) return { ok: false, reason: 'not_found' };

    const rec = await Otp.findOne({ channel, identifier });
    if (!rec) return { ok: false, reason: 'not_found' };

    /**
     * A record with no hash cannot verify anything. This should now be
     * unreachable — `persist()` writes the hash and the write is validated — but
     * a database can still hold rows written by an earlier build, and
     * `bcrypt.compare` against `undefined` throws, which would surface as a 500
     * on a correct code. Clear the unusable row and ask for a fresh one.
     */
    if (!rec.codeHash) {
        logger.warn(`OTP record for ${channel}:${identifier} has no codeHash — discarding`);
        await Otp.deleteOne({ _id: rec._id });
        return { ok: false, reason: 'not_found' };
    }

    const t = now();

    if (rec.isLocked(t)) {
        return {
            ok: false,
            reason: 'locked',
            retryAfterSeconds: Math.ceil((rec.lockedUntil.getTime() - t) / 1000),
        };
    }

    if (rec.isExpired(t)) return { ok: false, reason: 'expired' };

    if (rec.attempts >= env.otp.maxAttempts) {
        rec.lockedUntil = new Date(t + env.otp.lockoutSeconds * 1000);
        await rec.save();
        return { ok: false, reason: 'too_many_attempts', retryAfterSeconds: env.otp.lockoutSeconds };
    }

    // Count the guess before checking it, so a crash mid-verify cannot be used
    // to get a free attempt.
    rec.attempts += 1;
    await rec.save();

    const good = channel === 'phone' && env.msg91.verifyWith === 'msg91'
        ? (await verifyWhatsAppOtpWithProvider(identifier, code)).ok
        : await bcrypt.compare(String(code), rec.codeHash);

    if (good) {
        await Otp.deleteOne({ _id: rec._id });
        return { ok: true, channel, identifier, purpose: rec.purpose };
    }

    if (rec.attempts >= env.otp.maxAttempts) {
        rec.lockedUntil = new Date(t + env.otp.lockoutSeconds * 1000);
        await rec.save();
        return { ok: false, reason: 'too_many_attempts', retryAfterSeconds: env.otp.lockoutSeconds };
    }

    return {
        ok: false,
        reason: 'invalid',
        attemptsRemaining: Math.max(0, env.otp.maxAttempts - rec.attempts),
    };
}

/** Clear a challenge — used when an account action supersedes the verification. */
export async function clearOtp(channel, rawIdentifier) {
    const identifier = normaliseIdentifier(channel, rawIdentifier);
    if (identifier) await Otp.deleteOne({ channel, identifier });
}

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/apiError.js';

/**
 * Transactional email.
 *
 * This is the path a real verification code travels, so the previous version's
 * four shortcuts all had to go:
 *
 *  1. **It read `process.env.RESEND_API_KEY` directly**, bypassing `env.js`
 *     where `resendApiKey` is already defined. Two sources for one setting means
 *     one of them is eventually wrong, and `dotenv` load order decides which.
 *  2. **A missing key was not an error.** With no key the request went out as
 *     `Authorization: Bearer undefined`, Resend answered 401, and the caller saw
 *     a bare `Error: Resend failed: 401` — indistinguishable from a rejected
 *     recipient, an unverified domain, or a rate limit.
 *  3. **The response body was thrown away.** Resend explains precisely what is
 *     wrong ("The from address domain is not verified", "You can only send
 *     testing emails to your own email address") and none of it was logged,
 *     which is why a failing send looked like a mystery rather than a setting.
 *  4. **An unknown provider logged a stub and returned success.** The caller
 *     then persisted an OTP for a message that was never sent.
 *
 * Errors now carry a code the API layer can act on, the provider's own
 * explanation is logged server-side, and the API key never appears in a log, a
 * response, or an error.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Which email settings are missing, if any. Used by /auth/config and on boot. */
export function emailConfigStatus() {
    const provider = env.emailProvider;
    if (provider === 'mock') return { provider, configured: true, missing: [], mock: true };

    const missing = [];
    if (provider === 'resend' && !env.resendApiKey) missing.push('RESEND_API_KEY');
    if (!env.emailFrom) missing.push('EMAIL_FROM');

    return {
        provider,
        configured: missing.length === 0 && provider === 'resend',
        missing,
        supported: provider === 'resend',
        /**
         * Resend's shared sandbox sender. It works without domain verification
         * but **only delivers to the address that owns the Resend account** —
         * every other recipient is accepted with a 200 and then dropped. That
         * behaviour looks exactly like "OTP email is broken", so it is surfaced
         * rather than left to be discovered.
         */
        sandboxSender: env.emailFrom === 'onboarding@resend.dev',
    };
}

/**
 * Send an email. Throws `ApiError` on failure — callers must not persist an OTP
 * for a message that was never accepted.
 */
export async function sendEmail(to, subject, html) {
    const provider = env.emailProvider;

    if (provider === 'mock') {
        logger.info(`✉️  [MOCK EMAIL] to=${to} subject="${subject}"`);
        return { delivered: false, mock: true };
    }

    if (provider === 'resend') return sendViaResend(to, subject, html);

    throw new ApiError(500, 'EMAIL_PROVIDER_NOT_SUPPORTED',
        'Email delivery is not configured on this environment.',
        { provider, supported: ['resend', 'mock'] });
}

async function sendViaResend(to, subject, html) {
    const status = emailConfigStatus();
    if (!status.configured) {
        logger.error(`Email not configured — missing ${status.missing.join(', ') || '(unknown)'}`);
        throw new ApiError(500, 'EMAIL_PROVIDER_NOT_CONFIGURED',
            'Email delivery is not configured on this environment.',
            { missing: status.missing });
    }

    if (status.sandboxSender) {
        logger.warn(
            "EMAIL_FROM is onboarding@resend.dev — Resend's shared sandbox sender. "
            + 'It only delivers to the address that owns the Resend account; every other '
            + 'recipient is accepted and then dropped. Set EMAIL_FROM to an address on a '
            + 'domain verified in Resend before testing with real users.',
        );
    }

    let res;
    try {
        res = await fetch(RESEND_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env.resendApiKey}`,
            },
            body: JSON.stringify({ from: env.emailFrom, to, subject, html }),
        });
    } catch (err) {
        // DNS failure, TLS failure, egress blocked, Resend down.
        logger.error(`Resend unreachable: ${err?.message}`);
        throw new ApiError(502, 'EMAIL_DELIVERY_FAILED',
            'We could not send your verification email right now. Please try again in a moment.');
    }

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
        // Logged in full server-side — this is the sentence that says what is
        // actually wrong. It is never returned to the client.
        logger.error(
            `Resend rejected the message (HTTP ${res.status}) `
            + `from=${env.emailFrom} to=${to}: ${body?.message ?? body?.error ?? '(no message)'}`,
        );
        throw resendError(res.status, body);
    }

    logger.info(`✉️  Email sent to ${maskEmail(to)} (resend id ${body?.id ?? 'unknown'})`);
    return { delivered: true, id: body?.id ?? null };
}

/**
 * Map Resend's failure onto something the API can hand a user. The distinction
 * that matters: a misconfigured sender is *our* problem and no amount of
 * retrying will fix it, whereas a rate limit or an outage is worth retrying.
 * Either way the user is never shown provider internals.
 */
function resendError(httpStatus, body) {
    const detail = String(body?.message ?? body?.name ?? '');

    /**
     * Three different causes used to return the identical sentence "Email
     * delivery is not configured correctly on this environment." That made the
     * failure undiagnosable from the outside: an invalid key, an unverified
     * domain and the sandbox-sender restriction all looked the same, and the
     * only distinguishing information sat in a server log nobody was watching.
     *
     * Each cause now says which of the three it is and what fixes it. These are
     * operator-facing configuration faults, not user mistakes — naming the
     * setting leaks nothing (it is a variable name and a Resend feature, never a
     * key or a value) and turns a dead end into a five-minute fix.
     */
    if (httpStatus === 401 || httpStatus === 403) {
        return new ApiError(500, 'EMAIL_PROVIDER_REJECTED',
            'Resend rejected our API key. Check RESEND_API_KEY is a current, active key.',
            { fix: 'Regenerate the key in Resend → API Keys and restart the server.' });
    }
    if (/not verified|domain/i.test(detail)) {
        return new ApiError(500, 'EMAIL_SENDER_NOT_VERIFIED',
            'The sender domain in EMAIL_FROM is not verified in Resend.',
            { fix: 'Resend → Domains → add the domain and its DKIM/SPF records, then set EMAIL_FROM to an address on it.' });
    }
    if (/you can only send testing emails/i.test(detail)) {
        return new ApiError(500, 'EMAIL_SENDER_SANDBOXED',
            'EMAIL_FROM is Resend\'s sandbox sender, which only delivers to the Resend account owner.',
            { fix: 'Verify your own domain in Resend and set EMAIL_FROM to an address on it.' });
    }
    if (httpStatus === 429) {
        return new ApiError(429, 'EMAIL_RATE_LIMITED',
            'Too many emails have been sent just now. Please try again shortly.');
    }
    if (/invalid.*(to|recipient)|recipient/i.test(detail)) {
        return new ApiError(400, 'EMAIL_RECIPIENT_INVALID',
            'That email address could not be delivered to. Check it and try again.');
    }
    return new ApiError(502, 'EMAIL_DELIVERY_FAILED',
        'We could not send your verification email right now. Please try again in a moment.');
}

function maskEmail(email) {
    const [name, domain] = String(email).split('@');
    if (!domain) return '***';
    return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}

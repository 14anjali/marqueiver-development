import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/apiError.js';

/**
 * MSG91 WhatsApp OTP delivery.
 *
 * This replaces the previous Twilio Verify / SMS path entirely. Phone
 * verification happens over WhatsApp, and there is **no SMS fallback** — a
 * fallback would quietly send a verification code over a channel the product
 * does not claim to use, and would hide a misconfiguration that ought to be
 * loud.
 *
 * Two things are deliberate here:
 *
 *  - **We generate the code, MSG91 delivers it.** Expiry, attempt caps, resend
 *    cooldowns and lockouts are ours to enforce and must behave identically in
 *    mock and live mode; handing the lifecycle to a vendor would make those
 *    rules untestable and inconsistent between environments. MSG91's own
 *    verify/retry endpoints are still supported (MSG91_VERIFY_WITH=msg91) for
 *    deployments that prefer it.
 *  - **Nothing is hardcoded.** Every credential comes from the environment. A
 *    live deployment with credentials missing throws a configuration error
 *    rather than silently logging the code, which is what "mock mode" is for.
 */

const MASK = (phone) => (phone ? phone.replace(/\d(?=\d{3})/g, '•') : '');

export function isLive() {
    return env.integrationMode === 'live';
}

/** Which credentials are missing, if any — used by /health and by send(). */
export function msg91ConfigStatus() {
    const missing = [];
    if (!env.msg91.authKey) missing.push('MSG91_AUTH_KEY');
    if (!env.msg91.templateId) missing.push('MSG91_WHATSAPP_TEMPLATE_ID');
    return { configured: missing.length === 0, missing };
}

/**
 * MSG91 wants a bare international number with no '+' and no separators.
 * `+91 90000 00000` and `9000000000` both have to reach the same recipient, so
 * a bare 10-digit number is given the configured country code rather than being
 * rejected — an Indian user typing their number without +91 is the common case,
 * not an error.
 */
export function normalisePhone(input) {
    const raw = String(input ?? '').trim();
    let digits = raw.replace(/[^\d]/g, '');
    if (!digits) return null;

    // An explicit + means the user gave the country code; take it as written.
    if (raw.startsWith('+')) return digits;

    // National trunk prefix. People write their own number as 09000000501 at
    // least as often as 9000000501, and without this the two become different
    // identities — the same person could sign up twice, and someone who
    // registered one way could not log in the other.
    if (digits.length > 10 && digits.startsWith('0')) digits = digits.replace(/^0+/, '');

    if (digits.length <= 10) return `${env.msg91.defaultCountryCode}${digits}`;
    return digits;
}

/** E.164, which is what we store on the user record. */
export function toE164(input) {
    const n = normalisePhone(input);
    return n ? `+${n}` : null;
}

export function isValidPhone(input) {
    const n = normalisePhone(input);
    return Boolean(n) && n.length >= 10 && n.length <= 15;
}

async function call(path, params, { method = 'GET', body } = {}) {
    const url = new URL(`${env.msg91.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.msg91.timeoutMs);
    let res;
    try {
        res = await fetch(url, {
            method,
            signal: controller.signal,
            headers: {
                accept: 'application/json',
                authkey: env.msg91.authKey,
                ...(body ? { 'content-type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
    } catch (err) {
        clearTimeout(timer);
        logger.error(`MSG91 ${path} unreachable: ${err?.message}`);
        throw new ApiError(502, 'OTP_DELIVERY_FAILED',
            'We could not send your WhatsApp code right now. Please try again in a moment.');
    }
    clearTimeout(timer);

    const payload = await res.json().catch(() => ({}));

    // MSG91 answers 200 with {type:'error'} for business-level failures, so the
    // HTTP status alone is not the success signal.
    const failed = !res.ok || String(payload?.type).toLowerCase() === 'error';
    if (failed) {
        const detail = payload?.message ?? payload?.msg ?? `HTTP ${res.status}`;
        logger.error(`MSG91 ${path} failed: ${JSON.stringify(detail)}`);
        throw new ApiError(502, 'OTP_DELIVERY_FAILED',
            'We could not send your WhatsApp code right now. Please try again in a moment.',
            { provider: 'msg91' });
    }
    return payload;
}

function requireConfig() {
    const { configured, missing } = msg91ConfigStatus();
    if (!configured) {
        throw new ApiError(500, 'OTP_PROVIDER_NOT_CONFIGURED',
            'WhatsApp verification is not configured on this environment.',
            { missing });
    }
}

/**
 * Send `code` to `phone` over WhatsApp using the configured MSG91 template.
 * Returns `{ delivered, requestId }`. In mock mode nothing leaves the process —
 * the code is logged and returned to the caller as a dev code.
 */
export async function sendWhatsAppOtp(phone, code, { purpose = 'login' } = {}) {
    const mobile = normalisePhone(phone);
    if (!mobile) throw ApiError.badRequest('A valid phone number is required');

    if (!isLive()) {
        logger.info(`💬 [MOCK WHATSAPP OTP] ${MASK(mobile)} → ${code} (${purpose})`);
        return { delivered: false, mock: true };
    }

    requireConfig();

    const payload = await call('/otp', {
        template_id: env.msg91.templateId,
        mobile,
        otp: code,
        otp_length: String(code).length,
        otp_expiry: Math.ceil(env.otp.ttlSeconds / 60),
        realTimeResponse: '1',
        ...(env.msg91.senderId ? { sender: env.msg91.senderId } : {}),
        [env.msg91.otpVarName]: code,
    }, { method: 'POST' });

    logger.info(`💬 WhatsApp OTP sent to ${MASK(mobile)} (${purpose})`);
    return { delivered: true, requestId: payload?.request_id ?? null };
}

/**
 * Ask MSG91 to resend. Only reached when MSG91 owns the lifecycle; with the
 * default local lifecycle a resend is just a fresh send of a fresh code, which
 * keeps our expiry and attempt counters authoritative.
 */
export async function retryWhatsAppOtp(phone) {
    const mobile = normalisePhone(phone);
    if (!isLive()) {
        logger.info(`💬 [MOCK WHATSAPP RETRY] ${MASK(mobile)}`);
        return { delivered: false, mock: true };
    }
    requireConfig();
    await call('/otp/retry', { mobile, retrytype: 'text' }, { method: 'POST' });
    return { delivered: true };
}

/**
 * Verify against MSG91 (MSG91_VERIFY_WITH=msg91). Returns a result object rather
 * than throwing on a wrong code, so the caller maps provider reasons onto the
 * same error codes the local path produces and the UI sees one vocabulary.
 */
export async function verifyWhatsAppOtpWithProvider(phone, code) {
    const mobile = normalisePhone(phone);
    if (!isLive()) return { ok: true, mock: true };
    requireConfig();

    try {
        await call('/otp/verify', { mobile, otp: code });
        return { ok: true };
    } catch (err) {
        // A rejected code is a normal outcome, not an outage.
        if (err instanceof ApiError && err.code === 'OTP_DELIVERY_FAILED')
            return { ok: false, reason: 'invalid' };
        throw err;
    }
}

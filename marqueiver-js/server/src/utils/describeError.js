import { ApiError } from './apiError.js';

/**
 * Turn anything that was thrown into a structured, loggable, secret-free record.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The Instagram callback logged
 *
 *   WARN Instagram callback failed
 *   { name: 'Error', code: 'UNKNOWN', providerCode: null,
 *     invalidFields: undefined, message: undefined }
 *
 * and that told nobody anything. Three separate reasons, all of them the
 * logging's fault rather than the error's:
 *
 *  1. `message` was only read when `err instanceof ApiError`. Every other
 *     failure — the interesting ones — had its message thrown away by the code
 *     meant to report it.
 *  2. `err?.name ?? 'Error'` and `err?.code ?? 'UNKNOWN'` collapse "absent" and
 *     "not an Error at all" into values that look like real answers. A thrown
 *     `null`, a plain object, or a string all render as a nice tidy
 *     `name: 'Error'`, which is why the log looked plausible and meant nothing.
 *  3. Provider failures keep their detail in different places depending on the
 *     client. `fetch` puts a network cause on `error.cause`; axios-style clients
 *     put it on `error.response.data.error`; ours puts it on `ApiError.details`.
 *     Reading only `error.message` finds none of them.
 *
 * So this reads every location, states plainly when the thrown value was not an
 * Error, and never invents a field it did not find.
 *
 * ── What it must never emit ────────────────────────────────────────────────
 * Access tokens, authorization codes, client secrets and JWTs all travel
 * through this code path — the token is in scope at the throw site and Meta
 * echoes query strings back in some error messages. Every string that leaves
 * here goes through `redact()`.
 */

/**
 * Remove anything credential-shaped from a string bound for the logs.
 *
 * Deliberately aggressive: a redacted message that is slightly harder to read
 * costs a minute of debugging, and a leaked token costs an account. The token
 * this project puts in `?token=` is already in Render's request logs — that is
 * a separate problem, and no reason to add another copy here.
 */
export function redact(value) {
    if (value == null) return value;

    return String(value)
        // key=value pairs in query strings and form bodies
        .replace(/((?:access_token|client_secret|code|token|refresh_token|signed_request)=)[^&\s"']+/gi,
            '$1[REDACTED]')
        // the same as JSON keys
        .replace(/(("|')?(?:access_token|client_secret|refresh_token|token)\2?\s*:\s*)("[^"]*"|'[^']*'|[^,}\s]+)/gi,
            '$1"[REDACTED]"')
        // bare JWTs anywhere in free text
        .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
        // long opaque Meta tokens (IGQV…, EAA…)
        .replace(/\b(IGQ|EAA)[A-Za-z0-9_-]{20,}/g, '[REDACTED_TOKEN]');
}

/** First defined value, so an absent field stays absent rather than becoming null. */
const first = (...values) => values.find((v) => v !== undefined && v !== null);

/**
 * @param {unknown} err  whatever was thrown — not necessarily an Error
 * @returns {object} a flat, safe description
 */
export function describeError(err) {
    // Not an Error at all. Say so, rather than dressing it up as one — this is
    // the case the old logging silently disguised.
    if (err === null || err === undefined) {
        return { thrown: err === null ? 'null' : 'undefined', name: 'NonError' };
    }
    if (typeof err !== 'object') {
        return { thrown: typeof err, name: 'NonError', message: redact(err) };
    }
    if (!(err instanceof Error)) {
        let shape;
        try { shape = redact(JSON.stringify(err)).slice(0, 400); } catch { shape = '[uninspectable]'; }
        return { thrown: 'object', name: 'NonError', message: shape };
    }

    // An axios/got-shaped provider error keeps its detail here.
    const response = err.response;
    const data = response?.data;
    const providerError = data?.error ?? data;

    const out = {
        name: err.name || 'Error',
        message: redact(err.message) || '(no message)',

        // HTTP status, wherever this client happens to keep it.
        status: first(err.status, response?.status, err.statusCode),

        // Our own ApiError code, or a driver code (Mongo 11000 etc.).
        code: first(err.code, err.details?.code),

        // The provider's own words. ApiError.details is where our Instagram and
        // Meta services put them; response.data.error is where HTTP clients do.
        providerCode: first(err.details?.providerCode, providerError?.code),
        providerMessage: redact(first(err.details?.providerMessage, providerError?.message)),
        providerStatus: first(err.details?.providerStatus, response?.status),
        providerType: first(err.details?.providerType, providerError?.type),

        // Mongoose validation — the schema paths that were rejected. Names only:
        // the values are the creator's profile data.
        invalidFields: err.errors ? Object.keys(err.errors) : undefined,

        // `fetch` network failures carry everything on the cause and nothing on
        // the message, which is just "fetch failed".
        // Both halves: the code is what you grep for (ENOTFOUND, ECONNRESET),
        // the message is what names the host that could not be reached.
        cause: err.cause
            ? redact([err.cause.code, err.cause.message ?? String(err.cause)]
                .filter(Boolean).join(' — '))
            : undefined,
    };

    // Drop keys we did not actually find, so the log shows what is known rather
    // than a wall of undefined.
    for (const [key, value] of Object.entries(out)) {
        if (value === undefined) delete out[key];
    }
    return out;
}

/**
 * The message a person should see, as distinct from what we log.
 *
 * ApiErrors are written for users ("must be a Creator or Business account").
 * Everything else gets a neutral line — an internal message in the UI is at
 * best confusing and at worst a disclosure.
 */
export function userFacingMessage(err, fallback) {
    return err instanceof ApiError ? err.message : fallback;
}
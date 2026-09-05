import crypto from 'node:crypto';
import { ApiError } from '../utils/apiError.js';

/**
 * Meta `signed_request` verification.
 *
 * Facebook and Instagram call the Deauthorize and Data Deletion callbacks
 * server-to-server with a single form field, `signed_request`, shaped as
 * `<base64url signature>.<base64url payload>` where the signature is
 * HMAC-SHA256 of the *encoded payload string* keyed with the app secret.
 *
 * The verification is the entire security of these endpoints. They are
 * necessarily unauthenticated — Meta has no session — and acting on an
 * unverified payload would let anyone POST a user id and have their connection
 * and data deleted. So an invalid signature is refused before the payload is
 * read for anything.
 *
 * Two details that are easy to get wrong and both break verification silently:
 *  - the HMAC covers the encoded payload string, not the decoded JSON;
 *  - Meta uses base64url (`-`/`_`, no padding), so the standard base64 alphabet
 *    produces a mismatch on roughly half of all requests.
 */

/**
 * @param {string} signedRequest  the raw `signed_request` field
 * @param {string} appSecret      the app secret for the calling platform
 * @returns {{ user_id?: string, algorithm?: string, issued_at?: number }}
 */
export function parseSignedRequest(signedRequest, appSecret) {
    if (!appSecret) {
        throw new ApiError(500, 'META_APP_SECRET_MISSING',
            'This callback is not configured on this environment.');
    }

    const raw = String(signedRequest ?? '');
    const [encodedSig, encodedPayload] = raw.split('.');
    if (!encodedSig || !encodedPayload) {
        throw new ApiError(400, 'SIGNED_REQUEST_MALFORMED', 'Malformed signed_request.');
    }

    let payload;
    try {
        payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch {
        throw new ApiError(400, 'SIGNED_REQUEST_MALFORMED', 'Malformed signed_request payload.');
    }

    // Meta has only ever used HMAC-SHA256 here, but the payload names the
    // algorithm, and accepting whatever it claims would be the obvious hole.
    if (String(payload.algorithm ?? '').toUpperCase().replace('-', '') !== 'HMACSHA256') {
        throw new ApiError(400, 'SIGNED_REQUEST_ALGORITHM',
            'Unsupported signed_request algorithm.');
    }

    const expected = crypto
        .createHmac('sha256', appSecret)
        .update(encodedPayload)          // the ENCODED string, not the parsed JSON
        .digest();
    const provided = Buffer.from(encodedSig, 'base64url');

    // Constant-time, and length-checked first because timingSafeEqual throws on
    // a length mismatch rather than returning false.
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        throw new ApiError(401, 'SIGNED_REQUEST_INVALID', 'Invalid signed_request signature.');
    }

    return payload;
}

/** A short, human-quotable code the user can give support. */
export function newConfirmationCode() {
    return crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, '').slice(0, 12).toUpperCase();
}
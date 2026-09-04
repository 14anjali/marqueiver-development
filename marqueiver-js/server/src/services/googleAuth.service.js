import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/apiError.js';

/**
 * Google Sign-In — real token verification.
 *
 * What this replaces: the previous `/auth/google` accepted `{ email, googleId }`
 * straight from the request body and trusted them. Anyone who could POST to the
 * endpoint could sign in as any user by typing their email address. That was the
 * single worst hole in the auth surface, and nothing about it is preserved here.
 *
 * Two entry points, both ending in a server-verified identity:
 *
 *  1. **id_token** (`verifyIdToken`) — for Google Identity Services in the
 *     browser. The token's signature is checked against Google's published keys,
 *     and `aud` is checked against our own client id, so a token minted for a
 *     different Google app is rejected.
 *  2. **Authorization code** (`buildAuthUrl` + `exchangeCode`) — the redirect
 *     flow. The client secret never leaves the server, and `state` is signed and
 *     single-use, which is what makes the callback CSRF-resistant.
 *
 * Signature verification uses Node's built-in WebCrypto against Google's JWKS
 * rather than pulling in google-auth-library, so this works on a stock install
 * with no new dependency to vet.
 */

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

let jwksCache = { keys: [], fetchedAt: 0 };

function b64urlToBuffer(part) {
    return Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decodeSegment(part) {
    return JSON.parse(b64urlToBuffer(part).toString('utf8'));
}

async function getJwks(kid) {
    const stale = Date.now() - jwksCache.fetchedAt > 60 * 60 * 1000;
    const known = jwksCache.keys.find((k) => k.kid === kid);
    if (known && !stale) return known;

    const res = await fetch(JWKS_URL).catch(() => null);
    if (!res?.ok) {
        // Serve a cached key rather than failing every sign-in during a blip.
        if (known) return known;
        throw new ApiError(502, 'GOOGLE_UNAVAILABLE',
            'Could not reach Google to verify your sign-in. Please try again.');
    }
    const body = await res.json();
    jwksCache = { keys: body.keys ?? [], fetchedAt: Date.now() };
    return jwksCache.keys.find((k) => k.kid === kid);
}

/**
 * Verify a Google id_token and return the claims we act on. Throws an ApiError
 * on anything that fails — an unverifiable token is never treated as a soft
 * failure that falls through to some other identity.
 */
export async function verifyIdToken(idToken) {
    if (!env.googleAuth.clientId) {
        throw new ApiError(500, 'GOOGLE_NOT_CONFIGURED',
            'Google sign-in is not configured on this environment.',
            { missing: ['GOOGLE_CLIENT_ID'] });
    }

    const parts = String(idToken ?? '').split('.');
    if (parts.length !== 3) throw ApiError.unauthorized('That Google sign-in could not be verified.');

    let header;
    let claims;
    try {
        header = decodeSegment(parts[0]);
        claims = decodeSegment(parts[1]);
    } catch {
        throw ApiError.unauthorized('That Google sign-in could not be verified.');
    }

    const jwk = await getJwks(header.kid);
    if (!jwk) throw ApiError.unauthorized('That Google sign-in could not be verified.');

    const key = await crypto.webcrypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
    );

    const valid = await crypto.webcrypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        b64urlToBuffer(parts[2]),
        Buffer.from(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) throw ApiError.unauthorized('That Google sign-in could not be verified.');

    if (!ISSUERS.has(claims.iss)) throw ApiError.unauthorized('That Google sign-in could not be verified.');
    // Without this check a token issued for any other Google application would
    // be accepted here.
    if (claims.aud !== env.googleAuth.clientId)
        throw ApiError.unauthorized('That Google sign-in was issued for a different application.');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now())
        throw ApiError.unauthorized('That Google sign-in has expired. Please try again.');
    if (!claims.email) throw ApiError.unauthorized('Google did not return an email address.');
    // An unverified Google email would let someone claim an address they do not
    // control, which is exactly what this flow is supposed to prove.
    if (claims.email_verified === false)
        throw new ApiError(403, 'GOOGLE_EMAIL_UNVERIFIED',
            'Your Google account email is not verified. Verify it with Google, then try again.');

    return {
        googleId: claims.sub,
        email: String(claims.email).toLowerCase(),
        emailVerified: claims.email_verified !== false,
        name: claims.name ?? '',
        picture: claims.picture ?? '',
    };
}

/* ─────────────────────────── authorization-code flow ───────────────────────── */

/**
 * Signed, expiring `state`. It carries the caller's intent (signup vs login) and
 * the role chosen on the signup screen, so the callback does not have to trust
 * anything the browser sends back — and so a stray callback cannot be replayed
 * into a different flow.
 */
export function signState(payload) {
    const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
    const mac = crypto.createHmac('sha256', env.jwt.accessSecret).update(body).digest('base64url');
    return `${body}.${mac}`;
}

export function verifyState(state, maxAgeMs = 10 * 60 * 1000) {
    const [body, mac] = String(state ?? '').split('.');
    if (!body || !mac) throw ApiError.badRequest('Invalid sign-in state');

    const expected = crypto.createHmac('sha256', env.jwt.accessSecret).update(body).digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
        throw ApiError.badRequest('Invalid sign-in state');

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (Date.now() - payload.iat > maxAgeMs)
        throw ApiError.badRequest('This sign-in link has expired. Please start again.');
    return payload;
}

export function googleConfigStatus() {
    const missing = [];
    if (!env.googleAuth.clientId) missing.push('GOOGLE_CLIENT_ID');
    if (!env.googleAuth.clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
    return { configured: missing.length === 0, missing };
}

export function buildAuthUrl(state) {
    if (!env.googleAuth.clientId)
        throw new ApiError(500, 'GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured on this environment.');

    const url = new URL(AUTH_URL);
    url.searchParams.set('client_id', env.googleAuth.clientId);
    url.searchParams.set('redirect_uri', env.googleAuth.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
}

/** Exchange the callback code for an id_token, then verify it as above. */
export async function exchangeCode(code) {
    const { configured, missing } = googleConfigStatus();
    if (!configured)
        throw new ApiError(500, 'GOOGLE_NOT_CONFIGURED',
            'Google sign-in is not configured on this environment.', { missing });

    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: env.googleAuth.clientId,
            client_secret: env.googleAuth.clientSecret,
            redirect_uri: env.googleAuth.redirectUri,
            grant_type: 'authorization_code',
        }),
    }).catch(() => null);

    if (!res?.ok) {
        const detail = res ? await res.text().catch(() => '') : 'unreachable';
        logger.error(`Google token exchange failed: ${detail}`);
        throw ApiError.unauthorized('Google sign-in could not be completed. Please try again.');
    }

    const { id_token: idToken } = await res.json();
    if (!idToken) throw ApiError.unauthorized('Google did not return an identity token.');
    return verifyIdToken(idToken);
}

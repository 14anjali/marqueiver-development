import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok } from '../../utils/respond.js';
import { env } from '../../config/env.js';
import { DataDeletionRequest } from '../../models/index.js';
import { parseSignedRequest, newConfirmationCode } from '../../services/metaSignedRequest.service.js';
import { REMOVERS } from '../../services/metaDataRemoval.service.js';

/**
 * Meta platform callbacks: Deauthorize and Data Deletion Request.
 *
 * Facebook and Instagram call these server-to-server when a person removes the
 * app or asks for their data to be deleted. There is no session and no bearer
 * token — Meta authenticates itself purely by signing the payload with the app
 * secret, so `parseSignedRequest` is the only thing standing between these
 * endpoints and anyone on the internet naming a user id to have deleted. It
 * runs before the payload is used for anything.
 *
 * ── Which secret ───────────────────────────────────────────────────────────
 * An Instagram integration is signed with the Instagram app secret when it uses
 * Instagram Login, and with the Facebook app secret when Instagram is reached
 * through Facebook Login. Which one applies depends on how the app is set up in
 * the Meta dashboard, and getting it wrong fails closed and silently — the
 * callback would reject every real request from Meta while looking configured.
 * So each platform has an ordered list of candidate secrets and the payload is
 * accepted if any of them verifies it. Both secrets are our own, so this widens
 * nothing: a forger still has to hold one of them.
 */

/** Ordered candidate app secrets per platform. Blanks are filtered out. */
function secretsFor(platform) {
    const list = platform === 'instagram'
        ? [env.instagram?.appSecret, env.facebook?.appSecret]
        : [env.facebook?.appSecret];
    return [...new Set(list.filter(Boolean))];
}

/**
 * Verify against every configured secret for the platform. The last failure is
 * rethrown so the caller still gets a precise reason (malformed vs. bad
 * signature vs. not configured) rather than a flattened one.
 */
function verifySignedRequest(signedRequest, platform) {
    const secrets = secretsFor(platform);
    if (!secrets.length) {
        throw new ApiError(500, 'META_APP_SECRET_MISSING',
            'This callback is not configured on this environment.');
    }

    let lastError;
    for (const secret of secrets) {
        try {
            return parseSignedRequest(signedRequest, secret);
        } catch (err) {
            lastError = err;
            // Only a signature mismatch is worth retrying with another secret;
            // a malformed body is malformed whichever key we hold.
            if (err.code !== 'SIGNED_REQUEST_INVALID') throw err;
        }
    }
    throw lastError;
}

/**
 * Meta sends `signed_request` as a form field on a POST. It has also been known
 * to arrive as a query parameter on manual dashboard tests, so both are read.
 */
function readSignedRequest(req) {
    const value = req.body?.signed_request ?? req.query?.signed_request;
    if (!value) {
        throw new ApiError(400, 'SIGNED_REQUEST_MISSING',
            'Missing signed_request.');
    }
    return String(value);
}

function requireUserId(payload) {
    const userId = payload?.user_id;
    if (!userId) {
        throw new ApiError(400, 'SIGNED_REQUEST_NO_USER',
            'signed_request did not identify a user.');
    }
    return String(userId);
}

/** The page a person can open to see what happened to their request. */
export function statusUrlFor(code) {
    const url = new URL('/data-deletion', env.clientUrl);
    url.searchParams.set('code', code);
    return url.toString();
}

/**
 * Deauthorize callback — the person removed the app in Facebook or Instagram.
 *
 * The tokens we hold are dead from this moment, so keeping the connection
 * record would leave the profile looking connected while every sync fails. The
 * data is removed on the same terms as a deletion request; the difference is
 * only that Meta expects no particular response body here.
 */
export const deauthorize = (platform) => catchAsync(async (req, res) => {
    const payload = verifySignedRequest(readSignedRequest(req), platform);
    const providerUserId = requireUserId(payload);

    const record = await DataDeletionRequest.create({
        kind: 'deauthorize',
        platform,
        providerUserId,
        status: 'received',
    });

    try {
        const { userIds, removed } = await REMOVERS[platform](providerUserId);
        record.user = userIds[0] ?? null;
        record.removed = { ...record.removed, ...removed };
        record.status = userIds.length ? 'completed' : 'no_data_found';
        record.completedAt = new Date();
        await record.save();
    } catch (err) {
        record.status = 'failed';
        record.failureReason = String(err?.message ?? err);
        await record.save();
        throw err;
    }

    // Meta ignores the body; a 200 is the acknowledgement.
    ok(res, { received: true });
});

/**
 * Data Deletion Request callback.
 *
 * The response shape is Meta's, not ours: a bare JSON object with exactly
 * `url` and `confirmation_code`. It deliberately bypasses the `{ ok, data }`
 * envelope every other endpoint uses, because Meta's validator reads those two
 * keys at the top level and an enveloped response fails their review.
 *
 * A request naming somebody who never connected here is answered the same way,
 * with `no_data_found` recorded. It is a truthful "there is nothing of yours to
 * delete", and returning an error instead would have Meta retrying a request
 * that can never succeed.
 */
export const dataDeletion = (platform) => catchAsync(async (req, res) => {
    const payload = verifySignedRequest(readSignedRequest(req), platform);
    const providerUserId = requireUserId(payload);

    const confirmationCode = newConfirmationCode();
    const record = await DataDeletionRequest.create({
        kind: 'data_deletion',
        platform,
        providerUserId,
        confirmationCode,
        status: 'received',
    });

    try {
        const { userIds, removed } = await REMOVERS[platform](providerUserId);
        record.user = userIds[0] ?? null;
        record.removed = { ...record.removed, ...removed };
        record.status = userIds.length ? 'completed' : 'no_data_found';
        record.completedAt = new Date();
        await record.save();
    } catch (err) {
        record.status = 'failed';
        record.failureReason = String(err?.message ?? err);
        await record.save();
        throw err;
    }

    res.status(200).json({
        url: statusUrlFor(confirmationCode),
        confirmation_code: confirmationCode,
    });
});

/**
 * Public status lookup for the URL handed back to Meta.
 *
 * Unauthenticated, because the person following the link has just removed the
 * app and may well have no way to sign in. It therefore returns only what the
 * holder of the code already knows — which platform, when, and whether it is
 * done. No identifiers, no counts of what was found, and never
 * `failureReason`: knowing a code exists must not reveal anything about the
 * account behind it.
 */
export const deletionStatus = catchAsync(async (req, res) => {
    const code = String(req.params.code ?? '').trim().toUpperCase();

    const record = await DataDeletionRequest
        .findOne({ confirmationCode: code, kind: 'data_deletion' })
        .select('platform status requestedAt completedAt')
        .lean();

    if (!record) {
        throw new ApiError(404, 'DELETION_REQUEST_NOT_FOUND',
            'We have no deletion request with that confirmation code.');
    }

    ok(res, {
        confirmationCode: code,
        platform: record.platform,
        status: record.status,
        requestedAt: record.requestedAt,
        completedAt: record.completedAt ?? null,
    });
});

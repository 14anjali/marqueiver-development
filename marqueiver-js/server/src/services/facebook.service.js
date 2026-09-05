import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/apiError.js';
import { requestSupportedMetrics, normaliseInsights } from '../utils/metricDiscovery.js';

/**
 * Facebook Pages integration — **Facebook Login**, Graph API, `graph.facebook.com`.
 *
 * This is a different flow from the Instagram integration and shares nothing
 * with it. Instagram uses Instagram Login against `graph.instagram.com` with an
 * Instagram User access token; that token is not valid here and this one is not
 * valid there. Two products of one Meta app, two token families.
 *
 * ── What this replaces ─────────────────────────────────────────────────────
 * The previous version made exactly two Graph calls — `/oauth/access_token` and
 * `/me` — and `fetchManagedPages()` was a stub that returned `[]`. There was no
 * Page list, no Page access token, no publishing and no comment handling, so
 * every Page capability the product needs was absent.
 *
 * It also requested ten permissions and used one. `user_posts`, `user_photos`,
 * `user_friends`, `user_likes`, `user_birthday`, `user_age_range`, `user_link`
 * and `user_location` were all in the scope string and none appeared in any
 * request. That is not merely untidy: App Review requires a screencast
 * demonstrating each requested permission in use, so a permission the code
 * never exercises cannot be demonstrated and fails the submission. The scope is
 * now exactly the four Page permissions the code below actually calls, plus
 * `public_profile`.
 *
 * ── Token model ────────────────────────────────────────────────────────────
 *   authorization code  →  short-lived USER token (~1 hour)
 *                       →  long-lived USER token (~60 days, fb_exchange_token)
 *                       →  PAGE access token, read from /me/accounts
 *
 * The order matters. A Page token derived from a *short-lived* user token
 * expires with it; one derived from a long-lived user token does not expire at
 * all while the user keeps the app authorised. Publishing on behalf of a Page
 * uses the Page token, never the user token.
 */

const GRAPH_VERSION = env.facebook.graphVersion || 'v23.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * The permissions this file actually uses, and where each one is spent.
 *
 *   public_profile         granted by default; identifies the person connecting
 *   pages_show_list        GET /me/accounts               → listPages()
 *   pages_read_engagement  GET /{page}, /{page}/posts,
 *                          /{post}/comments               → fetchPage/Posts/Comments
 *   pages_manage_posts     POST/DELETE /{page}/feed       → publishPost/deletePost
 *   pages_manage_engagement POST/DELETE /{comment}        → replyTo/hide/deleteComment
 *
 * `email` is deliberately absent: nothing stores or reads an email address from
 * Facebook, and an unused permission is a review liability rather than a
 * harmless extra. Add it back only alongside code that uses it.
 *
 * All four pages_* permissions need **Advanced Access** before anyone outside
 * the app's own testers can grant them.
 */
export const REQUIRED_SCOPES = [
    'public_profile',
    'pages_show_list',
    'pages_read_engagement',
    // Analytics. Separate from pages_read_engagement on purpose: engagement
    // reads content, read_insights reads metrics, and holding one does not
    // grant the other — a distinction that surfaces as an empty analytics page
    // rather than an error if it is missed.
    'read_insights',
    'pages_manage_posts',
    'pages_manage_engagement',
];

/** Generate a random OAuth state nonce. */
export function newState() {
    return crypto.randomBytes(32).toString('hex');
}

/* ─────────────────────────── request plumbing ────────────────────────────── */

/**
 * `fetch`, with transport failures turned into ApiErrors.
 *
 * An unreachable host makes `fetch` throw `TypeError: fetch failed`, whose
 * message names neither host nor reason — the real cause sits on `err.cause`.
 * Left unwrapped those arrive at the callback as anonymous throws with no code
 * and nothing to report, which is precisely how the Instagram integration
 * became undebuggable. The URL is never included: it carries the access token.
 */
async function fbFetch(url, init, label) {
    try {
        return await fetch(url, init);
    } catch (err) {
        throw new ApiError(502, 'FACEBOOK_UNREACHABLE',
            `Facebook could not be reached during ${label}. Please try again shortly.`,
            {
                platform: 'facebook',
                providerMessage: String(err?.cause?.code ?? err?.cause?.message ?? err?.message ?? 'network error'),
                providerCode: null,
                providerStatus: null,
            });
    }
}

/**
 * Map a Graph error onto something the UI can act on.
 *
 * Meta's error codes are the difference between "the user must do something",
 * "you must ship something", and "try again later", and collapsing them into a
 * generic 500 loses exactly the distinction the person needs. The token never
 * appears in the message — it travels in the query string, so the URL is never
 * interpolated into an error.
 */
function fbError(label, status, body) {
    const err = body?.error ?? {};
    const code = Number(err.code);
    const subcode = Number(err.error_subcode);
    const message = err.message ?? 'Unknown Facebook error';

    const detail = {
        platform: 'facebook',
        providerCode: Number.isFinite(code) ? code : null,
        providerSubcode: Number.isFinite(subcode) ? subcode : null,
        providerStatus: status,
        providerMessage: String(message),
        providerType: err.type ?? null,
    };

    // 190 is an expired/invalid/revoked token; 102 a session problem. Both mean
    // the person must reconnect, and neither is worth retrying.
    if (status === 401 || code === 190 || code === 102) {
        return new ApiError(401, 'FACEBOOK_TOKEN_INVALID',
            'Your Facebook authorisation has expired or was revoked — please reconnect.',
            { ...detail, action: 'reconnect' });
    }

    // 10 and the 200-family are permission failures: the app was not granted
    // what this call needs, or the permission lacks Advanced Access.
    if (code === 10 || (code >= 200 && code <= 299)) {
        return new ApiError(403, 'FACEBOOK_PERMISSION_MISSING',
            'Facebook did not grant Marq the permission this action needs.',
            {
                ...detail,
                action: 'reconnect',
                howTo: [
                    'Reconnect Facebook and leave every requested permission ticked.',
                    'Make sure you grant access to the Page you want to manage.',
                    'If the app is still in Development Mode, the account must be an app Tester, Developer or Admin.',
                ],
            });
    }

    // 4 and 17 are rate limits; 341 an application-level throttle.
    if (code === 4 || code === 17 || code === 341 || status === 429) {
        return new ApiError(429, 'FACEBOOK_RATE_LIMITED',
            'Facebook is rate-limiting Marq right now. Please try again in a few minutes.',
            detail);
    }

    // 100 with subcode 33 is "no such object, or you cannot see it" — almost
    // always a Page the token has no role on, rather than a missing Page.
    if (code === 100 && subcode === 33) {
        return new ApiError(404, 'FACEBOOK_OBJECT_NOT_VISIBLE',
            'That Facebook Page or post is not visible to your account.',
            { ...detail, action: 'reconnect' });
    }

    return new ApiError(502, 'FACEBOOK_API_ERROR',
        `Facebook ${label} failed: ${message}`, detail);
}

/** One Graph request, parsed and error-mapped. */
async function graph(path, { method = 'GET', params = {}, body, accessToken, label }) {
    const url = new URL(`${GRAPH_URL}/${String(path).replace(/^\/+/, '')}`);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const init = { method };
    if (accessToken) {
        // In the Authorization header rather than the query string, so the token
        // cannot end up in an intermediary's request log.
        init.headers = { Authorization: `Bearer ${accessToken}` };
    }
    if (body) {
        init.headers = { ...init.headers, 'Content-Type': 'application/x-www-form-urlencoded' };
        init.body = new URLSearchParams(body);
    }

    const res = await fbFetch(url, init, label);
    const text = await res.text().catch(() => '');
    let json;
    try { json = JSON.parse(text); } catch { json = null; }

    if (!res.ok || json?.error) throw fbError(label, res.status, json);
    return json ?? {};
}

/* ──────────────────────────────── OAuth ──────────────────────────────────── */

/**
 * Build the Facebook OAuth URL.
 *
 * ── Facebook Login vs Facebook Login for Business ──────────────────────────
 * These take different parameters, and sending the wrong one fails in a way
 * that looks like a permissions problem rather than a configuration one:
 *
 *   Facebook Login               `scope=<comma-separated permissions>`
 *   Facebook Login for Business  `config_id=<configuration id>` — the
 *                                configuration in the App Dashboard carries the
 *                                permission list, and `scope` is IGNORED.
 *
 * So an app using Login for Business with a `scope` string gets a consent
 * screen granting nothing, and every later Page call fails with "permission
 * missing". This picks by configuration rather than by assumption: set
 * `FACEBOOK_CONFIG_ID` and the Business flow is used, leave it unset and the
 * classic flow is. Which one you need is decided in the App Dashboard, not
 * here — see the setup notes.
 */
export function buildAuthUrl(state) {
    const params = new URLSearchParams({
        client_id: env.facebook.appId,
        redirect_uri: env.facebook.redirectUri,
        state,
        response_type: 'code',
    });

    if (env.facebook.configId) {
        // Login for Business: the configuration owns the permission list.
        params.set('config_id', env.facebook.configId);
    } else {
        params.set('scope', REQUIRED_SCOPES.join(','));
    }

    return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`;
}

/** True when this environment is configured for the Business login flow. */
export const usesLoginForBusiness = () => Boolean(env.facebook.configId);

/**
 * Exchange the authorization code for a short-lived user access token.
 */
export async function exchangeCodeForToken(code) {
    const data = await graph('oauth/access_token', {
        label: 'token exchange',
        params: {
            client_id: env.facebook.appId,
            client_secret: env.facebook.appSecret,
            redirect_uri: env.facebook.redirectUri,
            code,
        },
    }).catch((err) => {
        // A reused code is worth its own message: the user usually just
        // refreshed the callback, and "try connecting again" is the fix.
        if (err.details?.providerCode === 100 && /used|expired/i.test(err.details?.providerMessage ?? '')) {
            throw new ApiError(400, 'FACEBOOK_CODE_ALREADY_USED',
                'That Facebook authorization has already been used. Please start the connection again.',
                { platform: 'facebook', action: 'retry' });
        }
        throw err;
    });

    if (!data.access_token) {
        throw new ApiError(502, 'FACEBOOK_TOKEN_MISSING',
            'Facebook returned no access token for this authorization code.',
            { platform: 'facebook' });
    }

    return {
        access_token: data.access_token,
        token_type: data.token_type || 'bearer',
        expires_in: Number(data.expires_in) || 3600,
        longLived: false,
    };
}

/**
 * Upgrade a short-lived user token to a long-lived one (~60 days).
 *
 * This is not optional housekeeping. Page access tokens inherit the lifetime of
 * the user token they were read with, so skipping this step yields Page tokens
 * that die within the hour — the connection appears to succeed and then stops
 * working, with the database still reporting it healthy.
 */
export async function exchangeForLongLivedToken(shortLivedToken) {
    const data = await graph('oauth/access_token', {
        label: 'long-lived token exchange',
        params: {
            grant_type: 'fb_exchange_token',
            client_id: env.facebook.appId,
            client_secret: env.facebook.appSecret,
            fb_exchange_token: shortLivedToken,
        },
    });

    if (!data.access_token) {
        throw new ApiError(502, 'FACEBOOK_TOKEN_MISSING',
            'Facebook returned no long-lived token.', { platform: 'facebook' });
    }

    return {
        access_token: data.access_token,
        token_type: data.token_type || 'bearer',
        // Long-lived user tokens are ~60 days; Facebook omits expires_in for
        // some app types, so a documented default beats an absent expiry.
        expires_in: Number(data.expires_in) || 5_184_000,
        longLived: true,
    };
}

/** The person who authorised, so the connection can be attributed. */
export async function fetchUserProfile(userAccessToken) {
    const data = await graph('me', {
        accessToken: userAccessToken,
        label: 'user profile fetch',
        params: { fields: 'id,name,picture.type(large)' },
    });

    return {
        id: String(data.id),
        name: data.name,
        profilePicture: data.picture?.data?.url ?? null,
    };
}

/* ────────────────────────────── Pages ────────────────────────────────────── */

/**
 * The Pages this person can act on, each with its own access token.
 *
 * `tasks` is the useful part and the reason it is requested: Facebook returns
 * what this user may actually do on each Page (CREATE_CONTENT, MANAGE,
 * MODERATE, ANALYZE). Without it the UI can only discover that someone lacks
 * publishing rights by letting them write a post and then failing — the
 * capability is knowable up front, so it should be known up front.
 *
 * Requires `pages_show_list`.
 */
export async function listPages(userAccessToken) {
    const data = await graph('me/accounts', {
        accessToken: userAccessToken,
        label: 'page list fetch',
        params: {
            fields: 'id,name,username,category,tasks,access_token,fan_count,followers_count,picture.type(large),link',
            limit: 100,
        },
    });

    return (data.data ?? []).map((page) => ({
        id: String(page.id),
        name: page.name,
        username: page.username ?? null,
        category: page.category ?? null,
        tasks: Array.isArray(page.tasks) ? page.tasks : [],
        accessToken: page.access_token ?? null,
        followers: page.followers_count ?? page.fan_count ?? 0,
        likes: page.fan_count ?? 0,
        picture: page.picture?.data?.url ?? null,
        link: page.link ?? null,
    }));
}

/** Page-level detail and engagement counts. Requires `pages_read_engagement`. */
export async function fetchPage(pageAccessToken, pageId) {
    const data = await graph(String(pageId), {
        accessToken: pageAccessToken,
        label: 'page fetch',
        params: {
            fields: 'id,name,username,about,description,category,link,website,fan_count,followers_count,picture.type(large),cover',
        },
    });

    return {
        id: String(data.id),
        name: data.name,
        username: data.username ?? null,
        about: data.about ?? null,
        description: data.description ?? null,
        category: data.category ?? null,
        link: data.link ?? null,
        website: data.website ?? null,
        followers: data.followers_count ?? data.fan_count ?? 0,
        likes: data.fan_count ?? 0,
        picture: data.picture?.data?.url ?? null,
        cover: data.cover?.source ?? null,
    };
}

/** Recent Page posts with engagement summaries. Requires `pages_read_engagement`. */
export async function fetchPagePosts(pageAccessToken, pageId, limit = 25) {
    const data = await graph(`${pageId}/posts`, {
        accessToken: pageAccessToken,
        label: 'page posts fetch',
        params: {
            fields: 'id,message,created_time,permalink_url,full_picture,'
                + 'reactions.summary(true).limit(0),comments.summary(true).limit(0),shares',
            limit,
        },
    });

    return (data.data ?? []).map((post) => ({
        id: String(post.id),
        message: post.message ?? '',
        createdTime: post.created_time,
        permalink: post.permalink_url ?? null,
        image: post.full_picture ?? null,
        reactions: post.reactions?.summary?.total_count ?? 0,
        comments: post.comments?.summary?.total_count ?? 0,
        shares: post.shares?.count ?? 0,
    }));
}

/**
 * Publish to the Page. Requires `pages_manage_posts`.
 *
 * Posted with the **Page** access token, not the user token — a user token here
 * either fails or posts as the person rather than the Page.
 */
export async function publishPost(pageAccessToken, pageId, { message, link } = {}) {
    if (!message && !link) {
        throw ApiError.badRequest('A post needs a message or a link.');
    }

    const data = await graph(`${pageId}/feed`, {
        method: 'POST',
        accessToken: pageAccessToken,
        label: 'post publish',
        body: { ...(message ? { message } : {}), ...(link ? { link } : {}) },
    });

    return { id: String(data.id) };
}

/** Remove a Page post. Requires `pages_manage_posts`. */
export async function deletePost(pageAccessToken, postId) {
    await graph(String(postId), {
        method: 'DELETE', accessToken: pageAccessToken, label: 'post delete',
    });
    return { deleted: true };
}

/* ──────────────────────────── Comments ───────────────────────────────────── */

/** Comments on a post. Requires `pages_read_engagement`. */
export async function fetchComments(pageAccessToken, postId, limit = 50) {
    const data = await graph(`${postId}/comments`, {
        accessToken: pageAccessToken,
        label: 'comments fetch',
        params: {
            fields: 'id,message,created_time,from{id,name},like_count,comment_count,is_hidden',
            limit,
            order: 'reverse_chronological',
        },
    });

    return (data.data ?? []).map((c) => ({
        id: String(c.id),
        message: c.message ?? '',
        createdTime: c.created_time,
        authorName: c.from?.name ?? 'Facebook user',
        authorId: c.from?.id ?? null,
        likes: c.like_count ?? 0,
        replies: c.comment_count ?? 0,
        hidden: Boolean(c.is_hidden),
    }));
}

/** Reply to a comment as the Page. Requires `pages_manage_engagement`. */
export async function replyToComment(pageAccessToken, commentId, message) {
    if (!message?.trim()) throw ApiError.badRequest('A reply needs a message.');

    const data = await graph(`${commentId}/comments`, {
        method: 'POST', accessToken: pageAccessToken, label: 'comment reply',
        body: { message },
    });
    return { id: String(data.id) };
}

/**
 * Hide or unhide a comment. Requires `pages_manage_engagement`.
 *
 * Hiding is preferred to deleting for moderation: it removes the comment from
 * public view without destroying it, so a moderation decision stays reversible.
 */
export async function setCommentHidden(pageAccessToken, commentId, hidden = true) {
    await graph(String(commentId), {
        method: 'POST', accessToken: pageAccessToken, label: 'comment moderation',
        body: { is_hidden: hidden ? 'true' : 'false' },
    });
    return { hidden };
}

/** Delete a comment. Requires `pages_manage_engagement`. */
export async function deleteComment(pageAccessToken, commentId) {
    await graph(String(commentId), {
        method: 'DELETE', accessToken: pageAccessToken, label: 'comment delete',
    });
    return { deleted: true };
}

/* ─────────────────────────── Page insights ───────────────────────────────── */

/**
 * Page insight metrics, in preference order.
 *
 * Facebook retires Page metrics regularly and without a redirect — the
 * `page_engaged_users` family and several `page_views_*` metrics have all been
 * removed or narrowed across recent versions. As with Instagram, one retired
 * name in a comma-separated `metric=` list fails the entire request, so these
 * go through discovery rather than being trusted: whatever this Page and Graph
 * version still serve comes back, the rest are reported unavailable.
 *
 * Requires `read_insights`, which is separate from `pages_read_engagement` —
 * engagement reads content, insights reads analytics, and having one does not
 * grant the other.
 */
export const PAGE_METRICS = [
    'page_impressions_unique',
    'page_impressions',
    'page_post_engagements',
    'page_fans',
    'page_fan_adds',
    'page_fan_removes',
    'page_views_total',
    'page_video_views',
];

/**
 * Page-level insights for the last `days` days.
 *
 * @returns the normalised shape — every metric either carries a value or is
 *          explicitly marked unavailable, never silently zero.
 */
export async function fetchPageInsights(pageAccessToken, pageId, { days = 28 } = {}) {
    const since = Math.floor((Date.now() - days * 86_400_000) / 1000);
    const until = Math.floor(Date.now() / 1000);

    const { data, unavailable } = await requestSupportedMetrics(
        PAGE_METRICS,
        (metrics) => graph(`${pageId}/insights`, {
            accessToken: pageAccessToken,
            label: 'page insights fetch',
            params: { metric: metrics.join(','), period: 'day', since, until },
        }),
        {
            onDrop: ({ dropped, remaining }) => logger.warn(
                'Facebook Page insights: metric not supported, retrying without it.',
                { dropped, remaining: remaining.length },
            ),
        },
    );

    return normaliseInsights(data?.data, unavailable);
}

/** Whether Facebook is configured well enough to attempt live OAuth. */
export function facebookConfigStatus() {
    const missing = [];
    if (!env.facebook.appId) missing.push('FACEBOOK_APP_ID');
    if (!env.facebook.appSecret) missing.push('FACEBOOK_APP_SECRET');
    if (!env.facebook.redirectUri) missing.push('FACEBOOK_REDIRECT_URI');

    return {
        configured: missing.length === 0,
        missing,                       // variable NAMES only, never values
        loginForBusiness: usesLoginForBusiness(),
        graphVersion: GRAPH_VERSION,
        scopes: usesLoginForBusiness() ? null : REQUIRED_SCOPES,
    };
}
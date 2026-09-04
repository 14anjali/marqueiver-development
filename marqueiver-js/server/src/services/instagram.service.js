import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/apiError.js';

/**
 * Instagram OAuth + Graph integration — **Instagram API with Instagram Login**
 * (Meta's "Business Login for Instagram"), not Facebook Login and not the
 * retired Basic Display API.
 *
 * The three things that identify the flow, and that the rest of this file
 * depends on being true:
 *
 *   authorize   https://www.instagram.com/oauth/authorize   ← instagram.com, not facebook.com
 *   token       https://api.instagram.com/oauth/access_token
 *   graph       https://graph.instagram.com                 ← not graph.facebook.com
 *   scopes      instagram_business_basic, …_content_publish, …_manage_insights
 *
 * The token this yields is an **Instagram User access token**. It is not a
 * Facebook/Meta user token and it is not interchangeable with one: it is only
 * valid against `graph.instagram.com`, and sending it to `graph.facebook.com`
 * fails. That is why nothing here shares a host or a token with the Facebook
 * integration, and why fixing this file cannot affect Facebook or Google auth.
 *
 * ── The production failure this file was rewritten to fix ──────────────────
 * `GET https://graph.instagram.com/v22.0/me` returned
 *   {"error":{"message":"Unsupported request - method type: get",
 *             "type":"IGApiException","code":100}}
 *
 * That message is the host rejecting the **path**, not the fields — an invalid
 * field produces `Tried accessing nonexisting field (…) on node type (…)`
 * instead. `graph.instagram.com` reads a leading `/v22.0/` segment it does not
 * recognise as a node id, so the request became "GET the node named v22.0",
 * which supports no GET. Every call in this file carried that prefix, so the
 * damage was wider than the one 500:
 *
 *   - `/v22.0/me`            → the 500 in the logs (uncaught)
 *   - `/v22.0/{id}`          → would have failed next, in fetchProfile
 *   - `/v22.0/access_token`  → the long-lived token exchange, **silently
 *                              swallowed** by a catch that logged a warning and
 *                              carried on. Production has therefore been
 *                              storing one-hour tokens stamped with a sixty-day
 *                              expiry, so connections die overnight and the
 *                              database says they are fine.
 *
 * Requests now go through `igGet`, which uses the documented unversioned path
 * and falls back across candidates on a path-shaped rejection, logging which
 * form worked so a version can be pinned deliberately rather than guessed.
 */

const IG_AUTHORIZE = 'https://www.instagram.com/oauth/authorize';
const IG_TOKEN = 'https://api.instagram.com/oauth/access_token';
const IG_GRAPH_HOST = 'https://graph.instagram.com';

// Business Login scopes.
const DEFAULT_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
];

/** Short-lived Instagram tokens last an hour; long-lived ones sixty days. */
const SHORT_LIVED_TTL_SECONDS = 3600;
const LONG_LIVED_TTL_SECONDS = 5_184_000;

/**
 * Check whether Instagram is configured for live OAuth.
 */
export function isLiveMode() {
  return (
    env.integrationMode === 'live' &&
    !!env.instagram.appId &&
    !!env.instagram.appSecret
  );
}

/* ────────────────────────── graph request layer ──────────────────────────── */

/**
 * Candidate URLs for a graph path, best-documented first.
 *
 * With no version configured this is a single unversioned URL and there is no
 * fallback behaviour at all. A configured version is tried first and the
 * unversioned form kept as a safety net, because pinning a version that the
 * host later stops accepting should degrade to a logged warning rather than to
 * the outage this file just had.
 */
export function graphCandidates(path, version = env.instagram.graphVersion) {
  const clean = String(path).replace(/^\/+/, '');
  const unversioned = `${IG_GRAPH_HOST}/${clean}`;
  if (!version) return [unversioned];
  return [`${IG_GRAPH_HOST}/${version}/${clean}`, unversioned];
}

/**
 * Is this the host telling us the *path* is wrong, rather than the fields or
 * the token? Only that is worth retrying against another path form; a bad
 * token or a missing permission would return the same answer every time and
 * retrying would just double the latency of a guaranteed failure.
 */
function isPathRejection(body) {
  const err = body?.error;
  if (!err) return false;
  return Number(err.code) === 100
    && /unsupported\s+(get\s+)?request|method type/i.test(String(err.message ?? ''));
}

/** The field name Meta names in a "nonexisting field" error, if that's what this is. */
function nonexistentField(body) {
  const message = String(body?.error?.message ?? '');
  const match = message.match(/nonexisting field \(([^)]+)\)/i);
  return match ? match[1] : null;
}

/**
 * A provider error the UI can act on, carrying Instagram's own message.
 *
 * The message is included deliberately — the standing rule here is not to hide
 * provider errors behind a generic 500, because that is what turned this bug
 * into a production mystery. The access token never appears: it travels in the
 * query string, so the URL is never logged or interpolated into an error.
 */
function igError(label, status, body, rawText) {
  const provider = body?.error?.message ?? String(rawText ?? '').slice(0, 300);
  const providerCode = body?.error?.code;

  // Instagram signals a dead or revoked token as 190 (and 102 for a session
  // problem). syncInstagram matches on the message to mark the account expired,
  // so that wording is kept intact.
  const isAuth = status === 401 || [190, 102, 463, 467].includes(Number(providerCode));

  return new ApiError(
    isAuth ? 401 : 502,
    isAuth ? 'INSTAGRAM_TOKEN_INVALID' : 'INSTAGRAM_API_ERROR',
    isAuth
      ? 'Instagram authorization expired or was revoked — please reconnect.'
      : `Instagram ${label} failed: ${provider}`,
    {
      platform: 'instagram',
      providerCode: providerCode ?? null,
      providerStatus: status,
      // Kept verbatim so the field-narrowing retry can read the field name
      // Instagram named, even when the message above was replaced.
      providerMessage: String(provider),
    },
  );
}

/**
 * `fetch`, with transport failures turned into ApiErrors.
 *
 * An unreachable host, a DNS failure, a TLS problem or a socket reset makes
 * `fetch` throw `TypeError: fetch failed` — a message that names neither the
 * host nor the reason, with the real cause hidden on `err.cause`. Every one of
 * those escaped this module unwrapped, so the callback's handler received
 * something with no `code`, no `details`, and a message that says nothing:
 *
 *   { name: 'Error', code: 'UNKNOWN', providerCode: null, message: undefined }
 *
 * which is exactly the shape production reported. A network failure is a
 * legitimate outcome and should be reported as one, not leak out as an
 * anonymous throw. The URL is never included — it carries the access token.
 */
async function igFetch(url, init, label) {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new ApiError(502, 'INSTAGRAM_UNREACHABLE',
      `Instagram could not be reached during ${label}. Please try again shortly.`,
      {
        platform: 'instagram',
        // The cause is where undici puts the real reason (ENOTFOUND, ECONNRESET,
        // UND_ERR_CONNECT_TIMEOUT…). Never the URL.
        providerMessage: String(err?.cause?.code ?? err?.cause?.message ?? err?.message ?? 'network error'),
        providerCode: null,
        providerStatus: null,
      });
  }
}

/**
 * GET a graph.instagram.com node, trying each candidate path form.
 *
 * @param {string} path    node path, e.g. 'me' or '17841400000000000'
 * @param {object} params  query parameters (access_token included by caller)
 * @param {string} label   what to call this in an error message
 */
async function igGet(path, params, label) {
  const candidates = graphCandidates(path);
  let lastFailure;

  for (let i = 0; i < candidates.length; i += 1) {
    const url = new URL(candidates[i]);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const res = await igFetch(url, undefined, label);
    const text = await res.text().catch(() => '');
    let body;
    try { body = JSON.parse(text); } catch { body = null; }

    if (res.ok) {
      if (i > 0) {
        // Never log `url` — it carries the access token.
        logger.warn(
          `Instagram ${label}: the configured graph version was rejected; `
          + 'the unversioned path worked. Clear or correct INSTAGRAM_GRAPH_VERSION.',
          { path, configuredVersion: env.instagram.graphVersion },
        );
      }
      return body ?? {};
    }

    lastFailure = { status: res.status, body, text };

    // Only a path-shaped rejection is worth another form.
    if (isPathRejection(body) && i < candidates.length - 1) continue;
    break;
  }

  throw igError(label, lastFailure.status, lastFailure.body, lastFailure.text);
}

/**
 * GET a node, dropping fields Meta says do not exist and retrying.
 *
 * Field availability on the Instagram node has moved between API generations —
 * `account_type` in particular exists under some configurations and not others.
 * Losing an optional field should cost us that field, not the whole connection:
 * before this, one retired field name would have failed the entire callback and
 * blocked onboarding for every creator.
 *
 * Bounded by the number of fields, and each drop is logged so a permanently
 * absent field gets noticed rather than silently tolerated forever.
 */
async function igGetFields(path, fields, accessToken, label) {
  let remaining = [...fields];

  for (let attempt = 0; attempt < fields.length; attempt += 1) {
    try {
      return await igGet(path, { fields: remaining.join(','), access_token: accessToken }, label);
    } catch (err) {
      const dropped = nonexistentField({
        error: { message: err.details?.providerMessage ?? err.message },
      });

      if (!dropped || !remaining.includes(dropped) || remaining.length === 1) throw err;

      remaining = remaining.filter((f) => f !== dropped);
      logger.warn(`Instagram ${label}: dropping unsupported field "${dropped}" and retrying.`,
        { remaining });
    }
  }

  throw new ApiError(502, 'INSTAGRAM_API_ERROR',
    `Instagram ${label} failed: no supported fields remained.`, { platform: 'instagram' });
}

/**
 * Read a node's fields, trying each candidate node in turn.
 *
 * Only a *path* rejection moves to the next candidate — the host telling us the
 * node is not routable. A bad token or a missing permission answers the same
 * way whichever node is asked, so retrying those would only double the latency
 * of a certain failure.
 *
 * Which node worked is logged, because "which node does this app's token
 * actually address" is the question this integration has now got wrong twice,
 * and it should be answerable from the logs rather than by reasoning.
 */
async function igGetFieldsFromNodes(nodes, fields, accessToken, label) {
  let lastError;

  for (let i = 0; i < nodes.length; i += 1) {
    const kind = nodes[i] === 'me' ? 'me' : 'id';
    const version = env.instagram.graphVersion ? `${env.instagram.graphVersion}/` : '';

    logger.info('Instagram OAuth step:', {
      operation: 'profileRequest',
      status: 'started',
      // Host and path only. The access token travels in the query string and
      // must never reach a log line.
      endpoint: `${IG_GRAPH_HOST}/${version}${nodes[i]}`,
      node: kind,
      fieldCount: fields.length,
    });

    try {
      const result = await igGetFields(nodes[i], fields, accessToken, label);
      logger.info('Instagram OAuth step:', {
        operation: 'profileRequest',
        status: 'ok',
        node: kind,
        fieldsReturned: Object.keys(result ?? {}),
      });
      return result;
    } catch (err) {
      lastError = err;

      const pathRejected = isPathRejection({
        error: {
          code: err.details?.providerCode,
          message: err.details?.providerMessage ?? err.message,
        },
      });

      logger.warn('Instagram OAuth step failed:', {
        operation: 'profileRequest',
        node: kind,
        status: err.details?.providerStatus ?? err.status,
        providerCode: err.details?.providerCode ?? null,
        providerMessage: err.details?.providerMessage ?? err.message,
        willRetryOtherNode: pathRejected && i < nodes.length - 1,
      });

      if (pathRejected && i < nodes.length - 1) continue;
      throw err;
    }
  }

  throw lastError;
}

/* ──────────────────────────────── OAuth ──────────────────────────────────── */

/**
 * Build Instagram OAuth authorization URL.
 */
export function buildAuthUrl(state) {
  const redirectUri = env.instagram.redirectUri;

  // Mock mode
  if (!isLiveMode()) {
    const u = new URL(env.instagram.redirectUri);
    u.searchParams.set('code', 'mock_code_' + state);
    u.searchParams.set('state', state);
    return u.toString();
  }

  const params = new URLSearchParams({
    client_id: env.instagram.appId,
    redirect_uri: redirectUri,
    scope: DEFAULT_SCOPES.join(','),
    response_type: 'code',
    state,
  });

  return `${IG_AUTHORIZE}?${params.toString()}`;
}

/**
 * Read the token response, which comes in two shapes.
 *
 * Business Login returns `{ data: [ { access_token, user_id, permissions } ] }`
 * on current versions and a flat `{ access_token, user_id }` on older ones.
 * The previous code read `json.user_id` only, so against the current shape the
 * id came back `undefined` and was stored as an empty string — which is also
 * why `igUserId` was empty on connected accounts and the duplicate-account
 * index could never fire.
 */
export function readTokenResponse(json) {
  const first = Array.isArray(json?.data) ? (json.data[0] ?? {}) : (json ?? {});
  return {
    accessToken: first.access_token ?? null,
    userId: first.user_id != null ? String(first.user_id) : '',
    permissions: Array.isArray(first.permissions)
      ? first.permissions
      : String(first.permissions ?? '').split(',').filter(Boolean),
    expiresIn: Number(first.expires_in) || null,
  };
}

/**
 * Exchange Instagram authorization code for an access token.
 */
export async function exchangeCodeForToken(code) {
  // Mock mode
  if (!isLiveMode()) {
    const seed = hash(code);
    return {
      access_token: 'mock_token_' + seed,
      user_id: 'ig_' + (seed % 100000000),
      tokenType: 'bearer',
      scopes: DEFAULT_SCOPES,
      expires_in: LONG_LIVED_TTL_SECONDS,
      longLived: true,
    };
  }

  const body = new URLSearchParams({
    client_id: env.instagram.appId,
    client_secret: env.instagram.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: env.instagram.redirectUri,
    code,
  });

  const res = await igFetch(IG_TOKEN, { method: 'POST', body }, 'token exchange');
  const text = await res.text().catch(() => '');
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  if (!res.ok) throw igError('token exchange', res.status, json, text);

  const parsed = readTokenResponse(json);
  if (!parsed.accessToken) {
    throw new ApiError(502, 'INSTAGRAM_TOKEN_MISSING',
      'Instagram returned no access token for this authorization code.',
      { platform: 'instagram' });
  }

  /**
   * Upgrade to a long-lived token.
   *
   * Documented unversioned, and routed through `igGet` so a stray version
   * prefix cannot silently break it the way it did before. A failure here is
   * not fatal — the short-lived token still completes this connection — but the
   * reported lifetime now matches the token we actually hold. Claiming sixty
   * days for a one-hour token is worse than a short expiry, because the sync
   * job trusts `tokenExpiresAt` and will not refresh what it believes is fresh.
   */
  let accessToken = parsed.accessToken;
  let expiresIn = SHORT_LIVED_TTL_SECONDS;
  let longLived = false;

  try {
    const long = await igGet('access_token', {
      grant_type: 'ig_exchange_token',
      client_secret: env.instagram.appSecret,
      access_token: accessToken,
    }, 'long-lived token exchange');

    if (long?.access_token) {
      accessToken = long.access_token;
      expiresIn = Number(long.expires_in) || LONG_LIVED_TTL_SECONDS;
      longLived = true;
    }
  } catch (err) {
    logger.warn(
      'Instagram long-lived token exchange failed; keeping the short-lived token. '
      + 'The connection will need reconnecting within the hour.',
      { reason: err.message },
    );
  }

  return {
    access_token: accessToken,
    user_id: parsed.userId,
    tokenType: 'bearer',
    scopes: parsed.permissions.length ? parsed.permissions : DEFAULT_SCOPES,
    expires_in: expiresIn,
    longLived,
  };
}

/* ─────────────────────────────── graph reads ─────────────────────────────── */

/**
 * Fetch the connected Instagram user's id and username.
 *
 * Note this is now a *fallback*, not the primary source of the id: the token
 * exchange already returns `user_id`, and the callback prefers it. Keeping a
 * network round-trip on the critical path to fetch a value we were just handed
 * is what turned a single broken endpoint into a failed connection.
 *
 * `user_id` is the Instagram-scoped id under Instagram Login; `id` is accepted
 * as a fallback because the two generations of this API differ on which is
 * returned, and the caller only needs whichever one identifies the account.
 */
export async function fetchMe(accessToken, igUserId) {
  if (!isLiveMode() || String(accessToken).startsWith('mock_token_')) {
    const seed = hash(accessToken);
    return {
      id: igUserId || 'ig_' + (seed % 100000000),
      username: 'creator_' + (seed % 9999),
    };
  }

  const p = await igGetFields('me', ['user_id', 'username'], accessToken, '/me fetch');

  const id = p.user_id ?? p.id;
  if (!id) {
    throw new ApiError(502, 'INSTAGRAM_ID_MISSING',
      'Instagram did not return an account id for this login.',
      { platform: 'instagram' });
  }

  return { id: String(id), username: p.username };
}

/**
 * Fetch the connected Instagram profile.
 */
export async function fetchProfile(accessToken, igUserId) {
  if (!isLiveMode() || String(accessToken).startsWith('mock_token_')) {
    const seed = hash(accessToken);
    return {
      id: igUserId || 'ig_' + (seed % 100000000),
      username: 'creator_' + (seed % 9999),
      name: 'Marqueiver Creator',
      profile_picture_url: `https://i.pravatar.cc/300?u=${seed}`,
      biography: 'Fitness & lifestyle creator on Marqueiver.',
      followers_count: 10000 + ((seed * 137) % 500000),
      follows_count: 100 + (seed % 2000),
      media_count: 50 + (seed % 900),
      account_type: ['PERSONAL', 'CREATOR', 'BUSINESS'][seed % 3],
      is_verified: seed % 10 === 0,
      website: 'https://marqueiver.com',
      dataSource: 'connected',
    };
  }

  const FIELDS = [
    'id', 'user_id', 'username', 'name', 'profile_picture_url',
    'followers_count', 'follows_count', 'media_count',
    'account_type', 'biography', 'website',
  ];

  /**
   * Which node to read the profile from.
   *
   * This used `String(igUserId)` alone — the `user_id` handed back by the token
   * exchange — and that is what production is failing on:
   *
   *   GET https://graph.instagram.com/{user_id}?fields=…
   *   {"error":{"message":"Unsupported request - method type: get",
   *             "type":"IGApiException","code":100}}
   *
   * That message is the host saying the *path* is not a routable node — the
   * same class of failure as the `/v22.0/` prefix before it, and distinct from
   * a bad field ("Tried accessing nonexisting field") or a bad object
   * ("Object with ID … does not exist"). Under Instagram Login the token
   * response's `user_id` is an app-scoped identifier; it identifies the account
   * but is not addressable as a Graph node.
   *
   * `me` is. An Instagram User access token *is* the identity, so the node
   * needs no id at all, and the response carries `id` and `user_id` anyway.
   *
   * Note this does not add a request: the profile fetch is one call either way,
   * and it is the same call that was already being made — only the node
   * changes. The id from the token is still used, as the second candidate and
   * as the value persisted, so nothing is lost if `me` is ever refused.
   */
  const nodes = ['me', igUserId ? String(igUserId) : null].filter(Boolean);
  const p = await igGetFieldsFromNodes(nodes, FIELDS, accessToken, 'profile fetch');

  return {
    id: String(p.user_id ?? p.id ?? igUserId),
    username: p.username,
    name: p.name || p.username,
    profile_picture_url: p.profile_picture_url,
    biography: p.biography,
    followers_count: p.followers_count,
    follows_count: p.follows_count,
    media_count: p.media_count,
    /**
     * Left undefined rather than defaulted when Instagram does not return it.
     * The old `|| 'BUSINESS'` meant an account whose type we never learned was
     * recorded as eligible — the eligibility gate could not fail, because its
     * input was manufactured. `assertInstagramEligible` decides what an absent
     * type means; this function's job is to report what Instagram said.
     */
    account_type: p.account_type ? String(p.account_type).toUpperCase() : undefined,
    is_verified: p.is_verified || false,
    website: p.website,
    dataSource: 'connected',
  };
}

/**
 * Fetch Instagram insights. Optional — a failure here must not fail a connection.
 */
export async function fetchInsights(
  accessToken,
  igUserId,
  metricNames = ['follower_count', 'media_count'],
) {
  if (!isLiveMode() || String(accessToken).startsWith('mock_token_')) {
    return {
      follower_count: { value: 10000 },
      media_count: { value: 150 },
    };
  }

  try {
    const data = await igGet(`${igUserId}/insights`, {
      metric: metricNames.join(','),
      access_token: accessToken,
    }, 'insights fetch');
    return data.data;
  } catch (e) {
    logger.warn('Instagram insights fetch failed', { error: e.message });
    return null;
  }
}

/**
 * Generate OAuth state.
 */
export function newState() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Simple deterministic hash for mock data.
 */
function hash(s) {
  return [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
}
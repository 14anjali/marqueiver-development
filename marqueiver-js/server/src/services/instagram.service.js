import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/apiError.js';
import { requestSupportedMetrics, normaliseInsights } from '../utils/metricDiscovery.js';

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

    /**
     * The exact request Meta refused, minus the credential.
     *
     * `url.origin + url.pathname` is the full target with the query string —
     * and therefore the access token — removed, so the URL that failed can be
     * compared against the documentation character by character without the
     * token ever reaching a log. `x-fb-request-id` is what Meta support asks
     * for first if this has to be escalated to them.
     */
    logger.warn('Instagram graph request refused:', {
      operation: 'graphRequest',
      method: 'GET',
      endpoint: `${url.origin}${url.pathname}`,      // token-free by construction
      queryKeys: [...url.searchParams.keys()].filter((k) => k !== 'access_token'),
      fields: url.searchParams.get('fields') ?? null,
      httpStatus: res.status,
      providerCode: body?.error?.code ?? null,
      providerSubcode: body?.error?.error_subcode ?? null,
      providerType: body?.error?.type ?? null,
      providerMessage: body?.error?.message ?? null,
      fbRequestId: res.headers?.get?.('x-fb-request-id') ?? null,
      fbTraceId: body?.error?.fbtrace_id ?? null,
    });

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
async function igGetFields(path, fields, accessToken, label, extraParams = {}) {
  let remaining = [...fields];

  for (let attempt = 0; attempt < fields.length; attempt += 1) {
    try {
      return await igGet(path, {
        ...extraParams,
        fields: remaining.join(','),
        access_token: accessToken,
      }, label);
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
   * What Instagram ACTUALLY granted, before any defaulting.
   *
   * `scopeCount: 3` in the connect logs is not the evidence it appears to be:
   * the returned `scopes` fall back to DEFAULT_SCOPES when Instagram sends no
   * permissions, and DEFAULT_SCOPES has three entries. So a grant of nothing
   * and a grant of all three print the same number, and "were the scopes
   * granted?" has been unanswerable from the logs.
   *
   * `grantedPermissions` here is the raw value: an empty array means Instagram
   * granted none, which is a completely different problem from a bad endpoint.
   *
   * The token prefix is 8 characters. Meta token families are identifiable by
   * their prefix — `IGQ…` is an Instagram User token, `EAA…` a Facebook
   * one — and that single fact says whether this token belongs on
   * graph.instagram.com at all. Eight characters cannot be used to
   * authenticate anything.
   */
  logger.info('Instagram OAuth step:', {
    operation: 'inspectTokenGrant',
    status: 'ok',
    appIdUsed: env.instagram.appId,          // public identifier, not a secret
    tokenPrefix: String(parsed.accessToken).slice(0, 8),
    tokenLength: String(parsed.accessToken).length,
    tokenEmpty: !parsed.accessToken,
    grantedPermissions: parsed.permissions,  // raw — NOT the DEFAULT_SCOPES fallback
    grantedCount: parsed.permissions.length,
    requestedScopes: DEFAULT_SCOPES,
    userId: parsed.userId,                   // an account id, not a credential
    /**
     * The whole token response, with only the token itself removed.
     *
     * Whether Instagram answered `{data:[{…}]}` or a flat object, and whether
     * it included a `permissions` key at all, decides how the response should
     * be read — and neither has ever been visible. Everything except
     * `access_token` is structural or public.
     */
    rawResponseShape: (() => {
      const redact = (o) => Object.fromEntries(Object.entries(o ?? {})
        .map(([k, v]) => [k, k === 'access_token' ? '[REDACTED]' : v]));
      return Array.isArray(json?.data)
        ? { shape: 'data[]', keys: Object.keys(json.data[0] ?? {}), first: redact(json.data[0]) }
        : { shape: 'flat', keys: Object.keys(json ?? {}), body: redact(json) };
    })(),
  });

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
   * ── Why the id fallback is gone ────────────────────────────────────────────
   * It was kept as a second candidate on the theory that it might work if `me`
   * were ever refused. Production settled that: the diagnostics probe reported
   *
   *   endpoint: 'https://graph.instagram.com/28127701113565244'  → 400, code 100
   *
   * and that id is the tell. Instagram professional account ids sit in the
   * 17841… range; `2812770…` is the **app-scoped** id, which is what the token
   * response's `user_id` field carries under Instagram Login. An app-scoped id
   * identifies the account to this app and is not a Graph node — so this
   * request could never have succeeded for any token, version or field list.
   *
   * Keeping it cost more than the nothing it bought: every profile failure
   * produced two errors instead of one, the second one a guaranteed failure
   * that looked like corroborating evidence, and it made a version problem
   * read like a node problem. One node, one request, one honest error.
   *
   * The professional account id still reaches the database — it comes back
   * inside this response as `user_id`, which is read below.
   */
  const p = await igGetFieldsFromNodes(['me'], FIELDS, accessToken, 'profile fetch');

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

/* ────────────────────────────── diagnostics ──────────────────────────────── */

/**
 * Ask Meta what this token actually is, when a profile read has failed.
 *
 * ── Why a probe rather than another endpoint change ────────────────────────
 * The failure being diagnosed is that EVERY `graph.instagram.com` request is
 * refused with `(#100) Unsupported request - method type: get` — `/me`, the
 * id-addressed node, and the long-lived token exchange alike. That last one
 * matters most: it means the failure is not about which node is asked for,
 * because `/access_token` is not a node. Something about the host and token
 * pairing is wrong, and guessing a fourth endpoint would be the fourth guess.
 *
 * Trying the equivalent read on `graph.facebook.com` establishes which API
 * generation the token belongs to — Instagram Login tokens work only on
 * graph.instagram.com, Facebook Login tokens only on graph.facebook.com.
 *
 * The permissions Instagram actually granted are the other half of the answer,
 * and those are logged at `inspectTokenGrant` during the token exchange. An
 * empty `grantedPermissions` array with a successful OAuth is the signature of
 * a permission that has not cleared App Review: the consent screen renders, the
 * token issues, and nothing is authorised.
 *
 * This is a diagnostic, not a fallback. It runs only when a profile read has
 * already failed, only when INSTAGRAM_DIAGNOSTICS=1, it changes no behaviour,
 * and it never returns data to the caller — it writes findings to the log and
 * that is all. Nothing here becomes a code path that quietly papers over a
 * misconfiguration.
 *
 * No token, secret or authorization code is ever logged: only HTTP status,
 * Meta's own message, and its error codes.
 */
export async function diagnoseInstagramToken(accessToken, igUserId) {
  const findings = [];

  const probe = async (label, url, params) => {
    const target = new URL(url);
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, String(v));

    try {
      const res = await fetch(target);
      const text = await res.text().catch(() => '');
      let body; try { body = JSON.parse(text); } catch { body = null; }

      findings.push({
        probe: label,
        // Host and path only — the query string carries the token.
        endpoint: `${target.origin}${target.pathname}`,
        method: 'GET',
        status: res.status,
        ok: res.ok,
        providerCode: body?.error?.code ?? null,
        providerSubcode: body?.error?.error_subcode ?? null,
        providerType: body?.error?.type ?? null,
        providerMessage: body?.error?.message ?? null,
        fbRequestId: res.headers?.get?.('x-fb-request-id') ?? null,
        fbTraceId: body?.error?.fbtrace_id ?? null,
        // Field NAMES only. The values are the person's profile.
        returnedFields: res.ok && body ? Object.keys(body).slice(0, 12) : undefined,
      });
    } catch (err) {
      findings.push({ probe: label, endpoint: `${target.origin}${target.pathname}`, transportError: String(err?.cause?.code ?? err?.message ?? 'failed') });
    }
  };

  /**
   * The `debug_token` probe has been removed.
   *
   * It was meant to answer "which app issued this token", but it is a
   * graph.facebook.com endpoint and cannot parse an Instagram User access
   * token. Against this flow it returns
   *
   *   code 190 — Invalid OAuth access token - Cannot parse access token
   *
   * which reads exactly like "your token is invalid" and is nothing of the
   * kind: it means the wrong debugger was asked. A probe that returns a
   * false alarm is worse than no probe, because it sends the next hour of
   * debugging after a token that is fine.
   *
   * The token's own metadata — prefix, length, and the permissions Instagram
   * actually granted — is logged at `inspectTokenGrant` during the exchange,
   * which is the honest answer to the same question.
   */

  // 2. The read that is failing, so its exact response sits beside the others.
  await probe('instagram-host /me', `${IG_GRAPH_HOST}/me`, {
    fields: 'user_id,username', access_token: accessToken,
  });

  /**
   * 2b. The version dimension — the gap in the elimination so far.
   *
   * `/v22.0/me` failed, so the version prefix was removed; `/me` then failed
   * too, and the conclusion drawn was "versioning is not the problem". That
   * does not follow. v22.0 is old enough to have been retired, and a retired
   * version and an unsupported path produce the same code-100 response — so
   * "an old version fails" and "unversioned fails" together say nothing about
   * whether a CURRENT version works. It was never tried.
   *
   * Three forms, one run, and the answer is no longer a matter of opinion.
   */
  for (const version of ['v23.0', 'v22.0']) {
    await probe(`instagram-host /${version}/me`, `${IG_GRAPH_HOST}/${version}/me`, {
      fields: 'user_id,username', access_token: accessToken,
    });
  }

  // 3. The same read on the Facebook host. Success here would mean the token
  //    belongs to the Facebook Login generation and the app is configured for
  //    "Instagram API with Facebook Login", not Instagram Login.
  await probe('facebook-host /me', 'https://graph.facebook.com/me', {
    fields: 'id,name', access_token: accessToken,
  });

  // 4. Does the token grant anything at all on the Facebook host?
  await probe('facebook-host /me/accounts', 'https://graph.facebook.com/me/accounts', {
    access_token: accessToken,
  });

  if (igUserId) {
    await probe('instagram-host /{id}', `${IG_GRAPH_HOST}/${igUserId}`, {
      fields: 'username', access_token: accessToken,
    });
  }

  logger.warn('Instagram diagnostics — what Meta says about this token:', { findings });
  return findings;
}

/* ─────────────────────────── media & insights ────────────────────────────── */

/**
 * Media fields requested on the media edge.
 *
 * `igGetFields` drops any Meta rejects, so an unavailable field costs that
 * field rather than the whole request.
 */
const MEDIA_FIELDS = [
  'id', 'caption', 'media_type', 'media_product_type', 'media_url',
  'thumbnail_url', 'permalink', 'timestamp', 'like_count', 'comments_count',
];

/**
 * The connected account's media — posts, reels and carousels.
 *
 * Reels arrive on this same edge, distinguished by `media_product_type: REELS`
 * rather than a separate endpoint. Stories are not here: they live on a
 * different edge, expire in 24 hours, and nothing in Marqueiver displays them,
 * so they are not fetched.
 */
export async function fetchMedia(accessToken, igUserId, limit = 25) {
  if (!isLiveMode() || String(accessToken).startsWith('mock_token_')) {
    const seed = hash(accessToken);
    return Array.from({ length: 6 }, (_, i) => ({
      id: `mock_media_${seed}_${i}`,
      caption: `Mock post ${i + 1}`,
      media_type: i % 3 === 0 ? 'VIDEO' : 'IMAGE',
      media_product_type: i % 3 === 0 ? 'REELS' : 'FEED',
      permalink: 'https://instagram.com/p/mock',
      timestamp: new Date(Date.now() - i * 86_400_000).toISOString(),
      like_count: 100 + ((seed + i * 37) % 5000),
      comments_count: (seed + i) % 300,
    }));
  }

  const data = await igGetFields(
    `${igUserId}/media`, MEDIA_FIELDS, accessToken, 'media fetch',
    { limit: Math.min(limit, 100) },
  );

  return Array.isArray(data?.data) ? data.data : [];
}

/**
 * Account-level insight metrics, in preference order.
 *
 * Verified against Meta's Instagram User insights reference rather than
 * carried over: the previous implementation asked for `follower_count` and
 * `media_count`, which are media-edge *fields*, not account insight metrics —
 * it would have failed on every call had anything ever reached it.
 *
 * `impressions` is deliberately absent. Meta's reference states it was
 * deprecated in v22.0 and removed for all versions on 21 April 2025, replaced
 * by `views`. A second Meta page still lists `impressions`; discovery is what
 * makes that contradiction survivable either way.
 */
export const ACCOUNT_METRICS = [
  'reach',
  'views',
  'total_interactions',
  'likes',
  'comments',
  'shares',
  'saves',
  'replies',
  'follows_and_unfollows',
  'profile_links_taps',
  'accounts_engaged',
];

/**
 * Account-level insights for the last `days` days.
 *
 * Returns the normalised shape — every metric either has a value or is marked
 * unavailable — so a metric Meta refused never renders as a zero.
 */
export async function fetchAccountInsights(accessToken, igUserId, { days = 28 } = {}) {
  if (!isLiveMode() || String(accessToken).startsWith('mock_token_')) {
    const seed = hash(accessToken);
    return normaliseInsights(ACCOUNT_METRICS.slice(0, 6).map((name, i) => ({
      name, period: 'day', total_value: { value: 500 + ((seed + i * 91) % 20000) },
    })), ACCOUNT_METRICS.slice(6));
  }

  const since = Math.floor((Date.now() - days * 86_400_000) / 1000);
  const until = Math.floor(Date.now() / 1000);

  const { data, unavailable } = await requestSupportedMetrics(
    ACCOUNT_METRICS,
    (metrics) => igGet(`${igUserId}/insights`, {
      metric: metrics.join(','),
      metric_type: 'total_value',
      period: 'day',
      since,
      until,
      access_token: accessToken,
    }, 'account insights fetch'),
    {
      onDrop: ({ dropped, remaining }) => logger.warn(
        'Instagram account insights: metric not supported, retrying without it.',
        { dropped, remaining: remaining.length },
      ),
    },
  );

  return normaliseInsights(data?.data, unavailable);
}

/**
 * Per-media insight metrics.
 *
 * Meta's media-level reference 404s and its Insights guide is visibly stale
 * (it still presents `impressions` and `engagement`), so unlike the account
 * list these names are NOT verified against current documentation. That is
 * precisely why they go through discovery: whichever of them this account and
 * Graph version actually serve will come back, and the rest are reported
 * unavailable instead of failing the request.
 */
export const MEDIA_METRICS = [
  'reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions',
];

export async function fetchMediaInsights(accessToken, mediaId) {
  if (!isLiveMode() || String(accessToken).startsWith('mock_token_')) {
    const seed = hash(mediaId);
    return normaliseInsights(
      MEDIA_METRICS.slice(0, 4).map((name, i) => ({ name, total_value: { value: (seed + i * 13) % 9000 } })),
      MEDIA_METRICS.slice(4),
    );
  }

  const { data, unavailable } = await requestSupportedMetrics(
    MEDIA_METRICS,
    (metrics) => igGet(`${mediaId}/insights`, {
      metric: metrics.join(','),
      access_token: accessToken,
    }, 'media insights fetch'),
    {
      onDrop: ({ dropped }) => logger.warn(
        'Instagram media insights: metric not supported, retrying without it.', { dropped },
      ),
    },
  );

  return normaliseInsights(data?.data, unavailable);
}

/**
 * Backwards-compatible alias.
 *
 * `fetchInsights` was exported and never called from anywhere — dead code whose
 * existence made `instagram_business_manage_insights` look used when nothing
 * reached it. Kept as a thin alias so any caller added since keeps working.
 */
export const fetchInsights = fetchAccountInsights;

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
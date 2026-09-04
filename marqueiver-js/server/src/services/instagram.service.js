import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Instagram OAuth + Graph API integration.
 *
 * Uses Instagram Business Login.
 *
 * Flow:
 * 1. buildAuthUrl() → Instagram authorization
 * 2. exchangeCodeForToken() → authorization code → access token
 * 3. fetchMe() → connected Instagram user
 * 4. fetchProfile() → profile data
 * 5. fetchInsights() → optional insights
 */

// Instagram Business Login endpoints
const IG_AUTHORIZE =
  'https://www.instagram.com/oauth/authorize';

const IG_TOKEN =
  'https://api.instagram.com/oauth/access_token';

const IG_GRAPH =
  'https://graph.instagram.com/v22.0';

// Business Login scopes
const DEFAULT_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
];

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

/**
 * Build Instagram OAuth authorization URL.
 */
export function buildAuthUrl(state) {
  const redirectUri = env.instagram.redirectUri;

  // Mock mode
  if (!isLiveMode()) {
    const u = new URL(env.instagram.redirectUri);

    u.searchParams.set(
      'code',
      'mock_code_' + state
    );

    u.searchParams.set(
      'state',
      state
    );

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
 * Exchange Instagram authorization code for access token.
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
      expires_in: 5184000,
    };
  }

  /**
   * IMPORTANT:
   * Instagram credentials come from env.instagram,
   * NOT env.meta.
   */
  const body = new URLSearchParams({
    client_id: env.instagram.appId,
    client_secret: env.instagram.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: env.instagram.redirectUri,
    code,
  });

  const res = await fetch(IG_TOKEN, {
    method: 'POST',
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');

    throw new Error(
      `Instagram token exchange failed (${res.status}): ${text}`
    );
  }

  const json = await res.json();

  let accessToken = json.access_token;
  let expiresAt;

  /**
   * Exchange short-lived token for long-lived token.
   */
  try {
    const longUrl = new URL(
      `${IG_GRAPH}/access_token`
    );

    longUrl.searchParams.set(
      'grant_type',
      'ig_exchange_token'
    );

    longUrl.searchParams.set(
      'client_secret',
      env.instagram.appSecret
    );

    longUrl.searchParams.set(
      'access_token',
      accessToken
    );

    const longRes = await fetch(longUrl);

    if (longRes.ok) {
      const longJson = await longRes.json();

      accessToken =
        longJson.access_token || accessToken;

      if (longJson.expires_in) {
        expiresAt = new Date(
          Date.now() +
            longJson.expires_in * 1000
        );
      }
    }
  } catch (e) {
    logger.warn(
      'Long-lived Instagram token exchange failed; using short-lived token.'
    );
  }

  return {
    access_token: accessToken,

    user_id: String(
      json.user_id ?? ''
    ),

    tokenType: 'bearer',

    scopes: DEFAULT_SCOPES,

    expires_in: expiresAt
      ? Math.floor(
          (expiresAt - new Date()) / 1000
        )
      : 5184000,
  };
}

/**
 * Fetch connected Instagram user's basic information.
 */
export async function fetchMe(
  accessToken,
  igUserId
) {
  if (
    !isLiveMode() ||
    String(accessToken).startsWith('mock_token_')
  ) {
    const seed = hash(accessToken);

    return {
      id:
        igUserId ||
        'ig_' + (seed % 100000000),

      username:
        'creator_' + (seed % 9999),
    };
  }

  const fields = 'id,username';

  const url = new URL(
    `${IG_GRAPH}/me`
  );

  url.searchParams.set(
    'fields',
    fields
  );

  url.searchParams.set(
    'access_token',
    accessToken
  );

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => '');

    throw new Error(
      `Instagram /me fetch failed (${res.status}): ${text}`
    );
  }

  const p = await res.json();

  return {
    id: String(p.id),
    username: p.username,
  };
}

/**
 * Fetch connected Instagram profile.
 */
export async function fetchProfile(
  accessToken,
  igUserId
) {
  if (
    !isLiveMode() ||
    String(accessToken).startsWith('mock_token_')
  ) {
    const seed = hash(accessToken);

    return {
      id:
        igUserId ||
        'ig_' + (seed % 100000000),

      username:
        'creator_' + (seed % 9999),

      name: 'Marqueiver Creator',

      profile_picture_url:
        `https://i.pravatar.cc/300?u=${seed}`,

      biography:
        'Fitness & lifestyle creator on Marqueiver.',

      followers_count:
        10000 +
        ((seed * 137) % 500000),

      follows_count:
        100 +
        (seed % 2000),

      media_count:
        50 +
        (seed % 900),

      account_type:
        ['PERSONAL', 'CREATOR', 'BUSINESS'][
          seed % 3
        ],

      is_verified:
        seed % 10 === 0,

      website:
        'https://marqueiver.com',

      dataSource: 'connected',
    };
  }

  
const fields =
  'id,username,name,profile_picture_url,' +
  'followers_count,follows_count,media_count,' +
  'account_type,biography,website';

  const url = new URL(
    `${IG_GRAPH}/${igUserId}`
  );

  url.searchParams.set(
    'fields',
    fields
  );

  url.searchParams.set(
    'access_token',
    accessToken
  );

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => '');

    throw new Error(
      `Instagram profile fetch failed (${res.status}): ${text}`
    );
  }

  const p = await res.json();

  return {
    id: String(p.id),

    username: p.username,

    name:
      p.name ||
      p.username,

    profile_picture_url:
      p.profile_picture_url,

    biography:
      p.biography,

    followers_count:
      p.followers_count,

    follows_count:
      p.follows_count,

    media_count:
      p.media_count,

    account_type:
      (
        p.account_type ||
        'BUSINESS'
      ).toUpperCase(),

    is_verified:
      p.is_verified || false,

    website:
      p.website,

    dataSource: 'connected',
  };
}

/**
 * Fetch Instagram insights.
 */
export async function fetchInsights(
  accessToken,
  igUserId,
  metricNames = [
    'follower_count',
    'media_count',
  ]
) {
  if (
    !isLiveMode() ||
    String(accessToken).startsWith('mock_token_')
  ) {
    return {
      follower_count: {
        value: 10000,
      },

      media_count: {
        value: 150,
      },
    };
  }

  try {
    const url = new URL(
      `${IG_GRAPH}/${igUserId}/insights`
    );

    url.searchParams.set(
      'metric',
      metricNames.join(',')
    );

    url.searchParams.set(
      'access_token',
      accessToken
    );

    const res = await fetch(url);

    if (!res.ok) {
      logger.warn(
        'Instagram insights fetch failed',
        {
          status: res.status,
        }
      );

      return null;
    }

    const data = await res.json();

    return data.data;
  } catch (e) {
    logger.warn(
      'Instagram insights fetch failed',
      {
        error: e.message,
      }
    );

    return null;
  }
}

/**
 * Generate OAuth state.
 */
export function newState() {
  return crypto
    .randomBytes(16)
    .toString('hex');
}

/**
 * Simple deterministic hash for mock data.
 */
function hash(s) {
  return [...String(s)].reduce(
    (a, c) =>
      (a * 31 +
        c.charCodeAt(0)) >>>
      0,
    7
  );
}
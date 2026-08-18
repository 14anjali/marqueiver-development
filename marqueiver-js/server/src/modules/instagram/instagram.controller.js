import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok } from '../../utils/respond.js';
import { env } from '../../config/env.js';
import { verifyAccess } from '../../utils/tokens.js';
import { InstagramAccount, CreatorProfile, User } from '../../models/index.js';
import * as instagramService from '../../services/instagram.service.js';

/**
 * Instagram OAuth + data sync (SRS FR-4, FR-5).
 *
 * Flow:
 * GET  /auth/instagram           → redirect to IG consent (FR-4.2)
 * GET  /auth/instagram/callback  → exchange code, fetch profile, persist (FR-4.3–4.6)
 * GET  /instagram/profile        → return connected profile (proxied) (FR-5)
 * POST /instagram/sync           → on-demand refresh (FR-4.7)
 *
 * The access token is passed through OAuth `state` (signed) rather than a header,
 * because the browser navigates to IG and back. We embed the app JWT in `state`
 * so the callback can attribute the connection to the right user.
 */

// Persist the synced profile fields onto both the InstagramAccount and the
// creator's socialAccounts rollup (reusing existing profile structure).
async function persistProfile(userId, token, profile) {
  const doc = {
    user: userId,
    instagramId: profile.id,
    accessToken: token.access_token,
    tokenType: 'instagram_business',
    tokenExpiresAt: token.expires_in ? new Date(Date.now() + (token.expires_in * 1000)) : undefined,
    scopes: token.scopes || [],
    username: profile.username,
    displayName: profile.name,
    profilePicture: profile.profile_picture_url,
    bio: profile.biography,
    followers: profile.followers_count ?? 0,
    following: profile.follows_count ?? 0,
    mediaCount: profile.media_count ?? 0,
    accountType: profile.account_type || 'BUSINESS',
    isVerified: profile.is_verified || false,
    website: profile.website,
    dataSource: 'connected',
    status: 'connected',
    lastSyncedAt: new Date(),
  };

  const account = await InstagramAccount.findOneAndUpdate(
    { user: userId },
    doc,
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Mirror into the creator profile's socialAccounts (reuse existing shape).
  const creator = await CreatorProfile.findOne({ user: userId });
  if (creator) {
    const entry = {
      platform: 'instagram',
      handle: profile.username || '',
      followers: profile.followers_count ?? 0,
      engagementRate: creator.socialAccounts?.find((s) => s.platform === 'instagram')?.engagementRate ?? 0,
      verified: profile.is_verified || false,
      dataSource: 'connected',
    };
    const idx = (creator.socialAccounts || []).findIndex((s) => s.platform === 'instagram');
    if (idx >= 0) creator.socialAccounts[idx] = entry;
    else creator.socialAccounts.push(entry);
    await creator.save();
  }

  // Update user's connectedAccounts
  await User.findByIdAndUpdate(userId, {
    $addToSet: { connectedAccounts: 'instagram' },
  });

  return account;
}

/** FR-4.2 — begin the OAuth consent flow. Requires an authenticated user. */
export const startInstagramAuth = catchAsync(async (req, res) => {
  // `state` carries a CSRF nonce + the caller's JWT so the callback can identify them.
  const nonce = instagramService.newState();
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : req.query.token;

  if (!token) throw ApiError.unauthorized('Missing access token for Instagram connect');

  const state = `${nonce}.${token}`;
  const url = instagramService.buildAuthUrl(state);

  // Return the URL (SPA-friendly). Clients may also hit this as a redirect.
  if (req.query.redirect === '1') return res.redirect(url);

  ok(res, { authUrl: url, state: nonce });
});

/** FR-4.3–4.6 — handle the callback: exchange code, fetch + persist profile. */
export const instagramCallback = catchAsync(async (req, res) => {
  const { code, state, error, error_description: errDesc } = req.query;

  // FR §8 — user denied/cancelled consent.
  if (error) {
    return redirectResult(res, false, errDesc || 'Instagram connection was cancelled');
  }

  if (!code || !state) throw ApiError.badRequest('Missing code or state from Instagram');

  // Recover the user from the state's embedded JWT.
  const jwt = String(state).split('.').slice(1).join('.');
  let claims;
  try { claims = verifyAccess(jwt); } catch { throw ApiError.unauthorized('Invalid OAuth state'); }

  // Step 1: Exchange code for token
  const token = await instagramService.exchangeCodeForToken(String(code));

  // Step 2: Get IG User ID from /me endpoint
  const meData = await instagramService.fetchMe(token.access_token);

  // Step 3: Fetch full profile using IG User ID
  const profile = await instagramService.fetchProfile(token.access_token, meData.id);

  // Step 4: Persist profile
  await persistProfile(claims.sub, token, profile);

  return redirectResult(res, true, 'Instagram connected');
});

/** FR-5 — return the connected profile (token never included). */
export const getInstagramProfile = catchAsync(async (req, res) => {
  const account = await InstagramAccount.findOne({ user: req.auth.sub }).lean();
  if (!account) throw ApiError.notFound('No Instagram account connected');

  // accessToken is select:false, so it isn't present here — defensive delete anyway.
  delete account.accessToken;

  ok(res, account);
});

export const disconnectInstagram = catchAsync(async (req, res) => {
  const userId = req.auth.sub;

  await InstagramAccount.deleteOne({ user: userId });

  await CreatorProfile.findOneAndUpdate(
    { user: userId },
    {
      $pull: {
        socialAccounts: { platform: 'instagram' }
      }
    }
  );

  await User.findByIdAndUpdate(
    userId,
    {
      $pull: {
        connectedAccounts: 'instagram'
      }
    }
  );

  ok(res, { message: 'Instagram disconnected successfully' });
});

/** FR-4.7 — on-demand refresh of profile data. */
export const syncInstagram = catchAsync(async (req, res) => {
  const account = await InstagramAccount.findOne({ user: req.auth.sub }).select('+accessToken');
  if (!account) throw ApiError.notFound('No Instagram account connected');
  if (account.status !== 'connected') throw ApiError.badRequest('Instagram account is not connected');

  try {
    const profile = await instagramService.fetchProfile(account.accessToken, account.instagramId);

    const updated = await persistProfile(req.auth.sub, {
      access_token: account.accessToken,
      tokenType: account.tokenType,
      expires_in: account.tokenExpiresAt
        ? Math.floor((account.tokenExpiresAt - new Date()) / 1000)
        : 3600,
      scopes: account.scopes,
    }, profile);

    const view = updated.toObject();
    delete view.accessToken;

    ok(res, view);
  } catch (e) {
    // FR §8 — token expired/revoked or IG API unavailable.
    if (/expired|revoked|401|403/i.test(e.message)) {
      account.status = 'expired';
      await account.save();
      throw ApiError.unauthorized('Instagram authorization expired — please reconnect');
    }
    throw new ApiError(502, 'IG_SYNC_FAILED', 'Instagram is unavailable right now — try again shortly');
  }
});

// Redirect back to the frontend with a result flag the SPA can react to.
function redirectResult(res, success, message) {
//   const url = new URL('/onboarding/instagram', env.clientUrl);

//for development
const redirectPath = success ? '/profile' : '/onboarding/instagram';
const url = new URL(redirectPath, env.clientUrl);
//
  url.searchParams.set('ig', success ? 'connected' : 'error');
  url.searchParams.set('message', message);
  res.redirect(url.toString());
}
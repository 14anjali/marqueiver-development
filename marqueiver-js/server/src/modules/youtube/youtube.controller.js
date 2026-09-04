import { catchAsync, ApiError } from '../../utils/apiError.js';
import { assertNotLinkedElsewhere } from '../../services/socialConnect.service.js';
import { ok } from '../../utils/respond.js';
import { env } from '../../config/env.js';
import { verifyAccess } from '../../utils/tokens.js';
import { YouTubeChannel, CreatorProfile, User } from '../../models/index.js';
import * as youtubeService from '../../services/youtube.service.js';

/**
 * YouTube OAuth + data sync.
 *
 * Flow:
 * GET  /auth/youtube           → redirect to Google consent
 * GET  /auth/youtube/callback  → exchange code, fetch profile, persist
 * GET  /youtube/profile        → return connected profile
 * POST /youtube/sync           → on-demand refresh
 */

async function persistProfile(userId, token, profile) {
  const doc = {
    user: userId,
    youtubeChannelId: profile.id,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.tokenType,
    tokenExpiresAt: token.expires_in ? new Date(Date.now() + (token.expires_in * 1000)) : undefined,
    scopes: token.scopes || [],
    title: profile.title,
    description: profile.description,
    customUrl: profile.customUrl,
    publishedAt: profile.publishedAt,
    thumbnails: profile.thumbnails,
    viewCount: parseInt(profile.statistics?.viewCount || 0, 10),
    subscriberCount: parseInt(profile.statistics?.subscriberCount || 0, 10),
    videoCount: parseInt(profile.statistics?.videoCount || 0, 10),
    dataSource: 'connected',
    status: 'connected',
    lastSyncedAt: new Date(),
  };

  // One YouTube channel belongs to one Marqueiver user.
  await assertNotLinkedElsewhere('youtube', doc.youtubeChannelId, userId);

  const channel = await YouTubeChannel.findOneAndUpdate(
    { user: userId },
    doc,
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Mirror into creator profile's socialAccounts
  const creator = await CreatorProfile.findOne({ user: userId });
  if (creator) {
    const entry = {
      platform: 'youtube',
      handle: profile.customUrl || profile.title || '',
      followers: parseInt(profile.statistics?.subscriberCount || 0, 10),
      engagementRate: creator.socialAccounts?.find((s) => s.platform === 'youtube')?.engagementRate ?? 0,
      verified: false,
      dataSource: 'connected',
    };
    const idx = (creator.socialAccounts || []).findIndex((s) => s.platform === 'youtube');
    if (idx >= 0) creator.socialAccounts[idx] = entry;
    else creator.socialAccounts.push(entry);
    await creator.save();
  }

  // Update user's connectedAccounts
  await User.findByIdAndUpdate(userId, {
    $addToSet: { connectedAccounts: 'youtube' },
  });

  return channel;
}

/** Begin the OAuth consent flow. */
export const startYoutubeAuth = catchAsync(async (req, res) => {
  const nonce = youtubeService.newState();
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : req.query.token;

  if (!token) throw ApiError.unauthorized('Missing access token for YouTube connect');

  const state = `${nonce}.${token}`;
  const url = youtubeService.buildAuthUrl(state);

  if (req.query.redirect === '1') return res.redirect(url);

  ok(res, { authUrl: url, state: nonce });
});

/** Handle the callback: exchange code, fetch + persist profile. */
export const youtubeCallback = catchAsync(async (req, res) => {
  const { code, state, error, error_description: errDesc } = req.query;

  if (error) {
    return redirectResult(res, false, errDesc || 'YouTube connection was cancelled');
  }

  if (!code || !state) throw ApiError.badRequest('Missing code or state from YouTube');

  const jwt = String(state).split('.').slice(1).join('.');
  let claims;
  try { claims = verifyAccess(jwt); } catch { throw ApiError.unauthorized('Invalid OAuth state'); }

  const token = await youtubeService.exchangeCodeForToken(String(code));
  const profile = await youtubeService.fetchProfile(token.access_token, 'mine');
  await persistProfile(claims.sub, token, profile);

  return redirectResult(res, true, 'YouTube connected');
});

/** Return the connected profile (token never included). */
export const getYoutubeProfile = catchAsync(async (req, res) => {
  const channel = await YouTubeChannel.findOne({ user: req.auth.sub }).lean();
  if (!channel) throw ApiError.notFound('No YouTube channel connected');

  delete channel.accessToken;
  delete channel.refreshToken;

  ok(res, channel);
});

/** On-demand refresh of profile data. */
export const syncYoutube = catchAsync(async (req, res) => {
  const channel = await YouTubeChannel.findOne({ user: req.auth.sub }).select('+accessToken +refreshToken');
  if (!channel) throw ApiError.notFound('No YouTube channel connected');
  if (channel.status !== 'connected') throw ApiError.badRequest('YouTube channel is not connected');

  try {
    const profile = await youtubeService.fetchProfile(channel.accessToken, channel.youtubeChannelId);

    const updated = await persistProfile(req.auth.sub, {
      access_token: channel.accessToken,
      refresh_token: channel.refreshToken,
      tokenType: channel.tokenType,
      expires_in: channel.tokenExpiresAt
        ? Math.floor((channel.tokenExpiresAt - new Date()) / 1000)
        : 3600,
      scopes: channel.scopes,
    }, profile);

    const view = updated.toObject();
    delete view.accessToken;
    delete view.refreshToken;

    ok(res, view);
  } catch (e) {
    if (/expired|revoked|401|403/i.test(e.message)) {
      channel.status = 'expired';
      await channel.save();
      throw ApiError.unauthorized('YouTube authorization expired — please reconnect');
    }
    throw new ApiError(502, 'YT_SYNC_FAILED', 'YouTube is unavailable right now — try again shortly');
  }
});

function redirectResult(res, success, message) {
//   const url = new URL('/onboarding/youtube', env.clientUrl);

  const redirectPath = success ? '/profile' : '/onboarding/youtube';
  const url = new URL(redirectPath, env.clientUrl);

  url.searchParams.set('yt', success ? 'connected' : 'error');
  url.searchParams.set('message', message);
  res.redirect(url.toString());
}

/**
 * Disconnect YouTube (scope §16, A73). Mirrors `disconnectInstagram` so all
 * three platforms behave identically. Only removes this platform's records —
 * the creator's other connections are untouched.
 */
export const disconnectYoutube = catchAsync(async (req, res) => {
  const userId = req.auth.sub;

  await YouTubeChannel.deleteOne({ user: userId });

  await CreatorProfile.findOneAndUpdate(
    { user: userId },
    { $pull: { socialAccounts: { platform: 'youtube' } } },
  );

  await User.findByIdAndUpdate(
    userId,
    { $pull: { connectedAccounts: 'youtube' } },
  );

  ok(res, { message: 'YouTube disconnected successfully' });
});

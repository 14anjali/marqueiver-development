import { catchAsync, ApiError } from '../../utils/apiError.js';
import { ok } from '../../utils/respond.js';
import { env } from '../../config/env.js';
import { verifyAccess } from '../../utils/tokens.js';
import { FacebookPage, User } from '../../models/index.js';
import * as facebookService from '../../services/facebook.service.js';

const processingCodes = new Map();

/**
 * Start Facebook Auth
 */
export const startFacebookAuth = catchAsync(async (req, res) => {
  const nonce = facebookService.newState();
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : req.query.token;

  if (!token) throw ApiError.unauthorized('Missing access token for Facebook connect');

  const state = `${nonce}.${token}`;
  const url = facebookService.buildAuthUrl(state);

  if (req.query.redirect === '1') return res.redirect(url);

  ok(res, { authUrl: url, state: nonce });
});

/**
 * Facebook OAuth Callback
 */
export const facebookCallback = catchAsync(async (req, res) => {
  const { code, state, error, error_description: errDesc } = req.query;

  if (error) {
    return redirectResult(res, false, errDesc || 'Facebook connection was cancelled');
  }

  if (!code || !state) throw ApiError.badRequest('Missing code or state from Facebook');

  if (processingCodes.has(code)) {
    try {
      const result = await processingCodes.get(code).promise;
      return redirectResult(res, result.success, result.message);
    } catch (err) {
      return redirectResult(res, false, err.message || 'Connection failed');
    }
  }

  const jwt = String(state).split('.').slice(1).join('.');
  let claims;
  try { claims = verifyAccess(jwt); } 
  catch { return redirectResult(res, false, 'Invalid OAuth state'); }

  const processingPromise = (async () => {
    try {
      const token = await facebookService.exchangeCodeForToken(String(code));
      
      // Fetch user profile using available active permissions
      const profile = await facebookService.fetchUserProfile(token.access_token);

      // Save user profile into DB
      await FacebookPage.findOneAndUpdate(
        { user: claims.sub },
        {
          user: claims.sub,
          facebookPageId: profile.id,
          userAccessToken: token.access_token,
          pageName: profile.name,
          profilePicture: profile.profilePicture,
          status: 'connected',
          lastSyncedAt: new Date(),
        },
        { upsert: true, new: true }
      );

      await User.findByIdAndUpdate(claims.sub, {
        $addToSet: { connectedAccounts: 'facebook' },
      });

      return { success: true, message: 'Facebook connected successfully' };

    } catch (err) {
      if (err.code === 'FB_CODE_ALREADY_USED' || err.message === 'FB_CODE_ALREADY_USED') {
        throw new Error('Authorization code already used. Please try connecting again.');
      }
      throw err;
    }
  })();

  processingCodes.set(code, { promise: processingPromise });
  setTimeout(() => processingCodes.delete(code), 10 * 60 * 1000);

  try {
    const result = await processingPromise;
    return redirectResult(res, result.success, result.message);
  } catch (err) {
    return redirectResult(res, false, err.message);
  }
});

/**
 * Get Facebook Profile (Export added)
 */
export const getFacebookProfile = catchAsync(async (req, res) => {
  const page = await FacebookPage.findOne({ user: req.auth.sub }).lean();
  if (!page) throw ApiError.notFound('No Facebook account connected');

  delete page.userAccessToken;
  delete page.pageAccessToken;

  ok(res, page);
});

/**
 * Sync Facebook Profile Data (Export added)
 */
export const syncFacebook = catchAsync(async (req, res) => {
  const page = await FacebookPage.findOne({ user: req.auth.sub }).select('+userAccessToken');
  if (!page) throw ApiError.notFound('No Facebook account connected');
  if (page.status !== 'connected') throw ApiError.badRequest('Facebook account is not connected');

  try {
    const profile = await facebookService.fetchUserProfile(page.userAccessToken);

    page.pageName = profile.name;
    page.profilePicture = profile.profilePicture;
    page.lastSyncedAt = new Date();
    await page.save();

    const view = page.toObject();
    delete view.userAccessToken;

    ok(res, view);
  } catch (e) {
    if (/expired|revoked|401|403|invalid/i.test(e.message)) {
      page.status = 'expired';
      await page.save();
      throw ApiError.unauthorized('Facebook authorization expired — please reconnect');
    }
    throw new ApiError(502, 'FB_SYNC_FAILED', 'Facebook is unavailable right now — try again shortly');
  }
});

function redirectResult(res, success, message) {
  const url = new URL('/onboarding/facebook', env.clientUrl);
  url.searchParams.set('fb', success ? 'connected' : 'error');
  url.searchParams.set('message', message);
  res.redirect(url.toString());
}
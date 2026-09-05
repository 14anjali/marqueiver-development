import { catchAsync, ApiError } from '../../utils/apiError.js';
import { assertNotLinkedElsewhere } from '../../services/socialConnect.service.js';
import { ok } from '../../utils/respond.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { verifyAccess } from '../../utils/tokens.js';
import { FacebookPage, CreatorProfile, User } from '../../models/index.js';
import * as fb from '../../services/facebook.service.js';
import { describeError, userFacingMessage } from '../../utils/describeError.js';
import { syncFacebook as syncPage } from '../../services/socialSync.service.js';

/**
 * Facebook Pages: connect, choose a Page, publish, moderate.
 *
 * The flow has two halves because Facebook's does:
 *
 *   GET  /auth/facebook           → consent
 *   GET  /auth/facebook/callback  → code → long-lived user token → store
 *                                   `pending_selection`, redirect to the picker
 *   GET  /facebook/pages          → the Pages this person can act on
 *   POST /facebook/pages/select   → store the chosen Page + its Page token
 *
 * A person can administer several Pages, and only they can say which one Marq
 * should manage. The previous implementation had no such step: it called `/me`,
 * wrote the person's own profile into the FacebookPage collection and declared
 * the connection finished, so no Page was ever actually connected.
 */

/** Step logging, mirroring the Instagram callback so both read alike. */
async function step(operation, fn) {
  logger.info('Facebook OAuth step:', { operation, status: 'started' });
  try {
    const result = await fn();
    logger.info('Facebook OAuth step:', { operation, status: 'ok' });
    return result;
  } catch (err) {
    logger.warn('Facebook OAuth step failed:', { operation, ...describeError(err) });
    if (err && typeof err === 'object') err.marqStep = operation;
    throw err;
  }
}

const processingCodes = new Map();

/* ──────────────────────────────── OAuth ──────────────────────────────────── */

/** Begin consent. Requires an authenticated Marq user. */
export const startFacebookAuth = catchAsync(async (req, res) => {
  const status = fb.facebookConfigStatus();
  if (!status.configured) {
    // Naming the missing variables beats a generic failure at the consent
    // screen; the names are not secrets, the values would be.
    throw new ApiError(503, 'FACEBOOK_NOT_CONFIGURED',
      'Facebook connection is not configured on this environment.',
      { platform: 'facebook', missing: status.missing });
  }

  const nonce = fb.newState();
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : req.query.token;

  if (!token) throw ApiError.unauthorized('Missing access token for Facebook connect');

  const url = fb.buildAuthUrl(`${nonce}.${token}`);
  if (req.query.redirect === '1') return res.redirect(url);

  ok(res, { authUrl: url, state: nonce, loginForBusiness: status.loginForBusiness });
});

/**
 * OAuth callback.
 *
 * No `authenticate`: Facebook redirects the browser here directly, so the Marq
 * user is recovered from the JWT carried in `state`. Failures are carried back
 * into the UI on the same redirect the success path uses — letting an ApiError
 * escape would render raw JSON at the callback URL and strand the person there.
 */
export const facebookCallback = catchAsync(async (req, res) => {
  const { code, state, error, error_description: errDesc } = req.query;

  if (error) {
    return redirectResult(res, false, errDesc || 'Facebook connection was cancelled');
  }
  if (!code || !state) throw ApiError.badRequest('Missing code or state from Facebook');

  const jwt = String(state).split('.').slice(1).join('.');
  let claims;
  try { claims = verifyAccess(jwt); } catch { return redirectResult(res, false, 'Invalid OAuth state'); }

  // Facebook retries the redirect on a slow response, and an authorization code
  // is single-use — so a duplicate arrival must join the first attempt rather
  // than race it into "code already used".
  if (processingCodes.has(code)) {
    try {
      const result = await processingCodes.get(code);
      return redirectResult(res, result.success, result.message, result.next);
    } catch (err) {
      return redirectResult(res, false, userFacingMessage(err, 'Facebook connection failed.'));
    }
  }

  const work = (async () => {
    const short = await step('exchangeCodeForToken', () => fb.exchangeCodeForToken(String(code)));

    // Page tokens inherit the user token's lifetime, so this must happen before
    // any Page token is read — otherwise every Page token dies within the hour.
    const long = await step('exchangeForLongLivedToken', () =>
      fb.exchangeForLongLivedToken(short.access_token));

    logger.info('Facebook OAuth step:', {
      operation: 'inspectTokenResponse',
      status: 'ok',
      hasAccessToken: Boolean(long.access_token),
      longLived: long.longLived,
      expiresInSeconds: long.expires_in,
    });

    const profile = await step('fetchUserProfile', () => fb.fetchUserProfile(long.access_token));
    const pages = await step('listPages', () => fb.listPages(long.access_token));

    logger.info('Facebook OAuth step:', {
      operation: 'inspectPages', status: 'ok', pageCount: pages.length,
    });

    await FacebookPage.findOneAndUpdate(
      { user: claims.sub },
      {
        user: claims.sub,
        facebookUserId: profile.id,
        facebookUserName: profile.name,
        userAccessToken: long.access_token,
        tokenType: long.token_type,
        tokenExpiresAt: new Date(Date.now() + long.expires_in * 1000),
        scopes: fb.usesLoginForBusiness() ? [] : fb.REQUIRED_SCOPES,
        status: 'pending_selection',
        // Any previously chosen Page is cleared: re-authorising may have
        // changed which Pages are available, so the choice is made again.
        $unset: undefined,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    if (!pages.length) {
      return {
        success: false,
        message: 'Your Facebook account did not grant access to any Page. '
          + 'Create a Page, or ask its owner for a role on it, then reconnect.',
      };
    }

    // One Page and nothing to choose between — select it rather than making the
    // person confirm the only option.
    if (pages.length === 1) {
      await persistSelectedPage(claims.sub, pages[0], long);
      return { success: true, message: `Connected ${pages[0].name}`, next: 'connected' };
    }

    return { success: true, message: 'Choose the Page to connect', next: 'select-page' };
  })();

  processingCodes.set(code, work);
  setTimeout(() => processingCodes.delete(code), 10 * 60 * 1000);

  try {
    const result = await work;
    return redirectResult(res, result.success, result.message, result.next);
  } catch (err) {
    logger.warn('Facebook OAuth callback failed:', {
      operation: err?.marqStep ?? 'unknown',
      ...describeError(err),
    });
    return redirectResult(res, false,
      userFacingMessage(err, 'Facebook connection failed. Please try again.'));
  }
});

function redirectResult(res, success, message, next) {
  const url = new URL('/onboarding/facebook', env.clientUrl);
  url.searchParams.set('fb', success ? (next === 'select-page' ? 'select-page' : 'connected') : 'error');
  url.searchParams.set('message', message);
  res.redirect(url.toString());
}

/* ────────────────────────── Page selection ───────────────────────────────── */

/** Write the chosen Page and its Page token. */
async function persistSelectedPage(userId, page, tokenInfo) {
  await assertNotLinkedElsewhere('facebook', page.id, userId);

  if (!page.accessToken) {
    throw new ApiError(403, 'FACEBOOK_PAGE_TOKEN_MISSING',
      'Facebook did not return an access token for that Page.',
      {
        platform: 'facebook',
        howTo: [
          'Reconnect and make sure the Page is ticked on Facebook\'s permission screen.',
          'You need a role on the Page that allows content or management tasks.',
        ],
      });
  }

  const doc = await FacebookPage.findOneAndUpdate(
    { user: userId },
    {
      user: userId,
      facebookPageId: page.id,
      pageAccessToken: page.accessToken,
      ...(tokenInfo ? {
        userAccessToken: tokenInfo.access_token,
        tokenExpiresAt: new Date(Date.now() + tokenInfo.expires_in * 1000),
      } : {}),
      tasks: page.tasks,
      name: page.name,
      username: page.username,
      category: page.category,
      profilePicture: page.picture,
      link: page.link,
      followersCount: page.followers ?? 0,
      likesCount: page.likes ?? 0,
      dataSource: 'connected',
      status: 'connected',
      lastSyncedAt: new Date(),
    },
    { upsert: true, new: true, runValidators: true },
  );

  // Mirror onto the creator profile, the shape discovery reads.
  const creator = await CreatorProfile.findOne({ user: userId });
  if (creator) {
    const entry = {
      platform: 'facebook',
      handle: page.username ? `@${page.username}` : page.name,
      followers: page.followers ?? 0,
      engagementRate: creator.socialAccounts?.find((s) => s.platform === 'facebook')?.engagementRate ?? 0,
      verified: false,
      dataSource: 'connected',
    };
    const idx = (creator.socialAccounts || []).findIndex((s) => s.platform === 'facebook');
    if (idx >= 0) creator.socialAccounts[idx] = entry;
    else creator.socialAccounts.push(entry);
    await creator.save();
  }

  await User.findByIdAndUpdate(userId, { $addToSet: { connectedAccounts: 'facebook' } });
  return doc;
}

/** The connection record with its tokens, or a clear error. */
async function requireConnection(userId, { needPage = true } = {}) {
  const conn = await FacebookPage.findOne({ user: userId })
    .select('+pageAccessToken +userAccessToken');

  if (!conn) throw ApiError.notFound('No Facebook account connected');

  if (needPage && conn.status !== 'connected') {
    throw new ApiError(409, 'FACEBOOK_PAGE_NOT_SELECTED',
      'Choose which Facebook Page to manage before using this.',
      { platform: 'facebook', action: 'select-page' });
  }
  return conn;
}

/** The Pages this person can act on, read live so the list is never stale. */
export const listFacebookPages = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub, { needPage: false });

  const pages = await fb.listPages(conn.userAccessToken);

  ok(res, {
    selectedPageId: conn.status === 'connected' ? conn.facebookPageId : null,
    // The Page access tokens are stripped: the frontend never needs one, and
    // anything it holds can be read out of a browser.
    pages: pages.map(({ accessToken, ...safe }) => ({
      ...safe,
      canPublish: safe.tasks.includes('CREATE_CONTENT') || safe.tasks.includes('MANAGE'),
      canModerate: safe.tasks.includes('MODERATE') || safe.tasks.includes('MANAGE'),
    })),
  });
});

/** Choose the Page to manage. */
export const selectFacebookPage = catchAsync(async (req, res) => {
  const pageId = String(req.body?.pageId ?? '').trim();
  if (!pageId) throw ApiError.badRequest('pageId is required');

  const conn = await requireConnection(req.auth.sub, { needPage: false });

  // Re-read from Facebook rather than trusting the id the client sent: this is
  // what proves the person still has a role on that Page, and it is where the
  // Page token comes from.
  const pages = await fb.listPages(conn.userAccessToken);
  const page = pages.find((p) => p.id === pageId);

  if (!page) {
    throw new ApiError(403, 'FACEBOOK_PAGE_NOT_AVAILABLE',
      'That Page is not one your Facebook account can manage.',
      { platform: 'facebook' });
  }

  const saved = await persistSelectedPage(req.auth.sub, page, null);
  ok(res, publicView(saved));
});

/* ───────────────────────── Page data & actions ───────────────────────────── */

const publicView = (doc) => {
  const view = doc.toObject ? doc.toObject() : { ...doc };
  delete view.pageAccessToken;
  delete view.userAccessToken;
  return view;
};

export const getFacebookProfile = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub);
  ok(res, publicView(conn));
});

/**
 * Sync Now — Page detail, posts, engagement and insights in one run.
 *
 * A partial sync is a 200 with `partial: true`, not an error: one failed
 * optional call (insights needing a permission the Page reads do not, say)
 * should not discard the parts that did refresh.
 */
export const syncFacebook = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub);
  const report = await syncPage(conn, { postLimit: 25 });

  if (report.requiresReconnect) {
    throw new ApiError(401, 'FACEBOOK_TOKEN_INVALID',
      'Your Facebook authorisation has expired — please reconnect.',
      { platform: 'facebook', action: 'reconnect' });
  }

  ok(res, { page: publicView(conn), sync: report });
});

/**
 * Page analytics, served from the last sync.
 *
 * Fetching live on every render would spend the rate-limit budget on repeat
 * views of identical numbers; `syncedAt` lets the UI show how fresh they are
 * and offer Sync Now when they are not.
 */
export const getFacebookInsights = catchAsync(async (req, res) => {
  const conn = await FacebookPage.findOne({ user: req.auth.sub })
    .select('insights recentPosts lastSyncedAt followersCount likesCount name username status').lean();

  if (!conn) throw ApiError.notFound('No Facebook account connected');
  if (conn.status !== 'connected') {
    throw new ApiError(409, 'FACEBOOK_PAGE_NOT_SELECTED',
      'Choose which Facebook Page to manage before viewing analytics.',
      { platform: 'facebook', action: 'select-page' });
  }

  ok(res, {
    page: { id: conn.facebookPageId, name: conn.name, username: conn.username },
    followers: conn.followersCount ?? null,
    likes: conn.likesCount ?? null,
    // { available, value } per metric — an unavailable metric is never a zero.
    metrics: conn.insights ?? {},
    topPosts: (conn.recentPosts ?? [])
      .slice()
      .sort((a, b) => (b.reactions + b.comments + b.shares) - (a.reactions + a.comments + a.shares))
      .slice(0, 5),
    syncedAt: conn.lastSyncedAt ?? null,
  });
});

export const listFacebookPosts = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub);
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  ok(res, await fb.fetchPagePosts(conn.pageAccessToken, conn.facebookPageId, limit));
});

export const publishFacebookPost = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub);

  // Checked before the call so the person is told why, rather than reading
  // Facebook's generic permission error back.
  if (!conn.canPublish()) {
    throw new ApiError(403, 'FACEBOOK_PUBLISH_NOT_PERMITTED',
      'Your role on this Facebook Page does not allow publishing.',
      { platform: 'facebook', tasks: conn.tasks });
  }

  const { message, link } = req.body ?? {};
  ok(res, await fb.publishPost(conn.pageAccessToken, conn.facebookPageId, { message, link }), undefined, 201);
});

export const deleteFacebookPost = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub);
  if (!conn.canPublish()) {
    throw new ApiError(403, 'FACEBOOK_PUBLISH_NOT_PERMITTED',
      'Your role on this Facebook Page does not allow removing posts.',
      { platform: 'facebook', tasks: conn.tasks });
  }
  ok(res, await fb.deletePost(conn.pageAccessToken, req.params.postId));
});

export const listFacebookComments = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub);
  ok(res, await fb.fetchComments(conn.pageAccessToken, req.params.postId,
    Math.min(Number(req.query.limit) || 50, 100)));
});

const assertCanModerate = (conn) => {
  if (!conn.canModerate()) {
    throw new ApiError(403, 'FACEBOOK_MODERATION_NOT_PERMITTED',
      'Your role on this Facebook Page does not allow managing comments.',
      { platform: 'facebook', tasks: conn.tasks });
  }
};

export const replyToFacebookComment = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub);
  assertCanModerate(conn);
  ok(res, await fb.replyToComment(conn.pageAccessToken, req.params.commentId, req.body?.message),
    undefined, 201);
});

export const moderateFacebookComment = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub);
  assertCanModerate(conn);
  ok(res, await fb.setCommentHidden(conn.pageAccessToken, req.params.commentId,
    req.body?.hidden !== false));
});

export const deleteFacebookComment = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub);
  assertCanModerate(conn);
  ok(res, await fb.deleteComment(conn.pageAccessToken, req.params.commentId));
});

/** Disconnect. Removes only Facebook; Instagram and YouTube are untouched. */
export const disconnectFacebook = catchAsync(async (req, res) => {
  const userId = req.auth.sub;

  await FacebookPage.deleteMany({ user: userId });
  await CreatorProfile.findOneAndUpdate(
    { user: userId },
    { $pull: { socialAccounts: { platform: 'facebook' } } },
  );
  await User.findByIdAndUpdate(userId, { $pull: { connectedAccounts: 'facebook' } });

  ok(res, { message: 'Facebook disconnected successfully' });
});
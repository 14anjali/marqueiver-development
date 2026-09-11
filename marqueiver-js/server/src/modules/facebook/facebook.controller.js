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
 * A person can administer several Pages, and only they can say which ones Marq
 * should manage. The original implementation had no such step: it called `/me`,
 * wrote the person's own profile into the FacebookPage collection and declared
 * the connection finished, so no Page was ever actually connected.
 *
 * ── Several Pages, one profile ─────────────────────────────────────────────
 *
 * A creator may now connect as many Pages as they administer. Three things make
 * that work without disturbing anything that reads Facebook data:
 *
 *  - **One row per Page.** `FacebookPage.user` is no longer unique; the unique
 *    constraint is on `facebookPageId`, which is what actually prevents
 *    duplicates — the same Page cannot be added twice by one person, nor
 *    claimed by two. `selectFacebookPage` is idempotent as a result.
 *  - **One primary Page.** `CreatorProfile.socialAccounts` holds a single
 *    handle-and-follower pair per platform, and folding three Pages into one
 *    pair would misstate which audience belongs to which account. The creator
 *    nominates the Page that represents them publicly; the rest are managed
 *    here and do not touch discovery ranking. Summing the followers instead was
 *    the alternative, and it would have inflated a number brands filter on.
 *  - **One authorisation session.** The long-lived *user* token is the same for
 *    every Page it derived, so re-authorising refreshes it on all of them.
 *
 * Every per-Page endpoint takes an optional `pageId`. Omitting it resolves the
 * primary Page, which is exactly what the single-Page callers did before, so
 * existing clients keep working unchanged.
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
  /**
   * Header only. The `?token=` fallback that used to sit here is removed.
   *
   * It put a live JWT in the URL, and a URL is logged by every layer it passes
   * through — this project's own Render logs carried working access tokens in
   * plaintext because of it, and a token in a log is a token anyone with log
   * access can replay until it expires. The frontend already sends
   * `Authorization: Bearer` on this call, so the query parameter bought
   * nothing and cost that.
   */
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;

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

    /*
      Two writes, and the split matters.

      This used to be one `findOneAndUpdate({ user })` that set
      `status: 'pending_selection'`. With one Page per user that was the whole
      record; now it would match whichever Page happened to come first and
      reset a working connection to "pending" on every re-authorisation.

      So: refresh the shared user token on the Pages already connected, and
      upsert the authorisation session separately. The session is the row with
      `status: 'pending_selection'` and no Page id, and the partial unique index
      on the model keeps there being at most one per user.
    */
    const tokenFields = {
      facebookUserId: profile.id,
      facebookUserName: profile.name,
      userAccessToken: long.access_token,
      tokenType: long.token_type,
      tokenExpiresAt: new Date(Date.now() + long.expires_in * 1000),
      scopes: fb.usesLoginForBusiness() ? [] : fb.REQUIRED_SCOPES,
    };

    await FacebookPage.updateMany(
      { user: claims.sub, status: 'connected' },
      tokenFields,
    );

    await FacebookPage.findOneAndUpdate(
      { user: claims.sub, status: 'pending_selection' },
      { user: claims.sub, status: 'pending_selection', ...tokenFields },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    if (!pages.length) {
      return {
        success: false,
        message: 'Your Facebook account did not grant access to any Page. '
          + 'Create a Page, or ask its owner for a role on it, then reconnect.',
      };
    }

    /*
      One Page and nothing to choose between — select it rather than making the
      person confirm the only option.

      Only when they have no Pages connected yet. Someone who already manages
      two Pages here and re-authorises to add a third is deliberately choosing,
      so auto-selecting the only *available* Page would silently pick for them.
    */
    const alreadyConnected = await FacebookPage.countDocuments({
      user: claims.sub, status: 'connected',
    });

    if (pages.length === 1 && alreadyConnected === 0) {
      await persistSelectedPage(claims.sub, pages[0], long);
      return { success: true, message: `Connected ${pages[0].name}`, next: 'connected' };
    }

    return { success: true, message: 'Choose the Pages to connect', next: 'select-page' };
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

  /*
    Keyed on the Page id, not on the user.

    `{ user: userId }` was right when a user had one row; it would now overwrite
    whichever Page matched first, so adding a second Page would replace the
    first. Matching on the Page itself makes this an upsert of *that* Page and
    nothing else — which is also what makes re-adding an existing Page harmless
    rather than a duplicate.
  */
  const existing = await FacebookPage.countDocuments({ user: userId, status: 'connected' });

  /**
   * The authorisation, carried onto the Page row.
   *
   * This is not optional bookkeeping. When a Page is chosen from the picker,
   * `tokenInfo` is null — the long-lived *user* token lives on the
   * `pending_selection` session row, and that row is deleted a few lines below
   * once a Page exists. Without copying it first, two things break:
   *
   *  1. **"Add another Page" stops working.** `listFacebookPages` reads
   *     `conn.userAccessToken` to ask Facebook what this person administers.
   *     With the session gone and the token never copied, it would call Graph
   *     with `undefined`.
   *  2. **Meta's deletion callbacks could not find the connection.** Both the
   *     Deauthorize and Data Deletion handlers locate rows by `facebookUserId`
   *     and nothing else. A Page row without it is invisible to them — a
   *     compliance failure, and a silent one.
   *
   * The single-Page code never hit this because it upserted by `{ user }`, so
   * the one row kept whatever the callback had written. Keying on the Page id
   * is what made the carry-over necessary.
   */
  const session = tokenInfo ? null : await FacebookPage.findOne({ user: userId })
    .sort({ status: 1 })      // 'connected' < 'pending_selection'
    .select('+userAccessToken facebookUserId facebookUserName tokenExpiresAt scopes');

  const authFields = tokenInfo
    ? {
      userAccessToken: tokenInfo.access_token,
      tokenExpiresAt: new Date(Date.now() + tokenInfo.expires_in * 1000),
    }
    : {
      ...(session?.userAccessToken ? { userAccessToken: session.userAccessToken } : {}),
      ...(session?.tokenExpiresAt ? { tokenExpiresAt: session.tokenExpiresAt } : {}),
      ...(session?.facebookUserId ? { facebookUserId: session.facebookUserId } : {}),
      ...(session?.facebookUserName ? { facebookUserName: session.facebookUserName } : {}),
    };

  const doc = await FacebookPage.findOneAndUpdate(
    { facebookPageId: page.id },
    {
      user: userId,
      facebookPageId: page.id,
      pageAccessToken: page.accessToken,
      ...authFields,
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
      // The first Page connected becomes the public one. Someone connecting
      // their only Page should not have to then nominate it.
      ...(existing === 0 ? { isPrimary: true } : {}),
      lastSyncedAt: new Date(),
    },
    { upsert: true, new: true, runValidators: true },
  );

  /*
    The authorisation session has served its purpose once a Page is connected.

    Left behind, it is a second row for this user in `pending_selection`, which
    `requireConnection` would find before a real Page and report as "choose a
    Page" on a connection that is finished.
  */
  await FacebookPage.deleteOne({ user: userId, status: 'pending_selection' });

  await mirrorPrimaryPage(userId);
  await User.findByIdAndUpdate(userId, { $addToSet: { connectedAccounts: 'facebook' } });
  return doc;
}

/**
 * Copy the primary Page onto `CreatorProfile.socialAccounts`, the shape
 * discovery and the public profile read.
 *
 * One place rather than inline at each call site, because there are now four
 * ways the primary Page can change — connecting one, disconnecting one,
 * nominating a different one, and a sync refreshing the follower count — and
 * four copies of this would drift.
 *
 * With no connected Pages left, the Facebook entry is removed rather than
 * zeroed: a creator with no Facebook should not appear in discovery as a
 * creator with a Facebook audience of zero.
 */
async function mirrorPrimaryPage(userId) {
  const creator = await CreatorProfile.findOne({ user: userId });
  if (!creator) return;

  const primary = await FacebookPage.findOne({ user: userId, status: 'connected' })
    // Falls back to any connected Page if the flag is somehow unset, so a
    // missing primary degrades to the old behaviour rather than to nothing.
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();

  const idx = (creator.socialAccounts || []).findIndex((s) => s.platform === 'facebook');

  if (!primary) {
    if (idx >= 0) creator.socialAccounts.splice(idx, 1);
    await creator.save();
    return;
  }

  const entry = {
    platform: 'facebook',
    handle: primary.username ? `@${primary.username}` : primary.name,
    followers: primary.followersCount ?? 0,
    engagementRate: creator.socialAccounts?.[idx]?.engagementRate ?? 0,
    verified: false,
    dataSource: 'connected',
  };

  if (idx >= 0) creator.socialAccounts[idx] = entry;
  else creator.socialAccounts.push(entry);

  await creator.save();
}

/**
 * The connection record with its tokens, or a clear error.
 *
 * `pageId` names a specific Page; without it the primary Page is used, which is
 * what every caller did implicitly when a user could only have one. Passing a
 * Page id that belongs to someone else resolves to nothing and 404s — the query
 * is scoped by `user`, so a Page id alone is never enough to reach a Page.
 */
async function requireConnection(userId, { needPage = true, pageId } = {}) {
  const filter = { user: userId };
  if (pageId) filter.facebookPageId = String(pageId);

  const conn = await FacebookPage.findOne(filter)
    // Without a Page id: the primary Page, then any connected Page, and only
    // then the pending-selection session — so a user midway through adding a
    // second Page still resolves to the Page they already have.
    .sort({ isPrimary: -1, status: 1, createdAt: 1 })
    .select('+pageAccessToken +userAccessToken');

  if (!conn) {
    throw ApiError.notFound(pageId
      ? 'That Facebook Page is not connected to your account'
      : 'No Facebook account connected');
  }

  if (needPage && conn.status !== 'connected') {
    throw new ApiError(409, 'FACEBOOK_PAGE_NOT_SELECTED',
      'Choose which Facebook Page to manage before using this.',
      { platform: 'facebook', action: 'select-page' });
  }
  return conn;
}

/** A Page id from the query string or body, whichever the verb allows. */
const pageIdFrom = (req) => {
  const raw = req.query?.pageId ?? req.body?.pageId ?? req.params?.pageId;
  const value = String(raw ?? '').trim();
  return value || undefined;
};

/** The Pages this person can act on, read live so the list is never stale. */
export const listFacebookPages = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub, { needPage: false });

  const pages = await fb.listPages(conn.userAccessToken);

  // Which of them this user already has, so the picker can show "Connected"
  // instead of offering to add a Page that is already there.
  const connected = await FacebookPage
    .find({ user: req.auth.sub, status: 'connected' })
    .select('facebookPageId isPrimary')
    .lean();

  const connectedIds = new Set(connected.map((c) => c.facebookPageId));
  const primaryId = connected.find((c) => c.isPrimary)?.facebookPageId ?? null;

  ok(res, {
    // Kept for the existing single-Page callers, which read `selectedPageId`.
    selectedPageId: primaryId,
    primaryPageId: primaryId,
    connectedPageIds: [...connectedIds],
    // The Page access tokens are stripped: the frontend never needs one, and
    // anything it holds can be read out of a browser.
    pages: pages.map(({ accessToken, ...safe }) => ({
      ...safe,
      connected: connectedIds.has(safe.id),
      isPrimary: safe.id === primaryId,
      canPublish: safe.tasks.includes('CREATE_CONTENT') || safe.tasks.includes('MANAGE'),
      canModerate: safe.tasks.includes('MODERATE') || safe.tasks.includes('MANAGE'),
    })),
  });
});

/**
 * Connect one or more Pages.
 *
 * Accepts `pageId` (one) or `pageIds` (several) — the picker lets someone tick
 * three Pages and add them in one go, and three sequential requests would each
 * re-list the Pages from Facebook against a rate limit that is not generous.
 *
 * Adding a Page that is already connected refreshes it instead of failing.
 * That is deliberate: the unique index would reject a duplicate row anyway, and
 * an error for "you already have this" is a worse answer than simply being
 * up to date.
 */
export const selectFacebookPage = catchAsync(async (req, res) => {
  const requested = [
    ...(Array.isArray(req.body?.pageIds) ? req.body.pageIds : []),
    ...(req.body?.pageId ? [req.body.pageId] : []),
  ].map((id) => String(id).trim()).filter(Boolean);

  const ids = [...new Set(requested)];
  if (!ids.length) throw ApiError.badRequest('pageId or pageIds is required');

  const conn = await requireConnection(req.auth.sub, { needPage: false });

  // Re-read from Facebook rather than trusting the ids the client sent: this is
  // what proves the person still has a role on those Pages, and it is where the
  // Page tokens come from.
  const available = await fb.listPages(conn.userAccessToken);
  const byId = new Map(available.map((p) => [p.id, p]));

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new ApiError(403, 'FACEBOOK_PAGE_NOT_AVAILABLE',
      missing.length === ids.length
        ? 'That Page is not one your Facebook account can manage.'
        : `${missing.length} of those Pages are not ones your Facebook account can manage.`,
      { platform: 'facebook', pageIds: missing });
  }

  const saved = [];
  for (const id of ids) {
    // Sequential, not `Promise.all`: each call writes the primary flag based on
    // how many Pages already exist, and in parallel they would all read zero
    // and every one of them would claim to be primary.
    // eslint-disable-next-line no-await-in-loop
    saved.push(await persistSelectedPage(req.auth.sub, byId.get(id), null));
  }

  // A single id returns the Page itself, as it always did; a list returns the
  // list. Existing callers passing `pageId` see no change.
  ok(res, req.body?.pageIds ? saved.map(publicView) : publicView(saved[0]));
});

/** Every Page this user has connected — what the profile screen renders. */
export const listConnectedPages = catchAsync(async (req, res) => {
  const pages = await FacebookPage
    .find({ user: req.auth.sub, status: 'connected' })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();

  ok(res, pages.map((page) => ({
    ...publicView(page),
    canPublish: page.tasks?.includes('CREATE_CONTENT') || page.tasks?.includes('MANAGE'),
    canModerate: page.tasks?.includes('MODERATE') || page.tasks?.includes('MANAGE'),
  })));
});

/**
 * Nominate the Page that represents this creator publicly.
 *
 * Two writes rather than one, and the order matters: clear the flag everywhere
 * first, then set it. Setting first and clearing after would, if the second
 * write failed, leave two primary Pages — and `mirrorPrimaryPage` would then
 * pick between them by creation date, which is not what the creator asked for.
 */
export const setPrimaryPage = catchAsync(async (req, res) => {
  const pageId = pageIdFrom(req);
  if (!pageId) throw ApiError.badRequest('pageId is required');

  const page = await FacebookPage.findOne({
    user: req.auth.sub, facebookPageId: pageId, status: 'connected',
  });
  if (!page) throw ApiError.notFound('That Facebook Page is not connected to your account');

  await FacebookPage.updateMany({ user: req.auth.sub }, { isPrimary: false });
  await FacebookPage.updateOne({ _id: page._id }, { isPrimary: true });

  await mirrorPrimaryPage(req.auth.sub);

  const fresh = await FacebookPage.findById(page._id).lean();
  ok(res, publicView(fresh));
});

/**
 * Disconnect a single Page, leaving the others alone.
 *
 * If the Page removed was the primary one, the next remaining Page inherits the
 * role — otherwise the creator's public profile would quietly lose its Facebook
 * entry because the flag pointed at a row that no longer exists.
 */
export const disconnectFacebookPage = catchAsync(async (req, res) => {
  const pageId = pageIdFrom(req);
  if (!pageId) throw ApiError.badRequest('pageId is required');

  const page = await FacebookPage.findOne({ user: req.auth.sub, facebookPageId: pageId });
  if (!page) throw ApiError.notFound('That Facebook Page is not connected to your account');

  const wasPrimary = page.isPrimary;
  await FacebookPage.deleteOne({ _id: page._id });

  const remaining = await FacebookPage
    .find({ user: req.auth.sub, status: 'connected' })
    .sort({ createdAt: 1 });

  if (wasPrimary && remaining.length) {
    await FacebookPage.updateOne({ _id: remaining[0]._id }, { isPrimary: true });
  }

  await mirrorPrimaryPage(req.auth.sub);

  // The platform only counts as connected while a Page remains.
  if (!remaining.length) {
    await User.findByIdAndUpdate(req.auth.sub, { $pull: { connectedAccounts: 'facebook' } });
  }

  ok(res, {
    message: `Disconnected ${page.name ?? 'the Page'}`,
    remaining: remaining.length,
  });
});

/* ───────────────────────── Page data & actions ───────────────────────────── */

const publicView = (doc) => {
  const view = doc.toObject ? doc.toObject() : { ...doc };
  delete view.pageAccessToken;
  delete view.userAccessToken;
  return view;
};

export const getFacebookProfile = catchAsync(async (req, res) => {
  // No `pageId` resolves the primary Page — the same single answer this
  // returned before, so existing callers are unaffected.
  const conn = await requireConnection(req.auth.sub, { pageId: pageIdFrom(req) });
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
  const pageId = pageIdFrom(req);

  /*
    With a `pageId`, sync that Page. Without one, sync every connected Page —
    "Sync now" on a profile listing three Pages should refresh all three, and
    refreshing only the primary would leave the other cards showing figures from
    whenever they were last touched, with no way to tell.
  */
  const pages = pageId
    ? [await requireConnection(req.auth.sub, { pageId })]
    : await FacebookPage.find({ user: req.auth.sub, status: 'connected' })
      .sort({ isPrimary: -1, createdAt: 1 })
      .select('+pageAccessToken +userAccessToken');

  if (!pages.length) throw ApiError.notFound('No Facebook account connected');

  const results = [];
  let expired = false;

  for (const page of pages) {
    // eslint-disable-next-line no-await-in-loop
    const report = await syncPage(page, { postLimit: 25 });
    if (report.requiresReconnect) expired = true;
    results.push({ pageId: page.facebookPageId, name: page.name, sync: report });
  }

  /*
    The token is shared across this user's Pages, so if it has expired every
    sync failed for the same reason and reconnecting is the only fix. Reported
    as an error only when nothing succeeded — one Page failing on a permission
    it individually lacks must not discard the Pages that did refresh.
  */
  if (expired && results.every((r) => r.sync.requiresReconnect)) {
    throw new ApiError(401, 'FACEBOOK_TOKEN_INVALID',
      'Your Facebook authorisation has expired — please reconnect.',
      { platform: 'facebook', action: 'reconnect' });
  }

  // Follower counts move on sync, and the primary Page's count is what the
  // public profile shows.
  await mirrorPrimaryPage(req.auth.sub);

  ok(res, {
    // `page` and `sync` kept for the single-Page callers that read them.
    page: publicView(pages[0]),
    sync: results[0].sync,
    pages: results,
    synced: results.length,
  });
});

/**
 * Page analytics, served from the last sync.
 *
 * Fetching live on every render would spend the rate-limit budget on repeat
 * views of identical numbers; `syncedAt` lets the UI show how fresh they are
 * and offer Sync Now when they are not.
 */
export const getFacebookInsights = catchAsync(async (req, res) => {
  const pageId = pageIdFrom(req);
  const conn = await FacebookPage
    .findOne({ user: req.auth.sub, ...(pageId ? { facebookPageId: pageId } : {}) })
    .sort({ isPrimary: -1, status: 1, createdAt: 1 })
    .select('insights recentPosts lastSyncedAt followersCount likesCount name username status facebookPageId')
    .lean();

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
  const conn = await requireConnection(req.auth.sub, { pageId: pageIdFrom(req) });
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  ok(res, await fb.fetchPagePosts(conn.pageAccessToken, conn.facebookPageId, limit));
});

export const publishFacebookPost = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub, { pageId: pageIdFrom(req) });

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
  const conn = await requireConnection(req.auth.sub, { pageId: pageIdFrom(req) });
  if (!conn.canPublish()) {
    throw new ApiError(403, 'FACEBOOK_PUBLISH_NOT_PERMITTED',
      'Your role on this Facebook Page does not allow removing posts.',
      { platform: 'facebook', tasks: conn.tasks });
  }
  ok(res, await fb.deletePost(conn.pageAccessToken, req.params.postId));
});

export const listFacebookComments = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub, { pageId: pageIdFrom(req) });
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
  const conn = await requireConnection(req.auth.sub, { pageId: pageIdFrom(req) });
  assertCanModerate(conn);
  ok(res, await fb.replyToComment(conn.pageAccessToken, req.params.commentId, req.body?.message),
    undefined, 201);
});

export const moderateFacebookComment = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub, { pageId: pageIdFrom(req) });
  assertCanModerate(conn);
  ok(res, await fb.setCommentHidden(conn.pageAccessToken, req.params.commentId,
    req.body?.hidden !== false));
});

export const deleteFacebookComment = catchAsync(async (req, res) => {
  const conn = await requireConnection(req.auth.sub, { pageId: pageIdFrom(req) });
  assertCanModerate(conn);
  ok(res, await fb.deleteComment(conn.pageAccessToken, req.params.commentId));
});

/** Disconnect. Removes only Facebook; Instagram and YouTube are untouched. */
export const disconnectFacebook = catchAsync(async (req, res) => {
  const userId = req.auth.sub;

  // Every Page, as before. A single Page is removed by
  // `DELETE /facebook/pages/:pageId` instead.
  await FacebookPage.deleteMany({ user: userId });
  await CreatorProfile.findOneAndUpdate(
    { user: userId },
    { $pull: { socialAccounts: { platform: 'facebook' } } },
  );
  await User.findByIdAndUpdate(userId, { $pull: { connectedAccounts: 'facebook' } });

  ok(res, { message: 'Facebook disconnected successfully' });
});
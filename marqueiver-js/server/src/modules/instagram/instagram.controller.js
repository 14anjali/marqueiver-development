import { catchAsync, ApiError } from '../../utils/apiError.js';
import { assertNotLinkedElsewhere, assertInstagramEligible } from '../../services/socialConnect.service.js';
import { ok } from '../../utils/respond.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { verifyAccess } from '../../utils/tokens.js';
import { InstagramAccount, InstagramMedia, CreatorProfile, User } from '../../models/index.js';
import { syncInstagram } from '../../services/socialSync.service.js';
import * as instagramService from '../../services/instagram.service.js';
import { describeError, userFacingMessage } from '../../utils/describeError.js';

/**
 * Run one step of the OAuth callback, logging its start and its failure.
 *
 * The point is the `operation` name. The callback makes six calls that can fail
 * for unrelated reasons, and the log said only that "the callback" failed —
 * so a token-exchange problem, an ineligible account and a database write were
 * indistinguishable, and every one of them looked like the last bug we fixed.
 *
 * The step name is stamped onto the error so the single catch at the bottom can
 * report which operation it came from, without a try/catch per step.
 */
async function step(operation, fn) {
  logger.info('Instagram OAuth step:', { operation, status: 'started' });
  try {
    const result = await fn();
    logger.info('Instagram OAuth step:', { operation, status: 'ok' });
    return result;
  } catch (err) {
    logger.warn('Instagram OAuth step failed:', { operation, ...describeError(err) });
    // Non-objects (a thrown string or null) cannot carry a property; the catch
    // below falls back to 'unknown' for those, which describeError also flags.
    if (err && typeof err === 'object') err.marqueiverStep = operation;
    throw err;
  }
}

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
  /**
   * Two gates before this counts as a connection.
   *
   * Eligibility first: Meta only returns insights, and only permits the
   * business_discovery calls discovery relies on, for Creator and Business
   * accounts. A PERSONAL account completes OAuth perfectly well and then returns
   * nothing — connected and useless.
   *
   * Then uniqueness: one Instagram account belongs to one Marqueiver user.
   */
  // Step 7 — eligibility.
  const accountType = await step('assertInstagramEligible', async () =>
    assertInstagramEligible(profile, { businessLogin: true }));

  // Step 8 — one Instagram account belongs to one Marqueiver user.
  await step('assertNotLinkedElsewhere', () =>
    assertNotLinkedElsewhere('instagram', profile.id, userId));

  const doc = {
    user: userId,
    /**
     * The model field is `igUserId`. This wrote `instagramId`, which the schema
     * does not declare, so Mongoose silently dropped it on every save and the
     * Instagram account id was never actually stored — which is also why nothing
     * could detect the same account being connected twice.
     */
    igUserId: String(profile.id),
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
    /**
     * The type the eligibility gate resolved, not a default.
     *
     * This read `profile.account_type || 'BUSINESS'`, which quietly undid the
     * fix one line above it: `fetchProfile` was changed to leave the field
     * undefined when Instagram does not return it, precisely so that nothing
     * downstream would invent one — and then this recorded every such account as
     * BUSINESS anyway. The stored value is now whatever
     * `assertInstagramEligible` actually concluded ('UNKNOWN' when Business
     * Login is the evidence rather than a reported type), so the database says
     * what we know instead of what we assumed.
     */
    accountType,
    isVerified: profile.is_verified || false,
    website: profile.website,
    dataSource: 'connected',
    status: 'connected',
    lastSyncedAt: new Date(),
  };

  // Step 9a — the account record itself.
  const account = await step('saveInstagramAccount', () => InstagramAccount.findOneAndUpdate(
    { user: userId },
    doc,
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  ));

  // Step 9b — mirror into the creator profile's socialAccounts.
  const creator = await step('mirrorToCreatorProfile', () => CreatorProfile.findOne({ user: userId }));
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
    await step('saveCreatorProfile', () => creator.save());
  }

  /**
   * Step 9c — the user's connected-accounts rollup.
   *
   * `connectedAccounts` was written here, in facebook.controller.js and in
   * youtube.controller.js, and declared in none of them: it was not a path on
   * the User schema. In strict mode Mongoose strips undeclared paths from an
   * update, so `$addToSet` cast down to `{}` — an empty update document, which
   * the driver rejects. Six write sites, every one of them either a silent
   * no-op or a throw at the very end of a connection that had otherwise
   * succeeded. The field is now declared on the schema.
   */
  await step('updateConnectedAccounts', () => User.findByIdAndUpdate(userId, {
    $addToSet: { connectedAccounts: 'instagram' },
  }));

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

  /**
   * Everything past this point can fail for reasons the person needs to read —
   * an ineligible account, a revoked token, Instagram being down. This is a
   * browser redirect from Instagram, not an API call, so letting an ApiError
   * escape rendered a raw JSON error page at the callback URL: the person was
   * dropped out of onboarding onto `{"ok":false,...}` with no way back. The
   * failure is now carried into the UI on the same redirect the success path
   * uses, so onboarding stays in control of what happens next.
   */
  try {
    // Step 2 — exchange the code. This already returns the Instagram user id.
    const token = await step('exchangeCodeForToken', () =>
      instagramService.exchangeCodeForToken(String(code)));

    /**
     * Step 3 — what did the token response actually contain?
     *
     * Shape only, never contents. Whether `user_id` came back decides whether
     * step 5 runs at all, and "did Instagram return an id" was previously
     * unanswerable from the logs — which is why a missing id looked like a
     * `/me` bug rather than a token-parsing one.
     */
    logger.info('Instagram OAuth step:', {
      operation: 'inspectTokenResponse',
      status: 'ok',
      hasAccessToken: Boolean(token.access_token),
      hasUserId: Boolean(token.user_id),          // step 4
      userIdLength: String(token.user_id ?? '').length,
      longLived: token.longLived === true,
      expiresInSeconds: token.expires_in ?? null,
      scopeCount: Array.isArray(token.scopes) ? token.scopes.length : 0,
    });

    /**
     * Step 5 — establish the Instagram user id.
     *
     * Preferred from the token response, which carries it: the previous code
     * always spent a `/me` round-trip to re-fetch a value it had just been
     * handed, so when that one endpoint broke the whole connection failed with
     * a 500 even though nothing was actually wrong with the account. `/me` is
     * now only the fallback for the older token shape that omits `user_id`, and
     * the log above says which path this run took.
     */
    const igUserId = token.user_id;

    /**
     * Step 6 — the profile, which is what eligibility is judged on, and which
     * also carries the authoritative account id.
     *
     * There is no separate `/me` round-trip any more, in either direction.
     * `fetchProfile` asks the `me` node first — an Instagram User access token
     * *is* the identity, so the node needs no id — and falls back to the
     * id-addressed node only if the host refuses that path. One request, and
     * the id comes back inside it.
     *
     * The id from the token is still what gets stored; it is passed here purely
     * as the fallback node and as the value to fall back to if the response
     * omits one.
     */
    const profile = await step('fetchProfile', () =>
      instagramService.fetchProfile(token.access_token, igUserId));

    logger.info('Instagram OAuth step:', {
      operation: 'inspectProfile',
      status: 'ok',
      hasId: Boolean(profile.id),
      hasUsername: Boolean(profile.username),
      accountType: profile.account_type ?? '(not returned)',
      followersCount: profile.followers_count ?? null,
    });

    // Steps 7–9 — eligibility, uniqueness and persistence, each logged inside.
    await persistProfile(claims.sub, token, { ...profile, id: profile.id ?? igUserId });

    // Step 10 — redirect back into onboarding.
    logger.info('Instagram OAuth step:', { operation: 'callback', status: 'succeeded' });
    return redirectResult(res, true, 'Instagram connected');
  } catch (err) {
    /**
     * One line that actually names the failure.
     *
     * `describeError` reads the message wherever the thrower left it — our
     * ApiError details, an HTTP client's `response.data.error`, a fetch
     * `cause`, Mongoose's `errors` — and says plainly when what was thrown was
     * not an Error at all. Everything it emits is redacted.
     *
     * The previous version read `message` only for ApiError, so every failure
     * that was not one of ours reported `message: undefined` — the reporting
     * discarded the one field that would have identified it.
     */
    logger.warn('Instagram OAuth callback failed:', {
      operation: err?.marqueiverStep ?? 'unknown',
      ...describeError(err),
    });

    return redirectResult(res, false,
      userFacingMessage(err, 'Instagram connection failed. Please try again.'));
  }
});

/**
 * Sync Now — refresh profile, media, engagement and insights.
 *
 * Returns the sync report alongside the account, so the UI can say which parts
 * are fresh and which could not be refreshed rather than presenting stale
 * numbers as current. A partial sync is a 200 with `partial: true`, not an
 * error: the parts that did refresh are real and worth showing.
 */
export const syncInstagramNow = catchAsync(async (req, res) => {
  const account = await InstagramAccount.findOne({ user: req.auth.sub }).select('+accessToken');
  if (!account) throw ApiError.notFound('No Instagram account connected');

  const report = await syncInstagram(account, { mediaLimit: 25 });

  if (report.requiresReconnect) {
    throw new ApiError(401, 'INSTAGRAM_TOKEN_INVALID',
      'Your Instagram authorisation has expired — please reconnect.',
      { platform: 'instagram', action: 'reconnect' });
  }

  const view = account.toObject();
  delete view.accessToken;
  ok(res, { account: view, sync: report });
});

/** The connected account's media, newest first. */
export const listInstagramMedia = catchAsync(async (req, res) => {
  const account = await InstagramAccount.findOne({ user: req.auth.sub }).select('_id');
  if (!account) throw ApiError.notFound('No Instagram account connected');

  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const media = await InstagramMedia.find({ account: account._id })
    .sort({ timestamp: -1 }).limit(limit).lean();

  ok(res, media);
});

/**
 * Account-level analytics.
 *
 * Served from the last sync rather than fetched live: an analytics page that
 * calls Meta on every render burns the app's rate-limit budget on repeat views
 * of the same numbers. `syncedAt` is returned so the UI can show how fresh the
 * figures are and offer Sync Now when they are not.
 */
export const getInstagramInsights = catchAsync(async (req, res) => {
  const account = await InstagramAccount.findOne({ user: req.auth.sub })
    .select('insights lastSyncedAt followers following mediaCount username accountType').lean();

  if (!account) throw ApiError.notFound('No Instagram account connected');

  ok(res, {
    username: account.username,
    accountType: account.accountType,
    followers: account.followers ?? null,
    following: account.following ?? null,
    mediaCount: account.mediaCount ?? null,
    // Each metric is { available, value } — an unavailable metric is never a
    // zero, so the UI can render "Not available from Meta API" honestly.
    metrics: account.insights ?? {},
    syncedAt: account.lastSyncedAt ?? null,
  });
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

/**
 * The old profile-only sync lived here and has been replaced by
 * `syncInstagramNow` above, which goes through socialSync.service.js.
 *
 * Two reasons rather than one. It refreshed only the profile — no media, no
 * insights — so "Sync Now" left the analytics page as stale as it found it. And
 * it classified failures by regex over the error message (`/expired|revoked|
 * 401|403/`), which reads whatever text the provider happened to send: an
 * unrelated error mentioning "403" marked a healthy account expired, and a real
 * expiry phrased differently did not. The replacement matches on error codes.
 */

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
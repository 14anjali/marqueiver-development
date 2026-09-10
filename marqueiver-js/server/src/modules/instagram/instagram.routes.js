import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import * as c from './instagram.controller.js';
import * as metaCallbacks from '../meta/metaCallbacks.controller.js';

/**
 * Instagram OAuth + data routes (SRS §5, FR-4/FR-5).
 * OAuth endpoints are rate-limited per SRS §7.1.
 */

const router = Router();

const oauthLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * FR-4.2 — start consent.
 *
 * `authenticate` is what the Facebook and YouTube equivalents have had all
 * along (facebook.routes.js, youtube.routes.js) and this route did not. Without
 * it the controller was the only thing inspecting the bearer string, and it
 * inspected it without verifying the signature — so the token embedded in
 * `state`, which the callback later trusts to identify the Marq user, was never
 * checked at the point it was issued.
 *
 * The middleware also loads the user and re-reads the role from the database,
 * so a suspended or terminated account cannot start a new social connection.
 */
router.get(
  '/auth/instagram',
  oauthLimiter,
  authenticate,
  c.startInstagramAuth
);

// FR-4.3 — OAuth callback
router.get(
  '/auth/instagram/callback',
  oauthLimiter,
  c.instagramCallback
);

// FR-5 — connected profile
router.get(
  '/instagram/profile',
  authenticate,
  c.getInstagramProfile
);

/**
 * FR-4.7 — Sync Now.
 *
 * Refreshes profile, media, engagement and insights in one run. Rate-limited
 * separately and harder than the read endpoints: each sync makes up to a dozen
 * Meta calls, so an impatient double-click is a meaningful share of the app's
 * rate-limit budget.
 */
const syncLimiter = rateLimit({
  windowMs: 60_000, max: 6, standardHeaders: true, legacyHeaders: false,
});

router.post('/instagram/sync', authenticate, syncLimiter, c.syncInstagramNow);

// Content and analytics, served from the last sync.
router.get('/instagram/media', authenticate, c.listInstagramMedia);
router.get('/instagram/insights', authenticate, c.getInstagramInsights);

// Disconnect Instagram from Marqueiver
router.delete(
  '/instagram/disconnect',
  authenticate,
  c.disconnectInstagram
);

/**
 * Meta platform callbacks.
 *
 * Unauthenticated by necessity — Instagram calls these server-to-server, with
 * no browser, no session and no token. The `signed_request` HMAC is the
 * authentication, and it is verified inside the handler before the payload is
 * read for anything.
 *
 * The limit is higher than `oauthLimiter` because these are machine traffic:
 * Meta can legitimately send a burst (a bulk deletion, or a retry sweep), and
 * throttling that would look to Meta like an endpoint that fails intermittently.
 *
 * These paths are what goes in the Meta App Dashboard:
 *   Deauthorize Callback URL   →  {API_URL}/api/auth/instagram/deauthorize
 *   Data Deletion Request URL  →  {API_URL}/api/auth/instagram/data-deletion
 */
const metaCallbackLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/auth/instagram/deauthorize',
  metaCallbackLimiter,
  metaCallbacks.deauthorize('instagram'),
);

router.post(
  '/auth/instagram/data-deletion',
  metaCallbackLimiter,
  metaCallbacks.dataDeletion('instagram'),
);

export default router;
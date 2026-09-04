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

// FR-4.2 — start consent
router.get(
  '/auth/instagram',
  oauthLimiter,
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

// FR-4.7 — on-demand sync
router.post(
  '/instagram/sync',
  authenticate,
  c.syncInstagram
);

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
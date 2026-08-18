import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import * as c from './instagram.controller.js';

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

export default router;
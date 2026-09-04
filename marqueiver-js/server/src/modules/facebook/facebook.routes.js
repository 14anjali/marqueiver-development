import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import * as metaCallbacks from '../meta/metaCallbacks.controller.js';

import {
  startFacebookAuth,
  facebookCallback,
  getFacebookProfile,
  syncFacebook,
  disconnectFacebook,
} from './facebook.controller.js';


const router = Router();


// Start Facebook OAuth flow
router.get(
  '/auth/facebook',
  authenticate,
  startFacebookAuth
);


// Facebook OAuth callback
// Do not add authenticate here because Facebook redirects
// directly to this endpoint.
router.get(
  '/auth/facebook/callback',
  facebookCallback
);


// Return the connected Facebook Page
router.get(
  '/facebook/profile',
  authenticate,
  getFacebookProfile
);


// Refresh Facebook Page data
router.post(
  '/facebook/sync',
  authenticate,
  syncFacebook
);


// A73 — disconnect parity with Instagram.
router.delete('/facebook/disconnect', authenticate, disconnectFacebook);


/**
 * Meta platform callbacks.
 *
 * No `authenticate`, for the same reason the OAuth callback above has none and
 * one stronger: Facebook calls these server-to-server, with no browser, no
 * session and no token. Authentication is the `signed_request` HMAC, verified
 * inside the handler before the payload is read for anything.
 *
 * These paths are what goes in the Meta App Dashboard (Settings → Basic):
 *   Deauthorize Callback URL   →  {API_URL}/api/auth/facebook/deauthorize
 *   Data Deletion Request URL  →  {API_URL}/api/auth/facebook/data-deletion
 */
const metaCallbackLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/auth/facebook/deauthorize',
  metaCallbackLimiter,
  metaCallbacks.deauthorize('facebook'),
);

router.post(
  '/auth/facebook/data-deletion',
  metaCallbackLimiter,
  metaCallbacks.dataDeletion('facebook'),
);

export default router;
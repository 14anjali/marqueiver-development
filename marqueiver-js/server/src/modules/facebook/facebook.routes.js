import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';

import {
  startFacebookAuth,
  facebookCallback,
  getFacebookProfile,
  syncFacebook,
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


export default router;
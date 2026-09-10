import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import {
  startYoutubeAuth,
  youtubeCallback,
  getYoutubeProfile,
  syncYoutube,
  disconnectYoutube,
} from './youtube.controller.js';

const router = Router();

router.get('/auth/youtube', authenticate, startYoutubeAuth);
router.get('/auth/youtube/callback', youtubeCallback);

router.get('/youtube/profile', authenticate, getYoutubeProfile);

router.post('/youtube/sync', authenticate, syncYoutube);

// A73 — disconnect parity with Instagram.
router.delete('/youtube/disconnect', authenticate, disconnectYoutube);

export default router;
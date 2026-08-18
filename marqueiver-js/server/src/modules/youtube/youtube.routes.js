import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import {
  startYoutubeAuth,
  youtubeCallback,
  getYoutubeProfile,
  syncYoutube,
} from './youtube.controller.js';

const router = Router();

router.get('/auth/youtube', authenticate, startYoutubeAuth);
router.get('/auth/youtube/callback', youtubeCallback);

router.get('/youtube/profile', authenticate, getYoutubeProfile);

router.post('/youtube/sync', authenticate, syncYoutube);

export default router;
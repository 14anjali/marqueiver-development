import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import * as metaCallbacks from '../meta/metaCallbacks.controller.js';
import * as c from './facebook.controller.js';

const router = Router();

const oauthLimiter = rateLimit({
  windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false,
});

/* ── OAuth ─────────────────────────────────────────────────────────────────
 * The callback deliberately has no `authenticate`: Facebook redirects the
 * browser here directly, so there is no Authorization header to read. The Marq
 * user is recovered from the signed JWT carried in the `state` parameter, which
 * is also what makes `state` the CSRF defence.
 */
router.get('/auth/facebook', oauthLimiter, authenticate, c.startFacebookAuth);
router.get('/auth/facebook/callback', oauthLimiter, c.facebookCallback);

/* ── Page selection ────────────────────────────────────────────────────────
 * The step that did not exist. A person may administer several Pages and only
 * they can say which one Marq should manage, so the connection is not finished
 * until a Page is chosen.
 */
router.get('/facebook/pages', authenticate, c.listFacebookPages);
router.post('/facebook/pages/select', authenticate, c.selectFacebookPage);

/* ── The connected Page ────────────────────────────────────────────────────── */
router.get('/facebook/profile', authenticate, c.getFacebookProfile);
router.get('/facebook/insights', authenticate, c.getFacebookInsights);

/**
 * Sync Now — rate-limited harder than the reads because each run makes several
 * Meta calls, so a double-click is a real share of the rate-limit budget.
 */
const syncLimiter = rateLimit({
  windowMs: 60_000, max: 6, standardHeaders: true, legacyHeaders: false,
});
router.post('/facebook/sync', authenticate, syncLimiter, c.syncFacebook);
router.delete('/facebook/disconnect', authenticate, c.disconnectFacebook);

/* ── Content (pages_manage_posts / pages_read_engagement) ──────────────────── */
router.get('/facebook/posts', authenticate, c.listFacebookPosts);
router.post('/facebook/posts', authenticate, c.publishFacebookPost);
router.delete('/facebook/posts/:postId', authenticate, c.deleteFacebookPost);

/* ── Comments (pages_manage_engagement) ────────────────────────────────────── */
router.get('/facebook/posts/:postId/comments', authenticate, c.listFacebookComments);
router.post('/facebook/comments/:commentId/reply', authenticate, c.replyToFacebookComment);
router.post('/facebook/comments/:commentId/hide', authenticate, c.moderateFacebookComment);
router.delete('/facebook/comments/:commentId', authenticate, c.deleteFacebookComment);

/* ── Meta platform callbacks ───────────────────────────────────────────────
 * Unauthenticated by necessity — Facebook calls these server-to-server with no
 * session. The `signed_request` HMAC is verified inside the handler before the
 * payload is read for anything.
 *
 * Meta App Dashboard → Settings → Basic:
 *   Deauthorize Callback URL   {API_URL}/api/auth/facebook/deauthorize
 *   Data Deletion Request URL  {API_URL}/api/auth/facebook/data-deletion
 */
const metaCallbackLimiter = rateLimit({
  windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false,
});

router.post('/auth/facebook/deauthorize', metaCallbackLimiter, metaCallbacks.deauthorize('facebook'));
router.post('/auth/facebook/data-deletion', metaCallbackLimiter, metaCallbacks.dataDeletion('facebook'));

export default router;
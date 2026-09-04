import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as c from './metaCallbacks.controller.js';

/**
 * Meta endpoints that belong to no single platform module.
 *
 * Mounted at the API root with the full path written here, so the URL is
 * readable in one place — it is a value pasted into the Meta App Dashboard, and
 * a path split across a mount point and a router is how the wrong URL ends up
 * in a dashboard field.
 *
 * There is deliberately **no webhook receiver**. Marqueiver reads Instagram and
 * Facebook data when a creator connects and on demand afterwards; nothing needs
 * a push subscription, so there is no endpoint to leave unverified and no
 * verify token to keep in sync. The Deauthorize and Data Deletion callbacks are
 * a separate mechanism and live in the platform route files.
 */
const router = Router();

/**
 * Public status lookup for a data deletion confirmation code.
 *
 * Unauthenticated for the reason given on the handler, and rate-limited harder
 * than the rest of the API because an open lookup keyed on a 12-character code
 * is the one place here worth brute-forcing.
 */
const statusLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
});

router.get('/data-deletion/status/:code', statusLimiter, c.deletionStatus);

export default router;
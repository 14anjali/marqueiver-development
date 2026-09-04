import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as c from './metaCallbacks.controller.js';

/**
 * The public status page for a data deletion confirmation code.
 *
 * Unauthenticated for the reason given on the handler, and rate-limited harder
 * than the rest of the API because an open lookup keyed on a 12-character code
 * is the one place here worth brute-forcing.
 */
const router = Router();

const statusLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
});

router.get('/status/:code', statusLimiter, c.deletionStatus);

export default router;

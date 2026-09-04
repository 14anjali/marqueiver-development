import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as c from './discovery.controller.js';

const router = Router();
router.use(authenticate);

/**
 * Scope §10 — role-based discovery rules, enforced on the backend rather than
 * by hiding sections in the UI:
 *
 *   Brand   → may discover creators.  May NOT browse a directory of brands.
 *   Creator → may see campaigns (see modules/campaigns).  May NOT browse a
 *             directory of other creators.
 *
 * Admin keeps access to both directories for moderation/support.
 *
 * Note the asymmetry on the single-profile endpoints: a creator still needs to
 * read the brand profile of a brand it is dealing with, and vice versa, so
 * `/creators/:id` and `/brands/:id` stay open to authenticated users. The rule
 * being enforced is about *discovery directories*, not about ever resolving a
 * counterpart's profile.
 */
const brandsOnly = requireRole('brand', 'admin');

router.get('/creators', brandsOnly, validate(c.searchCreatorsSchema, 'query'), c.searchCreators);
router.get('/creators/export', brandsOnly, validate(c.searchCreatorsSchema, 'query'), c.exportCreators);
router.get('/creators/saved', brandsOnly, c.listSavedCreators);
router.post('/creators/:id/save', brandsOnly, c.saveCreator);
router.delete('/creators/:id/save', brandsOnly, c.unsaveCreator);
router.get('/creators/:id', c.getCreatorProfile);

// Creator-facing brand lookup. A brand must not be handed a directory of other
// brands as its discovery experience (§10), so brands are excluded from the list.
router.get('/brands', requireRole('creator', 'admin'), c.searchBrands);
router.get('/brands/:id', c.getBrandProfile);

export default router;

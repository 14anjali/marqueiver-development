import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as c from './reviews.controller.js';
const router = Router();
router.use(authenticate);
router.post('/deal/:dealId', validate(c.createReviewSchema), c.createReview);
router.get('/user/:userId', c.listForUser);
export default router;

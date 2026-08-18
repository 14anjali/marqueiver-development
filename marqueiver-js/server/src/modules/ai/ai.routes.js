import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import * as c from './ai.controller.js';
const router = Router();
router.use(authenticate);
router.get('/compatibility/:creatorId', c.compatibility);
export default router;

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as c from './verifications.controller.js';
const router = Router();
router.use(authenticate);
router.post('/', validate(c.submitSchema), c.submit);
router.get('/', c.myVerifications);
export default router;

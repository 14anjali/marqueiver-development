import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as c from './notifications.controller.js';
const router = Router();
router.use(authenticate);
router.get('/', c.list);
router.post('/read', validate(c.readSchema), c.read);
export default router;

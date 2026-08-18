import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import * as c from './payments.controller.js';
const router = Router();
router.post('/webhook', c.webhook); // public, signature-verified
router.get('/transactions', authenticate, c.myTransactions);
router.get('/earnings', authenticate, requireRole('creator'), c.earnings);
export default router;

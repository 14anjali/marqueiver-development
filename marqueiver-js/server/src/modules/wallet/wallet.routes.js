import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as c from './wallet.controller.js';

const router = Router();
router.use(authenticate);

const withdrawLimiter = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });

router.get('/', c.getWallet);
router.get('/ledger', c.getLedger);
router.post('/payout-method', validate(c.setPayoutMethodSchema), c.setPayoutMethod);
router.post('/withdraw', withdrawLimiter, validate(c.withdrawSchema), c.withdraw);

export default router;

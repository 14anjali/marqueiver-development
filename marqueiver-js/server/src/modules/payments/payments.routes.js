import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as c from './payments.controller.js';
const router = Router();
router.post('/webhook', c.webhook); // public, signature-verified
router.get('/transactions', authenticate, c.myTransactions);
router.get('/earnings', authenticate, requireRole('creator'), c.earnings);

/**
 * Brand payment methods — reference records, not chargeable instruments.
 * See `models/BrandPaymentMethod.js`. Escrow funding is untouched and still
 * runs through `POST /deals/:id/payment-session`.
 */
router.get('/methods', authenticate, requireRole('brand'), c.listBrandPaymentMethods);
router.post('/methods', authenticate, requireRole('brand'), validate(c.brandPaymentMethodSchema), c.addBrandPaymentMethod);
router.patch('/methods/:id', authenticate, requireRole('brand'), validate(c.brandPaymentMethodPatchSchema), c.updateBrandPaymentMethod);
router.post('/methods/:id/default', authenticate, requireRole('brand'), c.setDefaultBrandPaymentMethod);
router.delete('/methods/:id', authenticate, requireRole('brand'), c.removeBrandPaymentMethod);

export default router;
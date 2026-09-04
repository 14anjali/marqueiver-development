import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as c from './deals.controller.js';
import { requireCompliance } from '../../middleware/policyGate.js';
const router = Router();
router.use(authenticate);
/**
 * Policy 1.3, 13.1, 1.14 — starting or progressing a Collaboration requires an
 * 18+ declaration, verified mobile and email, and acceptance of the current
 * policies. Reads stay open so a blocked user can see why.
 */
router.post('/', requireRole('brand'), requireCompliance, validate(c.createDealSchema), c.createDeal);
router.get('/', c.listMyDeals);
router.get('/:id', c.getDeal);
router.post('/:id/payment-session', requireRole('brand'), requireCompliance, c.startPaymentSession);
router.post('/:id/transition', requireCompliance, validate(c.transitionSchema), c.transition);
router.post('/:id/submit', requireRole('creator'), validate(c.submitWorkSchema), c.submitWork);
// Policy 15 — disclosure must be confirmed before submission is permitted.
router.post('/:id/disclosure', requireRole('creator'), validate(c.confirmDisclosureSchema), c.confirmDisclosure);
// Policy 28 — the consequence must be shown before the user confirms.
router.get('/:id/cancellation-preview', c.previewCancellation);
router.post('/:id/cancel', validate(c.cancelDealSchema), c.cancelDeal);
// Policy 5.4 — revision requests, capped at the agreed rounds.
router.post('/:id/request-revision', requireRole('brand'), c.requestRevision);

// Negotiation (scope §11, §12) — both parties, state checked in the service.
router.post('/:id/offers', validate(c.offerSchema), c.createOffer);
router.post('/:id/offers/:offerId/accept', c.acceptOfferHandler);
router.post('/:id/offers/:offerId/reject', validate(c.rejectOfferSchema), c.rejectOfferHandler);
// Offers cannot be withdrawn (§4) — the endpoint was removed deliberately.
router.post('/:id/confirm-terms', c.confirmTermsHandler);
router.post('/:id/reject', validate(c.rejectDealSchema), c.rejectDealHandler);
export default router;

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as c from './policies.controller.js';

const router = Router();

// Public — a person must be able to read the terms before registering.
router.get('/', c.listPolicies);
router.get('/:slug', c.getPolicy);

// Acceptance is attributable, so it requires a session.
router.post('/accept', authenticate, validate(c.acceptPolicySchema), c.acceptPolicies);
router.get('/me/acceptances', authenticate, c.myAcceptances);
router.get('/me/pending', authenticate, c.pendingAcceptances);

export default router;

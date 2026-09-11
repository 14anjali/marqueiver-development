import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as c from './campaigns.controller.js';

const router = Router();
router.use(authenticate);

router.post('/', validate(c.createCampaignSchema), c.createCampaign);
router.get('/', c.listCampaigns);
// Must be declared before '/:id' or "applied" is captured as an id.
router.get('/applied', c.listMyApplications);
router.get('/:id', c.getCampaign);
// What is still missing before this campaign can be published. Owner-only, and
// declared before the PATCH so the wizard's review step has one source of truth.
router.get('/:id/readiness', c.getPublishReadiness);
router.patch('/:id', validate(c.updateCampaignSchema), c.updateCampaign);
// Draft/rejected → back into the review queue. Distinct from PATCH so that
// saving an edit does not re-enter the queue on every keystroke.
router.post('/:id/submit', c.submitCampaignForReview);
router.post('/:id/apply', c.applyToCampaign);
router.get('/:id/applicants', c.listApplicants);
router.patch('/:id/applicants/:creatorId', validate(c.decideApplicantSchema), c.decideApplicant);

export default router;
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as c from './users.controller.js';
const router = Router();
router.use(authenticate);
router.get('/me/profile', c.getMyProfile);
// Everything the onboarding screens need, resolved server-side, so a refresh
// or a re-login resumes at the correct step instead of restarting.
router.get('/me/onboarding', c.getOnboardingState);
router.patch('/me/creator', validate(c.updateCreatorSchema), c.updateCreatorProfile);
router.patch('/me/brand', validate(c.updateBrandSchema), c.updateBrandProfile);
router.post('/me/socials', validate(c.connectSocialSchema), c.connectSocial);
router.post('/me/logo-upload-url', validate(c.getUploadUrlSchema), c.getLogoUploadUrl);
router.post('/me/complete-onboarding', c.completeOnboarding);
router.patch('/me/onboarding-step', validate(c.saveOnboardingStepSchema), c.saveOnboardingStep);
router.post('/me/portfolio', validate(c.addPortfolioItemSchema), c.addPortfolioItem);
router.delete('/me/portfolio/:itemId', c.deletePortfolioItem);
router.get('/me/analytics', c.getAnalytics);
router.get('/me/media-kit', c.getMediaKit);

// Policy 1.3 — 18+ declaration, verified server-side.
router.post('/me/declare-age', validate(c.declareAgeSchema), c.declareAge);
// Policy 3.3 — publish / unpublish the profile from discovery.
router.patch('/me/visibility', validate(c.setVisibilitySchema), c.setProfileVisibility);
// Policy 3.2 / 13.2 — declared figures, stored apart from verified ones.
router.put('/me/self-reported-metrics', validate(c.selfReportedSchema), c.setSelfReportedMetrics);
// Account deletion — deactivation + anonymisation (Policy 24 retention).
router.delete('/me', validate(c.deleteAccountSchema), c.deleteAccount);
export default router;
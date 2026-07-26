import { Router } from 'express';
import * as adController from './ad.controller';
import authMiddleware from '../../middlewares/auth';
import optionalAuthMiddleware from '../../middlewares/optional-auth';
import validateRequest from '../../middlewares/validate-request';
import { createAdSchema, updateAdSchema } from './ad.validation';

const router = Router();

router.post('/', authMiddleware, validateRequest(createAdSchema), adController.createAd);
router.get('/my-ads', authMiddleware, adController.getMyAds);
router.get('/', optionalAuthMiddleware, adController.getAds);
router.get('/:id', optionalAuthMiddleware, adController.getAd);
router.post('/:id/view', optionalAuthMiddleware, adController.countAdView);
router.post('/:id/repost', authMiddleware, adController.repostAd);
router.put('/:id', authMiddleware, validateRequest(updateAdSchema), adController.updateAd);
router.delete('/:id', authMiddleware, adController.deleteAd);

export default router;

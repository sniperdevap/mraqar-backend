import { Router } from 'express';
import * as paymentController from './payment.controller';
import authMiddleware from '../../middlewares/auth';

const router = Router();

router.get('/callback', paymentController.callback);
router.post('/callback', paymentController.callback);

// Protected
router.post('/checkout', authMiddleware, paymentController.createCheckout);
router.get('/my-payments', authMiddleware, paymentController.getMyPayments);

export default router;

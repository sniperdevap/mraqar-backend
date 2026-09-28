import { Request, Response } from 'express';
import * as paymentService from './payment.service';
import asyncHandler from '../../utils/async-handler';
import { formatResponse } from '../../utils/helpers';
import logger from '../../utils/logger';
import config from '../../config/default';

export const createCheckout = asyncHandler(async (req: Request, res: Response) => {
    const { planId, coupon, quantity } = req.body;
    const user = req.user as any;
    const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';

    if (!planId) {
        return res.status(400).json(formatResponse(false, 'Plan ID is required'));
    }

    try {
        const checkout = await paymentService.createCheckout({ userId: user.id, planId, quantity: quantity === undefined ? 1 : Number(quantity), couponCode: coupon, lang });
        res.status(200).json(formatResponse(true, checkout.free ? 'Subscribed successfully' : 'Checkout created', checkout));
    } catch (error: any) {
        res.status(error.statusCode || 400).json(formatResponse(false, error.message));
    }
});

export const callback = asyncHandler(async (req: Request, res: Response) => {
    const paymentId = typeof req.query.paymentId === 'string' ? req.query.paymentId : undefined;
    logger.info(`[myfatoorah] callback paymentId=${paymentId || '-'}`);

    try {
        res.redirect(await paymentService.handleCallback(paymentId));
    } catch (error) {
        logger.error(`[myfatoorah] callback failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        res.redirect(`${config.clientUrl}/payment/result?status=failed`);
    }
});

export const getMyPayments = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as any;
    const payments = await paymentService.getMyPayments(user.id);
    res.status(200).json(formatResponse(true, 'Payments fetched successfully', payments));
});

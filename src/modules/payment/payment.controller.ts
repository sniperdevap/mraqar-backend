import { Request, Response } from 'express';
import * as paymentService from './payment.service';
import asyncHandler from '../../utils/async-handler';
import { formatResponse } from '../../utils/helpers';
import logger from '../../utils/logger';
import config from '../../config/default';

export const createCheckout = asyncHandler(async (req: Request, res: Response) => {
    const { planId, coupon, mobile } = req.body;
    const user = req.user as any;
    const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';

    if (!planId) {
        return res.status(400).json(formatResponse(false, 'Plan ID is required'));
    }

    try {
        const checkout = await paymentService.createCheckout({
            userId: user.id,
            planId,
            couponCode: coupon,
            lang,
            mobile: mobile || user.phone
        });

        if (checkout.free) {
            return res.status(200).json(formatResponse(true, 'Subscribed successfully', checkout));
        }

        res.status(200).json(formatResponse(true, 'Checkout created', checkout));
    } catch (error: any) {
        res.status(400).json(formatResponse(false, error.message));
    }
});

export const callback = asyncHandler(async (req: Request, res: Response) => {
    const query = { ...req.query, ...req.body } as { encrp?: string; ErrorCode?: string; PayTrackID?: string };

    logger.info(`[knet] callback ${req.method} track=${query.PayTrackID || '-'} ErrorCode=${query.ErrorCode || '-'} encrp=${query.encrp ? 'yes' : 'no'}`);

    try {
        const redirectUrl = await paymentService.handleCallback(query);
        res.redirect(redirectUrl);
    } catch (error) {
        logger.error(`[knet] callback failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        res.redirect(`${config.clientUrl}/payment/result?status=failed`);
    }
});

export const getMyPayments = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as any;
    const payments = await paymentService.getMyPayments(user.id);
    res.status(200).json(formatResponse(true, 'Payments fetched successfully', payments));
});

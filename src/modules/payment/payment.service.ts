import { PaymentModel, PaymentStatus, IPayment } from './models/payment.model';
import * as knet from './knet.service';
import { isMockGatewayEnabled } from './knet.mock';
import * as subscriptionService from '../subscription/subscription.service';
import { SubscriptionPlanModel } from '../subscription-plan/models/subscription-plan.model';
import CustomError from '../../utils/custom-error';
import logger from '../../utils/logger';
import config from '../../config/default';

export const getReturnUrl = (): string => {
    const base = process.env.KNET_RETURN_URL || `${process.env.API_PUBLIC_URL || ''}${config.baseRoute}/payments/callback`;
    if (!base.startsWith('https://') && !isMockGatewayEnabled()) {
        throw new CustomError('KNET return URL must be a public https URL', 500);
    }
    return base;
};

const resultRedirect = (status: string, trackId?: string, errorCode?: string) => {
    const params = new URLSearchParams({ status });
    if (trackId) params.set('track', trackId);
    if (errorCode) params.set('code', errorCode);
    return `${config.clientUrl}/payment/result?${params.toString()}`;
};

export interface CreateCheckoutParams {
    userId: string;
    planId: string;
    couponCode?: string;
    lang?: 'en' | 'ar';
    mobile?: string;
}

export const createCheckout = async (params: CreateCheckoutParams) => {
    const { plan, amount, couponCode } = await subscriptionService.priceOrder(params.planId, params.couponCode);

    await subscriptionService.assertPlanPurchasable(params.userId, plan, params.lang);

    if (amount <= 0) {
        await subscriptionService.consumeCoupon(couponCode);
        const subscription = await subscriptionService.grantPlan(params.userId, plan, params.lang);
        return { free: true as const, subscription };
    }

    const trackId = knet.generateTrackId();

    const payment = await PaymentModel.create({
        trackId,
        user: params.userId,
        plan: plan._id,
        planType: plan.planType,
        amount,
        couponCode,
        status: PaymentStatus.PENDING
    });

    const checkout = await knet.buildCheckout({
        amount,
        trackId,
        lang: params.lang,
        reference: plan.name,
        userId: params.userId,
        returnUrl: getReturnUrl(),
        kValidateMobile: process.env.KNET_K_VALIDATE === 'true' ? params.mobile : undefined,
        payType: (process.env.KNET_PAY_TYPE as '1' | '2' | undefined) || undefined
    });

    logger.info(`[knet] checkout created track=${trackId} user=${params.userId} amount=${knet.formatAmount(amount)}`);

    return { free: false as const, paymentId: payment.id, trackId, ...checkout };
};

const statusFor = (gatewayStatus?: string): PaymentStatus => {
    switch (gatewayStatus) {
        case knet.KNET_STATUS.SUCCESS:
            return PaymentStatus.PAID;
        case knet.KNET_STATUS.CANCELLED:
            return PaymentStatus.CANCELLED;
        default:
            return PaymentStatus.FAILED;
    }
};

export const applyResult = async (payment: IPayment, result: knet.KnetTransaction) => {
    const status = statusFor(result?.Status);

    const claimed = await PaymentModel.findOneAndUpdate(
        { _id: payment._id, status: PaymentStatus.PENDING },
        {
            $set: {
                status,
                gatewayMessage: result?.Message,
                payType: result?.PayType,
                paymentId: result?.PaymentId,
                transactionId: result?.TransactionId,
                authCode: result?.AuthCode,
                referenceId: result?.ReferenceId,
                receiptNo: result?.ReceiptNo,
                gatewayResponse: result
            }
        },
        { new: true }
    );

    // Someone else already settled this payment.
    if (!claimed) {
        return PaymentModel.findById(payment._id);
    }

    if (status !== PaymentStatus.PAID) {
        logger.warn(`[knet] payment not successful track=${claimed.trackId} status=${result?.Status} message=${result?.Message}`);
        return claimed;
    }

    const paidAmount = Number(result?.Amount);
    if (Number.isFinite(paidAmount) && Math.abs(paidAmount - claimed.amount) > 0.0005) {
        logger.error(`[knet] amount mismatch track=${claimed.trackId} expected=${claimed.amount} charged=${paidAmount}`);
    }

    const plan = await SubscriptionPlanModel.findById(claimed.plan);
    if (!plan) {
        logger.error(`[knet] paid for a plan that no longer exists track=${claimed.trackId} plan=${claimed.plan}`);
        return claimed;
    }

    try {
        await subscriptionService.consumeCoupon(claimed.couponCode);
        await subscriptionService.grantPlan(String(claimed.user), plan);
        claimed.creditsGranted = true;
        await claimed.save();
    } catch (error) {
        logger.error(`[knet] PAID BUT NOT GRANTED track=${claimed.trackId} user=${claimed.user} amount=${claimed.amount}: ${error instanceof Error ? error.message : 'unknown error'}`);
        return claimed;
    }

    logger.info(`[knet] payment settled track=${claimed.trackId} receipt=${result?.ReceiptNo}`);
    return claimed;
};

export const handleCallback = async (query: { encrp?: string; ErrorCode?: string; PayTrackID?: string }) => {
    if (query.ErrorCode) {
        const payment = query.PayTrackID ? await PaymentModel.findOne({ trackId: query.PayTrackID }) : null;
        if (payment && payment.status === PaymentStatus.PENDING) {
            payment.status = PaymentStatus.FAILED;
            payment.errorCode = query.ErrorCode;
            await payment.save();
        }
        logger.warn(`[knet] gateway error code=${query.ErrorCode} track=${query.PayTrackID}`);
        return resultRedirect('failed', query.PayTrackID, query.ErrorCode);
    }

    if (!query.encrp) {
        return resultRedirect('failed');
    }

    const result = await knet.getTransactionByEncrp(query.encrp);
    const trackId = result?.PayId;

    const payment = trackId ? await PaymentModel.findOne({ trackId }) : null;
    if (!payment) {
        logger.error(`[knet] callback for unknown track=${trackId}`);
        return resultRedirect('failed', trackId);
    }

    const settled = await applyResult(payment, result);
    return resultRedirect(settled?.status === PaymentStatus.PAID ? 'success' : settled?.status || 'failed', payment.trackId);
};

/** Minutes a payment may sit pending before the sweep asks the gateway what happened. */
const RECONCILE_AFTER_MINUTES = 5;
const RECONCILE_GIVE_UP_HOURS = 24;

/**
 * Catches the customer who paid and never came back — a closed tab, a dropped connection.
 * Without this the money moves and the credits never do.
 */
export const reconcilePendingPayments = async () => {
    const now = Date.now();

    const pending = await PaymentModel.find({
        status: PaymentStatus.PENDING,
        createdAt: {
            $lt: new Date(now - RECONCILE_AFTER_MINUTES * 60 * 1000),
            $gt: new Date(now - RECONCILE_GIVE_UP_HOURS * 60 * 60 * 1000)
        }
    }).limit(100);

    for (const payment of pending) {
        try {
            const result = await knet.verifyByTrackId(payment.trackId);

            // -1 means the gateway has no record yet; leave it pending for the next sweep.
            if (result?.Status === knet.KNET_STATUS.INVALID_REF) {
                continue;
            }

            await applyResult(payment, result);
        } catch (error) {
            logger.error(`[knet] reconcile failed track=${payment.trackId}: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
    }

    return pending.length;
};

export const getMyPayments = (userId: string) => PaymentModel.find({ user: userId }).sort({ createdAt: -1 }).limit(50).populate('plan');

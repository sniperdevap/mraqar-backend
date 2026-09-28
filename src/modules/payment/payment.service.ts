import { PaymentModel, PaymentStatus, IPayment } from './models/payment.model';
import * as mf from './myfatoorah.service';
import * as subscriptionService from '../subscription/subscription.service';
import { SubscriptionPlanModel } from '../subscription-plan/models/subscription-plan.model';
import { UserModel } from '../user/models/user.model';
import CustomError from '../../utils/custom-error';
import logger from '../../utils/logger';
import config from '../../config/default';

const resultRedirect = (status: string, trackId?: string, errorCode?: string) => {
    const params = new URLSearchParams({ status });
    if (trackId) params.set('track', trackId);
    if (errorCode) params.set('code', errorCode);
    return `${config.clientUrl}/payment/result?${params.toString()}`;
};

export interface CreateCheckoutParams {
    userId: string;
    planId: string;
    quantity?: number;
    couponCode?: string;
    lang?: 'en' | 'ar';
}

export const createCheckout = async (params: CreateCheckoutParams) => {
    const { plan, amount, couponCode, quantity } = await subscriptionService.priceOrder(params.planId, params.couponCode, params.quantity);

    if (amount <= 0) {
        await subscriptionService.consumeCoupon(couponCode);
        const subscription = await subscriptionService.grantPlan(params.userId, plan, quantity);
        return { free: true as const, subscription };
    }

    if (!process.env.MYFATOORAH_CALLBACK_URL) {
        throw new CustomError('MYFATOORAH_CALLBACK_URL is not configured', 500);
    }

    const user = await UserModel.findById(params.userId).select('name phoneNumber');
    const trackId = mf.generateTrackId();

    const payment = await PaymentModel.create({
        trackId,
        user: params.userId,
        plan: plan._id,
        planType: plan.planType,
        quantity,
        amount: mf.round3(amount),
        couponCode,
        status: PaymentStatus.PENDING
    });

    const invoice = await mf.sendPayment({
        amount,
        itemName: `${(params.lang === 'ar' && plan.nameAr) || plan.name}${quantity > 1 ? ` x${quantity}` : ''}`,
        customerName: user?.name,
        mobile: user?.phoneNumber,
        trackId,
        userId: params.userId,
        lang: params.lang
    });

    payment.invoiceId = String(invoice.InvoiceId);
    await payment.save();

    logger.info(`[myfatoorah] checkout created track=${trackId} invoice=${invoice.InvoiceId} user=${params.userId} amount=${payment.amount}`);

    return { free: false as const, paymentId: payment.id, trackId, url: invoice.InvoiceURL };
};

export const statusFor = (invoice: mf.MfInvoice, attempt?: mf.MfTransaction): PaymentStatus | null => {
    if (invoice.InvoiceStatus === 'Paid') return PaymentStatus.PAID;
    if (invoice.InvoiceStatus === 'Canceled') return PaymentStatus.CANCELLED;
    if (attempt && !mf.isSuccessful(attempt) && attempt.TransactionStatus !== 'InProgress') return PaymentStatus.FAILED;
    return null;
};

export const grantPaid = async (payment: IPayment) => {
    const claimed = await PaymentModel.findOneAndUpdate({ _id: payment._id, status: PaymentStatus.PAID, creditsGranted: false }, { $set: { creditsGranted: true } }, { new: true });
    if (!claimed) return;

    try {
        const plan = await SubscriptionPlanModel.findById(claimed.plan);
        if (!plan) throw new Error(`plan ${claimed.plan} no longer exists`);
        await subscriptionService.consumeCoupon(claimed.couponCode);
        await subscriptionService.grantPlan(String(claimed.user), plan, claimed.quantity || 1);
        logger.info(`[myfatoorah] plan granted track=${claimed.trackId}`);
    } catch (error) {
        await PaymentModel.updateOne({ _id: claimed._id }, { $set: { creditsGranted: false } });
        logger.error(`[myfatoorah] PAID BUT NOT GRANTED track=${claimed.trackId} user=${claimed.user} amount=${claimed.amount}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
};

export const applyResult = async (payment: IPayment, invoice: mf.MfInvoice, paymentId?: string) => {
    const txns = invoice.InvoiceTransactions || [];
    const txn = txns.find((t) => paymentId && t.PaymentId === paymentId) || txns.find(mf.isSuccessful) || txns[txns.length - 1];

    const status = statusFor(invoice, paymentId ? txn : undefined);
    if (!status) return payment;

    const settled = await PaymentModel.findOneAndUpdate(
        { _id: payment._id, status: PaymentStatus.PENDING },
        {
            $set: {
                status,
                gatewayMessage: txn?.Error || invoice.InvoiceStatus,
                errorCode: txn?.ErrorCode || undefined,
                payType: txn?.PaymentGateway,
                paymentId: txn?.PaymentId,
                transactionId: txn?.TransactionId,
                authCode: txn?.AuthorizationId,
                referenceId: txn?.ReferenceId,
                receiptNo: invoice.InvoiceReference,
                gatewayResponse: invoice
            }
        },
        { new: true }
    );

    if (!settled) return PaymentModel.findById(payment._id);

    if (status !== PaymentStatus.PAID) {
        logger.warn(`[myfatoorah] payment ${status} track=${settled.trackId} error=${txn?.ErrorCode || '-'} ${txn?.Error || ''}`);
        return settled;
    }

    if (Math.abs(Number(invoice.InvoiceValue) - settled.amount) > 0.0005) {
        logger.error(`[myfatoorah] amount mismatch track=${settled.trackId} expected=${settled.amount} charged=${invoice.InvoiceValue}`);
    }

    await grantPaid(settled);
    return PaymentModel.findById(settled._id);
};

export const handleCallback = async (paymentId?: string) => {
    if (!paymentId) return resultRedirect('failed');

    const invoice = await mf.getPaymentStatus(paymentId, 'PaymentId');
    const payment = invoice.CustomerReference ? await PaymentModel.findOne({ trackId: invoice.CustomerReference }) : null;
    if (!payment) {
        logger.error(`[myfatoorah] callback for unknown track=${invoice.CustomerReference} paymentId=${paymentId}`);
        return resultRedirect('failed');
    }

    const settled = await applyResult(payment, invoice, paymentId);
    const status = settled?.status === PaymentStatus.PAID ? 'success' : settled?.status === PaymentStatus.PENDING ? 'pending' : settled?.status || 'failed';
    return resultRedirect(status, payment.trackId, settled?.errorCode);
};

export const reconcilePendingPayments = async () => {
    const now = Date.now();

    const pending = await PaymentModel.find({
        status: PaymentStatus.PENDING,
        createdAt: { $lt: new Date(now - 5 * 60 * 1000), $gt: new Date(now - 24 * 60 * 60 * 1000) }
    }).limit(100);

    for (const payment of pending) {
        if (!payment.invoiceId) continue;
        try {
            await applyResult(payment, await mf.getPaymentStatus(payment.invoiceId, 'InvoiceId'));
        } catch (error) {
            logger.error(`[myfatoorah] reconcile failed track=${payment.trackId}: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
    }

    const ungranted = await PaymentModel.find({ status: PaymentStatus.PAID, creditsGranted: false }).limit(100);
    for (const payment of ungranted) await grantPaid(payment);

    return pending.length + ungranted.length;
};

export const getMyPayments = (userId: string) => PaymentModel.find({ user: userId }).sort({ createdAt: -1 }).limit(50).populate('plan');

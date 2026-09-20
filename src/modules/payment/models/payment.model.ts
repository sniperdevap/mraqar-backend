import mongoose, { Schema, Document } from 'mongoose';
import { PlanType } from '../../subscription-plan/models/subscription-plan.model';

export enum PaymentStatus {
    PENDING = 'pending',
    PAID = 'paid',
    FAILED = 'failed',
    CANCELLED = 'cancelled'
}

export interface IPayment extends Document {
    trackId: string;
    user: mongoose.Types.ObjectId;
    plan: mongoose.Types.ObjectId;
    planType: PlanType;
    amount: number;
    couponCode?: string;
    status: PaymentStatus;
    creditsGranted: boolean;
    payType?: string;
    paymentId?: string;
    transactionId?: string;
    authCode?: string;
    referenceId?: string;
    receiptNo?: string;
    gatewayMessage?: string;
    errorCode?: string;
    gatewayResponse?: unknown;
    createdAt: Date;
    updatedAt: Date;
}

const PaymentSchema: Schema = new Schema(
    {
        trackId: { type: String, required: true, unique: true },
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        plan: { type: Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
        planType: { type: String, enum: Object.values(PlanType), required: true },
        amount: { type: Number, required: true, min: 0 },
        couponCode: { type: String },
        status: { type: String, enum: Object.values(PaymentStatus), default: PaymentStatus.PENDING },
        creditsGranted: { type: Boolean, default: false },
        payType: { type: String },
        paymentId: { type: String },
        transactionId: { type: String },
        authCode: { type: String },
        referenceId: { type: String },
        receiptNo: { type: String },
        gatewayMessage: { type: String },
        errorCode: { type: String },
        gatewayResponse: { type: Schema.Types.Mixed }
    },
    { timestamps: true }
);

// Drives the reconciliation sweep for payments the customer never returned from.
PaymentSchema.index({ status: 1, createdAt: 1 });
PaymentSchema.index({ user: 1, createdAt: -1 });

export const PaymentModel = mongoose.model<IPayment>('Payment', PaymentSchema);

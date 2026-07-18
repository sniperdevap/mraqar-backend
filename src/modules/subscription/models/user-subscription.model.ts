import mongoose, { Schema, Document } from 'mongoose';
import { PlanType } from '../../subscription-plan/models/subscription-plan.model';

export interface IUserSubscription extends Document {
    user: mongoose.Types.ObjectId;
    plan: mongoose.Types.ObjectId;
    planType: PlanType;
    credits: number;
    premiumCredits: number;
    startDate: Date;
    endDate: Date;
    isActive: boolean;
    purchaseCount: number;
    createdAt: Date;
    updatedAt: Date;
}

const UserSubscriptionSchema: Schema = new Schema(
    {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        plan: { type: Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
        planType: { type: String, enum: Object.values(PlanType), required: true },
        credits: { type: Number, default: 0, min: 0 },
        premiumCredits: { type: Number, default: 0, min: 0 },
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },
        isActive: { type: Boolean, default: true },
        purchaseCount: { type: Number, default: 1 }
    },
    { timestamps: true }
);

// Compound index to ensure one subscription per plan type per user (if desired, but user requirements say "if user already has active subscription... just increase credit", so we likely keep one record per plan type)
UserSubscriptionSchema.index({ user: 1, planType: 1 }, { unique: true });
// Supports the public office listing, which starts from office-plan subscribers.
UserSubscriptionSchema.index({ planType: 1, user: 1 });

export const UserSubscriptionModel = mongoose.model<IUserSubscription>('UserSubscription', UserSubscriptionSchema);

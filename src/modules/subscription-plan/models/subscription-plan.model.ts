import mongoose, { Schema, Document } from 'mongoose';

export enum PlanType {
    OFFICE_PLAN = 'office-plan',
    DAILY_PLAN = 'daily-plan'
}

export const SELLABLE_PLAN_TYPES = [PlanType.OFFICE_PLAN, PlanType.DAILY_PLAN];

export interface ISubscriptionPlan extends Document {
    name: string;
    nameAr: string;
    planType: PlanType;
    description: string;
    price: number;
    numberOfMonths: number;
    adCredits: number;
    discount: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const SubscriptionPlanSchema: Schema = new Schema(
    {
        name: { type: String, required: true },
        nameAr: { type: String, required: true },
        planType: { type: String, enum: Object.values(PlanType), required: true },
        description: { type: String, required: true },
        price: { type: Number, required: true, default: 0 },
        numberOfMonths: { type: Number, required: true },
        adCredits: { type: Number, required: true, min: 0 },
        discount: { type: Number, default: 0, min: 0, max: 100 },
        isActive: { type: Boolean, default: true }
    },
    { timestamps: true }
);

export const SubscriptionPlanModel = mongoose.model<ISubscriptionPlan>('SubscriptionPlan', SubscriptionPlanSchema);

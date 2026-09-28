import { z } from 'zod';
import { PlanType } from './models/subscription-plan.model';

export const createSubscriptionPlanSchema = z.object({
    body: z.object({
        name: z.string({ required_error: 'Plan name is required' }),
        planType: z.enum([PlanType.OFFICE_PLAN, PlanType.DAILY_PLAN], {
            errorMap: () => ({ message: 'Invalid plan type' })
        }),
        description: z.string({ required_error: 'Description is required' }),
        price: z.number({ required_error: 'Price is required' }).min(0),
        numberOfMonths: z.number({ required_error: 'Number of months is required' }).min(1),
        adCredits: z.number({ required_error: 'Number of ad credits is required' }).min(0),
        discount: z.number().min(0).max(100).optional(),
        isActive: z.boolean().optional()
    })
});

export const getSubscriptionPlanByIdSchema = z.object({
    params: z.object({
        id: z.string({ required_error: 'Plan ID is required' })
    })
});

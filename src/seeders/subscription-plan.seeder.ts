import { PlanType } from '../modules/subscription-plan/models/subscription-plan.model';
import logger from '../utils/logger';
import { SubscriptionPlanModel } from '../modules/subscription-plan/models/subscription-plan.model';

const seedSubscriptionPlan = async (): Promise<void> => {
    try {
        const plans = [
            {
                name: 'Office plan',
                nameAr: 'خطة المكتب',
                planType: PlanType.OFFICE_PLAN,
                description: 'إعلان - 1 شهور',
                price: 30,
                numberOfMonths: 1,
                adCredits: 30,
                discount: 0,
                isActive: true
            },
            {
                name: 'Daily Plan',
                nameAr: 'الخطة اليومية',
                planType: PlanType.DAILY_PLAN,
                description: 'إعلان مميز - رصيد واحد',
                price: 1.5,
                numberOfMonths: 1,
                adCredits: 1,
                discount: 0,
                isActive: true
            }
        ];

        for (const plan of plans) {
            const { price, ...rest } = plan;
            await SubscriptionPlanModel.findOneAndUpdate({ planType: plan.planType }, { $set: rest, $setOnInsert: { price } }, { upsert: true, new: true });
        }

        logger.info('Subscription plans seeded/updated successfully.');
    } catch (error: unknown) {
        if (error instanceof Error) {
            logger.error(`Error seeding subscription plans: ${error.message}`, { stack: error.stack });
        } else {
            logger.error('Unknown error occurred while seeding subscription plans');
        }
    }
};

export default seedSubscriptionPlan;

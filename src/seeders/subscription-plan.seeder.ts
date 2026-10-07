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
                description: 'مكتب - 1 شهر',
                price: 25,
                numberOfMonths: 1,
                adCredits: 30,
                discount: 0,
                isActive: true
            },
            {
                name: 'Daily Plan',
                nameAr: 'الخطة اليومية',
                planType: PlanType.DAILY_PLAN,
                description: 'شراء أرصدة للإعلانات',
                price: 1.5,
                numberOfMonths: 1,
                adCredits: 1,
                discount: 0,
                isActive: true
            },
            {
                name: 'Normal Ads',
                nameAr: 'إعلانات عادية',
                planType: PlanType.NORMAL_PLAN,
                description: 'Post up to 10 normal ads for free.',
                price: 0,
                numberOfMonths: 1,
                adCredits: 10,
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

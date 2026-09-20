import { SubscriptionPlanModel, PlanType, ISubscriptionPlan } from '../subscription-plan/models/subscription-plan.model';
import { UserSubscriptionModel } from './models/user-subscription.model';
import { NotificationModel, NotificationType } from '../user/models/notification.model';
import { CouponModel } from '../coupon/models/coupon.model';
import * as couponService from '../coupon/coupon.service';

const MAX_STANDARD_PURCHASES_PER_PLAN = 4;

const getPlanCredits = (plan: { adCredits?: number }) => {
    if (typeof plan.adCredits === 'number') {
        return plan.adCredits;
    }
    // Legacy fallback for old DB rows that may still carry split fields.
    const legacyPlan = plan as { normalAds?: number; premiumAds?: number };
    return (legacyPlan.normalAds || 0) + (legacyPlan.premiumAds || 0);
};

export const priceOrder = async (planId: string, couponCode?: string) => {
    const plan = await SubscriptionPlanModel.findOne({ _id: planId, planType: PlanType.OFFICE_PLAN, isActive: true });
    if (!plan) {
        throw new Error('Plan not found');
    }

    let discountValue = 0;
    if (couponCode) {
        ({ discountValue } = await couponService.validateCoupon(couponCode));
    }

    const amount = Math.round(plan.price * (1 - discountValue / 100) * 1000) / 1000;

    return { plan, amount, discountValue, couponCode };
};

export const consumeCoupon = async (couponCode?: string) => {
    if (!couponCode) return;
    await CouponModel.updateOne({ code: couponCode.toUpperCase() }, { $inc: { usageCount: 1 } });
};

export const assertPlanPurchasable = async (userId: string, plan: ISubscriptionPlan, lang: string = 'en') => {
    const existing = await UserSubscriptionModel.findOne({ user: userId, planType: plan.planType });
    if (!existing) return;

    if ((existing.purchaseCount || 0) >= MAX_STANDARD_PURCHASES_PER_PLAN && (existing.credits || 0) > 0) {
        if (lang === 'ar') {
            throw new Error('يمكنك إعادة شراء هذه الخطة بعد استهلاك كامل الرصيد الحالي.');
        }
        throw new Error('You have reached the maximum purchase limit for this plan');
    }
};

export const grantPlan = async (userId: string, plan: ISubscriptionPlan, lang: string = 'en') => {
    await assertPlanPurchasable(userId, plan, lang);

    // Check if subscription exists for this plan type
    const existingSubscription = await UserSubscriptionModel.findOne({
        user: userId,
        planType: plan.planType
    });

    let subscription;
    const now = new Date();
    const durationMonths = plan.numberOfMonths || 1;
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + durationMonths);

    if (existingSubscription) {
        if ((existingSubscription.purchaseCount || 0) >= MAX_STANDARD_PURCHASES_PER_PLAN) {
            existingSubscription.purchaseCount = 0;
        }
        const creditsToAdd = getPlanCredits(plan);
        existingSubscription.credits = (existingSubscription.credits || 0) + creditsToAdd;
        existingSubscription.premiumCredits = 0;
        existingSubscription.purchaseCount = (existingSubscription.purchaseCount || 0) + 1;
        existingSubscription.startDate = now;
        existingSubscription.endDate = endDate;
        existingSubscription.isActive = true;
        await existingSubscription.save();
        subscription = existingSubscription;
    } else {
        // Create new subscription
        subscription = await UserSubscriptionModel.create({
            user: userId,
            plan: plan._id,
            planType: plan.planType,
            credits: getPlanCredits(plan),
            premiumCredits: 0,
            startDate: now,
            endDate: endDate,
            isActive: true,
            purchaseCount: 1
        });
    }

    // Create notification for the user
    const isOffice = plan.planType === PlanType.OFFICE_PLAN;
    // We assume plan.name is English. If plans have localized names, we should potentialy fetch them.
    // For now we will construct the message using the plan name which might be English.

    const title = isOffice ? { en: 'Office Plan Activated!', ar: 'تم تفعيل خطة المكتب!' } : { en: 'Subscription Plan Activated!', ar: 'تم تفعيل خطة الاشتراك!' };

    const message = isOffice
        ? {
              en: `Your office plan "${plan.name}" has been subscribed successfully! You are now listed on the offices page.`,
              ar: `تم الاشتراك في خطة المكتب "${plan.name}" بنجاح! أنت الآن معروض في صفحة المكاتب.`
          }
        : {
              en: `Your plan "${plan.name}" has been subscribed successfully! You can now post ads.`,
              ar: `تم الاشتراك في خطة "${plan.name}" بنجاح! يمكنك الآن نشر الإعلانات.`
          };

    const redirectUrl = isOffice ? '/offices' : '/account?tab=my-ads';

    await NotificationModel.create({
        user: userId,
        type: NotificationType.SUBSCRIPTION_ACTIVATED,
        title,
        message,
        redirectUrl
    });

    return subscription;
};

export const subscribeUser = async (userId: string, planId: string, couponCode?: string, lang: string = 'en') => {
    const order = await priceOrder(planId, couponCode);

    if (order.amount > 0) {
        if (lang === 'ar') {
            throw new Error('هذه الخطة تتطلب الدفع. يرجى إتمام عملية الدفع.');
        }
        throw new Error('This plan requires payment. Please complete checkout.');
    }

    await consumeCoupon(couponCode);
    return grantPlan(userId, order.plan, lang);
};

export const getUserSubscriptions = async (userId: string) => {
    // Populate plan details for display names etc if needed
    return await UserSubscriptionModel.find({
        user: userId,
        planType: PlanType.OFFICE_PLAN,
        $or: [{ isActive: true }, { credits: { $gt: 0 } }]
    }).populate('plan');
};

export interface RemainingAdCredits {
    officeCredits: number;
    totalCredits: number;
}

export const getRemainingAdCredits = async (userId: string): Promise<RemainingAdCredits> => {
    const activeSubscriptions = await UserSubscriptionModel.find({
        user: userId,
        credits: { $gt: 0 },
        planType: PlanType.OFFICE_PLAN,
        isActive: true
    }).select('planType credits');

    const officeCredits = activeSubscriptions.filter((sub) => sub.planType === PlanType.OFFICE_PLAN).reduce((sum, sub) => sum + (sub.credits || 0), 0);

    return {
        officeCredits,
        totalCredits: officeCredits
    };
};

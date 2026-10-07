import { SubscriptionPlanModel, PlanType, ISubscriptionPlan, ALL_PLAN_TYPES } from '../subscription-plan/models/subscription-plan.model';
import { UserSubscriptionModel } from './models/user-subscription.model';
import { NotificationModel, NotificationType } from '../user/models/notification.model';
import { CouponModel } from '../coupon/models/coupon.model';
import * as couponService from '../coupon/coupon.service';

const getPlanCredits = (plan: { adCredits?: number }) => {
    if (typeof plan.adCredits === 'number') {
        return plan.adCredits;
    }
    // Legacy fallback for old DB rows that may still carry split fields.
    const legacyPlan = plan as { normalAds?: number; premiumAds?: number };
    return (legacyPlan.normalAds || 0) + (legacyPlan.premiumAds || 0);
};

export const MAX_DAILY_CREDITS = 100;

export const priceOrder = async (planId: string, couponCode?: string, quantity = 1) => {
    const plan = await SubscriptionPlanModel.findOne({ _id: planId, planType: { $in: ALL_PLAN_TYPES }, isActive: true });
    if (!plan) {
        throw new Error('Plan not found');
    }

    if (plan.planType !== PlanType.DAILY_PLAN) quantity = 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_DAILY_CREDITS) {
        throw new Error(`Quantity must be between 1 and ${MAX_DAILY_CREDITS}`);
    }

    // The normal plan is always a single free grant, whatever price, coupon or quantity is sent.
    if (plan.planType === PlanType.NORMAL_PLAN) {
        return { plan, amount: 0, discountValue: 0, couponCode: undefined, quantity: 1 };
    }

    let discountValue = 0;
    if (couponCode) {
        ({ discountValue } = await couponService.validateCoupon(couponCode));
    }

    const amount = Math.round(plan.price * quantity * (1 - discountValue / 100) * 1000) / 1000;

    return { plan, amount, discountValue, couponCode, quantity };
};

export const consumeCoupon = async (couponCode?: string) => {
    if (!couponCode) return;
    await CouponModel.updateOne({ code: couponCode.toUpperCase() }, { $inc: { usageCount: 1 } });
};

export const grantPlan = async (userId: string, plan: ISubscriptionPlan, quantity = 1, lang: string = 'en') => {
    // Check if subscription exists for this plan type
    const existingSubscription = await UserSubscriptionModel.findOne({
        user: userId,
        planType: plan.planType
    });

    // Free normal ads can only be claimed again once the previous batch is used up.
    if (plan.planType === PlanType.NORMAL_PLAN && (existingSubscription?.credits || 0) > 0) {
        throw new Error(lang === 'ar' ? 'لا يزال لديك إعلانات عادية متبقية. يمكنك الحصول على المزيد بعد استخدامها.' : 'You still have normal ads left. You can claim more once they are used up.');
    }

    let subscription;
    const now = new Date();
    const durationMonths = plan.numberOfMonths || 1;
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + durationMonths);

    if (existingSubscription) {
        const creditsToAdd = getPlanCredits(plan) * quantity;
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
            credits: getPlanCredits(plan) * quantity,
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

export const subscribeUser = async (userId: string, planId: string, couponCode?: string, lang: string = 'en', quantity = 1) => {
    const order = await priceOrder(planId, couponCode, quantity);

    if (order.amount > 0) {
        if (lang === 'ar') {
            throw new Error('هذه الخطة تتطلب الدفع. يرجى إتمام عملية الدفع.');
        }
        throw new Error('This plan requires payment. Please complete checkout.');
    }

    await consumeCoupon(couponCode);
    return grantPlan(userId, order.plan, order.quantity, lang);
};

export const getUserSubscriptions = async (userId: string) => {
    // Populate plan details for display names etc if needed
    return await UserSubscriptionModel.find({
        user: userId,
        planType: { $in: ALL_PLAN_TYPES },
        $or: [{ isActive: true }, { credits: { $gt: 0 } }]
    }).populate('plan');
};

export interface RemainingAdCredits {
    officeCredits: number;
    dailyCredits: number;
    normalCredits: number;
    premiumCredits: number;
    totalCredits: number;
}

export const getRemainingAdCredits = async (userId: string): Promise<RemainingAdCredits> => {
    const activeSubscriptions = await UserSubscriptionModel.find({
        user: userId,
        credits: { $gt: 0 },
        planType: { $in: ALL_PLAN_TYPES },
        isActive: true
    }).select('planType credits');

    const sum = (type: PlanType) => activeSubscriptions.filter((sub) => sub.planType === type).reduce((total, sub) => total + (sub.credits || 0), 0);
    const officeCredits = sum(PlanType.OFFICE_PLAN);
    const dailyCredits = sum(PlanType.DAILY_PLAN);
    const normalCredits = sum(PlanType.NORMAL_PLAN);
    const premiumCredits = officeCredits + dailyCredits;

    return {
        officeCredits,
        dailyCredits,
        normalCredits,
        premiumCredits,
        totalCredits: premiumCredits + normalCredits
    };
};

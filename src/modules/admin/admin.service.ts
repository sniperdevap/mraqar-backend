import CustomError from '../../utils/custom-error';
import { UserModel } from '../user/models';
import { AdModel } from '../ad/models/ad.model';
import { UserSubscriptionModel } from '../subscription/models/user-subscription.model';
import { PlanType, SubscriptionPlanModel } from '../subscription-plan/models/subscription-plan.model';
import { Types, PipelineStage } from 'mongoose';
import * as FailedAdService from '../failed-ad/failed-ad.service';
import * as mediaService from '../media/media.service';
import { UserRole } from '../user/user.constants';

export interface DashboardStats {
    totalUsers: number;
    totalAds: number;
    totalSubscriptions: number;
    activeUsers: number;
    activeAds: number;
    activeSubscriptions: number;
}

export interface AdsOverTimeEntry {
    label: string;
    count: number;
}

export interface PaginationInfo {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

export interface AdminSubscription {
    _id: Types.ObjectId;
    user: {
        _id: Types.ObjectId;
        name: string;
        phoneNumber: string;
    };
    planType: string;
    credits: number;
    premiumCredits: number;
    startDate: Date;
    endDate: Date;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface AdminSubscriptionsResponse {
    data: AdminSubscription[];
    pagination: PaginationInfo;
}

export const getDashboardStats = async (): Promise<DashboardStats> => {
    const [userStats, adStats, subscriptionStats] = await Promise.all([
        UserModel.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } }
                }
            }
        ]),
        AdModel.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } }
                }
            }
        ]),
        UserSubscriptionModel.aggregate([
            { $match: { planType: PlanType.OFFICE_PLAN } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } }
                }
            }
        ])
    ]);

    const users = userStats[0] || { total: 0, active: 0 };
    const ads = adStats[0] || { total: 0, active: 0 };
    const subscriptions = subscriptionStats[0] || { total: 0, active: 0 };

    return {
        totalUsers: users.total,
        totalAds: ads.total,
        totalSubscriptions: subscriptions.total,
        activeUsers: users.active,
        activeAds: ads.active,
        activeSubscriptions: subscriptions.active
    };
};

export const getAdsOverTime = async (period: 'weekly' | 'monthly' | 'yearly'): Promise<AdsOverTimeEntry[]> => {
    const now = new Date();
    let startDate: Date;
    let groupFormat: Record<string, unknown>;
    let labelProject: Record<string, unknown>;

    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const labels: string[] = [];

    switch (period) {
        case 'weekly': {
            // Start of current week (Monday)
            startDate = new Date(now);
            const day = startDate.getDay(); // 0 (Sun) to 6 (Sat)
            const diff = startDate.getDate() - (day === 0 ? 6 : day - 1); // Adjust to get Monday
            startDate.setDate(diff);
            startDate.setHours(0, 0, 0, 0);

            groupFormat = {
                dayOfWeek: { $dayOfWeek: '$createdAt' } // 1 (Sun) to 7 (Sat)
            };
            labelProject = {
                label: {
                    $arrayElemAt: [dayNames, { $subtract: ['$_id.dayOfWeek', 1] }]
                }
            };

            // Monday skip Sun (index 0) to Sat (index 6)
            // But user wants Mon to Sun
            const orderedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            labels.push(...orderedDays);
            break;
        }
        case 'monthly': {
            startDate = new Date(now);
            startDate.setMonth(startDate.getMonth() - 11); // Last 12 months including current
            startDate.setDate(1); // Start of the month
            startDate.setHours(0, 0, 0, 0);

            groupFormat = {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' }
            };
            labelProject = {
                label: {
                    $concat: [{ $arrayElemAt: [monthNames, '$_id.month'] }, ' ', { $toString: '$_id.year' }]
                }
            };

            // Generate labels for last 12 months
            for (let i = 11; i >= 0; i--) {
                const d = new Date(now);
                d.setMonth(d.getMonth() - i);
                labels.push(`${monthNames[d.getMonth() + 1]} ${d.getFullYear()}`);
            }
            break;
        }
        case 'yearly': {
            startDate = new Date(now);
            startDate.setFullYear(startDate.getFullYear() - 4); // Last 5 years
            startDate.setMonth(0, 1);
            startDate.setHours(0, 0, 0, 0);

            groupFormat = {
                year: { $year: '$createdAt' }
            };
            labelProject = {
                label: { $toString: '$_id.year' }
            };

            // Generate labels for last 5 years
            for (let i = 4; i >= 0; i--) {
                labels.push(`${now.getFullYear() - i}`);
            }
            break;
        }
    }

    const pipeline: PipelineStage[] = [
        { $match: { createdAt: { $gte: startDate } } },
        {
            $group: {
                _id: groupFormat,
                count: { $sum: 1 }
            }
        },
        {
            $project: {
                _id: 0,
                ...labelProject,
                count: 1
            }
        }
    ];

    interface AdGroupResult {
        label: string;
        count: number;
    }

    const result = (await AdModel.aggregate(pipeline)) as AdGroupResult[];

    const dataMap = new Map(result.map((item: AdGroupResult) => [item.label, item.count]));
    return labels.map((label: string) => ({
        label,
        count: dataMap.get(label) || 0
    }));
};

export interface AdminUser {
    _id: Types.ObjectId;
    name: string;
    phoneNumber: string;
    email?: string;
    role: string;
    isActive: boolean;
    isVerified: boolean;
    avatar?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserListResponse {
    users: AdminUser[];
    pagination: PaginationInfo;
}

export interface CreateAdminUserInput {
    name: string;
    phoneNumber: string;
    password: string;
    avatar: string;
}

export const createAdminUser = async (payload: CreateAdminUserInput) => {
    const phoneNumber = payload.phoneNumber.trim();
    const existingUser = await UserModel.findOne({ phoneNumber });

    if (existingUser) {
        if (!existingUser.isVerified) {
            throw new CustomError('Phone number is already registered but not verified.', 409, 'USER_EXISTS_UNVERIFIED', {
                userId: existingUser._id,
                name: existingUser.name,
                phoneNumber: existingUser.phoneNumber
            });
        }

        throw new CustomError('Phone number is already registered.', 409, 'USER_ALREADY_EXISTS');
    }

    const user = new UserModel({
        name: payload.name,
        phoneNumber,
        password: payload.password,
        avatar: payload.avatar,
        role: UserRole.USER,
        isVerified: true,
        isActive: true
    });

    await user.save();
    return user;
};

export const getAllUsersForAdmin = async (page: number = 1, limit: number = 10, search?: string, status?: string): Promise<UserListResponse> => {
    const skip = (page - 1) * limit;

    const matchStage: Record<string, unknown> = {
        role: { $ne: 'super_admin' },
        deletedAt: null,
    };

    if (status && status !== 'all') {
        matchStage.isActive = status === 'active';
    }

    if (search?.trim()) {
        const regex = new RegExp(search.trim(), 'i');
        matchStage.$or = [{ name: regex }, { phoneNumber: regex }];
    }

    const result = await UserModel.aggregate([
        { $match: matchStage },
        {
            $facet: {
                data: [
                    { $sort: { createdAt: -1 } },
                    { $skip: skip },
                    { $limit: limit },
                    {
                        $project: {
                            password: 0,
                            __v: 0
                        }
                    }
                ],
                count: [{ $count: 'total' }]
            }
        }
    ]);

    const users = (result[0]?.data as AdminUser[]) || [];
    const total = (result[0]?.count[0]?.total as number) || 0;

    return {
        users,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
};

export interface UserDetailsResponse {
    user: AdminUser;
    subscriptions: AdminSubscription[];
    ads: unknown[];
    pagination: PaginationInfo;
    stats: {
        totalAds: number;
        totalViews: number;
    };
}

export const getUserDetailsForAdmin = async (userId: string, page: number = 1, limit: number = 10): Promise<UserDetailsResponse> => {
    if (!Types.ObjectId.isValid(userId)) {
        throw new Error('Invalid user ID');
    }

    const objectId = new Types.ObjectId(userId);
    const skip = (page - 1) * limit;

    const result = await UserModel.aggregate([
        { $match: { _id: objectId } },
        { $project: { password: 0 } },
        {
            $lookup: {
                from: 'usersubscriptions',
                localField: '_id',
                foreignField: 'user',
                pipeline: [{ $sort: { createdAt: -1 } }],
                as: 'subscriptions'
            }
        }
    ]);

    if (!result || result.length === 0) {
        throw new Error('User not found');
    }

    const { subscriptions, ...user } = result[0] as { subscriptions: AdminSubscription[] } & AdminUser;

    const adsPipeline: PipelineStage[] = [
        { $match: { user: objectId } },
        {
            $facet: {
                data: [
                    { $sort: { createdAt: -1 } },
                    { $skip: skip },
                    { $limit: limit },
                    {
                        $lookup: {
                            from: 'propertytypes',
                            localField: 'propertyType',
                            foreignField: '_id',
                            as: 'propertyType'
                        }
                    },
                    { $unwind: { path: '$propertyType', preserveNullAndEmptyArrays: true } },
                    {
                        $lookup: {
                            from: 'areas',
                            localField: 'area',
                            foreignField: '_id',
                            as: 'area'
                        }
                    },
                    { $unwind: { path: '$area', preserveNullAndEmptyArrays: true } },
                    {
                        $lookup: {
                            from: 'media',
                            localField: 'media',
                            foreignField: '_id',
                            as: 'media'
                        }
                    }
                ],
                totalCount: [{ $count: 'total' }],
                viewsCount: [
                    {
                        $group: {
                            _id: null,
                            totalViews: { $sum: '$views' }
                        }
                    }
                ]
            }
        }
    ];

    const adsResult = await AdModel.aggregate(adsPipeline);

    const ads = adsResult[0]?.data || [];
    const totalAds = adsResult[0]?.totalCount[0]?.total || 0;
    const totalViews = adsResult[0]?.viewsCount[0]?.totalViews || 0;

    return {
        user,
        subscriptions,
        ads,
        pagination: {
            page,
            limit,
            total: totalAds,
            totalPages: Math.ceil(totalAds / limit)
        },
        stats: {
            totalAds,
            totalViews
        }
    };
};

export const deleteUser = async (userId: string) => {
    const user = await UserModel.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    if (user.role === 'super_admin') {
        throw new Error('Cannot delete super admin');
    }

    user.isActive = false;
    user.deletedAt = new Date();
    await user.save();

    await Promise.all([
        AdModel.updateMany({ user: userId }, { status: 'inactive' }),
        UserSubscriptionModel.updateMany({ user: userId }, { isActive: false }),
    ]);

    return true;
};

export const changeUserPassword = async (userId: string, newPassword: string) => {
    const user = await UserModel.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }
    user.password = newPassword;
    await user.save();
    return true;
};

export const updateUserForAdmin = async (userId: string, updatedData: Partial<Record<string, unknown>>) => {
    const user = await UserModel.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    if (user.role === 'super_admin' && updatedData.role && updatedData.role !== 'super_admin') {
        throw new Error('Cannot change super admin role');
    }
    if ('avatar' in updatedData && updatedData.avatar !== user.avatar && user.avatar) {
        await mediaService.deleteFile(user.avatar).catch((err) => {
            console.error('Failed to delete old avatar:', err);
        });
    }

    const updatedUser = await UserModel.findByIdAndUpdate(userId, updatedData, { new: true }).select('-password');
    return updatedUser;
};

export const verifyUserForAdmin = async (userId: string) => {
    const user = await UserModel.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    if (user.role === UserRole.SUPER_ADMIN) {
        throw new Error('Cannot verify super admin from user management');
    }

    user.isVerified = true;
    await user.save();

    return {
        userId: user._id,
        isVerified: user.isVerified
    };
};

export const getAllAdsForAdmin = async (params: Record<string, unknown>) => {
    const { getAds } = await import('../ad/ad.service');
    return await getAds(params);
};

export const getAdminSubscriptions = async (page: number = 1, limit: number = 10, search?: string): Promise<AdminSubscriptionsResponse> => {
    const skip = (page - 1) * limit;

    const pipeline: PipelineStage[] = [
        { $match: { planType: PlanType.OFFICE_PLAN } },
        {
            $lookup: {
                from: 'users',
                localField: 'user',
                foreignField: '_id',
                as: 'userData'
            }
        },
        { $unwind: '$userData' },
        {
            $match: {
                'userData.role': { $ne: 'super_admin' }
            }
        }
    ];

    if (search?.trim()) {
        const regex = new RegExp(search.trim(), 'i');
        pipeline.push({
            $match: {
                $or: [{ 'userData.name': regex }, { 'userData.phoneNumber': regex }]
            }
        });
    }

    pipeline.push({
        $facet: {
            data: [
                { $sort: { createdAt: -1 } },
                { $skip: skip },
                { $limit: limit },
                {
                    $project: {
                        user: {
                            _id: '$userData._id',
                            name: '$userData.name',
                            phoneNumber: '$userData.phoneNumber'
                        },
                        planType: 1,
                        credits: 1,
                        premiumCredits: 1,
                        startDate: 1,
                        endDate: 1,
                        isActive: 1,
                        createdAt: 1,
                        updatedAt: 1
                    }
                }
            ],
            count: [{ $count: 'total' }]
        }
    });

    const result = await UserSubscriptionModel.aggregate(pipeline);

    const data = (result[0]?.data as AdminSubscription[]) || [];
    const total = (result[0]?.count[0]?.total as number) || 0;

    return {
        data,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
};

export const cancelSubscription = async (subscriptionId: string) => {
    if (!Types.ObjectId.isValid(subscriptionId)) {
        throw new Error('Invalid subscription ID');
    }

    const subscription = await UserSubscriptionModel.findOne({ _id: subscriptionId, planType: PlanType.OFFICE_PLAN });
    if (!subscription) {
        throw new Error('Subscription not found');
    }

    subscription.isActive = false;
    subscription.credits = 0;
    subscription.premiumCredits = 0;
    subscription.purchaseCount = 0;
    await subscription.save();

    return true;
};

export const getFailedAdsForAdmin = async (page: number, limit: number, search?: string) => {
    return await FailedAdService.getFailedAds({ page, limit, search });
};

export const getFailedAdByIdForAdmin = async (id: string) => {
    return await FailedAdService.getFailedAdById(id);
};

export const deleteFailedAdForAdmin = async (id: string) => {
    return await FailedAdService.deleteFailedAd(id);
};

// Subscription Plans for Admin
export const getAllSubscriptionPlansForAdmin = async () => {
    return await SubscriptionPlanModel.find({ planType: PlanType.OFFICE_PLAN }).sort({ price: 1 });
};

export const updateSubscriptionPlanForAdmin = async (id: string, data: Partial<any>) => {
    if (!Types.ObjectId.isValid(id)) {
        throw new Error('Invalid plan ID');
    }
    if (data.planType && data.planType !== PlanType.OFFICE_PLAN) {
        throw new Error('Only office plans are supported');
    }
    const plan = await SubscriptionPlanModel.findOneAndUpdate({ _id: id, planType: PlanType.OFFICE_PLAN }, { ...data, planType: PlanType.OFFICE_PLAN }, { new: true });
    if (!plan) {
        throw new Error('Plan not found');
    }
    return plan;
};

export const toggleSubscriptionPlanStatus = async (id: string) => {
    if (!Types.ObjectId.isValid(id)) {
        throw new Error('Invalid plan ID');
    }
    const plan = await SubscriptionPlanModel.findOne({ _id: id, planType: PlanType.OFFICE_PLAN });
    if (!plan) {
        throw new Error('Plan not found');
    }
    plan.isActive = !plan.isActive;
    await plan.save();
    return plan;
};

import { Types, PipelineStage } from 'mongoose';
import { UserModel } from './models/user.model';
import { AdModel } from '../ad/models/ad.model';
import { WishlistModel, WishlistStatus } from './models/wishlist.model';
import { FavoriteModel } from './models/favorite.model';
import { NotificationModel, NotificationType } from './models/notification.model';
import * as mediaService from '../media/media.service';
import { resolveAdId, resolveMetadataInput } from '../public-id/public-id.service';

// Profile Management
export const getProfile = async (userId: string) => {
    const user = await UserModel.findById(userId).select('-password -__v');
    if (!user) {
        throw new Error('User not found');
    }
    return user;
};

export const updateProfile = async (
    userId: string,
    profileData: {
        name?: string;
        phoneNumber?: string;
        avatar?: string;
        instagram?: string;
        tiktok?: string;
        description?: string;
    }
) => {
    // If phone number is being updated, check for uniqueness
    if (profileData.phoneNumber) {
        const existingUser = await UserModel.findOne({
            phoneNumber: profileData.phoneNumber,
            _id: { $ne: userId }
        });

        if (existingUser) {
            const error: any = new Error('Phone number already in use');
            error.statusCode = 400;
            error.code = 'PHONE_ALREADY_IN_USE';
            throw error;
        }
    }

    const oldUser = await UserModel.findById(userId);

    if (oldUser && 'avatar' in profileData && profileData.avatar !== oldUser.avatar && oldUser.avatar) {
        await mediaService.deleteFile(oldUser.avatar).catch((err) => {
            console.error('Failed to delete old avatar:', err);
        });
    }

    const user = await UserModel.findByIdAndUpdate(userId, { $set: profileData }, { new: true }).select('-password -__v');

    if (!user) {
        throw new Error('User not found');
    }
    return user;
};

// My Ads
export const getUserAds = async (userId: string, status?: string, page: number = 1, limit: number = 12) => {
    const userObjectId = new Types.ObjectId(userId);
    const filter: any = { user: userObjectId };

    if (status === 'archived') {
        filter.status = { $in: ['inactive', 'sold'] };
    } else if (status === 'active') {
        filter.status = 'active';
    }

    const skip = (page - 1) * limit;

    const pipeline: PipelineStage[] = [
        { $match: filter },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },

        // Populate User
        {
            $lookup: {
                from: 'users',
                localField: 'user',
                foreignField: '_id',
                pipeline: [{ $project: { publicId: 1, name: 1, phoneNumber: 1, avatar: 1 } }],
                as: 'user'
            }
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },

        // Populate PropertyType
        {
            $lookup: {
                from: 'propertytypes',
                localField: 'propertyType',
                foreignField: '_id',
                pipeline: [{ $project: { publicId: 1, label: 1, labelAr: 1, value: 1 } }],
                as: 'propertyType'
            }
        },
        { $unwind: { path: '$propertyType', preserveNullAndEmptyArrays: true } },

        // Populate Area
        {
            $lookup: {
                from: 'areas',
                localField: 'area',
                foreignField: '_id',
                pipeline: [{ $project: { publicId: 1, label: 1, labelAr: 1, value: 1, governorateAr: 1 } }],
                as: 'area'
            }
        },
        { $unwind: { path: '$area', preserveNullAndEmptyArrays: true } },

        // Populate Media
        {
            $lookup: {
                from: 'media',
                localField: 'media',
                foreignField: '_id',
                as: 'media'
            }
        },

        // isOffice Logic
        {
            $lookup: {
                from: 'usersubscriptions',
                let: { adUserId: '$user._id' },
                pipeline: [
                    {
                        $match: {
                            $expr: { $eq: ['$user', '$$adUserId'] },
                            planType: 'office-plan',
                            isActive: true
                        }
                    },
                    { $limit: 1 },
                    { $project: { _id: 1 } }
                ],
                as: '_officeMatch'
            }
        },
        {
            $addFields: {
                isOffice: { $gt: [{ $size: '$_officeMatch' }, 0] }
            }
        },

        // isFav Logic
        {
            $lookup: {
                from: 'favorites',
                let: { adId: '$_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: { $eq: ['$ad', '$$adId'] },
                            user: userObjectId
                        }
                    },
                    { $limit: 1 },
                    { $project: { _id: 1 } }
                ],
                as: '_favMatch'
            }
        },
        {
            $addFields: {
                isFav: { $gt: [{ $size: '$_favMatch' }, 0] }
            }
        },

        {
            $project: {
                images: 0,
                videoThumbnail: 0,
                _officeMatch: 0,
                _favMatch: 0
            }
        }
    ];

    const [ads, total] = await Promise.all([AdModel.aggregate(pipeline), AdModel.countDocuments(filter)]);

    return {
        ads,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    };
};

// Wishlist
export const createWishlist = async (
    userId: string,
    wishlistData: {
        purpose?: string;
        propertyType?: number;
        area?: number;
        minPrice?: number;
        maxPrice?: number;
    }
) => {
    const resolvedData = await resolveMetadataInput(wishlistData);
    const wishlist = await WishlistModel.create({
        user: userId,
        ...resolvedData,
        status: WishlistStatus.ACTIVE
    });

    await wishlist.populate([
        { path: 'propertyType', select: 'publicId label labelAr value' },
        { path: 'area', select: 'publicId label labelAr value governorateAr' }
    ]);

    return wishlist;
};

export const getWishlists = async (userId: string, status?: WishlistStatus) => {
    const filter: any = { user: userId };
    if (status) {
        filter.status = status;
    }

    return await WishlistModel.find(filter)
        .populate({
            path: 'propertyType',
            select: 'publicId label labelAr value'
        })
        .populate('area', 'publicId label labelAr value governorateAr')
        .populate({
            path: 'matchedAd',
            populate: [
                { path: 'propertyType', select: 'publicId label labelAr value' },
                { path: 'area', select: 'publicId label labelAr value governorateAr' }
            ]
        })
        .sort({ createdAt: -1 });
};

export const updateWishlist = async (
    wishlistId: string,
    userId: string,
    updates: {
        status?: WishlistStatus;
        purpose?: string;
        propertyType?: number;
        area?: number;
        minPrice?: number;
        maxPrice?: number;
    }
) => {
    const resolvedUpdates = await resolveMetadataInput(updates);
    const wishlist = await WishlistModel.findOneAndUpdate({ _id: wishlistId, user: userId }, { $set: resolvedUpdates }, { new: true })
        .populate('propertyType', 'publicId label labelAr value')
        .populate('area', 'publicId label labelAr value governorateAr');

    if (!wishlist) {
        throw new Error('Wishlist not found');
    }
    return wishlist;
};

export const deleteWishlist = async (wishlistId: string, userId: string) => {
    // Instead of deleting, set status to cancelled
    const result = await WishlistModel.findOneAndUpdate({ _id: wishlistId, user: userId }, { $set: { status: WishlistStatus.CANCELLED } }, { new: true })
        .populate('propertyType', 'publicId label labelAr value')
        .populate('area', 'publicId label labelAr value governorateAr');

    if (!result) {
        throw new Error('Wishlist not found');
    }
    return result;
};

// Favorites
export const addFavorite = async (userId: string, adId: string) => {
    const adObjectId = await resolveAdId(adId);
    const existing = await FavoriteModel.findOne({ user: userId, ad: adObjectId });
    if (existing) {
        return existing;
    }

    const favorite = await FavoriteModel.create({ user: userId, ad: adObjectId });
    return favorite.populate({
        path: 'ad',
        populate: [
            { path: 'propertyType', select: 'publicId label labelAr value' },
            { path: 'area', select: 'publicId label labelAr value governorateAr' },
            { path: 'user', select: 'name phoneNumber' }
        ]
    });
};

export const removeFavorite = async (userId: string, adId: string) => {
    const adObjectId = await resolveAdId(adId);
    const result = await FavoriteModel.findOneAndDelete({ user: userId, ad: adObjectId });
    if (!result) {
        throw new Error('Favorite not found');
    }
    return result;
};

export const getFavorites = async (userId: string, page: number = 1, limit: number = 12) => {
    const userObjectId = new Types.ObjectId(userId);
    const skip = (page - 1) * limit;

    const pipeline: PipelineStage[] = [
        { $match: { user: userObjectId } },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },

        // Join with Ad table
        {
            $lookup: {
                from: 'ads',
                localField: 'ad',
                foreignField: '_id',
                as: 'ad'
            }
        },
        { $unwind: { path: '$ad', preserveNullAndEmptyArrays: true } },
        { $match: { ad: { $ne: null } } }, // Filter out deleted ads

        // Move ad fields to root temporarily to perform enrichment easily, or work inside $ad
        // Better: Replace root with $ad and then do same enrichment as getAds
        { $replaceRoot: { newRoot: '$ad' } },

        // Populate User
        {
            $lookup: {
                from: 'users',
                localField: 'user',
                foreignField: '_id',
                pipeline: [{ $project: { publicId: 1, name: 1, phoneNumber: 1, avatar: 1 } }],
                as: 'user'
            }
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },

        // Populate PropertyType
        {
            $lookup: {
                from: 'propertytypes',
                localField: 'propertyType',
                foreignField: '_id',
                pipeline: [{ $project: { publicId: 1, label: 1, labelAr: 1, value: 1 } }],
                as: 'propertyType'
            }
        },
        { $unwind: { path: '$propertyType', preserveNullAndEmptyArrays: true } },

        // Populate Area
        {
            $lookup: {
                from: 'areas',
                localField: 'area',
                foreignField: '_id',
                pipeline: [{ $project: { publicId: 1, label: 1, labelAr: 1, value: 1, governorateAr: 1 } }],
                as: 'area'
            }
        },
        { $unwind: { path: '$area', preserveNullAndEmptyArrays: true } },

        // Populate Media
        {
            $lookup: {
                from: 'media',
                localField: 'media',
                foreignField: '_id',
                as: 'media'
            }
        },

        // isOffice Logic
        {
            $lookup: {
                from: 'usersubscriptions',
                let: { adUserId: '$user._id' },
                pipeline: [
                    {
                        $match: {
                            $expr: { $eq: ['$user', '$$adUserId'] },
                            planType: 'office-plan',
                            isActive: true
                        }
                    },
                    { $limit: 1 },
                    { $project: { _id: 1 } }
                ],
                as: '_officeMatch'
            }
        },
        {
            $addFields: {
                isOffice: { $gt: [{ $size: '$_officeMatch' }, 0] }
            }
        },

        // isFav is true for all of these
        { $addFields: { isFav: true } },

        {
            $project: {
                images: 0,
                videoThumbnail: 0,
                _officeMatch: 0
            }
        }
    ];

    const [favorites, total] = await Promise.all([FavoriteModel.aggregate(pipeline), FavoriteModel.countDocuments({ user: userObjectId })]);

    return {
        favorites,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    };
};

export const isFavorite = async (userId: string, adId: string) => {
    const adObjectId = await resolveAdId(adId);
    const favorite = await FavoriteModel.findOne({ user: userId, ad: adObjectId });
    return !!favorite;
};

// Notifications
export const createNotification = async (notificationData: {
    user: string;
    type: NotificationType;
    title: { en: string; ar: string };
    message: { en: string; ar: string };
    relatedAd?: string;
    relatedWishlist?: string;
    redirectUrl?: string;
}) => {
    return await NotificationModel.create(notificationData);
};

export const getNotifications = async (userId: string, page: number = 1, limit: number = 20) => {
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
        NotificationModel.find({ user: userId }).populate('relatedAd').populate('relatedWishlist').sort({ createdAt: -1 }).skip(skip).limit(limit),
        NotificationModel.countDocuments({ user: userId })
    ]);

    return {
        notifications,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    };
};

export const markNotificationAsRead = async (notificationId: string, userId: string) => {
    const notification = await NotificationModel.findOneAndUpdate({ _id: notificationId, user: userId }, { $set: { isRead: true } }, { new: true });

    if (!notification) {
        throw new Error('Notification not found');
    }
    return notification;
};

export const markAllNotificationsAsRead = async (userId: string) => {
    await NotificationModel.updateMany({ user: userId, isRead: false }, { $set: { isRead: true } });
};

export const deleteNotification = async (notificationId: string, userId: string) => {
    const result = await NotificationModel.findOneAndDelete({ _id: notificationId, user: userId });
    if (!result) {
        throw new Error('Notification not found');
    }
    return result;
};

export const deleteAllNotifications = async (userId: string) => {
    await NotificationModel.deleteMany({ user: userId });
};

export const getUnreadNotificationCount = async (userId: string) => {
    return await NotificationModel.countDocuments({ user: userId, isRead: false });
};

// Wishlist Matching Logic - Check if new ad matches any active wishes
export const checkWishlistMatches = async (adId: string) => {
    const ad = await AdModel.findById(adId).populate('propertyType').populate('area');

    if (!ad || ad.status !== 'active') {
        return;
    }

    const activeWishes = await WishlistModel.find({
        status: WishlistStatus.ACTIVE
    })
        .populate('propertyType')
        .populate('area');

    for (const wish of activeWishes) {
        let matches = true;

        // Check purpose
        if (wish.purpose && wish.purpose !== ad.purpose) {
            matches = false;
        }

        // Check property type
        if (wish.propertyType && wish.propertyType.toString() !== ad.propertyType.toString()) {
            matches = false;
        }

        // Check area
        if (wish.area && wish.area.toString() !== ad.area.toString()) {
            matches = false;
        }

        // Check price range
        if (wish.minPrice !== undefined && ad.price < wish.minPrice) {
            matches = false;
        }
        if (wish.maxPrice !== undefined && ad.price > wish.maxPrice) {
            matches = false;
        }

        if (matches) {
            // Mark wish as completed
            await WishlistModel.findByIdAndUpdate(wish._id, {
                status: WishlistStatus.COMPLETED,
                matchedAd: adId
            });

            // Create notification
            await NotificationModel.create({
                user: wish.user,
                type: NotificationType.WISH_MATCHED,
                title: { en: 'Wish Matched!', ar: 'تم العثور على طلبك!' },
                message: { en: `A property matching your wish criteria has been posted.`, ar: `تم العثور على عقار يطابق معايير طلبك وتم نشره.` },
                redirectUrl: '/account?tab=wishlist',
                relatedAd: adId,
                relatedWishlist: wish._id
            });
        }
    }
};
// Account Deletion
export const deleteAccount = async (userId: string) => {
    const user = await UserModel.findByIdAndUpdate(userId, { $set: { deletedAt: new Date(), isActive: false } }, { new: true });

    if (!user) {
        throw new Error('User not found');
    }

    return user;
};

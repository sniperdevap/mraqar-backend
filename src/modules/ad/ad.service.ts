import { Document, PipelineStage, Types } from 'mongoose';
import crypto from 'crypto';
import { AdModel, IAd } from './models/ad.model';
import { AdViewModel } from './models/ad-view.model';
import * as mediaService from '../media/media.service';
import { MediaModel } from '../media/models/media.model';
import { UserSubscriptionModel } from '../subscription/models/user-subscription.model';
import { PlanType } from '../subscription-plan/models/subscription-plan.model';
import CustomError from '../../utils/custom-error';
import { resolveAdId, resolveAreaId, resolveMetadataInput, resolvePropertyTypeId } from '../public-id/public-id.service';

export type AdDocument = Document<unknown, {}, IAd> & IAd & { _id: Types.ObjectId };

export const createAd = async (adData: Partial<IAd>): Promise<AdDocument> => {
    // Normalize legacy field name.
    if (typeof adData.isPremium === 'boolean' && typeof adData.premiumAd !== 'boolean') {
        adData.premiumAd = adData.isPremium;
    }

    const subscriptions = await UserSubscriptionModel.find({
        user: adData.user,
        planType: PlanType.OFFICE_PLAN,
        isActive: true,
        credits: { $gt: 0 }
    });

    if (!subscriptions || subscriptions.length === 0) {
        throw new CustomError('You dont have a subscription. Please subscribe first to create ads.', 400, 'NO_SUBSCRIPTION');
    }

    const officeSubscription = subscriptions.find((sub) => sub.planType === PlanType.OFFICE_PLAN);
    const selectedSubscription = officeSubscription;

    if (!selectedSubscription) {
        throw new CustomError('You have no ad credits remaining. Please purchase a plan to continue posting ads.', 400, 'INSUFFICIENT_CREDITS');
    }

    adData.premiumAd = true;
    adData.premiumExpiresAt = undefined;

    const resolvedAdData = await resolveMetadataInput(adData as Partial<IAd>);
    const ad = await AdModel.create(resolvedAdData);

    selectedSubscription.credits -= 1;
    selectedSubscription.isActive = true;
    await selectedSubscription.save();

    return ad as AdDocument;
};

export interface GetAdsParams {
    page?: number;
    limit?: number;
    purpose?: string;
    propertyType?: string;
    area?: string | string[];
    minPrice?: number;
    maxPrice?: number;
    userId?: string;
    status?: string | string[];
    premiumAd?: boolean;
    isPremium?: boolean;
}

export interface GetAdsResult {
    ads: IAd[];
    total: number;
    page: number;
    totalPages: number;
}

export const getAds = async (params: GetAdsParams = {}): Promise<GetAdsResult> => {
    const { page = 1, limit = 12, purpose, propertyType, area, minPrice, maxPrice, status, premiumAd, isPremium } = params;

    const filter: any = {};

    const premiumAdFilter = premiumAd ?? isPremium;
    if (premiumAdFilter !== undefined) {
        filter.$or = [{ premiumAd: premiumAdFilter }, { isPremium: premiumAdFilter }];
    }

    if (status) {
        if (Array.isArray(status)) {
            filter.status = { $in: status };
        } else if (status !== 'all') {
            filter.status = status;
        }
    } else {
        filter.status = 'active';
    }

    if (purpose) {
        filter.purpose = purpose;
    }

    if (propertyType) {
        filter.propertyType = await resolvePropertyTypeId(propertyType);
    }

    if (area) {
        if (Array.isArray(area)) {
            filter.area = { $in: await Promise.all(area.map(resolveAreaId)) };
        } else {
            filter.area = await resolveAreaId(area);
        }
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
        filter.price = {};
        if (minPrice !== undefined) {
            filter.price.$gte = minPrice;
        }
        if (maxPrice !== undefined) {
            filter.price.$lte = maxPrice;
        }
    }

    const skip = (page - 1) * limit;

    const pipeline: PipelineStage[] = [
        { $match: filter },
        {
            $addFields: {
                premiumAd: { $ifNull: ['$premiumAd', '$isPremium'] },
                isPremium: { $ifNull: ['$premiumAd', '$isPremium'] }
            }
        },
        { $sort: { premiumAd: -1, createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },

        // Populate User
        {
            $lookup: {
                from: 'users',
                localField: 'user',
                foreignField: '_id',
                pipeline: [{ $project: { name: 1, phoneNumber: 1, avatar: 1 } }],
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

        // Populate Media (preserving order)
        {
            $lookup: {
                from: 'media',
                localField: 'media',
                foreignField: '_id',
                as: '_mediaPopulated'
            }
        },
        {
            $addFields: {
                media: {
                    $map: {
                        input: '$media',
                        as: 'id',
                        in: {
                            $arrayElemAt: [
                                {
                                    $filter: {
                                        input: '$_mediaPopulated',
                                        as: 'm',
                                        cond: { $eq: ['$$m._id', '$$id'] }
                                    }
                                },
                                0
                            ]
                        }
                    }
                }
            }
        },
        { $project: { _mediaPopulated: 0 } },

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
                premiumAd: { $ifNull: ['$premiumAd', '$isPremium'] },
                isPremium: { $ifNull: ['$premiumAd', '$isPremium'] },
                isOffice: { $gt: [{ $size: '$_officeMatch' }, 0] }
            }
        },
        {
            $project: {
                images: 0,
                videoThumbnail: 0,
                _officeMatch: 0
            }
        }
    ];

    // isFav Logic
    if (params.userId && Types.ObjectId.isValid(params.userId)) {
        const userObjectId = new Types.ObjectId(params.userId);
        pipeline.push(
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
            { $project: { _favMatch: 0 } }
        );
    } else {
        pipeline.push({ $addFields: { isFav: false } });
    }

    const [ads, total] = await Promise.all([AdModel.aggregate(pipeline), AdModel.countDocuments(filter)]);

    return {
        ads,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    };
};

export const getAdById = async (id: string): Promise<IAd | null> => {
    const objectId = await resolveAdId(id);
    const ad = await AdModel.findById(objectId)
        .populate('user', 'name phoneNumber avatar')
        .populate('propertyType', 'publicId label labelAr value')
        .populate('area', 'publicId label labelAr value governorateAr')
        .populate('media')
        .select('-images -videoThumbnail');

    if (!ad) return null;

    return ad;
};

export interface CountAdViewResult {
    counted: boolean;
    views: number;
}

/**
 * Records a single view per ad per IP (hashed, never stored raw) and
 * atomically increments the ad's view counter only the first time.
 * Repeat calls from the same IP for the same ad are deduped via the
 * unique `identifier` index on AdView and simply report the current count.
 */
export const countAdView = async (id: string, ip: string): Promise<CountAdViewResult | null> => {
    let adObjectId: Types.ObjectId;
    try {
        adObjectId = await resolveAdId(id, true);
    } catch {
        return null;
    }

    const ad = await AdModel.findById(adObjectId).select('views');
    if (!ad) return null;

    const identifier = crypto.createHash('sha256').update(`${ip}:${adObjectId.toString()}`).digest('hex');

    const result = await AdViewModel.updateOne(
        { identifier },
        { $setOnInsert: { ad: adObjectId, createdAt: new Date() } },
        { upsert: true },
    );

    const counted = result.upsertedCount === 1;

    if (!counted) {
        return { counted: false, views: ad.views ?? 0 };
    }

    // Atomic increment at the DB level — never read-modify-write.
    const updated = await AdModel.findByIdAndUpdate(adObjectId, { $inc: { views: 1 } }, { new: true }).select('views');

    return { counted: true, views: updated?.views ?? (ad.views ?? 0) + 1 };
};

/**
 * Optimized single-aggregation fetch for the ad detail page.
 * Combines: ad fetch, user/propertyType/area/media lookups,
 * office subscription check, and favorite check into ONE pipeline.
 * View counting is handled separately via countAdView.
 */
export const getAdByIdAggregated = async (id: string, userId?: string): Promise<IAd | null> => {
    let adObjectId: Types.ObjectId;
    try {
        adObjectId = await resolveAdId(id, true);
    } catch {
        return null;
    }

    const pipeline: PipelineStage[] = [
        // 1. Match the ad
        { $match: { _id: adObjectId } },

        // 2. Lookup user
        {
            $lookup: {
                from: 'users',
                localField: 'user',
                foreignField: '_id',
                pipeline: [{ $project: { name: 1, phoneNumber: 1, avatar: 1 } }],
                as: 'user'
            }
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },

        // 3. Lookup propertyType
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

        // 4. Lookup area
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

        // 5. Lookup media (preserving order)
        {
            $lookup: {
                from: 'media',
                localField: 'media',
                foreignField: '_id',
                as: '_mediaPopulated'
            }
        },
        {
            $addFields: {
                media: {
                    $map: {
                        input: '$media',
                        as: 'id',
                        in: {
                            $arrayElemAt: [
                                {
                                    $filter: {
                                        input: '$_mediaPopulated',
                                        as: 'm',
                                        cond: { $eq: ['$$m._id', '$$id'] }
                                    }
                                },
                                0
                            ]
                        }
                    }
                }
            }
        },
        { $project: { _mediaPopulated: 0 } },

        // 6. Lookup office subscription (check if ad owner has active office plan)
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

        // 7. Add computed fields and remove internals
        {
            $addFields: {
                premiumAd: { $ifNull: ['$premiumAd', '$isPremium'] },
                isPremium: { $ifNull: ['$premiumAd', '$isPremium'] },
                isOffice: { $gt: [{ $size: '$_officeMatch' }, 0] }
            }
        },
        {
            $project: {
                images: 0,
                videoThumbnail: 0,
                _officeMatch: 0
            }
        }
    ];

    // 8. If user is logged in, also check favorite status
    if (userId && Types.ObjectId.isValid(userId)) {
        const userObjectId = new Types.ObjectId(userId);
        pipeline.push(
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
            { $project: { _favMatch: 0 } }
        );
    } else {
        pipeline.push({ $addFields: { isFav: false } });
    }

    const result = await AdModel.aggregate(pipeline);
    const ad = result.length > 0 ? result[0] : null;

    if (!ad) return null;

    return ad;
};

export const updateAd = async (id: string, updates: Partial<IAd>): Promise<IAd | null> => {
    if (typeof updates.isPremium === 'boolean' && typeof updates.premiumAd !== 'boolean') {
        updates.premiumAd = updates.isPremium;
    }

    const adObjectId = await resolveAdId(id);
    updates = await resolveMetadataInput(updates);
    // If media is being updated, handle deletions of removed media
    if (updates.media) {
        const oldAd = await AdModel.findById(adObjectId);
        if (oldAd && oldAd.media) {
            const newMediaIds = new Set(updates.media.map((m) => m.toString()));
            const mediaToDelete = oldAd.media.filter((m) => !newMediaIds.has(m.toString()));

            for (const mediaId of mediaToDelete) {
                const media = await MediaModel.findById(mediaId);
                if (media) {
                    await mediaService.deleteFile(media.key);
                    if (media.thumbnailKey) {
                        await mediaService.deleteFile(media.thumbnailKey);
                    }
                    await MediaModel.findByIdAndDelete(mediaId);
                }
            }
        }
    }

    updates.premiumExpiresAt = undefined;

    return await AdModel.findByIdAndUpdate(adObjectId, updates, { new: true });
};

export const deleteAd = async (id: string): Promise<IAd | null> => {
    const adObjectId = await resolveAdId(id);
    const ad = await AdModel.findByIdAndDelete(adObjectId);
    if (ad && ad.media) {
        for (const mediaId of ad.media) {
            const media = await MediaModel.findById(mediaId);
            if (media) {
                await mediaService.deleteFile(media.key);
                if (media.thumbnailKey) {
                    await mediaService.deleteFile(media.thumbnailKey);
                }
                await MediaModel.findByIdAndDelete(mediaId);
            }
        }
    }
    return ad;
};

export const getMyAds = async (userId: string): Promise<IAd[]> => {
    const userObjectId = new Types.ObjectId(userId);
    const pipeline: PipelineStage[] = [
        { $match: { user: userObjectId } },
        { $sort: { createdAt: -1 } },

        // Populate User
        {
            $lookup: {
                from: 'users',
                localField: 'user',
                foreignField: '_id',
                pipeline: [{ $project: { name: 1, phoneNumber: 1, avatar: 1 } }],
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

        // Populate Media (preserving order)
        {
            $lookup: {
                from: 'media',
                localField: 'media',
                foreignField: '_id',
                as: '_mediaPopulated'
            }
        },
        {
            $addFields: {
                media: {
                    $map: {
                        input: '$media',
                        as: 'id',
                        in: {
                            $arrayElemAt: [
                                {
                                    $filter: {
                                        input: '$_mediaPopulated',
                                        as: 'm',
                                        cond: { $eq: ['$$m._id', '$$id'] }
                                    }
                                },
                                0
                            ]
                        }
                    }
                }
            }
        },
        { $project: { _mediaPopulated: 0 } },

        // isOffice Logic (Check if current user has active office plan)
        {
            $lookup: {
                from: 'usersubscriptions',
                let: { adUserId: userObjectId },
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
                premiumAd: { $ifNull: ['$premiumAd', '$isPremium'] },
                isPremium: { $ifNull: ['$premiumAd', '$isPremium'] },
                isOffice: { $gt: [{ $size: '$_officeMatch' }, 0] }
            }
        },

        // isFav Logic (Check if this ad is in favorites)
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

    return await AdModel.aggregate(pipeline);
};

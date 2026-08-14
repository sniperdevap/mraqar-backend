import { UserModel } from '../user/models';
import { AdModel } from '../ad/models/ad.model';
import { PlanType } from '../subscription-plan/models/subscription-plan.model';
import { UserSubscriptionModel } from '../subscription/models/user-subscription.model';
import mongoose from 'mongoose';
import { resolveAreaId, resolvePropertyTypeId } from '../public-id/public-id.service';

export interface GetOfficesParams {
    page?: number;
    limit?: number;
    propertyType?: string;
    area?: string | string[];
    minPrice?: number;
    maxPrice?: number;
    search?: string;
}

export interface GetOfficesResult {
    offices: any[];
    total: number;
    page: number;
    totalPages: number;
}

export interface Office {
    _id: string;
    publicId?: number;
    name: string;
    phoneNumber: string;
    avatar?: string;
    instagram?: string;
    tiktok?: string;
    description?: string;
    email?: string;
    twitter?: string;
    adsCount?: number;
}

/**
 * Get all offices (users with active Office plan subscriptions)
 */
export const getOffices = async (
  params: GetOfficesParams = {},
): Promise<GetOfficesResult> => {
  const { page = 1, limit = 12, search } = params;
  const skip = (page - 1) * limit;
  const userEligibilityMatch: Record<string, unknown> = {
    "office.isActive": true,
    "office.deletedAt": null,
    "office.isVerified": true,
    "office.role": { $in: ["user"] },
  };

  if (search) {
    userEligibilityMatch.$or = [
      { "office.name": { $regex: search, $options: "i" } },
      { "office.phoneNumber": { $regex: search, $options: "i" } },
    ];
  }

  const aggregation = await UserSubscriptionModel.aggregate<{
    offices: Office[];
    metadata: Array<{ total: number }>;
  }>([
    // Preserve the existing office eligibility rule while using the new
    // planType-leading index instead of materializing every subscription.
    { $match: { planType: PlanType.OFFICE_PLAN, deletedAt: null } },
    { $group: { _id: "$user" } },
    {
      $lookup: {
        from: UserModel.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "office",
      },
    },
    { $unwind: "$office" },
    { $match: userEligibilityMatch },
    { $sort: { "office.createdAt": -1 as const } },
    {
      $facet: {
        metadata: [{ $count: "total" }],
        offices: [
          { $skip: skip },
          { $limit: limit },
          // Count ads only for the paginated offices. The compound
          // user/status/createdAt index also serves office detail.
          {
            $lookup: {
              from: AdModel.collection.name,
              localField: "office._id",
              foreignField: "user",
              pipeline: [{ $match: { status: "active" } }, { $count: "count" }],
              as: "adsCountLookup",
            },
          },
          {
            $project: {
              _id: "$office._id",
              publicId: "$office.publicId",
              name: "$office.name",
              phoneNumber: "$office.phoneNumber",
              avatar: "$office.avatar",
              instagram: "$office.instagram",
              tiktok: "$office.tiktok",
              description: "$office.description",
              adsCount: {
                $ifNull: [{ $arrayElemAt: ["$adsCountLookup.count", 0] }, 0],
              },
              email: "$office.phoneNumber",
            },
          },
        ],
      },
    },
  ]).allowDiskUse(true);

  const offices = aggregation[0]?.offices || [];
  const total = aggregation[0]?.metadata[0]?.total || 0;

  return {
    offices,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
};

/**
 * Get office by ID with all ads
 */
export const getOfficeById = async (
    officeId: string,
    adFilters?: {
        propertyType?: string;
        area?: string | string[];
        minPrice?: number;
        maxPrice?: number;
        page?: number;
        limit?: number;
        purpose?: string;
    },
    userId?: string
): Promise<{ office: Office | null; ads: any[]; totalAds: number; page: number; totalPages: number }> => {
    const officeQuery =
        mongoose.Types.ObjectId.isValid(officeId) && officeId.length === 24
            ? { _id: new mongoose.Types.ObjectId(officeId) }
            : { publicId: Number(officeId) };
    const user =
        'publicId' in officeQuery && !Number.isSafeInteger(officeQuery.publicId)
            ? null
            : await UserModel.findOne(officeQuery).select('publicId name phoneNumber avatar instagram tiktok description').lean();

    if (!user) {
        return {
            office: null,
            ads: [],
            totalAds: 0,
            page: adFilters?.page || 1,
            totalPages: 0
        };
    }

    const adPage = adFilters?.page || 1;
    const adLimit = adFilters?.limit || 12;
    const adSkip = (adPage - 1) * adLimit;

    // Build match stage
    const matchStage: any = {
        user: user._id,
        status: 'active'
    };

    if (adFilters?.purpose) {
        matchStage.purpose = adFilters.purpose;
    }

    if (adFilters?.propertyType) {
        matchStage.propertyType = await resolvePropertyTypeId(adFilters.propertyType);
    }

    if (adFilters?.area) {
        if (Array.isArray(adFilters.area)) {
            matchStage.area = { $in: await Promise.all(adFilters.area.map(resolveAreaId)) };
        } else {
            matchStage.area = await resolveAreaId(adFilters.area);
        }
    }

    if (adFilters?.minPrice !== undefined || adFilters?.maxPrice !== undefined) {
        matchStage.price = {};
        if (adFilters.minPrice !== undefined) {
            matchStage.price.$gte = adFilters.minPrice;
        }
        if (adFilters.maxPrice !== undefined) {
            matchStage.price.$lte = adFilters.maxPrice;
        }
    }

    // Pipeline stages for ads
    const adPipeline: any[] = [
        { $match: matchStage },
        { $sort: { createdAt: -1 as const } },
        { $skip: adSkip },
        { $limit: adLimit },
        {
            $addFields: {
                user: {
                    _id: user._id,
                    publicId: user.publicId,
                    name: user.name,
                    phoneNumber: user.phoneNumber,
                    avatar: user.avatar
                }
            }
        },
        // Populate propertyType
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
        // Populate area
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
        // Populate media (preserving order)
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
        // Remove legacy fields
        { $project: { images: 0, videoThumbnail: 0 } }
    ];

    // Add isFav logic if userId is provided
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        const userObjectId = new mongoose.Types.ObjectId(userId);
        adPipeline.push(
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
                    as: 'isFavLookup'
                }
            },
            {
                $addFields: {
                    isFav: { $gt: [{ $size: '$isFavLookup' }, 0] }
                }
            },
            { $project: { isFavLookup: 0 } }
        );
    }

    // Aggregation pipeline
    const result = await AdModel.aggregate([
        {
            $facet: {
                ads: adPipeline,
                totalCount: [{ $match: matchStage }, { $count: 'count' }]
            }
        }
    ]);

    const ads = result[0]?.ads || [];
    const totalAds = result[0]?.totalCount?.[0]?.count || 0;

    const office: Office = {
        _id: user._id.toString(),
        publicId: user.publicId,
        name: user.name,
        phoneNumber: user.phoneNumber,
        avatar: user.avatar,
        instagram: user.instagram,
        tiktok: user.tiktok,
        description: user.description,
        email: user.phoneNumber, // Using phoneNumber as email placeholder
        adsCount: totalAds
    };

    return {
        office,
        ads,
        totalAds,
        page: adPage,
        totalPages: Math.ceil(totalAds / adLimit)
    };
};

import { CouponModel, ICoupon } from './models/coupon.model';
import CustomError from '../../utils/custom-error';
import { FilterQuery } from 'mongoose';

export const getAllCoupons = async (page: number = 1, limit: number = 10, search?: string, status?: string) => {
    const query: FilterQuery<ICoupon> = {};

    if (search) {
        query.code = { $regex: search, $options: 'i' };
    }

    if (status === 'active') {
        query.isActive = true;
        query.expiryDate = { $gt: new Date() };
    } else if (status === 'inactive') {
        query.$or = [{ isActive: false }, { expiryDate: { $lte: new Date() } }];
    }

    const skip = (page - 1) * limit;

    const [coupons, total] = await Promise.all([CouponModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit), CouponModel.countDocuments(query)]);

    return {
        data: coupons,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
};

export const getCouponById = async (id: string) => {
    const coupon = await CouponModel.findById(id);
    if (!coupon) throw new CustomError('Coupon not found', 404);
    return coupon;
};

export const createCoupon = async (data: { code: string; discountValue: number; userLimit: number; expiryDate: Date }) => {
    // Check if coupon code already exists
    const existing = await CouponModel.findOne({ code: data.code.toUpperCase() });
    if (existing) throw new CustomError('Coupon code already exists', 400);

    // Validate expiry date is in future
    if (new Date(data.expiryDate) <= new Date()) {
        throw new CustomError('Expiry date must be in the future', 400);
    }

    const coupon = await CouponModel.create({
        ...data
    });

    return coupon;
};

export const updateCoupon = async (
    id: string,
    data: {
        code?: string;
        discountValue?: number;
        userLimit?: number;
        expiryDate?: string;
        isActive?: boolean;
    }
) => {
    const coupon = await CouponModel.findById(id);
    if (!coupon) throw new CustomError('Coupon not found', 404);

    // Let's restrict code changes for simplicity and reliability.
    if (data.code && data.code.toUpperCase() !== coupon.code) {
        throw new CustomError('Coupon code cannot be changed. Delete and recreate if needed.', 400);
    }

    if (data.expiryDate && new Date(data.expiryDate) <= new Date()) {
        throw new CustomError('Expiry date must be in the future', 400);
    }

    // Update in DB
    Object.assign(coupon, data);
    await coupon.save();

    return coupon;
};

export const deleteCoupon = async (id: string) => {
    const coupon = await CouponModel.findById(id);
    if (!coupon) throw new CustomError('Coupon not found', 404);

    await coupon.deleteOne();
    return true;
};

export const getCouponStats = async () => {
    const total = await CouponModel.countDocuments();
    const active = await CouponModel.countDocuments({ isActive: true, expiryDate: { $gt: new Date() } });
    const inactive = total - active;

    return { total, active, inactive };
};

export const validateCoupon = async (code: string) => {
    const coupon = await CouponModel.findOne({ code: code.toUpperCase(), isActive: true });
    if (!coupon) throw new CustomError('Invalid coupon code', 404);

    if (new Date(coupon.expiryDate) <= new Date()) {
        throw new CustomError('Coupon has expired', 400);
    }

    if (coupon.userLimit > 0 && coupon.usageCount >= coupon.userLimit) {
        throw new CustomError('Coupon usage limit reached', 400);
    }

    return {
        code: coupon.code,
        discountValue: coupon.discountValue
    };
};

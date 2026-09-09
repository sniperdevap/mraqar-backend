import jwt, { JwtPayload } from 'jsonwebtoken';

import CustomError from '../../utils/custom-error';
import config from '../../config/default';
import { User, UserModel, OTPModel } from './models';
import { UserRole } from './user.constants';
import { ERROR_MESSAGES } from './user.messages';

// Get all users
const getAllUsers = async (): Promise<User[]> => {
    return await UserModel.find().select('-__v -password'); //selecting all fields except __v and password
};

// Get a user by ID
const getUserById = async (id: string): Promise<User | null> => {
    return await UserModel.findById(id);
};

// Get a user with details (placeholder for future expansions)
const getUserWithDetails = async (userId: string): Promise<User> => {
    const user = await UserModel.findById(userId);

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER_NOT_FOUND, 404);
    }

    return user;
};

// Get a user by Phone Number
const getUserByPhoneNumber = async (phoneNumber: string): Promise<User | null> => {
    return await UserModel.findOne({ phoneNumber }).lean(false);
};

// Create a new user
const createUser = async (userData: Partial<User>): Promise<User> => {
    // No manual password hashing, handled by model hooks
    const user = new UserModel(userData);
    return await user.save();
};

// Update a user by ID
const updateUser = async (id: string, updatedData: Partial<User>): Promise<User | null> => {
    // No manual password hashing, handled by model hooks
    return await UserModel.findByIdAndUpdate(id, updatedData, { new: true });
};

// Delete a user by ID
const deleteUser = async (id: string): Promise<boolean> => {
    const result = await UserModel.findByIdAndDelete(id);
    return result !== null;
};

// Validate user credentials (phoneNumber/password)
const validateUserCredentials = async (phoneNumber: string, password: string): Promise<User | null> => {
    const user = await getUserByPhoneNumber(phoneNumber);
    if (!user) return null;
    if (user.deletedAt) {
        throw new CustomError('Your account has been deleted. Please contact support for assistance.', 403, 'ACCOUNT_DELETED');
    }
    if (!password || !user.password || !user.matchPassword) return null;
    if (await user.matchPassword(password)) return user;
    return null;
};

// Generate OTP
const generateOTP = async (userId: string): Promise<string> => {
    const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit OTP

    await OTPModel.findOneAndUpdate({ userId }, { code, createdAt: new Date() }, { upsert: true, new: true });

    return code;
};

// Verify OTP
const verifyOTP = async (userId: string, code: string): Promise<boolean> => {
    const otp = await OTPModel.findOne({ userId, code });

    if (!otp) return false;

    // Delete the OTP document after successful verification
    await OTPModel.deleteOne({ _id: otp._id });

    return true;
};

// Generate password reset token
const generateResetToken = async (phoneNumber: string): Promise<string> => {
    const user = await UserModel.findOne({ phoneNumber });
    if (!user) throw new CustomError(ERROR_MESSAGES.USER_NOT_FOUND, 404);
    return jwt.sign({ id: user.id }, config.jwtSecret!, { expiresIn: '15m' });
};

const generateAuthToken = (user: User): string => {
    const payload: { id: string; role?: string } = { id: String(user._id) };
    if (user.role) payload.role = user.role;
    return jwt.sign(payload, config.jwtSecret!);
};

// Verify reset password token
const verifyResetToken = async (token: string): Promise<{ valid: boolean; message: string }> => {
    if (!token || token.trim().length === 0) {
        throw new CustomError(ERROR_MESSAGES.VERIFICATION_TOKEN_REQUIRED, 400);
    }

    const decoded = jwt.verify(token, config.jwtSecret!) as JwtPayload;
    const user = await UserModel.findById(decoded.id as string);

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER_NOT_FOUND, 404);
    }

    return { valid: true, message: 'Token is valid' };
};

// Reset user password
const resetUserPassword = async (token: string, newPassword: string): Promise<boolean> => {
    const decoded = jwt.verify(token, config.jwtSecret!) as JwtPayload;
    const user = await UserModel.findByIdAndUpdate(decoded.id as string, {
        password: newPassword
    });

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER_NOT_FOUND, 404);
    }

    return true;
};

const getAllBusinesses = async (page: number = 1, limit: number = 10, search?: string, status?: string) => {
    const skip = (page - 1) * limit;

    // Simplified matchStage for new User model
    const matchStage: Record<string, unknown> = {
        role: UserRole.BUSINESS_OWNER // Or maybe specific role if needed
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
                            __v: 0,
                            isVerified: 0,
                            resetPasswordToken: 0,
                            resetPasswordExpires: 0
                        }
                    }
                ],
                count: [{ $count: 'total' }]
            }
        }
    ]);

    const businesses = result[0].data;
    const total = result[0].count[0]?.total || 0;

    return {
        businesses,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
};

const getBusinessStats = async () => {
    const result = await UserModel.aggregate([
        {
            $match: {
                role: UserRole.BUSINESS_OWNER
            }
        },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                active: {
                    $sum: {
                        $cond: [{ $eq: ['$isActive', true] }, 1, 0]
                    }
                },
                inactive: {
                    $sum: {
                        $cond: [{ $eq: ['$isActive', false] }, 1, 0]
                    }
                }
            }
        }
    ]);

    const stats = result[0] || { total: 0, active: 0, inactive: 0 };

    return {
        total: stats.total,
        active: stats.active,
        inactive: stats.inactive
    };
};

const toggleUserStatus = async (userId: string): Promise<User> => {
    const user = await UserModel.findById(userId);
    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER_ID_NOT_FOUND(userId), 404);
    }

    user.isActive = !user.isActive;
    await user.save();

    return user;
};

const toggleUserVerified = async (userId: string): Promise<User> => {
    const user = await UserModel.findById(userId);
    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER_ID_NOT_FOUND(userId), 404);
    }

    user.isVerified = !user.isVerified;
    await user.save();

    return user;
};

export {
    getAllUsers,
    getUserById,
    getUserByPhoneNumber,
    createUser,
    generateOTP,
    verifyOTP,
    updateUser,
    deleteUser,
    validateUserCredentials,
    generateResetToken,
    generateAuthToken,
    resetUserPassword,
    verifyResetToken,
    getAllBusinesses,
    getBusinessStats,
    toggleUserStatus,
    toggleUserVerified,
    getUserWithDetails
};

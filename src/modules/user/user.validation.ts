import { z } from 'zod';
import { UserRole } from './user.constants';

const userRoleEnum = z.nativeEnum(UserRole);

// Password validation helper - matches UI validation
export const passwordSchema = z.string().min(1, 'Password is required');

const createUserSchema = z.object({
    body: z.object({
        name: z.string().min(1, 'Name is required').trim(),
        phoneNumber: z.string().min(1, 'Phone number is required'),
        password: passwordSchema,
        role: userRoleEnum.optional()
    })
});

const updateUserSchema = z.object({
    body: z.object({
        name: z.string().trim().optional(),
        phoneNumber: z.string().optional(),
        password: passwordSchema.optional(),
        role: userRoleEnum.optional(),
        instagram: z.string().optional(),
        tiktok: z.string().optional(),
        description: z.string().optional()
    })
});

const updateAccountSchema = z.object({
    body: z.object({
        name: z.string().trim().optional(),
        email: z.string().email('Invalid email address').optional(),
        password: passwordSchema.optional()
    })
});

const getUserByIdSchema = z.object({
    params: z.object({
        id: z.string().min(1, 'User ID is required')
    })
});

const deleteUserSchema = z.object({
    params: z.object({
        id: z.string().min(1, 'User ID is required')
    })
});

const signinSchema = z.object({
    body: z.object({
        phoneNumber: z.string().min(1, 'Phone number is required'),
        password: z.string().min(1, 'Password is required')
    })
});

// Phone number or email: the reset code goes by SMS or by email.
const phoneOrEmail = {
    phoneNumber: z.string().min(1).optional(),
    email: z.string().email('Invalid email address').optional()
};
const forgotPasswordSchema = z.object({
    body: z.object(phoneOrEmail).refine((b) => b.phoneNumber || b.email, { message: 'Phone number or email is required' })
});

const resetPasswordSchema = z.object({
    body: z.object({
        token: z.string().min(1, 'Token is required'),
        newPassword: passwordSchema
    })
});

const verifyOTPSchema = z.object({
    body: z.object({ ...phoneOrEmail, code: z.string().min(1, 'Verification code is required') })
        .refine((b) => b.phoneNumber || b.email, { message: 'Phone number or email is required' })
});

const resendOTPSchema = z.object({
    body: z.object(phoneOrEmail).refine((b) => b.phoneNumber || b.email, { message: 'Phone number or email is required' })
});

const verifyResetTokenSchema = z.object({
    query: z.object({
        token: z.string().min(1, 'Reset token is required')
    })
});

const businessOwnerSignupSchema = z.object({
    body: z.object({
        name: z.string().min(1, 'Name is required').trim(),
        phoneNumber: z.string().min(1, 'Phone number is required'),
        password: passwordSchema,
        avatar: z.string().optional(),
        email: z.string().email('Invalid email address').optional().or(z.literal('')),
        accountType: z.enum(['individual', 'office']).optional(),
        userType: z.enum(['personal', 'owner', 'marketer']).optional(),
        licenseNumber: z.string().trim().optional()
    }).refine((b) => b.accountType !== 'office' || Boolean(b.licenseNumber), {
        message: 'License number is required for offices', path: ['licenseNumber']
    })
});

const googleSigninSchema = z.object({
    body: z.object({
        credential: z.string().min(20, 'Google credential is required'),
        phoneNumber: z.string().optional(),
        name: z.string().trim().optional(),
        accountType: z.enum(['individual', 'office']).optional(),
        userType: z.enum(['personal', 'owner', 'marketer']).optional(),
        licenseNumber: z.string().trim().optional()
    })
});

const getAllBusinessesSchema = z.object({
    query: z.object({
        page: z.string().optional(),
        limit: z.string().optional(),
        search: z.string().optional(),
        status: z.string().optional()
    })
});

const toggleUserStatusSchema = z.object({
    params: z.object({
        id: z.string().min(1, 'User ID is required')
    })
});

const toggleUserVerifiedSchema = z.object({
    params: z.object({
        id: z.string().min(1, 'User ID is required')
    })
});

export {
    createUserSchema,
    updateUserSchema,
    getUserByIdSchema,
    deleteUserSchema,
    signinSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    verifyOTPSchema,
    resendOTPSchema,
    updateAccountSchema,
    businessOwnerSignupSchema,
    googleSigninSchema,
    verifyResetTokenSchema,
    getAllBusinessesSchema,
    toggleUserStatusSchema,
    toggleUserVerifiedSchema
};

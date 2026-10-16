import { Router } from 'express';
import {
    getUsers,
    getUserById,
    createUser,
    updateUser,
    deleteUser,
    signin,
    forgotPassword,
    resetPassword,
    verifyOTP,
    resendOTP,
    signup,
    googleSignin,
    verifyResetToken,
    getAllBusinesses,
    getBusinessStats,
    toggleUserStatus
} from './user.controller';
import asyncHandler from '../../utils/async-handler';
import validateRequest from '../../middlewares/validate-request';
import {
    createUserSchema,
    updateUserSchema,
    getUserByIdSchema,
    deleteUserSchema,
    signinSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    verifyOTPSchema,
    resendOTPSchema,
    businessOwnerSignupSchema,
    googleSigninSchema,
    verifyResetTokenSchema,
    getAllBusinessesSchema,
    toggleUserStatusSchema
} from './user.validation';
import authMiddleware from '../../middlewares/auth';
import authorizeRoles from '../../middlewares/authorize-roles';
import { UserRole } from './user.constants';

const router = Router();
//public routes
router.post('/signin', validateRequest(signinSchema), asyncHandler(signin));
router.post('/signup', validateRequest(businessOwnerSignupSchema), asyncHandler(signup));
router.post('/google', validateRequest(googleSigninSchema), asyncHandler(googleSignin));
router.post('/forgot-password', validateRequest(forgotPasswordSchema), asyncHandler(forgotPassword));
router.get('/verify-reset-token', validateRequest(verifyResetTokenSchema), asyncHandler(verifyResetToken));
router.post('/reset-password', validateRequest(resetPasswordSchema), asyncHandler(resetPassword));
router.post('/verify-otp', validateRequest(verifyOTPSchema), asyncHandler(verifyOTP));
router.post('/resend-otp', validateRequest(resendOTPSchema), asyncHandler(resendOTP));

// Protected routes
router.get('/businesses/stats', authMiddleware, authorizeRoles([UserRole.SUPER_ADMIN]), asyncHandler(getBusinessStats));
router.get('/businesses', authMiddleware, authorizeRoles([UserRole.SUPER_ADMIN]), validateRequest(getAllBusinessesSchema), asyncHandler(getAllBusinesses));
router.patch('/toggle-status/:id', authMiddleware, authorizeRoles([UserRole.SUPER_ADMIN]), validateRequest(toggleUserStatusSchema), asyncHandler(toggleUserStatus));
router.get('/', authMiddleware, authorizeRoles([UserRole.SUPER_ADMIN]), asyncHandler(getUsers));
router.get('/:id', authMiddleware, authorizeRoles([UserRole.SUPER_ADMIN, UserRole.STAFF, UserRole.BUSINESS_OWNER]), validateRequest(getUserByIdSchema), asyncHandler(getUserById));
router.post('/', authMiddleware, authorizeRoles([UserRole.SUPER_ADMIN]), validateRequest(createUserSchema), asyncHandler(createUser));
router.put('/:id', authMiddleware, authorizeRoles([UserRole.SUPER_ADMIN, UserRole.STAFF, UserRole.BUSINESS_OWNER]), validateRequest(updateUserSchema), asyncHandler(updateUser));
router.delete('/:id', authMiddleware, authorizeRoles([UserRole.SUPER_ADMIN, UserRole.STAFF, UserRole.BUSINESS_OWNER]), validateRequest(deleteUserSchema), asyncHandler(deleteUser));

export default router;

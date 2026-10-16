import { Request, Response } from "express";
import * as UserService from "./user.service";
import CustomError from "../../utils/custom-error";
import { formatResponse } from "../../utils/helpers";
import { UserRole } from "./user.constants";
import { SUCCESS_MESSAGES, ERROR_MESSAGES } from "./user.messages";
import { JwtPayload } from "jsonwebtoken";
import logger from "../../utils/logger";
import { getUserSubscriptions } from "../subscription/subscription.service";
import { sendSMS } from "../../utils/sms-sender";
import { UserModel } from "./models/user.model";
import crypto from "crypto";

/** Verifies a Google Identity Services ID token and returns its profile. */
const verifyGoogleCredential = async (credential: string) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new CustomError("Google sign-in is not configured", 503);
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!r.ok) throw new CustomError("Invalid Google sign-in", 401);
  const info = (await r.json()) as { aud?: string; sub?: string; email?: string; email_verified?: string | boolean; name?: string; picture?: string; exp?: string };
  const verified = info.email_verified === true || info.email_verified === "true";
  if (info.aud !== clientId || !info.sub || !info.email || !verified) throw new CustomError("Invalid Google sign-in", 401);
  return { googleId: info.sub, email: info.email.toLowerCase(), name: info.name || "", picture: info.picture };
};

const authPayload = async (user: any) => {
  const token = await UserService.generateAuthToken(user);
  const subscriptions = await getUserSubscriptions((user._id as any).toString());
  const { password: _, __v, ...rest } = user.toObject();
  return { token, user: { ...rest, subscriptions } };
};

/**
 * POST /users/google { credential, phoneNumber?, name?, accountType?, userType?, licenseNumber? }
 * Signs in an existing account (matched by Google id or email). A new account needs a
 * Kuwait phone number, so the first call answers { needsPhone: true } and the client
 * calls again with the phone number.
 */
const googleSignin = async (req: Request, res: Response) => {
  const { credential, phoneNumber, name, accountType, userType, licenseNumber } = req.body;
  const g = await verifyGoogleCredential(credential);

  let user: any = await UserModel.findOne({ $or: [{ googleId: g.googleId }, { email: g.email }] });
  if (user) {
    if (!user.isActive) throw new CustomError(ERROR_MESSAGES.ACCOUNT_INACTIVE, 403);
    if (!user.googleId) { user.googleId = g.googleId; await user.save(); }
    return res.status(200).json(formatResponse(true, SUCCESS_MESSAGES.SIGNIN_SUCCESSFUL, await authPayload(user)));
  }

  if (!phoneNumber) {
    return res.status(200).json(formatResponse(true, "Phone number required", { needsPhone: true, email: g.email, name: g.name }));
  }
  if (accountType === "office" && !licenseNumber) throw new CustomError("License number is required for offices", 400);
  if (await UserService.getUserByPhoneNumber(String(phoneNumber).trim())) {
    throw new CustomError(ERROR_MESSAGES.USER_ALREADY_EXISTS, 400);
  }
  user = await UserService.createUser({
    name: (name || g.name || g.email.split("@")[0]).trim(),
    phoneNumber: String(phoneNumber).trim(),
    password: crypto.randomBytes(24).toString("hex"),
    avatar: g.picture,
    email: g.email,
    googleId: g.googleId,
    accountType: accountType || "individual",
    userType: accountType === "office" ? undefined : userType,
    licenseNumber: accountType === "office" ? licenseNumber : undefined,
    role: UserRole.USER,
    isVerified: true,
    isActive: true,
  } as any);
  res.status(201).json(formatResponse(true, SUCCESS_MESSAGES.USER_CREATED, await authPayload(user)));
};
const signup = async (req: Request, res: Response) => {
  const { name, phoneNumber, password, avatar, email, accountType, userType, licenseNumber } = req.body;

  const existingUser = await UserService.getUserByPhoneNumber(phoneNumber);
  if (existingUser) {
    throw new CustomError(ERROR_MESSAGES.USER_ALREADY_EXISTS, 400);
  }
  const cleanEmail = typeof email === "string" && email.trim() ? email.trim().toLowerCase() : undefined;
  if (cleanEmail && (await UserModel.exists({ email: cleanEmail }))) {
    throw new CustomError("Email is already registered", 400);
  }

  const newUser = await UserService.createUser({
    name,
    phoneNumber: phoneNumber.trim(),
    password,
    avatar,
    email: cleanEmail,
    accountType: accountType || "individual",
    userType: accountType === "office" ? undefined : userType,
    licenseNumber: accountType === "office" ? licenseNumber : undefined,
    role: UserRole.USER,
    isVerified: true,
    isActive: true,
  });

  const { password: _, __v, ...userWithoutSensitiveData } = newUser.toObject();
  res
    .status(201)
    .json(
      formatResponse(
        true,
        SUCCESS_MESSAGES.USER_CREATED,
        userWithoutSensitiveData,
      ),
    );
};

const getUsers = async (req: Request, res: Response) => {
  const users = await UserService.getAllUsers();
  res
    .status(200)
    .json(formatResponse(true, SUCCESS_MESSAGES.USERS_RETRIEVED, users));
};

const getUserById = async (req: Request, res: Response) => {
  const { id } = req.params;
  const currentUser = req.user as JwtPayload;
  // Only Super Admin can get any user, others can only get themselves
  if (currentUser.role !== UserRole.SUPER_ADMIN && currentUser.id !== id) {
    throw new CustomError(ERROR_MESSAGES.USER_NOT_AUTHORIZED_UPDATE, 403);
  }
  const user = await UserService.getUserById(id as string);
  if (!user) {
    throw new CustomError(ERROR_MESSAGES.USER_ID_NOT_FOUND(id as string), 404);
  }

  const { password, __v, ...userWithoutSensitiveData } = user.toObject();
  res
    .status(200)
    .json(
      formatResponse(
        true,
        SUCCESS_MESSAGES.USER_RETRIEVED,
        userWithoutSensitiveData,
      ),
    );
};

const createUser = async (req: Request, res: Response) => {
  const { ...userData } = req.body;
  const newUser = await UserService.createUser({ ...userData });

  const { password, __v, ...userWithoutSensitiveData } = newUser.toObject();
  res
    .status(201)
    .json(
      formatResponse(
        true,
        SUCCESS_MESSAGES.USER_CREATED,
        userWithoutSensitiveData,
      ),
    );
};

const updateUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { ...updatedData } = req.body;
  const currentUser = req.user as JwtPayload;
  // Only Super Admin can update any user, others can only update themselves
  if (currentUser.role !== UserRole.SUPER_ADMIN && currentUser.id !== id) {
    throw new CustomError(ERROR_MESSAGES.USER_NOT_AUTHORIZED_UPDATE, 403);
  }
  const updatedUser = await UserService.updateUser(id as string, {
    ...updatedData,
  });
  if (!updatedUser) {
    throw new CustomError(ERROR_MESSAGES.USER_ID_NOT_FOUND(id as string), 404);
  }

  const { password, __v, ...userWithoutSensitiveData } = updatedUser.toObject();
  res
    .status(200)
    .json(
      formatResponse(
        true,
        SUCCESS_MESSAGES.USER_UPDATED,
        userWithoutSensitiveData,
      ),
    );
};

const deleteUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  const currentUser = req.user as JwtPayload;
  // Only Super Admin can delete any user, others can only delete themselves
  if (currentUser.role !== UserRole.SUPER_ADMIN && currentUser.id !== id) {
    throw new CustomError(ERROR_MESSAGES.USER_NOT_AUTHORIZED_DELETE, 403);
  }
  const deleted = await UserService.deleteUser(id as string);
  if (!deleted) {
    throw new CustomError(ERROR_MESSAGES.USER_ID_NOT_FOUND(id as string), 404);
  }
  res.status(200).json(formatResponse(true, SUCCESS_MESSAGES.USER_DELETED));
};

const signin = async (req: Request, res: Response) => {
  const { phoneNumber, password } = req.body;
  const user = await UserService.validateUserCredentials(phoneNumber, password);
  if (!user) {
    throw new CustomError(ERROR_MESSAGES.INVALID_CREDENTIALS, 401);
  }
  if (!user.isVerified) {
    throw new CustomError(
      "Phone number not verified",
      403,
      "PHONE_NOT_VERIFIED",
    );
  }
  if (!user.isActive) {
    throw new CustomError(ERROR_MESSAGES.ACCOUNT_INACTIVE, 403);
  }
  const token = await UserService.generateAuthToken(user);
  const subscriptions = await getUserSubscriptions(
    (user._id as any).toString(),
  );

  const { password: _, __v, ...userWithoutSensitiveData } = user.toObject();

  res.status(200).json(
    formatResponse(true, SUCCESS_MESSAGES.SIGNIN_SUCCESSFUL, {
      token,
      user: { ...userWithoutSensitiveData, subscriptions },
    }),
  );
};

const forgotPassword = async (req: Request, res: Response) => {
  const { phoneNumber } = req.body;
  const user = await UserService.getUserByPhoneNumber(phoneNumber);
  if (!user) {
    throw new CustomError(ERROR_MESSAGES.USER_NOT_FOUND, 404);
  }

  const otp = await UserService.generateOTP((user._id as any).toString());
  logger.info(`OTP generated for forgot-password: ${phoneNumber}`);
  const smsSent = await sendSMS(
    phoneNumber,
    `هذا هو رمز إعادة تعيين كلمة المرور لموقع مستر عقار الإلكتروني. ${otp}`,
  );
  if (!smsSent) {
    throw new CustomError("Failed to send reset code", 500);
  }

  res.status(200).json(formatResponse(true, "Reset code sent to your phone"));
};

const verifyResetToken = async (req: Request, res: Response) => {
  const { token } = req.query;
  const result = await UserService.verifyResetToken(token as string);
  res.status(200).json(formatResponse(true, result.message, { valid: true }));
};

const resetPassword = async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;
  await UserService.resetUserPassword(token, newPassword);
  res
    .status(200)
    .json(formatResponse(true, SUCCESS_MESSAGES.PASSWORD_RESET_SUCCESS));
};

const verifyOTP = async (req: Request, res: Response) => {
  const { phoneNumber, code } = req.body;

  const user = await UserService.getUserByPhoneNumber(phoneNumber);
  if (!user) {
    throw new CustomError(ERROR_MESSAGES.USER_NOT_FOUND, 404);
  }

  const isValid = await UserService.verifyOTP(
    (user._id as any).toString(),
    code,
  );
  if (!isValid) {
    throw new CustomError("Invalid or expired verification code", 400);
  }

  user.isVerified = true;
  await user.save();

  const authToken = await UserService.generateAuthToken(user);
  const subscriptions = await getUserSubscriptions(
    (user._id as any).toString(),
  );

  const { password: _, __v, ...userWithoutSensitiveData } = user.toObject();

  res.status(200).json(
    formatResponse(true, "Phone number verified successfully", {
      token: authToken,
      user: { ...userWithoutSensitiveData, subscriptions },
    }),
  );
};

const resendOTP = async (req: Request, res: Response) => {
  const { phoneNumber } = req.body;
  const user = await UserService.getUserByPhoneNumber(phoneNumber);
  if (!user) {
    throw new CustomError(ERROR_MESSAGES.USER_NOT_FOUND, 404);
  }
  if (user.isVerified) {
    throw new CustomError("Phone number is already verified", 400);
  }

  const otp = await UserService.generateOTP((user._id as any).toString());
  logger.info(`OTP generated for resend: ${phoneNumber}`);
  const smsSent = await sendSMS(
    phoneNumber,
    `رمز التحقق الخاص بك في موقع مستر عقار الإلكتروني. ${otp}`,
  );
  if (!smsSent) {
    throw new CustomError("Failed to send verification code", 500);
  }

  res.status(200).json(formatResponse(true, "Verification code resent"));
};

const getAllBusinesses = async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.max(
    1,
    Math.min(100, parseInt(req.query.limit as string) || 10),
  );
  const search = req.query.search as string | undefined;
  const status = req.query.status as string | undefined;

  const result = await UserService.getAllBusinesses(
    page,
    limit,
    search,
    status,
  );

  res.status(200).json(
    formatResponse(true, SUCCESS_MESSAGES.BUSINESSES_RETRIEVED, {
      data: result.businesses,
      pagination: result.pagination,
    }),
  );
};

const getBusinessStats = async (req: Request, res: Response) => {
  const stats = await UserService.getBusinessStats();

  res
    .status(200)
    .json(
      formatResponse(true, SUCCESS_MESSAGES.BUSINESS_STATS_RETRIEVED, stats),
    );
};

const toggleUserStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  // const previousStatus = (await UserService.getUserById(id))?.isActive;
  const user = await UserService.toggleUserStatus(id as string);

  res.status(200).json(
    formatResponse(true, SUCCESS_MESSAGES.USER_STATUS_UPDATED, {
      userId: user._id,
      isActive: user.isActive,
    }),
  );
};

const toggleUserVerified = async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = await UserService.toggleUserVerified(id as string);

  res.status(200).json(
    formatResponse(true, "User verification updated successfully", {
      userId: user._id,
      isVerified: user.isVerified,
    }),
  );
};

export {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  signin,
  forgotPassword,
  resetPassword,
  signup,
  googleSignin,
  verifyOTP,
  resendOTP,
  verifyResetToken,
  getAllBusinesses,
  getBusinessStats,
  toggleUserStatus,
  toggleUserVerified,
};

import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';
import { UserRole } from '../user.constants';

interface User extends Document {
    publicId: number;
    name: string;
    phoneNumber: string;
    password: string;
    role: UserRole;
    isVerified: boolean;
    isActive: boolean;
    deletedAt?: Date | null;
    avatar?: string;
    instagram?: string;
    tiktok?: string;
    description?: string;
    email?: string;
    googleId?: string;
    accountType?: 'individual' | 'office';
    userType?: 'personal' | 'owner' | 'marketer';
    licenseNumber?: string;
}

// Add instance method for password comparison
declare module 'mongoose' {
    interface Document {
        matchPassword?(enteredPassword: string): Promise<boolean>;
    }
}

const UserSchema: Schema = new Schema(
    {
        publicId: { type: Number, required: true, immutable: true, unique: true, sparse: true, min: 1, index: true },
        name: { type: String, required: true },
        phoneNumber: { type: String, required: true, unique: true, index: true },
        password: {
            type: String,
            required: true
        },
        role: { type: String, enum: Object.values(UserRole), default: UserRole.USER },
        isVerified: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true },
        deletedAt: {
            type: Date,
            default: null
        },
        avatar: { type: String },
        instagram: { type: String },
        tiktok: { type: String },
        description: { type: String },
        email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
        googleId: { type: String, unique: true, sparse: true },
        accountType: { type: String, enum: ['individual', 'office'], default: 'individual' },
        userType: { type: String, enum: ['personal', 'owner', 'marketer'] },
        licenseNumber: { type: String, trim: true }
    },
    { timestamps: true }
);

UserSchema.pre('validate', async function () {
    if (!this.publicId) {
        const { nextPublicId } = await import('../../counter/counter.service');
        this.set('publicId', await nextPublicId('user'), { overwriteImmutable: true });
    }
});

UserSchema.methods.matchPassword = async function (enteredPassword: string) {
    if (!enteredPassword || !this.password) {
        throw new Error('Missing data for password comparison');
    }
    return await bcrypt.compare(enteredPassword, this.password);
};

// Encrypt password using bcrypt before saving
UserSchema.pre('save', async function (next: (err?: any) => void) {
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(String(this.password), salt);
    next();
});

// Encrypt password on update hooks
const hashPasswordOnUpdate = async function (this: any, next: (err?: any) => void) {
    const data = this.getUpdate();
    if (data && data.password) {
        const salt = await bcrypt.genSalt(10);
        data.password = await bcrypt.hash(String(data.password), salt);
        this.setUpdate(data);
    }
    next();
};

UserSchema.pre('updateOne', hashPasswordOnUpdate);
UserSchema.pre('findOneAndUpdate', hashPasswordOnUpdate);

const UserModel = mongoose.model<User>('User', UserSchema);

export { UserModel, User, UserRole };

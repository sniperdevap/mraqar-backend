import mongoose, { Schema, Document } from "mongoose";

export enum AdPurpose {
  SALE = "sale",
  RENT = "rent",
  EXCHANGE = "exchange",
}

export enum AdStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  SOLD = "sold",
}

export enum AdPriceUnit {
  KD = "kd",
  THOUSAND = "thousand",
}

export interface IAd extends Document {
  publicId: number;
  user: mongoose.Types.ObjectId;
  title?: string; // Optional if not in design, but good practice
  purpose: AdPurpose;
  propertyType: mongoose.Types.ObjectId;
  area: mongoose.Types.ObjectId;
  price: number;
  priceUnit: AdPriceUnit;
  phoneNumber: string;
  isPhoneHidden: boolean;
  alternativePhoneNumber?: string;
  premiumAd: boolean;
  isPremium?: boolean;
  premiumExpiresAt?: Date;
  description: string;
  media: mongoose.Types.ObjectId[];
  status: AdStatus;
  views: number;
  viewers: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const AdSchema: Schema = new Schema(
  {
    publicId: {
      type: Number,
      required: true,
      immutable: true,
      unique: true,
      sparse: true,
      min: 1,
      index: true,
    },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    purpose: { type: String, enum: Object.values(AdPurpose), required: true },
    propertyType: {
      type: Schema.Types.ObjectId,
      ref: "PropertyType",
      required: true,
    },
    area: { type: Schema.Types.ObjectId, ref: "Area", required: true },
    price: { type: Number, required: true },
    priceUnit: {
      type: String,
      enum: Object.values(AdPriceUnit),
      default: AdPriceUnit.KD,
    },
    phoneNumber: { type: String, required: true },
    isPhoneHidden: { type: Boolean, default: false },
    alternativePhoneNumber: { type: String },
    premiumAd: { type: Boolean, default: false },
    premiumExpiresAt: { type: Date },
    description: { type: String, required: true },
    media: [{ type: Schema.Types.ObjectId, ref: "Media", default: [] }],
    status: {
      type: String,
      enum: Object.values(AdStatus),
      default: AdStatus.ACTIVE,
    },
    views: { type: Number, default: 0 },
    viewers: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Covers getAds' default listing (status filter + premium-first sort) and countDocuments.
AdSchema.index({ status: 1, premiumAd: -1, createdAt: -1 });
// Covers getMyAds.
AdSchema.index({ user: 1, createdAt: -1 });
// Supports active-ad counts and newest-first ads on office pages.
AdSchema.index({ user: 1, status: 1, createdAt: -1 });

AdSchema.pre("validate", async function () {
  if (!this.publicId) {
    const { nextPublicId } = await import("../../counter/counter.service");
    this.set("publicId", await nextPublicId("ad"), { overwriteImmutable: true });
  }
});

AdSchema.virtual("isPremium")
  .get(function (this: IAd & { premiumAd?: boolean }) {
    return Boolean(this.premiumAd);
  })
  .set(function (this: IAd & { premiumAd?: boolean }, value: boolean) {
    this.premiumAd = Boolean(value);
  });

export const AdModel = mongoose.model<IAd>("Ad", AdSchema);

import mongoose, { Schema, Document } from "mongoose";

export interface IAdView extends Document {
  identifier: string;
  ad: mongoose.Types.ObjectId;
  createdAt: Date;
}

const AdViewSchema: Schema = new Schema({
  identifier: { type: String, required: true, unique: true },
  ad: { type: Schema.Types.ObjectId, ref: "Ad", required: true, index: true },
  createdAt: { type: Date, default: Date.now },
});

export const AdViewModel = mongoose.model<IAdView>("AdView", AdViewSchema);

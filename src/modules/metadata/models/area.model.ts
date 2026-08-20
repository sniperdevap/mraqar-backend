import mongoose, { Schema, Document } from 'mongoose';

export interface IArea extends Document {
    publicId: number;
    label: string;
    labelAr: string;
    value: string;
    governorate: string;
    governorateAr: string;
    order: number;
}

const AreaSchema: Schema = new Schema(
    {
        publicId: { type: Number, required: true, immutable: true, unique: true, sparse: true, min: 1, index: true },
        label: { type: String, required: true },
        labelAr: { type: String, default: '' },
        value: { type: String, required: true, unique: true },
        governorate: { type: String, required: true },
        governorateAr: { type: String, default: '' },
        order: { type: Number, default: 0 }
    },
    { timestamps: true }
);

AreaSchema.pre('validate', async function () {
    if (!this.publicId) {
        const { nextPublicId } = await import('../../counter/counter.service');
        this.set('publicId', await nextPublicId('area'), { overwriteImmutable: true });
    }
});

export const Area = mongoose.model<IArea>('Area', AreaSchema);

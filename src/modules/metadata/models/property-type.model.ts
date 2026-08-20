import mongoose, { Schema, Document } from 'mongoose';

export interface IPropertyType extends Document {
    publicId: number;
    label: string;
    labelAr: string;
    value: string;
    order: number;
}

const PropertyTypeSchema: Schema = new Schema(
    {
        publicId: { type: Number, required: true, immutable: true, unique: true, sparse: true, min: 1, index: true },
        label: { type: String, required: true },
        labelAr: { type: String, default: '' },
        value: { type: String, required: true, unique: true },
        order: { type: Number, default: 0 }
    },
    { timestamps: true }
);

PropertyTypeSchema.pre('validate', async function () {
    if (!this.publicId) {
        const { nextPublicId } = await import('../../counter/counter.service');
        this.set('publicId', await nextPublicId('propertyType'), { overwriteImmutable: true });
    }
});

export const PropertyType = mongoose.model<IPropertyType>('PropertyType', PropertyTypeSchema);

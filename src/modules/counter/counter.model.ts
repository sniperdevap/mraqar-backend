import mongoose, { Schema } from 'mongoose';

export type CounterKey = 'ad' | 'area' | 'propertyType' | 'user';

interface ICounter {
    _id: CounterKey;
    sequence: number;
}

const CounterSchema = new Schema<ICounter>({
    _id: { type: String, required: true },
    sequence: { type: Number, required: true, min: 0, default: 0 }
});

export const CounterModel = mongoose.model<ICounter>('Counter', CounterSchema);

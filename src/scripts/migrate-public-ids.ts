import dotenv from 'dotenv';
import mongoose, { Model } from 'mongoose';
import config from '../config/default';
import { AdModel } from '../modules/ad/models/ad.model';
import { Area } from '../modules/metadata/models/area.model';
import { PropertyType } from '../modules/metadata/models/property-type.model';
import { UserModel } from '../modules/user/models';
import { setCounterSequence } from '../modules/counter/counter.service';

dotenv.config();

const apply = process.argv.includes('--apply');
const batchSizeArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
const batchSize = Number(batchSizeArg?.split('=')[1] ?? 500);
if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error('batch-size must be a positive integer');

type MigratedModel = Model<any>;

async function migrate(model: MigratedModel, name: string, counterKey: 'ad' | 'area' | 'propertyType' | 'user') {
    const existing = await model
        .find({ publicId: { $type: 'number' } })
        .sort({ publicId: -1 })
        .limit(1)
        .select('publicId')
        .lean();
    let nextId = existing[0]?.publicId ?? 0;
    const missing = await model.find({ $or: [{ publicId: { $exists: false } }, { publicId: null }] }).sort({ createdAt: 1, _id: 1 }).select('_id').lean();

    console.log(`${name}: ${missing.length} records need IDs; next ID is ${nextId + 1}`);
    if (apply) {
        for (let offset = 0; offset < missing.length; offset += batchSize) {
            const operations = missing.slice(offset, offset + batchSize).map((record) => ({
                updateOne: {
                    filter: { _id: record._id as mongoose.Types.ObjectId, $or: [{ publicId: { $exists: false } }, { publicId: null }] },
                    update: { $set: { publicId: ++nextId } }
                }
            }));
            if (operations.length) {
                // publicId is immutable for normal application writes. Migrations
                // intentionally use the native collection to backfill old records.
                const result = await model.collection.bulkWrite(operations, { ordered: true });
                if (result.matchedCount !== operations.length || result.modifiedCount !== operations.length) {
                    throw new Error(
                        `${name} batch verification failed: expected=${operations.length}, matched=${result.matchedCount}, modified=${result.modifiedCount}`
                    );
                }
            }
        }
        const max: any = await model.findOne().sort({ publicId: -1 }).select('publicId').lean();
        await setCounterSequence(counterKey, max?.publicId ?? 0);
    }
}

async function verify() {
    for (const [model, name] of [
        [AdModel, 'ads'],
        [UserModel, 'users'],
        [Area, 'areas'],
        [PropertyType, 'property types']
    ] as const) {
        const invalid = await model.countDocuments({ $or: [{ publicId: { $exists: false } }, { publicId: null }, { publicId: { $lt: 1 } }] });
        const duplicates = await model.aggregate([{ $group: { _id: '$publicId', count: { $sum: 1 } } }, { $match: { _id: { $ne: null }, count: { $gt: 1 } } }]);
        if (apply && (invalid || duplicates.length)) throw new Error(`${name} verification failed: invalid=${invalid}, duplicate groups=${duplicates.length}`);
        console.log(`${name}: invalid=${invalid}, duplicate groups=${duplicates.length}`);
    }

    const broken = await AdModel.aggregate([
        { $lookup: { from: 'areas', localField: 'area', foreignField: '_id', as: '_area' } },
        { $lookup: { from: 'propertytypes', localField: 'propertyType', foreignField: '_id', as: '_type' } },
        { $match: { $or: [{ _area: { $size: 0 } }, { _type: { $size: 0 } }] } },
        { $count: 'count' }
    ]);
    if (broken[0]?.count) throw new Error(`Broken ad metadata references: ${broken[0].count}`);
    console.log('Broken ad metadata references: 0');
}

async function main() {
    await mongoose.connect(config.db.uri);
    await migrate(PropertyType, 'property types', 'propertyType');
    await migrate(Area, 'areas', 'area');
    await migrate(AdModel, 'ads', 'ad');
    await migrate(UserModel, 'users', 'user');
    await verify();
    console.log(apply ? 'Public ID migration completed.' : 'Dry run completed. Re-run with --apply to write changes.');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());

import mongoose from "mongoose";
import config from "../config/default";
import { AdModel } from "../modules/ad/models/ad.model";
import { UserSubscriptionModel } from "../modules/subscription/models/user-subscription.model";

async function main() {
  await mongoose.connect(config.db.uri);

  await Promise.all([
    UserSubscriptionModel.createIndexes(),
    AdModel.createIndexes(),
  ]);

  const [subscriptionIndexes, adIndexes] = await Promise.all([
    UserSubscriptionModel.collection.indexes(),
    AdModel.collection.indexes(),
  ]);

  const subscriptionIndex = subscriptionIndexes.find(
    (index) =>
      JSON.stringify(index.key) === JSON.stringify({ planType: 1, user: 1 }),
  );
  const adIndex = adIndexes.find(
    (index) =>
      JSON.stringify(index.key) ===
      JSON.stringify({ user: 1, status: 1, createdAt: -1 }),
  );

  if (!subscriptionIndex || !adIndex) {
    throw new Error("Required office indexes were not created");
  }

  console.log(
    `Office indexes ensured: ${subscriptionIndex.name}, ${adIndex.name}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

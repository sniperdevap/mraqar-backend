import { Express } from 'express';
import userRouter from '../modules/user/user.routes';
import accountRouter from '../modules/user/account.routes';
import metadataRouter from '../modules/metadata/metadata.routes';
import mediaRouter from '../modules/media/media.routes';
import adRouter from '../modules/ad/ad.routes';
import subscriptionPlanRouter from '../modules/subscription-plan/subscription-plan.routes';
import subscriptionRouter from '../modules/subscription/subscription.routes';
import officeRouter from '../modules/office/office.routes';
import contactRouter from '../modules/contact/contact.routes';
import adminRouter from '../modules/admin/admin.routes';
import couponRouter from '../modules/coupon/coupon.routes';
import paymentRouter from '../modules/payment/payment.routes';
import config from '../config/default';

const registerRoutes = (app: Express) => {
    // Route to Ping & check if Server is online
    app.get(`${config.baseRoute}/ping`, (req, res) => {
        res.status(200).send('OK');
    });

    app.use(`${config.baseRoute}/users`, userRouter);
    app.use(`${config.baseRoute}/account`, accountRouter);
    app.use(`${config.baseRoute}/metadata`, metadataRouter);
    app.use(`${config.baseRoute}/media`, mediaRouter);
    app.use(`${config.baseRoute}/ads`, adRouter);
    app.use(`${config.baseRoute}/subscription-plans`, subscriptionPlanRouter);
    app.use(`${config.baseRoute}/subscriptions`, subscriptionRouter);
    app.use(`${config.baseRoute}/offices`, officeRouter);
    app.use(`${config.baseRoute}/contact`, contactRouter);
    app.use(`${config.baseRoute}/admin`, adminRouter);
    app.use(`${config.baseRoute}/coupons`, couponRouter);
    app.use(`${config.baseRoute}/payments`, paymentRouter);
};

export default registerRoutes;

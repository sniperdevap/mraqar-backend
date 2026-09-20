/**
 * End-to-end check of the KNET payment flow against the fake gateway in knet.mock.ts.
 * No bank, no framework, no test runner - it drives the real HTTP endpoints and asserts
 * on the documents that come out.
 *
 * Run it with the app already listening and pointed at the mock:
 *
 *   # terminal 1
 *   NODE_ENV=development PORT=4064 KNET_MOCK=true \
 *   MONGO_URI=mongodb://127.0.0.1:27017/aqar_knet_e2e \
 *   KNET_BASE_URL=http://localhost:4064/mock-knet \
 *   KNET_RETURN_URL=http://localhost:4064/api/v1/payments/callback \
 *   npm run dev
 *
 *   # terminal 2
 *   MONGO_URI=mongodb://127.0.0.1:27017/aqar_knet_e2e npm run test:knet
 *
 * It writes fake users, payments and subscriptions, so it refuses to run against
 * anything but a local throwaway database.
 */
import assert from 'assert';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import config from '../config/default';
import { PlanType } from '../modules/subscription-plan/models/subscription-plan.model';
import { reconcilePendingPayments } from '../modules/payment/payment.service';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4064';
const API = `${BASE}${config.baseRoute}`;
const URI = config.db.uri;

// Never point this at a real database: it inserts users and rewrites the plan price.
if (!/(127\.0\.0\.1|localhost)/.test(URI) || /prod/i.test(URI)) {
    throw new Error(`refusing to run against "${URI}" - use a local throwaway database`);
}

const http = axios.create({ maxRedirects: 0, validateStatus: () => true, timeout: 15000 });
const form = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };

let passed = 0;
const check = (label: string, condition: boolean, detail: string) => {
    assert.ok(condition, `FAILED: ${label} - ${detail}`);
    console.log(`  ok   ${label} (${detail})`);
    passed += 1;
};

const db = () => mongoose.connection.db!;

const makeUser = async (n: number) => {
    const id = new mongoose.Types.ObjectId();
    // Inserted raw: the auth middleware only reads role, isVerified and isActive.
    await db().collection('users').insertOne({
        _id: id,
        publicId: 900000 + n,
        name: `KNET e2e ${n}`,
        phoneNumber: `+96599${String(900000 + n).slice(-6)}`,
        role: 'user',
        isVerified: true,
        isActive: true
    });
    return { id, headers: { Authorization: `Bearer ${jwt.sign({ id: String(id), role: 'user' }, config.jwtSecret!)}` } };
};

const payPage = async (url: string, fields: Record<string, string>) => {
    const page = await http.post(url, new URLSearchParams(fields).toString(), form);
    assert.strictEqual(page.status, 200, 'gateway did not render a checkout page');
    return String(page.data);
};

const linkFor = (html: string, marker: string) => html.match(new RegExp(`href="([^"]*${marker}[^"]*)"`))![1].replace(/&amp;/g, '&');

async function main() {
    await mongoose.connect(URI);
    for (const c of ['users', 'payments', 'usersubscriptions', 'coupons']) {
        await db().collection(c).deleteMany({});
    }

    // A plan that actually costs money - the seeder ships the office plan at 0.
    await db().collection('subscriptionplans').updateOne({ planType: PlanType.OFFICE_PLAN }, { $set: { price: 30, isActive: true } }, { upsert: false });
    const plan = await db().collection('subscriptionplans').findOne({ planType: PlanType.OFFICE_PLAN });
    assert.ok(plan, 'no office plan in the database - start the app once so the seeder runs');
    const planId = String(plan._id);
    const expectedCredits = plan.adCredits;

    console.log('\n1. customer pays and comes back');
    const u1 = await makeUser(1);
    const co = await http.post(`${API}/payments/checkout`, { planId }, { headers: u1.headers });
    check('checkout accepted', co.status === 200 && co.data?.data?.free === false, `HTTP ${co.status}`);
    const { url, fields, trackId } = co.data.data;
    check('amount is 3-decimal KWD', fields.tij_MerchantPaymentAmount === '30.000', fields.tij_MerchantPaymentAmount);
    check('track id is unique and <=30 chars', /^[A-Z0-9]{1,30}$/.test(trackId), trackId);

    const settle = await http.get(BASE + linkFor(await payPage(url, fields), 'outcome=success'));
    check('gateway redirects to the return url', settle.status === 302, String(settle.headers.location).split('?')[0]);
    const cb = await http.get(settle.headers.location as string);
    check('callback redirects the customer to success', String(cb.headers.location).includes('status=success'), String(cb.headers.location));

    const paid = await db().collection('payments').findOne({ trackId });
    check('payment recorded as paid', paid!.status === 'paid' && paid!.creditsGranted === true, `status=${paid!.status} granted=${paid!.creditsGranted}`);
    check('gateway fields persisted', Boolean(paid!.receiptNo && paid!.authCode && paid!.transactionId), `receipt=${paid!.receiptNo}`);
    const sub1 = await db().collection('usersubscriptions').findOne({ user: u1.id });
    check('credits granted', sub1!.credits === expectedCredits, `credits=${sub1!.credits}`);

    console.log('\n2. the same callback arrives twice');
    await http.get(settle.headers.location as string);
    const sub1Again = await db().collection('usersubscriptions').findOne({ user: u1.id });
    check('credits not granted twice', sub1Again!.credits === sub1!.credits, `credits=${sub1Again!.credits}`);

    console.log('\n3. customer pays, then closes the tab');
    const u2 = await makeUser(2);
    const co2 = await http.post(`${API}/payments/checkout`, { planId }, { headers: u2.headers });
    const silent = linkFor(await payPage(co2.data.data.url, co2.data.data.fields), 'silent=1');
    await http.get(BASE + silent);
    const stranded = await db().collection('payments').findOne({ trackId: co2.data.data.trackId });
    check('payment left pending, no redirect came back', stranded!.status === 'pending', `status=${stranded!.status}`);

    // The sweep only looks at payments older than 5 minutes.
    await db().collection('payments').updateOne({ trackId: co2.data.data.trackId }, { $set: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } });
    const swept = await reconcilePendingPayments();
    const rescued = await db().collection('payments').findOne({ trackId: co2.data.data.trackId });
    const sub2 = await db().collection('usersubscriptions').findOne({ user: u2.id });
    check('reconcile sweep settled it', swept >= 1 && rescued!.status === 'paid' && rescued!.creditsGranted === true, `swept=${swept} status=${rescued!.status}`);
    check('credits granted by the sweep', sub2!.credits === expectedCredits, `credits=${sub2!.credits}`);

    console.log('\n4. a 100% coupon skips the gateway');
    await db().collection('coupons').insertOne({ code: 'E2EFREE', discountValue: 100, userLimit: 0, expiryDate: new Date(Date.now() + 864e5), isActive: true, usageCount: 0 });
    const u3 = await makeUser(3);
    const free = await http.post(`${API}/payments/checkout`, { planId, coupon: 'E2EFREE' }, { headers: u3.headers });
    check('granted without payment', free.status === 200 && free.data.data.free === true, `free=${free.data?.data?.free}`);
    check('no payment row created', (await db().collection('payments').countDocuments({ user: u3.id })) === 0, '0 rows');
    check('coupon consumed once', (await db().collection('coupons').findOne({ code: 'E2EFREE' }))!.usageCount === 1, 'usageCount=1');

    console.log('\n5. the free endpoint refuses a paid plan');
    const u4 = await makeUser(4);
    const backdoor = await http.post(`${API}/subscriptions/subscribe`, { planId }, { headers: u4.headers });
    check('subscribe rejected', backdoor.status === 400, `HTTP ${backdoor.status}: ${backdoor.data?.message}`);
    check('nothing granted', (await db().collection('usersubscriptions').countDocuments({ user: u4.id })) === 0, '0 subscriptions');

    console.log('\n6. the gateway reports a failure');
    const u5 = await makeUser(5);
    const co5 = await http.post(`${API}/payments/checkout`, { planId }, { headers: u5.headers });
    const failed = await http.get(BASE + linkFor(await payPage(co5.data.data.url, co5.data.data.fields), 'outcome=failed'));
    const cb5 = await http.get(failed.headers.location as string);
    const p5 = await db().collection('payments').findOne({ trackId: co5.data.data.trackId });
    check('payment marked failed', p5!.status === 'failed' && p5!.creditsGranted !== true, `status=${p5!.status}`);
    check('customer sent to a failure page', !String(cb5.headers.location).includes('status=success'), String(cb5.headers.location));
    check('no credits for a failed payment', (await db().collection('usersubscriptions').countDocuments({ user: u5.id })) === 0, '0 subscriptions');

    await mongoose.disconnect();
    console.log(`\nknet-e2e: ${passed} checks passed\n`);
}

main().catch(async (error) => {
    console.error(`\n${error instanceof Error ? error.message : error}\n`);
    await mongoose.disconnect();
    process.exit(1);
});

import { Router, Request, Response } from 'express';
import { PaymentModel } from './models/payment.model';
import logger from '../../utils/logger';

const outcomes = new Map<string, 'success' | 'failed' | 'cancelled'>();

const STATUS = { success: '1', failed: '2', cancelled: '3' } as const;

const router = Router();

// 1. Authenticate
router.post('/ePay/api/cbk/online/pg/merchant/Authenticate', (req: Request, res: Response) => {
    const { ClientId, ENCRP_KEY } = req.body || {};
    if (!ClientId || !ENCRP_KEY) {
        return res.json({ Status: '0', Message: 'Invalid' });
    }
    res.json({ Status: '1', AccessToken: `mock-token-${Date.now()}` });
});

// 2. Hosted checkout page
router.post('/ePay/pg/epay', (req: Request, res: Response) => {
    const track = String(req.body.tij_MerchantPaymentTrack || '');
    const amount = String(req.body.tij_MerchantPaymentAmount || '0.000');
    const returnUrl = String(req.body.tij_MerchReturnUrl || '');
    const lang = String(req.body.tij_MerchantPaymentLang || 'en');

    if (!track || !returnUrl) {
        return res.status(400).send('TIJ0004 Invalid Merchant Track ID');
    }

    const link = (outcome: string, silent = false) => `/mock-knet/settle?track=${encodeURIComponent(track)}&outcome=${outcome}&return=${encodeURIComponent(returnUrl)}${silent ? '&silent=1' : ''}`;

    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mock KNET</title><style>
body{font:15px/1.5 system-ui,sans-serif;background:#f4f6f5;margin:0;display:grid;place-items:center;min-height:100vh}
.card{background:#fff;border:1px solid #dde5e2;border-radius:12px;padding:28px;max-width:400px;width:92%}
h1{font-size:17px;margin:0 0 4px}.warn{color:#9c2a24;font-size:12px;font-weight:600;margin:0 0 18px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0 0 22px;font-size:13px}
dt{color:#6b7a75}dd{margin:0;font-family:ui-monospace,Menlo,monospace;text-align:right}
a{display:block;text-align:center;text-decoration:none;padding:11px;border-radius:8px;margin-bottom:8px;font-weight:600;font-size:14px}
.ok{background:#00715b;color:#fff}.no{background:#fff;color:#9c2a24;border:1px solid #e4c9c7}
.gh{background:#fff;color:#6b7a75;border:1px solid #dde5e2;font-size:12.5px}
</style></head><body><div class="card">
<h1>Mock KNET checkout</h1>
<p class="warn">Test gateway — no real money moves.</p>
<dl><dt>Track ID</dt><dd>${track}</dd><dt>Amount</dt><dd>${amount} KWD</dd><dt>Language</dt><dd>${lang}</dd></dl>
<a class="ok" href="${link('success')}">Pay successfully</a>
<a class="no" href="${link('failed')}">Payment fails</a>
<a class="no" href="${link('cancelled')}">Cancel payment</a>
<a class="gh" href="${link('success', true)}">Pay, then close the tab (tests reconciliation)</a>
</div></body></html>`);
});

router.get('/settle', (req: Request, res: Response) => {
    const track = String(req.query.track || '');
    const outcome = String(req.query.outcome || 'success') as 'success' | 'failed' | 'cancelled';
    const returnUrl = String(req.query.return || '');

    outcomes.set(track, outcome);
    logger.warn(`[knet:mock] settled track=${track} outcome=${outcome}`);

    if (req.query.silent) {
        return res.send(
            `<body style="font:15px system-ui;padding:40px;max-width:460px">
             <h2 style="font-size:16px">Paid — and the customer vanished.</h2>
             <p style="color:#555">Track <code>${track}</code> is recorded as paid at the gateway, but no redirect was sent.
             The <code>reconcile pending payments</code> job runs every 5 minutes and will find it once the payment is
             older than 5 minutes. Watch the log for <code>[knet] payment settled</code>.</p></body>`
        );
    }

    res.redirect(`${returnUrl}?encrp=${encodeURIComponent(track)}`);
});

const transactionFor = async (track: string) => {
    const outcome = outcomes.get(track);

    // Unknown to the gateway yet — the real one answers -1, and reconcile leaves it pending.
    if (!outcome) return { Status: '-1', Message: 'Invalid' };

    const payment = await PaymentModel.findOne({ trackId: track });

    return {
        Status: STATUS[outcome],
        Message: outcome === 'success' ? 'Success' : outcome === 'cancelled' ? 'Expired/Cancelled' : 'Failed',
        Amount: payment ? payment.amount.toFixed(3) : '0.000',
        AuthCode: outcome === 'success' ? 'M123456' : '',
        PaymentId: outcome === 'success' ? `MOCKPAY${track.slice(-6)}` : '',
        PayType: 'KNET',
        ReceiptNo: outcome === 'success' ? `MOCK${track.slice(-8)}` : '',
        ReferenceId: outcome === 'success' ? `REF${track.slice(-6)}` : '',
        TrackId: track,
        TransactionId: outcome === 'success' ? `TXN${track.slice(-6)}` : '',
        PayId: track
    };
};

router.get('/ePay/api/cbk/online/pg/GetTransactions/:encrp/:token', async (req: Request, res: Response) => {
    res.json(await transactionFor(String(req.params.encrp)));
});

router.post('/ePay/api/cbk/online/pg/Verify', async (req: Request, res: Response) => {
    const { encrypmerch, authkey, payid } = req.body || {};
    if (!encrypmerch || !authkey) {
        return res.json({ Status: '0', Message: 'Invalid' });
    }
    res.json(await transactionFor(String(payid || '')));
});

export const isMockGatewayEnabled = (): boolean => process.env.KNET_MOCK === 'true' && process.env.NODE_ENV !== 'production';

export default router;

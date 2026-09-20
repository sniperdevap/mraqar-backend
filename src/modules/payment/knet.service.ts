import axios from 'axios';
import CustomError from '../../utils/custom-error';
import logger from '../../utils/logger';

export interface KnetCredentials {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    encrpKey: string;
}

export interface KnetTransaction {
    Status: string;
    Message?: string;
    Amount?: string;
    AuthCode?: string;
    PaymentId?: string;
    PayType?: string;
    ReceiptNo?: string;
    ReferenceId?: string;
    TrackId?: string;
    TransactionId?: string;
    PayId?: string;
}

export const KNET_STATUS = {
    INVALID_REF: '-1',
    INVALID_ACCESS: '0',
    SUCCESS: '1',
    FAILED: '2',
    CANCELLED: '3'
} as const;

const getCredentials = (): KnetCredentials => {
    const { KNET_BASE_URL, KNET_CLIENT_ID, KNET_CLIENT_SECRET, KNET_ENCRP_KEY } = process.env;

    if (!KNET_BASE_URL || !KNET_CLIENT_ID || !KNET_CLIENT_SECRET || !KNET_ENCRP_KEY) {
        throw new CustomError('KNET gateway is not configured', 500);
    }

    return {
        baseUrl: KNET_BASE_URL.replace(/\/+$/, ''),
        clientId: KNET_CLIENT_ID,
        clientSecret: KNET_CLIENT_SECRET,
        encrpKey: KNET_ENCRP_KEY
    };
};

const authHeader = (creds: KnetCredentials) => ({
    Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`
});

const http = axios.create({ timeout: 20000 });

export const safeUrl = (url = ''): string => url.replace(/(\/GetTransactions\/[^/]+\/).*/, '$1<token>').replace(/([?&]_v=)[^&]*/, '$1<token>');

const LOG_FIELDS = ['Status', 'Message', 'ErrorCode', 'PayId', 'TrackId', 'PayType', 'ReceiptNo', 'Amount'];

export const summarize = (data: unknown): string => {
    if (!data || typeof data !== 'object') return `body=<${typeof data}>`;
    const row = data as Record<string, unknown>;
    const pairs = LOG_FIELDS.filter((key) => row[key] !== undefined && row[key] !== '').map((key) => `${key}=${String(row[key])}`);
    return pairs.length ? pairs.join(' ') : 'body=<no status fields>';
};

const where = (config: { method?: string; url?: string } = {}) => `${String(config.method || 'req').toUpperCase()} ${safeUrl(config.url)}`;

http.interceptors.response.use(
    (res) => {
        logger.info(`[knet] ${where(res.config)} -> HTTP ${res.status} ${summarize(res.data)}`);
        return res;
    },
    (error) => {
        const res = error.response;

        if (res) {
            const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
            error.message = `${where(error.config)} -> HTTP ${res.status} ${res.statusText || ''} ${String(body || '<empty body>').slice(0, 500)}`.replace(/\s+/g, ' ').trim();
        } else {
            error.message = `${where(error.config)} -> ${error.code || 'no response'} ${error.message}`;
        }

        logger.error(`[knet] ${error.message}`);

        return Promise.reject(error);
    }
);

let cachedToken: { value: string; expiresAt: number } | null = null;

const TOKEN_TTL_MS = 5.5 * 60 * 60 * 1000;

export const getAccessToken = async (forceRefresh = false): Promise<string> => {
    if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
        return cachedToken.value;
    }

    const creds = getCredentials();

    const { data } = await http.post(
        `${creds.baseUrl}/ePay/api/cbk/online/pg/merchant/Authenticate`,
        {
            ClientId: creds.clientId,
            ClientSecret: creds.clientSecret,
            ENCRP_KEY: creds.encrpKey
        },
        { headers: { ...authHeader(creds), 'Content-Type': 'application/json' }, timeout: 20000 }
    );

    if (data?.Status !== '1' || !data?.AccessToken) {
        cachedToken = null;
        logger.error(`[knet] authenticate failed status=${data?.Status} message=${data?.Message}`);
        throw new CustomError('Payment gateway authentication failed', 502);
    }

    cachedToken = { value: data.AccessToken, expiresAt: Date.now() + TOKEN_TTL_MS };
    return cachedToken.value;
};

export const formatAmount = (amount: number): string => amount.toFixed(3);

export const generateTrackId = (): string => {
    const random = Math.random().toString(36).slice(2, 8);
    return `MA${Date.now().toString(36)}${random}`.toUpperCase().slice(0, 30);
};

export interface CheckoutParams {
    amount: number;
    trackId: string;
    lang?: 'en' | 'ar';
    reference?: string;
    userId?: string;
    returnUrl: string;
    kValidateMobile?: string;
    payType?: '1' | '2';
}

export const buildCheckout = async (params: CheckoutParams): Promise<{ url: string; fields: Record<string, string> }> => {
    const creds = getCredentials();
    const token = await getAccessToken();

    const fields: Record<string, string> = {
        tij_MerchantEncryptCode: creds.encrpKey,
        tij_MerchAuthKeyApi: token,
        tij_MerchantPaymentLang: params.lang === 'ar' ? 'ar' : 'en',
        tij_MerchantPaymentAmount: formatAmount(params.amount),
        tij_MerchantPaymentTrack: params.trackId,
        tij_MerchReturnUrl: params.returnUrl
    };

    if (params.reference) fields.tij_MerchantPaymentRef = sanitizeRef(params.reference);
    if (params.userId) fields.tij_MerchantUdf1 = params.userId.slice(0, 20);
    if (params.kValidateMobile) fields.tij_MerchantUdf4 = `CV ${params.kValidateMobile}`;
    if (params.payType) fields.tij_MerchPayType = params.payType;

    return { url: `${creds.baseUrl}/ePay/pg/epay?_v=${encodeURIComponent(token)}`, fields };
};

export const sanitizeRef = (value: string): string =>
    value
        .replace(/[^\p{L}\p{N}\-.& ]/gu, '')
        .trim()
        .slice(0, 30);

export const getTransactionByEncrp = async (encrp: string): Promise<KnetTransaction> => {
    const creds = getCredentials();

    const call = async (token: string) => {
        const { data } = await http.get(`${creds.baseUrl}/ePay/api/cbk/online/pg/GetTransactions/${encodeURIComponent(encrp)}/${encodeURIComponent(token)}`, {
            headers: authHeader(creds),
            timeout: 20000
        });
        return data as KnetTransaction;
    };

    let result = await call(await getAccessToken());

    if (result?.Status === KNET_STATUS.INVALID_ACCESS) {
        result = await call(await getAccessToken(true));
    }

    return result;
};

export const verifyByTrackId = async (trackId: string): Promise<KnetTransaction> => {
    const creds = getCredentials();

    const call = async (token: string) => {
        const { data } = await http.post(
            `${creds.baseUrl}/ePay/api/cbk/online/pg/Verify`,
            { encrypmerch: creds.encrpKey, authkey: token, payid: trackId },
            { headers: { ...authHeader(creds), 'Content-Type': 'application/json' }, timeout: 20000 }
        );
        return data as KnetTransaction;
    };

    let result = await call(await getAccessToken());

    if (result?.Status === KNET_STATUS.INVALID_ACCESS) {
        result = await call(await getAccessToken(true));
    }

    return result;
};

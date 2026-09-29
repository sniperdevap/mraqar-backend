import axios from 'axios';
import CustomError from '../../utils/custom-error';
import logger from '../../utils/logger';

export interface MfTransaction {
    TransactionStatus: string;
    PaymentGateway?: string;
    PaymentId?: string;
    ReferenceId?: string;
    TrackId?: string;
    TransactionId?: string;
    AuthorizationId?: string;
    Error?: string;
    ErrorCode?: string;
}

export interface MfInvoice {
    InvoiceId: number;
    InvoiceStatus: 'Pending' | 'Paid' | 'Canceled' | string;
    InvoiceReference?: string;
    CustomerReference?: string;
    InvoiceValue: number;
    InvoiceTransactions: MfTransaction[];
}

export interface SendPaymentParams {
    amount: number;
    itemName: string;
    customerName?: string;
    mobile?: string;
    trackId: string;
    userId: string;
    lang?: 'en' | 'ar';
}

const http = axios.create({ timeout: 20000 });

const post = async <T>(path: string, body: unknown): Promise<T> => {
    const { MYFATOORAH_API_KEY, MYFATOORAH_BASE_URL } = process.env;
    if (!MYFATOORAH_API_KEY) {
        throw new CustomError('MyFatoorah gateway is not configured', 500);
    }

    const baseUrl = (MYFATOORAH_BASE_URL || 'https://apitest.myfatoorah.com').replace(/\/+$/, '');

    try {
        const { data } = await http.post(`${baseUrl}${path}`, body, {
            headers: { Authorization: `Bearer ${MYFATOORAH_API_KEY}`, 'Content-Type': 'application/json' }
        });
        if (!data?.IsSuccess) {
            logger.error(`[myfatoorah] ${path} failed: ${data?.Message} ${JSON.stringify(data?.ValidationErrors || '')}`);
            throw new CustomError('Payment gateway error', 502);
        }
        return data.Data as T;
    } catch (error) {
        if (error instanceof CustomError) throw error;
        const res = axios.isAxiosError(error) ? error.response : undefined;
        logger.error(`[myfatoorah] ${path} -> ${res ? `HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 500)}` : error instanceof Error ? error.message : 'unknown error'}`);
        throw new CustomError('Payment gateway error', 502);
    }
};

export const round3 = (x: number) => Number(x.toFixed(3));

export const sendPayment = (params: SendPaymentParams) => {
    const amount = round3(params.amount);
    const mobile = params.mobile?.replace(/\D/g, '').replace(/^(00)?965/, '').slice(0, 11);

    return post<{ InvoiceId: number; InvoiceURL: string }>('/v2/SendPayment', {
        NotificationOption: 'LNK',
        InvoiceValue: amount,
        InvoiceItems: [{ ItemName: params.itemName.slice(0, 100), Quantity: 1, UnitPrice: amount }],
        CustomerName: (params.customerName || 'Customer').slice(0, 100),
        ...(mobile && { MobileCountryCode: '+965', CustomerMobile: mobile }),
        CustomerReference: params.trackId,
        UserDefinedField: params.userId,
        DisplayCurrencyIso: 'KWD',
        Language: params.lang === 'ar' ? 'ar' : 'en',
        CallBackUrl: process.env.MYFATOORAH_CALLBACK_URL,
        ErrorUrl: process.env.MYFATOORAH_CALLBACK_URL
    });
};

export const getPaymentStatus = (key: string, keyType: 'PaymentId' | 'InvoiceId') => post<MfInvoice>('/v2/GetPaymentStatus', { Key: key, KeyType: keyType });

export const isSuccessful = (txn?: MfTransaction) => txn?.TransactionStatus === 'Succss' || txn?.TransactionStatus === 'Success';

export const generateTrackId = (): string => ('MA' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();

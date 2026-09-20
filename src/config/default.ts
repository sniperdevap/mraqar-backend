import dotenv from 'dotenv';
import CustomError from '../utils/custom-error';

dotenv.config();

if (!process.env.CLIENT_URL || !process.env.JWT_SECRET) {
    throw new CustomError('Missing required environment variables', 500);
}

const config = {
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 5000,
    baseRoute: '/api/v1',
    db: {
        uri: process.env.MONGO_URI || 'mongodb://localhost:27017/sniper'
    },
    clientUrl: process.env.CLIENT_URL, //required
    jwtSecret: process.env.JWT_SECRET, //required
    emailClient: {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        senderName: process.env.SMTP_SENDER_NAME || 'Sniper',
        senderEmail: process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER
    },
    adminEmail: process.env.ADMIN_EMAIL || process.env.SUPER_ADMIN_EMAIL,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    knet: {
        baseUrl: process.env.KNET_BASE_URL,
        clientId: process.env.KNET_CLIENT_ID,
        clientSecret: process.env.KNET_CLIENT_SECRET,
        encrpKey: process.env.KNET_ENCRP_KEY,
        returnUrl: process.env.KNET_RETURN_URL,
        payType: process.env.KNET_PAY_TYPE, // 1 = KNET, 2 = T-Pay QR, empty = show selection page
        kValidate: process.env.KNET_K_VALIDATE === 'true'
    },
    R2_ENDPOINT: process.env.R2_ENDPOINT,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    sms: {
        apiUrl: process.env.DEZSMS_API_URL,
        apiKey: process.env.DEZSMS_API_KEY,
        dezSmsId: process.env.DEZSMS_ID,
        senderId: process.env.DEZSMS_SENDER_ID
    }
};

export default config;

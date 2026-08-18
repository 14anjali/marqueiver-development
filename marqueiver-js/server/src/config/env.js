import dotenv from 'dotenv';
dotenv.config();
const bool = (v, def = false) => v == null ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
;
export const env = {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 4000),
    clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
    apiUrl: process.env.API_URL ?? 'http://localhost:4000',
    mongoUri: process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/marqueiver',
    useMemoryDb: bool(process.env.USE_MEMORY_DB,false),
    atlasRegion: process.env.ATLAS_REGION ?? 'ap-south-1',
    appRegion: process.env.APP_REGION ?? 'ap-south-1',
    jwt: {
        accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret',
        refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev_refresh_secret',
        accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
        refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
    },
    otpTtlSeconds: Number(process.env.OTP_TTL_SECONDS ?? 300),
    integrationMode: (process.env.INTEGRATION_MODE ?? 'mock'),
    aiProvider: (process.env.AI_PROVIDER ?? 'live'),
    emailProvider: process.env.EMAIL_PROVIDER ?? 'resend',
emailFrom: process.env.EMAIL_FROM ?? 'onboarding@resend.dev',
resendApiKey: process.env.RESEND_API_KEY ?? '',
    storageProvider: (process.env.STORAGE_PROVIDER ?? 'mock'),
    twilio: {
        sid: process.env.TWILIO_ACCOUNT_SID ?? '',
        token: process.env.TWILIO_AUTH_TOKEN ?? '',
        verifySid: process.env.TWILIO_VERIFY_SID ?? '',
        whatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? '',
        smsFrom: process.env.TWILIO_SMS_FROM ?? '',
    },
    cashfree: {
        clientId: process.env.CASHFREE_CLIENT_ID ?? '',
        clientSecret: process.env.CASHFREE_CLIENT_SECRET ?? '',
        apiVersion: process.env.CASHFREE_API_VERSION ?? '2023-08-01',
        mode: process.env.CASHFREE_MODE ?? 'sandbox', // sandbox | production
        webhookSecret: process.env.CASHFREE_WEBHOOK_SECRET ?? '',
        // Cashfree Payouts is a separate product/credential pair from the
        // Payment Gateway above — used for creator wallet withdrawals.
        payoutClientId: process.env.CASHFREE_PAYOUT_CLIENT_ID ?? '',
        payoutClientSecret: process.env.CASHFREE_PAYOUT_CLIENT_SECRET ?? '',
    },
    openaiKey: process.env.OPENAI_API_KEY ?? '',
    geminiKey: process.env.GEMINI_API_KEY ?? '',
  facebook: {
    appId: process.env.FACEBOOK_APP_ID ?? '',
    appSecret: process.env.FACEBOOK_APP_SECRET ?? '',
    graphVersion: process.env.FACEBOOK_GRAPH_VERSION ?? 'v23.0',
    redirectUri: process.env.FACEBOOK_REDIRECT_URI ?? '',
  },
    instagram: {
        appId: process.env.INSTAGRAM_APP_ID ?? '',
  appSecret: process.env.INSTAGRAM_APP_SECRET ?? '',
        redirectUri: process.env.INSTAGRAM_REDIRECT_URI
            ?? `${process.env.API_URL ?? 'http://localhost:4000'}/api/auth/instagram/callback`,
    },
  
    google: {
       clientId: process.env.YOUTUBE_CLIENT_ID?? '',
  clientSecret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
  redirectUri:
    process.env.YOUTUBE_REDIRECT_URI ??
    `${process.env.API_URL ?? 'http://localhost:4000'}/api/auth/youtube/callback`,
    },
};
/**
 * Proposal §4.1: "a region mismatch was the biggest performance incident in the
 * current system; we will not repeat it." We warn loudly rather than crash.
 */
export function assertRegionAlignment(logger) {
    if (env.atlasRegion !== env.appRegion) {
        logger.warn(`⚠  REGION MISMATCH: APP_REGION=${env.appRegion} but ATLAS_REGION=${env.atlasRegion}. ` +
            `Cross-region DB latency will hurt every request. Align these before production.`);
    }
}

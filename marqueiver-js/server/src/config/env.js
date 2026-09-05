import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Load `.env` from the server package, not from wherever the process happened
 * to be started.
 *
 * `dotenv.config()` with no path resolves `.env` against `process.cwd()`. That
 * is fine when the server is started from `marqueiver-js/server`, and silently
 * loads *nothing* when it is started from the repository root, from
 * `marqueiver-js`, or by an IDE run configuration with a different working
 * directory — no error, no warning, just an app running entirely on defaults.
 * Anchoring the path to this file's own location removes that class of failure:
 * the same `.env` is read no matter where `npm run dev` is invoked from.
 *
 * `envFile` is exported so the boot diagnostics can state which file was
 * actually read, and whether it existed at all.
 */
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_PATH = process.env.DOTENV_PATH ?? path.join(SERVER_ROOT, '.env');

const result = dotenv.config({ path: ENV_PATH });

export const envFile = {
    path: ENV_PATH,
    exists: fs.existsSync(ENV_PATH),
    // dotenv never overrides a variable already present in the real
    // environment, so a value set by the shell or the host wins over the file.
    loadedKeys: result.parsed ? Object.keys(result.parsed).length : 0,
    error: result.error ? String(result.error.message) : null,
};

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
    /**
     * OTP lifecycle. These are policy-shaped numbers, not magic constants: a
     * code that never expires, or that can be guessed indefinitely, is not a
     * verification. All four are enforced in otp.service.js and surfaced to the
     * client as distinct error codes so the UI can say what actually happened.
     */
    otp: {
        ttlSeconds: Number(process.env.OTP_TTL_SECONDS ?? 300),
        length: Number(process.env.OTP_LENGTH ?? 6),
        maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
        resendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 30),
        maxResends: Number(process.env.OTP_MAX_RESENDS ?? 3),
        lockoutSeconds: Number(process.env.OTP_LOCKOUT_SECONDS ?? 900),
    },
    /** Kept for backward compatibility with existing callers. */
    otpTtlSeconds: Number(process.env.OTP_TTL_SECONDS ?? 300),

    /**
     * Whether a collaboration requires BOTH a verified mobile and a verified
     * email (Policy V2 clause 13.1), or just one verified identity.
     *
     * Off by default, which matches what signup promises: any one of Google,
     * email OTP or WhatsApp OTP creates a usable account. Turn it on when the
     * policy owner confirms 13.1 should bind — it gates deal and payment
     * actions only, never sign-in, so a user who hits it can still reach their
     * account and add the second channel.
     */
    requireDualVerification: bool(process.env.REQUIRE_DUAL_VERIFICATION, false),

    /**
     * MSG91 — WhatsApp OTP delivery. Phone verification runs over WhatsApp only;
     * there is deliberately no SMS fallback, because a silent downgrade to SMS
     * would send a verification code over a channel the product does not claim
     * to use. Missing credentials in live mode fail loudly instead.
     *
     * `verifyWith` decides who owns the OTP lifecycle:
     *   'local'  (default) — we generate the code, MSG91 delivers it, and expiry,
     *                        attempt caps and resend limits are enforced here.
     *   'msg91'            — MSG91 generates and verifies; we hold only the
     *                        request state.
     * Local is the default because the lifecycle rules above are ours to
     * enforce and must behave identically in mock and live mode.
     */
    msg91: {
        authKey: process.env.MSG91_AUTH_KEY ?? '',
        templateId: process.env.MSG91_WHATSAPP_TEMPLATE_ID ?? '',
        senderId: process.env.MSG91_SENDER_ID ?? '',
        otpVarName: process.env.MSG91_OTP_VAR_NAME ?? 'otp',
        baseUrl: process.env.MSG91_BASE_URL ?? 'https://control.msg91.com/api/v5',
        verifyWith: (process.env.MSG91_VERIFY_WITH ?? 'local').toLowerCase(),
        defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE ?? '91',
        timeoutMs: Number(process.env.MSG91_TIMEOUT_MS ?? 10_000),
    },

    /**
     * Google Sign-In. `clientId` is the audience every id_token is checked
     * against — without it a token minted for any other Google app would be
     * accepted, so live mode refuses to verify when it is unset.
     */
    googleAuth: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        redirectUri: process.env.GOOGLE_REDIRECT_URI
            ?? `${process.env.API_URL ?? 'http://localhost:4000'}/api/auth/google/callback`,
    },

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

    /**
     * Facebook Login **for Business** configuration id.
     *
     * Set this only if the app uses Login for Business, where the dashboard
     * configuration carries the permission list and the OAuth dialog takes
     * `config_id` — `scope` is ignored in that flow, so sending it yields a
     * consent screen that grants nothing and Page calls that then fail with
     * "permission missing", which reads like a permissions bug rather than the
     * configuration mistake it is.
     *
     * Leave empty for classic Facebook Login and the scope list in
     * facebook.service.js is used instead.
     */
    configId: process.env.FACEBOOK_CONFIG_ID ?? '',
  },

  /**
   * Meta Graph credentials for `meta.service.js` (`fetchSocialStats`).
   *
   * This block did not exist, and `meta.service.js` line 9 read
   * `env.meta.appId` regardless — which is the Render boot crash:
   *
   *   if (env.integrationMode === 'mock' || !env.meta.appId)
   *
   * `||` short-circuits, so with INTEGRATION_MODE unset (it defaults to 'mock')
   * the left side is true and the right side is never evaluated. Every local run
   * and every test therefore passed over a line that could not work. Render sets
   * INTEGRATION_MODE=live, the left side became false, and reading `.appId` off
   * `undefined` threw before the HTTP server was ever created.
   *
   * No new Render variable is introduced here: `fetchSocialStats` talks to the
   * Meta Graph API, and the Meta app credentials this project already
   * configures are the Facebook ones. Deriving the value keeps one source of
   * truth rather than adding a second pair that could drift out of step with it.
   */
  get meta() {
    return { appId: this.facebook.appId, appSecret: this.facebook.appSecret };
  },
    instagram: {
        appId: process.env.INSTAGRAM_APP_ID ?? '',
  appSecret: process.env.INSTAGRAM_APP_SECRET ?? '',
        /**
         * Version prefix for graph.instagram.com, e.g. 'v23.0'.
         *
         * Empty by default, and that is a decision rather than an omission: the
         * Instagram-Login endpoints are documented unversioned
         * (`https://graph.instagram.com/me`), and a version segment the host
         * does not recognise is read as a *node id* — which is exactly what
         * produced `IGApiException code 100 "Unsupported request - method
         * type: get"` in production against `/v22.0/me`.
         *
         * Set this only to pin a version you have confirmed works. The client
         * falls back to the unversioned path either way and logs when it had
         * to, so a wrong value degrades to a warning instead of an outage.
         */
        graphVersion: (process.env.INSTAGRAM_GRAPH_VERSION ?? '').trim().replace(/^\/+|\/+$/g, ''),
        redirectUri: process.env.INSTAGRAM_REDIRECT_URI
            ?? `${process.env.API_URL ?? 'http://localhost:4000'}/api/auth/instagram/callback`,

        /**
         * Run the token diagnostics when a profile read fails.
         *
         * **On by default**, deliberately. This was opt-in behind
         * INSTAGRAM_DIAGNOSTICS=1 for two releases, and in both the connect was
         * retried without the flag set — so the failure reproduced and produced
         * no evidence, and the next step was another guess. Diagnostics nobody
         * remembers to switch on are diagnostics that do not exist.
         *
         * The cost is bounded and paid only on a path that has already failed:
         * a handful of extra requests on a connect that was going to error
         * anyway. Set INSTAGRAM_DIAGNOSTICS=0 to silence it once the
         * integration is healthy.
         */
        diagnostics: bool(process.env.INSTAGRAM_DIAGNOSTICS, true),
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
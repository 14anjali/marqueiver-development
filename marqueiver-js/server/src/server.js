import http from 'http';
import { startScheduler } from './jobs/policyJobs.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { initSocket } from './modules/messaging/messaging.gateway.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { seedIfEmpty, seedPolicies } from './utils/seed.js';
async function main() {
    await connectDb();
    await seedIfEmpty(); // load sample data on first boot only
    await seedPolicies(); // Policy 24 — versions must exist before they can be accepted
    const app = createApp();
    const server = http.createServer(app);
    initSocket(server);
    server.listen(env.port, () => {
        logger.info(`🚀 Marqueiver API on http://localhost:${env.port} (${env.nodeEnv})`);
        logger.info(`   Integration mode: ${env.integrationMode} · AI: ${env.aiProvider}`);
        reportAuthProviders();
        // Policy 5.3 / 5.5 — review reminders, automatic completion, option C.
        startScheduler();
    });
    const shutdown = async () => {
        logger.info('Shutting down…');
        server.close(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
/**
 * Say plainly, at boot, whether this process can actually reach real users.
 *
 * "Why is email not working" is answerable from these four lines rather than by
 * reading the code: in mock mode nothing leaves the process and codes are
 * logged; in live mode each provider is either configured or it names the
 * variables it is missing. Only variable *names* are printed, never values.
 */
async function reportAuthProviders() {
    const { msg91ConfigStatus } = await import('./services/msg91.service.js');
    const { googleConfigStatus } = await import('./services/googleAuth.service.js');
    const { emailConfigStatus } = await import('./services/email.service.js');

    if (env.integrationMode !== 'live') {
        logger.warn('   ⚠  MOCK MODE — no email, WhatsApp or Google request leaves this process.');
        logger.warn('      OTPs are logged and returned to the client as `devCode`.');
        logger.warn('      Set INTEGRATION_MODE=live to use the real providers.');
        return;
    }

    const email = emailConfigStatus();
    const msg91 = msg91ConfigStatus();
    const google = googleConfigStatus();
    const mark = (s) => (s.configured ? '✅' : '❌');

    logger.info('   LIVE MODE — real providers:');
    logger.info(`     ${mark(email)} Email    ${email.provider}`
        + (email.configured ? ` · from ${env.emailFrom}` : ` · missing ${email.missing.join(', ')}`));
    logger.info(`     ${mark(msg91)} WhatsApp MSG91`
        + (msg91.configured ? '' : ` · missing ${msg91.missing.join(', ')}`));
    logger.info(`     ${mark(google)} Google   OAuth`
        + (google.configured ? '' : ` · missing ${google.missing.join(', ')}`));

    if (email.sandboxSender) {
        logger.warn('     ⚠  EMAIL_FROM is Resend\'s sandbox sender — it delivers ONLY to the '
            + 'Resend account owner. Every other recipient is accepted and dropped.');
    }
}

main().catch((e) => {
    logger.error('Fatal boot error', e);
    process.exit(1);
});

import http from 'http';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { initSocket } from './modules/messaging/messaging.gateway.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { seedIfEmpty } from './utils/seed.js';
async function main() {
    await connectDb();
    await seedIfEmpty(); // load sample data on first boot only
    const app = createApp();
    const server = http.createServer(app);
    initSocket(server);
    server.listen(env.port, () => {
        logger.info(`🚀 Marqueiver API on http://localhost:${env.port} (${env.nodeEnv})`);
        logger.info(`   Integration mode: ${env.integrationMode} · AI: ${env.aiProvider}`);
    });
    const shutdown = async () => {
        logger.info('Shutting down…');
        server.close(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
main().catch((e) => {
    logger.error('Fatal boot error', e);
    process.exit(1);
});

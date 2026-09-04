import mongoose from 'mongoose';
import { env, assertRegionAlignment } from './env.js';
import { logger } from './logger.js';
/**
 * Tracks whether the connected server supports multi-document transactions.
 * Standalone mongod (and the default memory server) does NOT — the deal engine
 * degrades gracefully to sequential writes in that case (dev only). In production
 * (Atlas replica set) transactions are always available. Proposal §7.
 */
export let transactionsSupported = false;
export async function connectDb() {
    assertRegionAlignment(logger);
    let uri = env.mongoUri;
    if (env.useMemoryDb) {
        try {
            // Optional dep — only pulled in when USE_MEMORY_DB=true.
            const { MongoMemoryReplSet } = await import('mongodb-memory-server');
            const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
            uri = replSet.getUri();
            transactionsSupported = true;
            logger.info('🧪 Using in-memory MongoDB replica set (transactions enabled)');
        }
        catch {
            logger.warn('USE_MEMORY_DB=true but mongodb-memory-server not installed; ' +
                'falling back to MONGO_URI. Run `npm install` to enable it.');
        }
    }
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    if (!env.useMemoryDb) {
        // Detect replica set (transactions require one).
        try {
            const admin = mongoose.connection.db.admin();
            const status = await admin.command({ hello: 1 });
            transactionsSupported = Boolean(status.setName);
        }
        catch {
            transactionsSupported = false;
        }
    }
    logger.info(`✅ MongoDB connected (transactions ${transactionsSupported ? 'ON' : 'OFF — standalone'})`);
}
export async function disconnectDb() {
    await mongoose.disconnect();
}

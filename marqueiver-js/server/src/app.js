import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import api from './routes.js';
import { errorHandler, notFound } from './middleware/error.js';
import { transactionsSupported } from './config/db.js';
export function createApp() {
    const app = express();
    app.set('trust proxy', 1);
    app.use(helmet());
    app.use(cors({ origin: env.clientUrl, credentials: true }));
    app.use(compression());
    // Capture the raw body alongside the parsed one — Cashfree webhook
    // signature verification (payments.controller.js) needs the exact bytes
    // Cashfree signed, which JSON.stringify(req.body) cannot reliably
    // reproduce (key order/whitespace can differ from the wire payload).
    app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
    app.use(express.urlencoded({ extended: true }));
    if (env.nodeEnv !== 'test')
        app.use(morgan('dev'));
    // Global rate limit (proposal §4 — rate limiting layer).
    app.use('/api', rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));
    app.get('/health', (_req, res) => res.json({
        ok: true,
        service: 'marqueiver-api',
        integrationMode: env.integrationMode,
        aiProvider: env.aiProvider,
        transactions: transactionsSupported,
        time: new Date().toISOString(),
    }));
    app.use('/api', api);
    app.use(notFound);
    app.use(errorHandler);
    return app;
}

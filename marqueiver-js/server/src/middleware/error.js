import { ApiError } from '../utils/apiError.js';
import { logger } from '../config/logger.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err, _req, res, _next) {
    if (err instanceof ApiError) {
        return res.status(err.status).json({
            ok: false,
            error: { code: err.code, message: err.message, details: err.details },
        });
    }
    // Mongoose duplicate key
    if (typeof err === 'object' && err && err.code === 11000) {
        return res.status(409).json({
            ok: false,
            error: { code: 'CONFLICT', message: 'Duplicate value', details: err.keyValue },
        });
    }
    logger.error('Unhandled error', err);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong' } });
}
export function notFound(_req, res) {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

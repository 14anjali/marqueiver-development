import { ApiError } from '../utils/apiError.js';
/** Zod validation middleware (proposal §4 — Zod at the API boundary). */
export const validate = (schema, source = 'body') => (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
        return next(ApiError.badRequest('Validation failed', result.error.flatten()));
    }
    req[source] = result.data;
    next();
};

export class ApiError extends Error {
    status;
    code;
    details;
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
    static badRequest(msg, details) {
        return new ApiError(400, 'BAD_REQUEST', msg, details);
    }
    static unauthorized(msg = 'Not authenticated') {
        return new ApiError(401, 'UNAUTHORIZED', msg);
    }
    static forbidden(msg = 'Not permitted') {
        return new ApiError(403, 'FORBIDDEN', msg);
    }
    static notFound(msg = 'Not found') {
        return new ApiError(404, 'NOT_FOUND', msg);
    }
    /**
     * `details` was missing here while `badRequest` and `unprocessable` both
     * take it, so a 409 could say what went wrong but never which record it
     * collided with — and "you already have one of these" is precisely the
     * error a caller wants to link to. Optional, so existing callers are
     * unaffected.
     */
    static conflict(msg, details) {
        return new ApiError(409, 'CONFLICT', msg, details);
    }
    static unprocessable(msg, details) {
        return new ApiError(422, 'UNPROCESSABLE', msg, details);
    }
}
/** Wrap async route handlers so thrown/rejected errors reach the error middleware. */
export const catchAsync = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
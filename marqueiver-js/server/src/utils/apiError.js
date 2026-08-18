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
    static conflict(msg) {
        return new ApiError(409, 'CONFLICT', msg);
    }
    static unprocessable(msg, details) {
        return new ApiError(422, 'UNPROCESSABLE', msg, details);
    }
}
/** Wrap async route handlers so thrown/rejected errors reach the error middleware. */
export const catchAsync = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

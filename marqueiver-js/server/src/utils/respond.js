export function ok(res, data, meta, status = 200) {
    res.status(status).json({ ok: true, data, ...(meta ? { meta } : {}) });
}
export function created(res, data) {
    ok(res, data, undefined, 201);
}

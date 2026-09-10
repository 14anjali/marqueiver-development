function log(level, msg, meta) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${level.toUpperCase()} ${msg}`;
    if (meta !== undefined)
        console[level === 'debug' ? 'log' : level](line, meta);
    else
        console[level === 'debug' ? 'log' : level](line);
}
export const logger = {
    info: (m, meta) => log('info', m, meta),
    warn: (m, meta) => log('warn', m, meta),
    error: (m, meta) => log('error', m, meta),
    debug: (m, meta) => log('debug', m, meta),
};

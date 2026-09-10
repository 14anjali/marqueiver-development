/**
 * Auth coverage.
 *
 * Boots the app and, for every mounted route, reports whether an
 * `authenticate` layer sits in front of it. This is the check that would have
 * caught both holes found in this audit — `GET /auth/instagram` mounted without
 * `authenticate`, and `POST /admin/bootstrap` mounted above the admin auth wall.
 *
 * Route handlers are read by function name off the middleware stack, so it sees
 * the real composed chain rather than what the routes file appears to say.
 */
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.INTEGRATION_MODE = 'mock';

const SERVER = process.argv[2];
const { createApp } = await import(path.join(SERVER, 'src/app.js'));
const app = createApp();

/**
 * Routes that are legitimately public, with the reason.
 *
 * An allowlist rather than a heuristic: "it has the word callback in it" is how
 * an unauthenticated route sneaks in. Anything not listed here and not
 * authenticated is reported.
 */
const PUBLIC = new Map([
  ['GET /health', 'liveness probe'],
  ['GET /api/auth/config', 'which login methods this environment offers'],
  ['POST /api/auth/otp/whatsapp/send', 'pre-login'],
  ['POST /api/auth/otp/whatsapp/resend', 'pre-login'],
  ['POST /api/auth/otp/email/send', 'pre-login'],
  ['POST /api/auth/otp/email/resend', 'pre-login'],
  ['POST /api/auth/otp/verify', 'pre-login'],
  ['POST /api/auth/google/verify', 'pre-login'],
  ['GET /api/auth/google/start', 'pre-login'],
  ['GET /api/auth/google/callback', 'provider redirect — no session yet'],
  ['GET /api/auth/signup/requirements', 'pre-signup'],
  ['POST /api/auth/signup', 'creates the session'],
  ['POST /api/auth/login', 'creates the session'],
  ['POST /api/auth/refresh', 'the refresh token IS the credential'],
  ['GET /api/auth/instagram/callback', 'provider redirect — user recovered from signed state'],
  ['GET /api/auth/facebook/callback', 'provider redirect — user recovered from signed state'],
  ['GET /api/auth/youtube/callback', 'provider redirect — user recovered from signed state'],
  ['POST /api/auth/instagram/deauthorize', 'Meta signed_request, HMAC-verified'],
  ['POST /api/auth/facebook/deauthorize', 'Meta signed_request, HMAC-verified'],
  ['POST /api/auth/instagram/data-deletion', 'Meta signed_request, HMAC-verified'],
  ['POST /api/auth/facebook/data-deletion', 'Meta signed_request, HMAC-verified'],
  ['GET /api/data-deletion/status/:code', 'opaque code, no PII, required by Meta'],
  ['POST /api/payments/webhook', 'Cashfree webhook, HMAC-verified'],
  ['GET /api/policies', 'published policy documents'],
  ['GET /api/policies/:slug', 'published policy documents'],
]);

const AUTH_NAMES = new Set(['authenticate']);
const ROLE_NAMES = new Set(['requireRole', 'requireAdminLevel', 'requireApprovedAdmin', 'brandsOnly']);

const rows = [];
function walk(stack, prefix = '', inherited = []) {
  for (const layer of stack) {
    if (layer.route) {
      const p = (prefix + layer.route.path).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
      const own = layer.route.stack.map((s) => s.name);
      const chain = [...inherited, ...own];
      for (const [m, on] of Object.entries(layer.route.methods)) {
        if (!on) continue;
        rows.push({
          key: `${m.toUpperCase()} ${p}`,
          authed: chain.some((n) => AUTH_NAMES.has(n)),
          roled: chain.filter((n) => ROLE_NAMES.has(n)),
        });
      }
    } else if (layer.handle?.stack) {
      const src = layer.regexp?.source ?? '';
      const mm = src.match(/^\^\\\/(?:\(\?:\)\?)?((?:[\w\-.~%]|\\\/)*)/);
      const mounted = mm ? '/' + mm[1].replace(/\\\//g, '/') : '';
      walk(layer.handle.stack, (prefix + mounted).replace(/\/+/g, '/').replace(/\/$/, ''), inherited);
    } else if (AUTH_NAMES.has(layer.name) || ROLE_NAMES.has(layer.name)) {
      // `router.use(authenticate)` — applies to everything declared after it.
      inherited.push(layer.name);
    }
  }
}
walk(app._router?.stack ?? app.router?.stack ?? []);

const unguarded = rows.filter((r) => !r.authed && !PUBLIC.has(r.key));
const staleAllow = [...PUBLIC.keys()].filter((k) => !rows.some((r) => r.key === k));

console.log(`routes            : ${rows.length}`);
console.log(`authenticated     : ${rows.filter((r) => r.authed).length}`);
console.log(`role-gated        : ${rows.filter((r) => r.roled.length).length}`);
console.log(`public by design  : ${rows.length - rows.filter((r) => r.authed).length - unguarded.length}`);
console.log();

if (unguarded.length) {
  console.log(`### UNAUTHENTICATED AND NOT ALLOWLISTED (${unguarded.length})`);
  for (const r of unguarded) console.log(`  ${r.key}`);
  console.log();
}

if (staleAllow.length) {
  console.log(`### ALLOWLIST ENTRIES FOR ROUTES THAT NO LONGER EXIST (${staleAllow.length})`);
  for (const k of staleAllow) console.log(`  ${k}`);
  console.log();
}

console.log(unguarded.length ? `FAIL — ${unguarded.length} unguarded route(s)` : 'PASS — every route is authenticated or deliberately public');

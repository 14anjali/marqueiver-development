import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';

// Dynamic imports: config/env.js snapshots process.env at module load, and
// static imports are hoisted above the assignments above.
const {
    signAccess, verifyAccess, signRefresh, verifyRefresh,
    signVerification, verifyVerification,
} = await import('../src/utils/tokens.js');

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (p) => readFileSync(path.join(SRC, p), 'utf8');

/**
 * The security regressions found in the production audit.
 *
 * Each test here corresponds to a finding that reached production. They are
 * deliberately blunt — most assert a single property that, had it held, would
 * have prevented the incident. The point is not coverage; it is that these
 * specific mistakes cannot be made again silently.
 */

/* ────────────── F-6 · verification tokens are not session tokens ───────────── */

test('a verification token is rejected wherever a session token is expected', () => {
    // Obtainable by anyone who can receive an OTP at any address — no account,
    // no password. Both token families are signed with the SAME secret, so the
    // signature check alone cannot tell them apart; only the `typ` claim can.
    const verification = signVerification({ channel: 'email', identifier: 'someone@example.com' });

    assert.throws(() => verifyAccess(verification), /Not a session token/);
});

test('a session token with no subject is rejected', () => {
    // A token that verifies but carries no `sub` used to yield `claims.sub ===
    // undefined`, which then reached persistProfile() and the socket room name.
    const subjectless = signAccess({ role: 'creator' });

    assert.throws(() => verifyAccess(subjectless), /no subject/);
});

test('a real session token still verifies and keeps its claims', () => {
    const token = signAccess({ sub: 'user-1', role: 'brand', adminLevel: undefined });
    const claims = verifyAccess(token);

    assert.equal(claims.sub, 'user-1');
    assert.equal(claims.role, 'brand');
});

test('an access token is still rejected where a verification token is expected', () => {
    // The guard that already existed, asserted so the pair stays symmetric.
    const access = signAccess({ sub: 'user-1', role: 'creator' });

    assert.throws(() => verifyVerification(access), /Not a verification token/);
});

test('the Instagram consent route authenticates, like its Facebook and YouTube siblings', () => {
    // This route read the bearer string itself and never verified the
    // signature, so the token later trusted by the callback to identify the
    // Marq user was unchecked at the point it was issued.
    const routes = read('modules/instagram/instagram.routes.js');
    const consent = routes.slice(routes.indexOf("'/auth/instagram'"));

    assert.match(consent.slice(0, 200), /authenticate/,
        'GET /auth/instagram must pass through the authenticate middleware');
});

/* ─────────────────── F-7 · refresh tokens can be revoked ──────────────────── */

test('a refresh token carries the account token version it was issued under', () => {
    const claims = verifyRefresh(signRefresh('user-1', 7));

    assert.equal(claims.sub, 'user-1');
    assert.equal(claims.tv, 7, 'without `tv` there is nothing for logout to invalidate');
});

test('tokens issued under different versions are distinguishable', () => {
    // Logout increments the account counter; every token stamped with an
    // earlier value must become identifiable as stale.
    const before = verifyRefresh(signRefresh('user-1', 3));
    const after = verifyRefresh(signRefresh('user-1', 4));

    assert.notEqual(before.tv, after.tv);
});

test('a legacy refresh token with no version is treated as version 0', () => {
    // Tokens minted before this field existed must keep working for accounts
    // that have never logged out, or deploying the change signs everybody out.
    const legacy = verifyRefresh(signRefresh('user-1'));

    assert.equal(legacy.tv ?? 0, 0);
});

test('logout is authenticated and revokes by incrementing, not overwriting', () => {
    const routes = read('modules/auth/auth.routes.js');
    const controller = read('modules/auth/auth.controller.js');

    assert.match(routes, /router\.post\('\/logout',\s*authenticate/,
        'an unauthenticated logout taking a user id would let anyone sign anyone out');
    assert.match(controller, /\$inc:\s*\{\s*tokenVersion:\s*1\s*\}/,
        'read-modify-write races when two devices sign out at once');
});

test('the refresh handler compares the token version before issuing', () => {
    const controller = read('modules/auth/auth.controller.js');
    const handler = controller.slice(controller.indexOf('export const refresh'));

    assert.match(handler.slice(0, 1600), /tokenVersion/,
        'a signature check proves the server issued the token, not that it is still valid');
});

test('tokenVersion is declared on the User schema', () => {
    // Mongoose runs in strict mode: an undeclared path is dropped on write, so
    // an unlisted counter would appear to increment and never persist. This
    // project has already lost data twice to exactly that.
    assert.match(read('models/User.js'), /tokenVersion:\s*\{\s*type:\s*Number/);
});

/* ──────────────── F-2 · admin bootstrap is not a production route ──────────── */

test('admin bootstrap refuses to run in production', () => {
    const controller = read('modules/admin/admin.controller.js');
    const handler = controller.slice(controller.indexOf('export const bootstrapAdmin'));

    assert.match(handler.slice(0, 400), /nodeEnv === 'production'/,
        'this route is mounted before authenticate and mints a super-admin token pair');
});

test('admin bootstrap is still the only route outside the admin auth wall', () => {
    // If another route is ever added above `router.use(authenticate, ...)`, it
    // inherits the same exposure. This asserts the shape of the wall.
    const routes = read('modules/admin/admin.routes.js');
    const wall = routes.indexOf('router.use(authenticate');

    assert.ok(wall > -1, 'the admin auth wall must exist');
    const above = routes.slice(0, wall).match(/router\.(get|post|put|patch|delete)\(/g) ?? [];
    assert.equal(above.length, 1, `unauthenticated admin routes: ${above.length}`);
});

/* ───────────────────── F-10 · the suite ignores ambient config ─────────────── */

test('the test runner does not read the developer .env', () => {
    // The suite used to pass or fail depending on which credentials happened to
    // be in the local .env, which makes it useless as a deploy gate.
    const env = read('config/env.js');

    assert.match(env, /NODE_TEST_CONTEXT/,
        'detect the test runner directly so the isolation cannot be lost by editing npm scripts');
});

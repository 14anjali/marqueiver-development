import test from 'node:test';
import assert from 'node:assert/strict';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

// Dynamic imports, because static ones are hoisted above the assignments above
// and config/env.js snapshots process.env at module load.
const {
    POLICY_V2, POLICY_BY_SLUG, ROUTE_TO_SLUG,
    policiesForRole, primaryPoliciesForRole, requiredSlugsForRole,
} = await import('../src/modules/policies/policyCatalog.js');
const { normalisePhone, toE164, isValidPhone } = await import('../src/services/msg91.service.js');
const { isValidEmail, normaliseIdentifier } = await import('../src/services/otp.service.js');
const { signVerification, verifyVerification, signAccess } = await import('../src/utils/tokens.js');
const { signState, verifyState, verifyIdToken } = await import('../src/services/googleAuth.service.js');

/**
 * Everything about the rebuilt auth surface that can be checked without a
 * database. This suite always runs; auth-flow.test.js covers the same rules
 * through HTTP wherever a MongoDB is available.
 */

/* ───────────────────────── Policy V2 content integrity ─────────────────────── */

test('all fifteen Policy V2 documents are present with real text', () => {
    assert.equal(POLICY_V2.length, 15);
    for (const p of POLICY_V2) {
        assert.ok(p.sections.length > 0, `${p.slug} has no sections`);
        assert.ok(p.body.split(/\s+/).length > 250, `${p.slug} body is too short to be the real policy`);
        assert.equal(p.version, '2.0');
        assert.equal(new Date(p.effectiveFrom).toISOString().slice(0, 10), '2026-08-01');
    }
});

test('policy text is the document, not a summary or a placeholder', () => {
    // Clauses that must survive the import verbatim, chosen because the product
    // depends on their exact figures.
    const terms = POLICY_BY_SLUG.get('terms-of-use').body;
    assert.match(terms, /at least 18 years of age/i);
    assert.match(terms, /only one account of each type/i);

    const commission = POLICY_BY_SLUG.get('commission-fees-policy').body;
    assert.match(commission, /12\.5/);

    const cancellation = POLICY_BY_SLUG.get('cancellation-refund-policy').body;
    assert.match(cancellation, /25% of the fee as a cancellation fee/i);
    assert.match(cancellation, /75% refund/i);

    for (const p of POLICY_V2) {
        assert.ok(!/lorem ipsum|placeholder|TODO|available on request/i.test(p.body),
            `${p.slug} contains placeholder text`);
    }
});

test('the cancellation rate table survives as a table, not flattened prose', () => {
    const s = POLICY_BY_SLUG.get('cancellation-refund-policy')
        .sections.find((x) => x.number === '7.1');
    const table = s.blocks.find((b) => b.type === 'table');
    assert.ok(table, '7.1 must render as a table — the numbers are the policy');
    assert.deepEqual(table.head, ['When cancelled', 'Creator receives', 'Brand receives']);
    assert.equal(table.rows.length, 4);
});

/* ──────────────────────── role-specific applicability ──────────────────────── */

test('the Creator Policy binds creators only', () => {
    assert.deepEqual(POLICY_BY_SLUG.get('creator-policy').requiredFor, ['creator']);
    assert.ok(requiredSlugsForRole('creator').includes('creator-policy'));
    assert.ok(!requiredSlugsForRole('brand').includes('creator-policy'));
});

test('the Brand Policy binds brands only', () => {
    assert.deepEqual(POLICY_BY_SLUG.get('brand-policy').requiredFor, ['brand']);
    assert.ok(requiredSlugsForRole('brand').includes('brand-policy'));
    assert.ok(!requiredSlugsForRole('creator').includes('brand-policy'));
});

test('both roles are bound by Terms and Privacy, and each set is exactly 14', () => {
    for (const role of ['creator', 'brand']) {
        const slugs = requiredSlugsForRole(role);
        assert.ok(slugs.includes('terms-of-use'));
        assert.ok(slugs.includes('privacy-policy'));
        assert.equal(slugs.length, 14, `${role} should be bound by 14 of the 15 policies`);
    }
    // The two sets differ by exactly the role policy.
    const c = new Set(requiredSlugsForRole('creator'));
    const b = new Set(requiredSlugsForRole('brand'));
    assert.deepEqual([...c].filter((s) => !b.has(s)), ['creator-policy']);
    assert.deepEqual([...b].filter((s) => !c.has(s)), ['brand-policy']);
});

test('the signup consent line names exactly three policies per role', () => {
    assert.deepEqual(primaryPoliciesForRole('creator').map((p) => p.slug),
        ['terms-of-use', 'privacy-policy', 'creator-policy']);
    assert.deepEqual(primaryPoliciesForRole('brand').map((p) => p.slug),
        ['terms-of-use', 'privacy-policy', 'brand-policy']);
});

test('the four public policy routes the signup form links to all resolve', () => {
    assert.equal(ROUTE_TO_SLUG.get('terms'), 'terms-of-use');
    assert.equal(ROUTE_TO_SLUG.get('privacy'), 'privacy-policy');
    assert.equal(ROUTE_TO_SLUG.get('creator-policy'), 'creator-policy');
    assert.equal(ROUTE_TO_SLUG.get('brand-policy'), 'brand-policy');
    assert.equal(ROUTE_TO_SLUG.size, 4);
});

test('admin is bound by no self-service policy set', () => {
    assert.equal(policiesForRole('admin').length, 0);
});

/* ────────────────────────── identifier normalisation ───────────────────────── */

test('the same phone number in any format resolves to one identifier', () => {
    const forms = ['+919000000501', '+91 90000 00501', '9000000501', '09000000501', '91-90000-00501'];
    const resolved = new Set(forms.map((f) => toE164(f)));
    assert.equal(resolved.size, 1, `expected one identity, got ${[...resolved].join(', ')}`);
    assert.equal([...resolved][0], '+919000000501');
});

test('a bare ten-digit number takes the configured country code', () => {
    assert.equal(normalisePhone('9000000501'), '919000000501');
});

test('nonsense is not a phone number', () => {
    for (const bad of ['', '   ', 'abc', '12', '+', '1234']) assert.equal(isValidPhone(bad), false);
    assert.equal(isValidPhone('+919000000501'), true);
});

test('emails are matched case-insensitively', () => {
    assert.equal(normaliseIdentifier('email', '  Alice@Example.COM '), 'alice@example.com');
});

test('email validation rejects the shapes that reach a real form', () => {
    for (const bad of ['', 'alice', 'alice@', '@example.com', 'a b@c.com', 'alice@example'])
        assert.equal(isValidEmail(bad), false, `${bad} should be invalid`);
    assert.equal(isValidEmail('alice@example.com'), true);
});

/* ───────────────────────────── token separation ────────────────────────────── */

test('a verification token carries no user, no role and no permissions', () => {
    const token = signVerification({ channel: 'email', identifier: 'alice@example.com' });
    const claims = verifyVerification(token);
    assert.equal(claims.typ, 'verification');
    assert.equal(claims.identifier, 'alice@example.com');
    assert.equal(claims.sub, undefined);
    assert.equal(claims.role, undefined);
});

test('an access token is not accepted where a verification token is expected', () => {
    const access = signAccess({ sub: 'abc123', role: 'brand' });
    assert.throws(() => verifyVerification(access), /Not a verification token/);
});

test('a tampered verification token is rejected', () => {
    const token = signVerification({ channel: 'email', identifier: 'alice@example.com' });
    const [h, p, s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({
        typ: 'verification', channel: 'email', identifier: 'admin@marqueiver.com',
        exp: Math.floor(Date.now() / 1000) + 600,
    })).toString('base64url');
    assert.throws(() => verifyVerification(`${h}.${forged}.${s}`));
    assert.ok(p);
});

/* ─────────────────────────────── Google OAuth ──────────────────────────────── */

test('OAuth state round-trips and carries the flow intent', () => {
    const state = signState({ intent: 'signup', role: 'creator' });
    const back = verifyState(state);
    assert.equal(back.intent, 'signup');
    assert.equal(back.role, 'creator');
});

test('a tampered OAuth state is rejected', () => {
    const state = signState({ intent: 'login', role: null });
    const [body] = state.split('.');
    assert.throws(() => verifyState(`${body}.deadbeef`), /Invalid sign-in state/);

    const swapped = Buffer.from(JSON.stringify({ intent: 'signup', role: 'brand', iat: Date.now() }))
        .toString('base64url');
    assert.throws(() => verifyState(`${swapped}.${state.split('.')[1]}`), /Invalid sign-in state/);
});

test('an expired OAuth state is rejected', () => {
    const stale = signState({ intent: 'login' });
    assert.throws(() => verifyState(stale, -1), /expired/i);
});

test('a hand-written Google token is not a Google sign-in', async () => {
    // The old endpoint took { email, googleId } from the request body and
    // trusted it, so this payload used to be a working login as anyone.
    const forged = ['e30', Buffer.from(JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: process.env.GOOGLE_CLIENT_ID,
        sub: '1', email: 'victim@example.com', email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url'), 'not-a-signature'].join('.');

    await assert.rejects(() => verifyIdToken(forged), (err) => err.status === 401 || err.status === 502);
});

test('a token with two segments is refused before any network call', async () => {
    await assert.rejects(() => verifyIdToken('abc.def'), (err) => err.status === 401);
});

/* ─────────────────────── request contracts (no database) ───────────────────── */

const authController = await import('../src/modules/auth/auth.controller.js');

test('login accepts a verification token and nothing else', () => {
    const okReq = authController.loginSchema.safeParse({ verificationToken: 'x'.repeat(24) });
    assert.equal(okReq.success, true);

    // The property the whole rebuild turns on: there is no way to tell login
    // what role you are. Strict mode makes the attempt a hard 400 rather than a
    // silently stripped field, so a client can never believe it worked.
    for (const smuggled of [
        { role: 'brand' },
        { adminLevel: 'super' },
        { user: 'someone-else' },
    ]) {
        const bad = authController.loginSchema.safeParse({
            verificationToken: 'x'.repeat(24), ...smuggled,
        });
        assert.equal(bad.success, false, `login must refuse ${JSON.stringify(smuggled)}`);
    }
});

test('signup requires a role, an age declaration and policy acceptances', () => {
    const base = {
        verificationToken: 'x'.repeat(24),
        role: 'creator',
        dob: '1995-05-05',
        ageDeclared18Plus: true,
        acceptedPolicies: ['terms-of-use'],
    };
    assert.equal(authController.signupSchema.safeParse(base).success, true);

    for (const [field, value] of [
        ['role', undefined], ['role', 'admin'], ['role', 'superuser'],
        ['dob', undefined], ['dob', 'not-a-date'],
        ['ageDeclared18Plus', false], ['ageDeclared18Plus', undefined],
        ['acceptedPolicies', []], ['acceptedPolicies', undefined],
        ['verificationToken', undefined],
    ]) {
        const body = { ...base, [field]: value };
        if (value === undefined) delete body[field];
        assert.equal(authController.signupSchema.safeParse(body).success, false,
            `signup must refuse ${field}=${JSON.stringify(value)}`);
    }
});

test('signup cannot be used to mint an admin or pre-set account state', () => {
    const base = {
        verificationToken: 'x'.repeat(24), role: 'creator', dob: '1995-05-05',
        ageDeclared18Plus: true, acceptedPolicies: ['terms-of-use'],
    };
    for (const smuggled of [
        { adminLevel: 'super' },
        { accountStatus: 'active' },
        { onboardingComplete: true },
        { emailVerified: true },
    ]) {
        assert.equal(authController.signupSchema.safeParse({ ...base, ...smuggled }).success, false,
            `signup must refuse ${JSON.stringify(smuggled)}`);
    }
});

test('the OTP verify contract names a channel explicitly', () => {
    const s = authController.verifyOtpSchema;
    assert.equal(s.safeParse({ channel: 'phone', identifier: '+919000000501', code: '123456' }).success, true);
    assert.equal(s.safeParse({ channel: 'email', identifier: 'a@b.com', code: '123456' }).success, true);
    // No SMS channel exists to be asked for.
    assert.equal(s.safeParse({ channel: 'sms', identifier: '+919000000501', code: '123456' }).success, false);
});

/* ──────────────── one verified method is enough to sign up ─────────────────── */

const { resolveNextStep } = await import('../src/modules/auth/auth.service.js');
const { Policy } = await import('../src/models/index.js');

/**
 * `resolveNextStep` also asks which policies are outstanding, which is a
 * database question. These cases are about the *verification* branch, so the
 * policy lookup is stubbed to "none published" — with no policy in force
 * `outstandingPoliciesFor` short-circuits and never reaches the database.
 * The policy branch itself is covered end-to-end in auth-flow.test.js.
 */
Policy.allCurrent = async () => [];

/** Minimal user stand-in — resolveNextStep only reads fields, except policies. */
const account = (over = {}) => ({
    _id: '000000000000000000000001',
    role: 'creator',
    accountStatus: 'active',
    dob: new Date('1995-05-05'),
    ageDeclared18Plus: true,
    phoneVerified: false,
    emailVerified: false,
    onboardingComplete: false,
    ...over,
});

test('an email-only signup is never asked for a phone number', async () => {
    const next = await resolveNextStep(account({ emailVerified: true }));
    assert.notEqual(next.step, 'verify_phone');
    assert.equal(next.step, 'onboarding');
    assert.equal(next.path, '/onboarding/influencer');
});

test('a WhatsApp-only signup is never asked for an email address', async () => {
    const next = await resolveNextStep(account({ phoneVerified: true, role: 'brand' }));
    assert.notEqual(next.step, 'verify_email');
    assert.equal(next.step, 'onboarding');
    assert.equal(next.path, '/onboarding/brand');
});

test('a Google signup (verified email, no phone) reaches onboarding', async () => {
    const next = await resolveNextStep(account({ emailVerified: true, googleId: 'g-1' }));
    assert.equal(next.step, 'onboarding');
});

test('an account with neither identity verified is still stopped', async () => {
    const next = await resolveNextStep(account());
    assert.equal(next.step, 'verify_identity');
});

test('an onboarded single-method account goes straight to its dashboard', async () => {
    const next = await resolveNextStep(account({ emailVerified: true, onboardingComplete: true }));
    assert.equal(next.step, 'dashboard');
    assert.equal(next.path, '/dashboard');
});

test('the role still decides the destination, per method', async () => {
    for (const [role, path] of [['creator', '/onboarding/influencer'], ['brand', '/onboarding/brand']]) {
        for (const verified of [{ emailVerified: true }, { phoneVerified: true }]) {
            const next = await resolveNextStep(account({ role, ...verified }));
            assert.equal(next.path, path, `${role} via ${Object.keys(verified)[0]}`);
        }
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';
process.env.OTP_RESEND_COOLDOWN_SECONDS = '0';

const { createApp } = await import('../src/app.js');
const { seedPolicies } = await import('../src/utils/seed.js');
const { User, Policy, PolicyAcceptance, Otp } = await import('../src/models/index.js');
const { signVerification } = await import('../src/utils/tokens.js');

/**
 * End-to-end auth tests.
 *
 * These exercise the flows through the HTTP surface rather than by calling
 * service functions, because the properties worth protecting are properties of
 * the API: that login has nowhere to put a role, that a Brand cannot be recorded
 * as accepting the Creator Policy, that a wrong code is counted. A unit test on
 * the service would pass even if the route quietly accepted the field.
 *
 * They need a real MongoDB. Point MONGO_URI at a scratch database, or let
 * mongodb-memory-server fetch a binary. If neither is available the suite skips
 * rather than failing, so a machine without a database does not report a
 * regression it has not found — the logic that can be checked without one is
 * covered by auth-unit.test.js, which always runs.
 *
 *   MONGO_URI="mongodb://127.0.0.1:27017/marqueiver_auth_test" npm test
 */

let mongod;
let server;
let base;
let available = false;
let skipReason = '';

test.before(async () => {
    try {
        if (process.env.MONGO_URI) {
            const db = process.env.MONGO_URI.split('/').pop().split('?')[0];
            if (!/test/i.test(db))
                throw new Error(`Refusing to run against "${db}" — use a database with "test" in its name.`);
            await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
        } else {
            const { MongoMemoryServer } = await import('mongodb-memory-server');
            mongod = await MongoMemoryServer.create();
            await mongoose.connect(mongod.getUri('marqueiver_auth_test'));
        }
    } catch (err) {
        skipReason = `no MongoDB available (${err.message.split('\n')[0]})`;
        return;
    }

    available = true;
    await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
    await seedPolicies();

    server = http.createServer(createApp());
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongod) await mongod.stop();
});

/** Wrap each case so the whole suite skips together when there is no database. */
const dbTest = (name, fn) => test(name, { skip: () => (available ? false : skipReason) }, fn);

async function api(path, { method = 'GET', body, token } = {}) {
    const res = await fetch(base + path, {
        method,
        headers: {
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: json.ok !== false, data: json.data, error: json.error };
}

/** Walk send → verify and return the verification token. */
async function verifyIdentity(channel, identifier) {
    const send = channel === 'phone'
        ? await api('/api/auth/otp/whatsapp/send', { method: 'POST', body: { phone: identifier, purpose: 'signup' } })
        : await api('/api/auth/otp/email/send', { method: 'POST', body: { email: identifier, purpose: 'signup' } });
    assert.equal(send.status, 200, JSON.stringify(send.error));

    const verify = await api('/api/auth/otp/verify', {
        method: 'POST', body: { channel, identifier, code: send.data.devCode },
    });
    assert.equal(verify.status, 200, JSON.stringify(verify.error));
    return verify.data;
}

async function signupAs(role, channel, identifier, extra = {}) {
    const { verificationToken } = await verifyIdentity(channel, identifier);
    const req = await api(`/api/auth/signup/requirements?role=${role}`);
    return api('/api/auth/signup', {
        method: 'POST',
        body: {
            verificationToken,
            role,
            dob: '1995-05-05',
            ageDeclared18Plus: true,
            acceptedPolicies: req.data.policies.map((p) => p.slug),
            profile: { displayName: 'Test account' },
            ...extra,
        },
    });
}

/* ───────────────────────── policy content and applicability ────────────────── */

dbTest('the fifteen Policy V2 documents are published with real text', async () => {
    const rows = await Policy.find({ version: '2.0' }).lean();
    assert.equal(rows.length, 15);
    for (const p of rows) {
        assert.ok(p.body.length > 500, `${p.slug} has no meaningful body`);
        assert.ok(p.sections.length > 0, `${p.slug} has no sections`);
    }
});

dbTest('the four signup policies resolve from their short public routes', async () => {
    for (const [route, slug] of [
        ['terms', 'terms-of-use'],
        ['privacy', 'privacy-policy'],
        ['creator-policy', 'creator-policy'],
        ['brand-policy', 'brand-policy'],
    ]) {
        const res = await api(`/api/policies/${route}`);
        assert.equal(res.status, 200, `${route} did not resolve`);
        assert.equal(res.data.slug, slug);
        assert.ok(res.data.body.length > 500);
        assert.ok(Array.isArray(res.data.sections) && res.data.sections.length);
    }
});

dbTest('creator signup is offered the Creator Policy and never the Brand Policy', async () => {
    const res = await api('/api/auth/signup/requirements?role=creator');
    const slugs = res.data.policies.map((p) => p.slug);
    assert.ok(slugs.includes('creator-policy'));
    assert.ok(!slugs.includes('brand-policy'));
    assert.ok(slugs.includes('terms-of-use') && slugs.includes('privacy-policy'));
});

dbTest('brand signup is offered the Brand Policy and never the Creator Policy', async () => {
    const res = await api('/api/auth/signup/requirements?role=brand');
    const slugs = res.data.policies.map((p) => p.slug);
    assert.ok(slugs.includes('brand-policy'));
    assert.ok(!slugs.includes('creator-policy'));
});

/* ─────────────────────────────── signup, all three ─────────────────────────── */

dbTest('creator signup over WhatsApp OTP creates the account and records consent', async () => {
    const res = await signupAs('creator', 'phone', '+919000010001');
    assert.equal(res.status, 201, JSON.stringify(res.error));
    assert.equal(res.data.user.role, 'creator');
    assert.equal(res.data.user.phoneVerified, true);
    assert.equal(res.data.user.emailVerified, false);
    assert.ok(res.data.accessToken && res.data.refreshToken);

    const user = await User.findOne({ phone: '+919000010001' });
    const accepted = await PolicyAcceptance.find({ user: user._id }).lean();
    assert.equal(accepted.length, 14, 'creator must accept the 14 policies binding creators');
    assert.ok(accepted.some((a) => a.slug === 'creator-policy'));
    assert.ok(!accepted.some((a) => a.slug === 'brand-policy'));
    assert.ok(accepted.every((a) => a.version === '2.0'));
});

dbTest('brand signup over email OTP records the brand policy set', async () => {
    const res = await signupAs('brand', 'email', 'brand-one@example.com');
    assert.equal(res.status, 201, JSON.stringify(res.error));
    assert.equal(res.data.user.role, 'brand');

    const user = await User.findOne({ email: 'brand-one@example.com' });
    const accepted = await PolicyAcceptance.find({ user: user._id }).lean();
    assert.ok(accepted.some((a) => a.slug === 'brand-policy'));
    assert.ok(!accepted.some((a) => a.slug === 'creator-policy'));
});

dbTest('signup is refused when a required policy was not accepted', async () => {
    const { verificationToken } = await verifyIdentity('email', 'nopolicy@example.com');
    const res = await api('/api/auth/signup', {
        method: 'POST',
        body: {
            verificationToken, role: 'creator', dob: '1990-01-01', ageDeclared18Plus: true,
            acceptedPolicies: ['terms-of-use'],
        },
    });
    assert.equal(res.status, 422);
    assert.equal(res.error.code, 'POLICY_ACCEPTANCE_REQUIRED');
    assert.ok(res.error.details.missing.includes('privacy-policy'));
    assert.equal(await User.countDocuments({ email: 'nopolicy@example.com' }), 0,
        'no account may exist without its consent record');
});

dbTest('a brand cannot be recorded as accepting the creator policy', async () => {
    const { verificationToken } = await verifyIdentity('email', 'wrongpolicy@example.com');
    const req = await api('/api/auth/signup/requirements?role=brand');
    const res = await api('/api/auth/signup', {
        method: 'POST',
        body: {
            verificationToken, role: 'brand', dob: '1990-01-01', ageDeclared18Plus: true,
            acceptedPolicies: [...req.data.policies.map((p) => p.slug), 'creator-policy'],
        },
    });
    assert.equal(res.status, 422);
    assert.equal(res.error.code, 'POLICY_NOT_APPLICABLE');
});

dbTest('signup is refused under 18', async () => {
    const { verificationToken } = await verifyIdentity('email', 'child@example.com');
    const req = await api('/api/auth/signup/requirements?role=creator');
    const recent = new Date();
    recent.setFullYear(recent.getFullYear() - 15);
    const res = await api('/api/auth/signup', {
        method: 'POST',
        body: {
            verificationToken, role: 'creator', dob: recent.toISOString().slice(0, 10),
            ageDeclared18Plus: true, acceptedPolicies: req.data.policies.map((p) => p.slug),
        },
    });
    assert.equal(res.status, 422);
    assert.equal(res.error.code, 'UNDER_18');
});

dbTest('signing up twice with the same identity is refused', async () => {
    const res = await signupAs('brand', 'phone', '+919000010001');
    assert.equal(res.status, 409);
    assert.equal(res.error.code, 'PHONE_ALREADY_REGISTERED');
});

/* ───────────────────────────────── login ───────────────────────────────────── */

dbTest('login takes no role and returns the role stored on the account', async () => {
    const { verificationToken } = await verifyIdentity('phone', '+919000010001');
    const res = await api('/api/auth/login', { method: 'POST', body: { verificationToken } });
    assert.equal(res.status, 200, JSON.stringify(res.error));
    assert.equal(res.data.user.role, 'creator');
    assert.ok(res.data.next.path);
});

dbTest('a role sent to login is rejected outright rather than honoured', async () => {
    const { verificationToken } = await verifyIdentity('phone', '+919000010001');
    const res = await api('/api/auth/login', {
        method: 'POST', body: { verificationToken, role: 'brand' },
    });
    // The schema is strict, so an attempt to state a role fails the request —
    // it can never be silently ignored *and* can never be honoured.
    assert.equal(res.status, 400);

    const clean = await api('/api/auth/login', { method: 'POST', body: { verificationToken } });
    assert.equal(clean.data.user.role, 'creator', 'the stored role is what counts');
});

dbTest('login on an unknown identity reports no account rather than creating one', async () => {
    const { verificationToken } = await verifyIdentity('email', 'stranger@example.com');
    const res = await api('/api/auth/login', { method: 'POST', body: { verificationToken } });
    assert.equal(res.status, 404);
    assert.equal(res.error.code, 'ACCOUNT_NOT_FOUND');
    assert.equal(await User.countDocuments({ email: 'stranger@example.com' }), 0);
});

dbTest('a suspended account is refused a session', async () => {
    await User.updateOne({ phone: '+919000010001' }, { accountStatus: 'suspended' });
    const { verificationToken } = await verifyIdentity('phone', '+919000010001');
    const res = await api('/api/auth/login', { method: 'POST', body: { verificationToken } });
    assert.equal(res.status, 403);
    assert.equal(res.error.code, 'ACCOUNT_SUSPENDED');
    await User.updateOne({ phone: '+919000010001' }, { accountStatus: 'active' });
});

/* ─────────────────────────────── OTP lifecycle ─────────────────────────────── */

dbTest('a wrong code is rejected and counted', async () => {
    await api('/api/auth/otp/whatsapp/send', { method: 'POST', body: { phone: '+919000020001' } });
    const res = await api('/api/auth/otp/verify', {
        method: 'POST', body: { channel: 'phone', identifier: '+919000020001', code: '000000' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.error.code, 'OTP_INVALID');
    assert.equal(res.error.details.attemptsRemaining, 4);
});

dbTest('too many wrong codes locks the challenge', async () => {
    await api('/api/auth/otp/whatsapp/send', { method: 'POST', body: { phone: '+919000020002' } });
    let last;
    for (let i = 0; i < 6; i += 1) {
        last = await api('/api/auth/otp/verify', {
            method: 'POST', body: { channel: 'phone', identifier: '+919000020002', code: '000000' },
        });
    }
    assert.equal(last.status, 429);
    assert.ok(['OTP_TOO_MANY_ATTEMPTS', 'OTP_LOCKED'].includes(last.error.code));
});

dbTest('an expired code is reported as expired, not merely wrong', async () => {
    const send = await api('/api/auth/otp/whatsapp/send', { method: 'POST', body: { phone: '+919000020003' } });
    await Otp.updateOne({ identifier: '+919000020003' }, { expiresAt: new Date(Date.now() - 1000) });
    const res = await api('/api/auth/otp/verify', {
        method: 'POST', body: { channel: 'phone', identifier: '+919000020003', code: send.data.devCode },
    });
    assert.equal(res.error.code, 'OTP_EXPIRED');
});

dbTest('resending issues a fresh code and clears the attempt counter', async () => {
    await api('/api/auth/otp/whatsapp/send', { method: 'POST', body: { phone: '+919000020004' } });
    await api('/api/auth/otp/verify', {
        method: 'POST', body: { channel: 'phone', identifier: '+919000020004', code: '000000' },
    });
    assert.equal((await Otp.findOne({ identifier: '+919000020004' })).attempts, 1);

    const again = await api('/api/auth/otp/whatsapp/resend', { method: 'POST', body: { phone: '+919000020004' } });
    assert.equal(again.status, 200);
    const rec = await Otp.findOne({ identifier: '+919000020004' });
    assert.equal(rec.attempts, 0);
    assert.equal(rec.sendCount, 2);
});

dbTest('a verified code cannot be replayed', async () => {
    const send = await api('/api/auth/otp/email/send', { method: 'POST', body: { email: 'replay@example.com' } });
    const first = await api('/api/auth/otp/verify', {
        method: 'POST', body: { channel: 'email', identifier: 'replay@example.com', code: send.data.devCode },
    });
    assert.equal(first.status, 200);
    const second = await api('/api/auth/otp/verify', {
        method: 'POST', body: { channel: 'email', identifier: 'replay@example.com', code: send.data.devCode },
    });
    assert.equal(second.error.code, 'OTP_NOT_FOUND');
});

dbTest('phone numbers are matched regardless of how they were typed', async () => {
    const send = await api('/api/auth/otp/whatsapp/send', { method: 'POST', body: { phone: '09000030001' } });
    const res = await api('/api/auth/otp/verify', {
        method: 'POST', body: { channel: 'phone', identifier: '+91 90000 30001', code: send.data.devCode },
    });
    assert.equal(res.status, 200, 'the same number in a different format must verify');
});

/* ───────────────────────────── token separation ────────────────────────────── */

dbTest('a verification token cannot be used as a session', async () => {
    const token = signVerification({ channel: 'email', identifier: 'a@b.com' });
    const res = await api('/api/auth/me', { token });
    assert.equal(res.status, 401);
});

dbTest('a forged verification token is rejected', async () => {
    const res = await api('/api/auth/login', {
        method: 'POST', body: { verificationToken: 'not.a.real.token.at.all' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.error.code, 'VERIFICATION_EXPIRED');
});

/* ────────────────────────── routing state after auth ───────────────────────── */

dbTest('a new account is routed to its role-specific onboarding', async () => {
    const res = await signupAs('creator', 'phone', '+919000040001');
    assert.equal(res.data.next.step, 'onboarding');
    assert.equal(res.data.next.path, '/onboarding/influencer');

    const brand = await signupAs('brand', 'phone', '+919000040002');
    assert.equal(brand.data.next.path, '/onboarding/brand');
});

dbTest('an onboarded account is routed to the dashboard', async () => {
    await User.updateOne({ phone: '+919000040001' }, { onboardingComplete: true, emailVerified: true, emailVerifiedAt: new Date(), email: 'done@example.com' });
    const { verificationToken } = await verifyIdentity('phone', '+919000040001');
    const res = await api('/api/auth/login', { method: 'POST', body: { verificationToken } });
    assert.equal(res.data.next.step, 'dashboard');
});

dbTest('a newly published policy version blocks the dashboard until re-accepted', async () => {
    await Policy.create({
        slug: 'terms-of-use', title: 'Terms & Conditions', version: '2.1',
        effectiveFrom: new Date(Date.now() - 1000), requiredFor: ['creator', 'brand'],
        body: 'Updated terms.', materialChange: true,
    });

    const { verificationToken } = await verifyIdentity('phone', '+919000040001');
    const res = await api('/api/auth/login', { method: 'POST', body: { verificationToken } });
    assert.equal(res.data.next.step, 'policy_acceptance');
    assert.ok(res.data.next.policies.some((p) => p.slug === 'terms-of-use' && p.version === '2.1'));

    const accept = await api('/api/auth/policies/accept', {
        method: 'POST',
        token: res.data.accessToken,
        body: { acceptedPolicies: res.data.next.policies.map((p) => p.slug).concat(
            (await api('/api/auth/signup/requirements?role=creator')).data.policies
                .map((p) => p.slug).filter((s) => s !== 'terms-of-use'),
        ) },
    });
    assert.equal(accept.status, 200, JSON.stringify(accept.error));
    assert.equal(accept.data.next.step, 'dashboard');

    await Policy.deleteOne({ slug: 'terms-of-use', version: '2.1' });
});

dbTest('/auth/me is the authority on role and destination', async () => {
    const { verificationToken } = await verifyIdentity('phone', '+919000040002');
    const login = await api('/api/auth/login', { method: 'POST', body: { verificationToken } });
    const me = await api('/api/auth/me', { token: login.data.accessToken });
    assert.equal(me.data.user.role, 'brand');
    assert.ok(me.data.next.path);
});

/* ──────────────────────────── linking identities ───────────────────────────── */

dbTest('a phone-registered account can link a verified email', async () => {
    const signup = await signupAs('creator', 'phone', '+919000050001');
    const token = signup.data.accessToken;
    assert.equal(signup.data.user.emailVerified, false);

    const { verificationToken } = await verifyIdentity('email', 'link-me@example.com');
    const res = await api('/api/auth/link', { method: 'POST', token, body: { verificationToken } });
    assert.equal(res.status, 200, JSON.stringify(res.error));
    assert.equal(res.data.user.emailVerified, true);
    assert.deepEqual(res.data.user.authProviders.sort(), ['email', 'phone']);
});

dbTest('linking an identity that belongs to someone else is refused', async () => {
    const signup = await signupAs('creator', 'phone', '+919000050002');
    const { verificationToken } = await verifyIdentity('email', 'link-me@example.com');
    const res = await api('/api/auth/link', {
        method: 'POST', token: signup.data.accessToken, body: { verificationToken },
    });
    assert.equal(res.status, 409);
    assert.equal(res.error.code, 'EMAIL_ALREADY_REGISTERED');
});

/* ──────────────────────────────── configuration ────────────────────────────── */

dbTest('auth config advertises WhatsApp, never SMS', async () => {
    const res = await api('/api/auth/config');
    assert.equal(res.data.methods.phone.channel, 'whatsapp');
    assert.equal(res.data.methods.phone.provider, 'msg91');
    assert.ok(!JSON.stringify(res.data).toLowerCase().includes('sms'));
});

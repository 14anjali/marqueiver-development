import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Live mode must be incapable of leaking a verification code.
 *
 * This file boots the config as a real deployment would — INTEGRATION_MODE=live —
 * and asserts the properties that keep a real user's code out of the response
 * body and out of the log. It is a separate file because config/env.js snapshots
 * process.env once at import, and the node test runner gives each file its own
 * process.
 */

process.env.NODE_ENV = 'test';
process.env.INTEGRATION_MODE = 'live';
process.env.EMAIL_PROVIDER = 'resend';
process.env.RESEND_API_KEY = '';          // deliberately unset
process.env.EMAIL_FROM = 'onboarding@resend.dev';
process.env.MSG91_AUTH_KEY = '';          // deliberately unset
process.env.MSG91_WHATSAPP_TEMPLATE_ID = '';
process.env.GOOGLE_CLIENT_ID = '';

const { isLiveMode } = await import('../src/services/otp.service.js');
const { sendEmail, emailConfigStatus } = await import('../src/services/email.service.js');
const { sendWhatsAppOtp, msg91ConfigStatus } = await import('../src/services/msg91.service.js');
const { googleConfigStatus } = await import('../src/services/googleAuth.service.js');

test('the process reports itself as live', () => {
    assert.equal(isLiveMode(), true);
});

/* ─────────────────────── no code may leave the process ─────────────────────── */

test('WhatsApp delivery never hands back a dev code', async () => {
    // Unconfigured, so it refuses — the point is that it refuses rather than
    // falling back to the mock path, which would return the code to the client.
    await assert.rejects(
        () => sendWhatsAppOtp('919000000501', '493021', { purpose: 'login' }),
        (err) => {
            assert.equal(err.code, 'OTP_PROVIDER_NOT_CONFIGURED');
            assert.equal(err.status, 500);
            // The failure must not carry the code anywhere in it.
            assert.ok(!JSON.stringify(err.details ?? {}).includes('493021'));
            assert.ok(!String(err.message).includes('493021'));
            return true;
        },
    );
});

test('a missing provider credential is a hard failure, not a silent downgrade', async () => {
    await assert.rejects(
        () => sendEmail('user@example.com', 'Your code', '<p>493021</p>'),
        (err) => {
            assert.equal(err.code, 'EMAIL_PROVIDER_NOT_CONFIGURED');
            // Names the variable so an operator can fix it...
            assert.deepEqual(err.details.missing, ['RESEND_API_KEY']);
            // ...without the message ever carrying a value.
            assert.ok(!/Bearer|sk_|re_/i.test(err.message));
            return true;
        },
    );
});

test('provider errors never expose the API key', () => {
    const status = emailConfigStatus();
    assert.ok(!JSON.stringify(status).includes('Bearer'));
    for (const value of Object.values(status)) {
        assert.notEqual(value, process.env.RESEND_API_KEY || '__unset__');
    }
});

/* ───────────────────── configuration is reported honestly ──────────────────── */

test('each provider names exactly what it is missing', () => {
    assert.deepEqual(emailConfigStatus().missing, ['RESEND_API_KEY']);
    assert.deepEqual(msg91ConfigStatus().missing, ['MSG91_AUTH_KEY', 'MSG91_WHATSAPP_TEMPLATE_ID']);
    assert.deepEqual(googleConfigStatus().missing, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);

    assert.equal(emailConfigStatus().configured, false);
    assert.equal(msg91ConfigStatus().configured, false);
    assert.equal(googleConfigStatus().configured, false);
});

test("Resend's sandbox sender is flagged, because it silently drops recipients", () => {
    // onboarding@resend.dev accepts every send with a 200 and only delivers to
    // the Resend account owner. Unflagged, that is indistinguishable from a bug.
    assert.equal(emailConfigStatus().sandboxSender, true);
});

test('an unsupported email provider fails instead of pretending to send', async () => {
    const { env } = await import('../src/config/env.js');
    const previous = env.emailProvider;
    env.emailProvider = 'ses';
    try {
        await assert.rejects(
            () => sendEmail('user@example.com', 'Your code', '<p>493021</p>'),
            (err) => {
                assert.equal(err.code, 'EMAIL_PROVIDER_NOT_SUPPORTED');
                return true;
            },
        );
    } finally {
        env.emailProvider = previous;
    }
});

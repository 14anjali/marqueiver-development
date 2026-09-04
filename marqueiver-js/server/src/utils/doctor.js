import { env, envFile } from '../config/env.js';
import { emailConfigStatus, sendEmail } from '../services/email.service.js';
import { msg91ConfigStatus } from '../services/msg91.service.js';
import { googleConfigStatus } from '../services/googleAuth.service.js';

/**
 * Provider diagnostics.
 *
 *   npm run doctor                       # report configuration only
 *   npm run doctor -- you@example.com    # also send a real test email
 *
 * Answers "why is this integration not working" without anyone reading source
 * or guessing. It reports which `.env` file was actually loaded, whether each
 * credential is present, and — with a recipient — performs a genuine Resend
 * send and prints exactly what Resend said.
 *
 * It never prints a secret. Keys are reported as present/absent plus a length
 * and a recognisable prefix (`re_…`, `GOCSPX-…`), which is enough to catch the
 * common mistakes — a truncated paste, a swapped client id and secret, a key
 * with surrounding quotes — without the value reaching a terminal or a log.
 */

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const tick = (ok) => (ok ? `${GREEN}✔${RESET}` : `${RED}✘${RESET}`);

/** Present/absent plus shape — never the value. */
function describeSecret(value, expectedPrefix) {
    if (!value) return `${RED}not set${RESET}`;
    const quoted = /^["']|["']$/.test(value);
    const spaced = value !== value.trim();
    const notes = [];
    if (quoted) notes.push(`${YELLOW}has surrounding quotes — remove them${RESET}`);
    if (spaced) notes.push(`${YELLOW}has leading/trailing whitespace${RESET}`);
    if (expectedPrefix && !value.startsWith(expectedPrefix)) {
        notes.push(`${YELLOW}does not start with "${expectedPrefix}"${RESET}`);
    }
    return `${GREEN}set${RESET} ${DIM}(${value.length} chars`
        + `${expectedPrefix && value.startsWith(expectedPrefix) ? `, ${expectedPrefix}…` : ''})${RESET}`
        + (notes.length ? `  ${notes.join('; ')}` : '');
}

function section(title) {
    console.log(`\n${title}`);
    console.log('─'.repeat(title.length));
}

async function main() {
    const recipient = process.argv[2];

    console.log('\nMarqueiver — provider diagnostics');

    /* ── where configuration came from ─────────────────────────────────────── */
    section('Configuration source');
    console.log(`  .env path        ${envFile.path}`);
    console.log(`  .env exists      ${tick(envFile.exists)} ${envFile.exists ? '' : `${RED}no file at that path${RESET}`}`);
    console.log(`  keys loaded      ${envFile.loadedKeys}`);
    if (envFile.error) console.log(`  ${RED}load error       ${envFile.error}${RESET}`);
    console.log(`  ${DIM}Values already present in the real environment always win over the file.${RESET}`);

    section('Mode');
    const live = env.integrationMode === 'live';
    console.log(`  INTEGRATION_MODE ${live ? `${GREEN}live${RESET}` : `${YELLOW}${env.integrationMode}${RESET}`}`);
    if (!live) {
        console.log(`  ${YELLOW}Not live — no provider is contacted, OTPs are logged and returned as devCode.${RESET}`);
        console.log(`  ${YELLOW}Set INTEGRATION_MODE=live to use the real providers.${RESET}`);
    }

    /* ── each provider ─────────────────────────────────────────────────────── */
    const email = emailConfigStatus();
    section('Email — Resend');
    console.log(`  EMAIL_PROVIDER   ${env.emailProvider}`);
    console.log(`  RESEND_API_KEY   ${describeSecret(env.resendApiKey, 're_')}`);
    console.log(`  EMAIL_FROM       ${env.emailFrom || `${RED}not set${RESET}`}`);
    console.log(`  configured       ${tick(email.configured)}`);
    if (email.missing.length) console.log(`  ${RED}missing          ${email.missing.join(', ')}${RESET}`);
    if (email.sandboxSender) {
        console.log(`  ${YELLOW}⚠ EMAIL_FROM is Resend's sandbox sender. It delivers ONLY to the address`);
        console.log(`    that owns the Resend account — every other recipient is accepted and`);
        console.log(`    dropped. Verify a domain in Resend and use an address on it.${RESET}`);
    }

    const msg91 = msg91ConfigStatus();
    section('WhatsApp — MSG91');
    console.log(`  MSG91_AUTH_KEY   ${describeSecret(env.msg91.authKey)}`);
    console.log(`  TEMPLATE_ID      ${env.msg91.templateId ? `${GREEN}set${RESET}` : `${RED}not set${RESET}`}`);
    console.log(`  OTP variable     ${env.msg91.otpVarName}`);
    console.log(`  verify with      ${env.msg91.verifyWith}`);
    console.log(`  configured       ${tick(msg91.configured)}`);
    if (msg91.missing.length) console.log(`  ${RED}missing          ${msg91.missing.join(', ')}${RESET}`);

    const google = googleConfigStatus();
    section('Google OAuth');
    console.log(`  CLIENT_ID        ${describeSecret(env.googleAuth.clientId)}`);
    console.log(`  CLIENT_SECRET    ${describeSecret(env.googleAuth.clientSecret, 'GOCSPX-')}`);
    console.log(`  REDIRECT_URI     ${env.googleAuth.redirectUri}`);
    console.log(`  configured       ${tick(google.configured)}`);
    if (google.missing.length) console.log(`  ${RED}missing          ${google.missing.join(', ')}${RESET}`);
    console.log(`  ${DIM}This exact redirect URI must appear in Google Cloud Console →`);
    console.log(`  Credentials → your OAuth client → Authorised redirect URIs.`);
    console.log(`  Add ${env.clientUrl} to Authorised JavaScript origins.${RESET}`);

    /* ── a real send ───────────────────────────────────────────────────────── */
    if (!recipient) {
        section('Live test');
        console.log(`  ${DIM}Pass an address to send a real test email:${RESET}`);
        console.log(`  ${DIM}npm run doctor -- you@example.com${RESET}`);
        console.log('');
        return;
    }

    section(`Live test — sending to ${recipient}`);
    if (env.emailProvider === 'mock') {
        console.log(`  ${YELLOW}EMAIL_PROVIDER=mock — nothing will actually be sent.${RESET}\n`);
        return;
    }

    try {
        const result = await sendEmail(
            recipient,
            'Marqueiver — provider diagnostics test',
            '<p>If you are reading this, Resend delivery is working.</p>',
        );
        console.log(`  ${GREEN}✔ Resend accepted the message${RESET}`);
        console.log(`  message id       ${result.id ?? '(none returned)'}`);
        console.log(`  ${DIM}Accepted is not the same as delivered — check the inbox, and check`);
        console.log(`  Resend → Logs if it does not arrive.${RESET}\n`);
    } catch (err) {
        console.log(`  ${RED}✘ ${err.code ?? 'ERROR'}${RESET}`);
        console.log(`  ${err.message}`);
        if (err.details?.fix) console.log(`  ${YELLOW}fix: ${err.details.fix}${RESET}`);
        if (err.details?.missing) console.log(`  ${YELLOW}missing: ${err.details.missing.join(', ')}${RESET}`);
        console.log(`  ${DIM}The server log above this line carries Resend's own message verbatim.${RESET}\n`);
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('\nDiagnostics failed to run:', err?.message ?? err, '\n');
    process.exit(1);
});

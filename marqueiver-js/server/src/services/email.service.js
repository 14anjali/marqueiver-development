import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
/** Transactional email. Proposal §8: must be on a verified domain from day one to
 * avoid the sandbox trap that was hit previously. Mock just logs. */
export async function sendEmail(to, subject, html) {
    if (env.emailProvider === 'mock') {
        logger.info(`✉️  [MOCK EMAIL] to=${to} subject="${subject}"`);
        return;
    }
    if (env.emailProvider === 'resend') {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            },
            body: JSON.stringify({ from: env.emailFrom, to, subject, html }),
        });
        if (!res.ok)
            throw new Error(`Resend failed: ${res.status}`);
        return;
    }
    // SES path would use @aws-sdk/client-ses here.
    logger.warn('SES provider selected but not wired in this build; falling back to log.');
    logger.info(`✉️  [SES-STUB] to=${to} subject="${subject}"`);
}

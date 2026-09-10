import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Transactional SMS + WhatsApp notification delivery (features: SMS
 * notifications, WhatsApp notifications). Distinct from services/otp.service.js
 * which only handles OTP verification (Twilio Verify) — this uses Twilio's
 * regular Messages API for one-way notification text, mirroring the
 * mock/live pattern already used by email.service.js.
 */

export async function sendSms(to, body) {
  if (env.integrationMode !== 'live' || !env.twilio.sid) {
    logger.info(`📱 [MOCK SMS] to=${to} body="${body}"`);
    return;
  }
  const twilio = (await import('twilio')).default(env.twilio.sid, env.twilio.token);
  await twilio.messages.create({ to, body, messagingServiceSid: env.twilio.verifySid || undefined, from: env.twilio.smsFrom || undefined });
}

export async function sendWhatsApp(to, body) {
  if (env.integrationMode !== 'live' || !env.twilio.sid || !env.twilio.whatsappFrom) {
    logger.info(`💬 [MOCK WHATSAPP] to=${to} body="${body}"`);
    return;
  }
  const twilio = (await import('twilio')).default(env.twilio.sid, env.twilio.token);
  await twilio.messages.create({
    to: `whatsapp:${to}`,
    from: `whatsapp:${env.twilio.whatsappFrom}`,
    body,
  });
}

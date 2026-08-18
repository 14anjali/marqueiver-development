import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { sendEmail } from './email.service.js';
import { Otp } from '../models/index.js';

const genCode = () =>
  env.integrationMode === 'mock'
    ? '123456'
    : String(crypto.randomInt(100000, 999999));


async function persist(channel, identifier, code, purpose) {
  const codeHash = await bcrypt.hash(code, 8);

  await Otp.findOneAndUpdate(
    { channel, identifier },
    {
      channel,
      identifier,
      ...(channel === 'phone' ? { phone: identifier } : {}),
      codeHash,
      purpose,
      attempts: 0,
      expiresAt: new Date(Date.now() + env.otpTtlSeconds * 1000),
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}


/**
 * Send Phone OTP
 */
export async function sendOtp(phone, purpose = 'login') {

  // LIVE MODE - Twilio Verify
  if (env.integrationMode === 'live') {

    if (env.twilio.sid && env.twilio.verifySid) {

      const twilio = (await import('twilio')).default(
        env.twilio.sid,
        env.twilio.token
      );

      await twilio.verify.v2
        .services(env.twilio.verifySid)
        .verifications
        .create({
          to: phone,
          channel: 'sms'
        });

      return {};
    }

    logger.warn(
      'Twilio not configured properly'
    );

    return {};
  }


  // MOCK MODE
  const code = genCode();

  await persist(
    'phone',
    phone,
    code,
    purpose
  );

  logger.info(
    `📱 [MOCK OTP] ${phone} → ${code}`
  );

  return {
    devCode: code
  };
}


/**
 * Verify Phone OTP
 */
export async function verifyOtp(phone, code) {

  // LIVE MODE - Verify with Twilio
  if (env.integrationMode === 'live') {

    const twilio = (await import('twilio')).default(
      env.twilio.sid,
      env.twilio.token
    );


    const verificationCheck =
      await twilio.verify.v2
        .services(env.twilio.verifySid)
        .verificationChecks
        .create({
          to: phone,
          code
        });


    return verificationCheck.status === 'approved';
  }


  // MOCK MODE
  const result = await verifyChannelOtp(
    'phone',
    phone,
    code
  );

  return result.ok;
}


/**
 * Verify OTP from Database (Mock mode)
 */
export async function verifyChannelOtp(channel, identifier, code) {

  const rec = await Otp.findOne({
    channel,
    identifier
  });


  if (!rec)
    return {
      ok: false,
      reason: 'not_found'
    };


  if (rec.expiresAt.getTime() < Date.now()) {

    await Otp.deleteOne({
      _id: rec._id
    });

    return {
      ok:false,
      reason:'expired'
    };
  }


  if (rec.attempts >= 5)
    return {
      ok:false,
      reason:'too_many_attempts'
    };


  rec.attempts += 1;
  await rec.save();


  const good = await bcrypt.compare(
    code,
    rec.codeHash
  );


  if(good){

    await Otp.deleteOne({
      _id:rec._id
    });

    return {
      ok:true
    };
  }


  return {
    ok:false,
    reason:'invalid'
  };
}


/**
 * Email OTP
 */
export async function sendEmailOtp(email, purpose='login') {

  const code = genCode();

  await persist(
    'email',
    email,
    code,
    purpose
  );


  if(
    env.integrationMode === 'live' &&
    env.emailProvider !== 'mock'
  ){

    await sendEmail(
      email,
      'Your Marqueiver verification code',
      `
      <h2>Verify your email</h2>
      <p>Your OTP is ${code}</p>
      `
    );

    return {};
  }


  logger.info(
    `✉️ [MOCK EMAIL OTP] ${email} → ${code}`
  );


  return {
    devCode:code
  };
}
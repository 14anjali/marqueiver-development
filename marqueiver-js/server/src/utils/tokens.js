import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
export function signAccess(claims) {
    return jwt.sign(claims, env.jwt.accessSecret, { expiresIn: env.jwt.accessTtl });
}
export function signRefresh(sub) {
    return jwt.sign({ sub }, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshTtl });
}
export function verifyAccess(token) {
    return jwt.verify(token, env.jwt.accessSecret);
}
export function verifyRefresh(token) {
    return jwt.verify(token, env.jwt.refreshSecret);
}

/**
 * A verification token: proof that *this* channel identity was verified by
 * *this* server a moment ago. It is not a session — it carries no user id, no
 * role and no permissions, and is rejected by every authenticated route.
 *
 * It exists so that verification and account creation are separate steps, and
 * that separation is what makes the two flows behave correctly:
 *
 *  - **Login** presents one of these; the server looks the account up and reads
 *    the role from the database. The client never states a role, so it cannot
 *    influence one.
 *  - **Signup** presents one of these together with a role and the policy
 *    acceptances, and the account is created only if the policies required for
 *    that role have actually been accepted.
 *
 * The window is short by design: long enough to fill in a name and tick a box,
 * not long enough to be worth stealing.
 */
const VERIFICATION_TTL = '20m';

export function signVerification({ channel, identifier, provider = 'otp', googleId, name }) {
    return jwt.sign(
        { typ: 'verification', channel, identifier, provider, googleId, name },
        env.jwt.accessSecret,
        { expiresIn: VERIFICATION_TTL },
    );
}

export function verifyVerification(token) {
    const claims = jwt.verify(token, env.jwt.accessSecret);
    // Without this check an access token would be accepted wherever a
    // verification token is expected, since both are signed with the same key.
    if (claims.typ !== 'verification') throw new Error('Not a verification token');
    return claims;
}

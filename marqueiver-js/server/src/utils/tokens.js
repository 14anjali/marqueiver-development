import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
export function signAccess(claims) {
    return jwt.sign(claims, env.jwt.accessSecret, { expiresIn: env.jwt.accessTtl });
}
/**
 * Sign a refresh token, stamped with the account's current token version.
 *
 * Refresh tokens live 30 days, which is long enough that "log out" has to mean
 * something on the server. Before this, logout deleted `localStorage` and
 * nothing else: a refresh token copied off a machine stayed usable for a month
 * and the only way to stop it was deleting or suspending the account.
 *
 * `tv` is that off switch. It is compared against `user.tokenVersion` on every
 * refresh, so incrementing the column invalidates every refresh token ever
 * issued to that account, at once, with no denylist to store or expire. The
 * cost is that revocation is per-account rather than per-device — logging out
 * on one machine signs the account out everywhere. That is the right default
 * for a platform holding escrowed money, and it is the behaviour someone who
 * suspects a stolen session actually wants.
 *
 * Access tokens are deliberately not versioned: checking them would mean a
 * database read on every request, and their 15-minute life is the bound on how
 * long a revoked session can still act.
 */
export function signRefresh(sub, tokenVersion = 0) {
    return jwt.sign({ sub, tv: tokenVersion }, env.jwt.refreshSecret, {
        expiresIn: env.jwt.refreshTtl,
    });
}
/**
 * Verify a session access token.
 *
 * The two guards below are the counterpart of the one in `verifyVerification`,
 * and they belong here rather than at the call sites. Access tokens and
 * verification tokens are signed with the *same secret*, so signature validity
 * alone does not distinguish them — only the `typ` claim does.
 *
 * `middleware/auth.js` carried these checks privately, which made them true of
 * authenticated routes and of nothing else. Four other places verify a token
 * without going through that middleware — the Instagram, Facebook and YouTube
 * OAuth callbacks and the socket handshake — and each accepted a verification
 * token as a session. A verification token is obtainable by anyone who can
 * complete an OTP for any address, with no account and no password, so that
 * turned "I can receive a code at some email" into an authenticated session.
 *
 * It also carries no `sub`, so the value those callers read as a user id was
 * `undefined`, which then reached `persistProfile()` and the socket room name.
 *
 * Putting the guard in the verifier means a future caller cannot forget it.
 */
export function verifyAccess(token) {
    const claims = jwt.verify(token, env.jwt.accessSecret);
    if (claims.typ === 'verification') throw new Error('Not a session token');
    if (!claims.sub) throw new Error('Session token carries no subject');
    return claims;
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

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

import { verifyAccess } from '../utils/tokens.js';
import { ApiError } from '../utils/apiError.js';
import { User } from '../models/index.js';

export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw ApiError.unauthorized();
    const claims = verifyAccess(header.slice(7));
    req.auth = claims;

    const user = await User.findById(claims.sub)
      .select('status lastSyncedAt')
      .lean();

    if (!user)
      throw ApiError.unauthorized('User no longer exists');
    if (user.status === 'suspended')
      throw ApiError.forbidden('Account suspended');

    const hour = 60 * 60 * 1000;
    if (!user.lastSyncedAt || Date.now() - new Date(user.lastSyncedAt).getTime() > hour) {
      await User.updateOne({ _id: claims.sub }, { lastSyncedAt: new Date() });
    }

    next();
  } catch (e) {
    if (e instanceof ApiError)
      return next(e);
    next(ApiError.unauthorized('Invalid or expired token'));
  }
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.auth)
    return next(ApiError.unauthorized());
  if (!roles.includes(req.auth.role))
    return next(ApiError.forbidden());
  next();
};

/** Admin permission-level gate — super does everything (proposal §5.3). */
export const requireAdminLevel = (...levels) => (req, _res, next) => {
  if (req.auth?.role !== 'admin')
    return next(ApiError.forbidden());
  if (req.auth.adminLevel === 'super')
    return next();
  if (!levels.includes(req.auth.adminLevel ?? ''))
    return next(ApiError.forbidden());
  next();
};
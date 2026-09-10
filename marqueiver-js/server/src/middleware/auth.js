import { verifyAccess } from '../utils/tokens.js';
import { ApiError } from '../utils/apiError.js';
import { User } from '../models/index.js';

export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw ApiError.unauthorized();
    const claims = verifyAccess(header.slice(7));

    // A verification token proves an identity was verified; it is not a session
    // and grants nothing. Both are signed with the access secret, so without
    // this check one would be accepted in place of the other.
    if (claims.typ === 'verification')
      throw ApiError.unauthorized('That token cannot be used to access this resource');
    if (!claims.sub)
      throw ApiError.unauthorized();

    req.auth = claims;

    const user = await User.findById(claims.sub)
      .select('status accountStatus deletedAt role lastSyncedAt')
      .lean();

    if (!user || user.deletedAt)
      throw ApiError.unauthorized('User no longer exists');

    /**
     * Policy 12 — the enforcement ladder, read live from the database rather
     * than from the token, so a suspension takes effect immediately instead of
     * whenever the current access token happens to expire.
     *
     * `restricted` is deliberately not blocked here: 12.2 restricts what a user
     * may *do*, not whether they may see their own account, and a user who
     * cannot reach the app cannot appeal. The action gates in policyGate.js are
     * what enforce a restriction.
     */
    const status = user.accountStatus ?? (user.status === 'suspended' ? 'suspended' : 'active');
    if (status === 'terminated')
      throw new ApiError(403, 'ACCOUNT_TERMINATED', 'This account has been terminated.');
    if (status === 'suspended' || user.status === 'suspended')
      throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended.');

    // The role in the token is a cache; the database is the authority, so a role
    // changed by an admin does not stay in force for the life of a token.
    req.auth.role = user.role;

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

/**
 * Blocks a self-signed-up Finance/Support admin from every /admin/* route
 * until an existing super admin approves them. Checked live from the
 * database (not the JWT) because approval can happen *after* the token was
 * issued — a pending admin who logs in right after signing up must start
 * working the moment they're approved, without needing to log in again.
 * Admins created via bootstrap or Team invite are set 'approved' at creation
 * time, so this is a no-op for them.
 */
export const requireApprovedAdmin = async (req, _res, next) => {
  if (req.auth?.role !== 'admin') return next(ApiError.forbidden());
  const user = await User.findById(req.auth.sub).select('adminApprovalStatus').lean();
  if (user?.adminApprovalStatus === 'pending') {
    return next(new ApiError(403, 'ADMIN_PENDING_APPROVAL', 'Your admin account is awaiting approval from a super admin.'));
  }
  if (user?.adminApprovalStatus === 'rejected') {
    return next(new ApiError(403, 'ADMIN_REJECTED', 'Your admin signup request was not approved.'));
  }
  next();
};
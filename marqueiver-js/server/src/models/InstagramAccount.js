import { Schema, model } from 'mongoose';

/**
 * Every `account_type` Instagram can report, and the subset that may connect.
 *
 * These live together because they drifted apart, and the drift was a silent
 * production failure: `assertInstagramEligible` accepted MEDIA_CREATOR while
 * this schema's enum listed only PERSONAL / CREATOR / BUSINESS / UNKNOWN. A
 * MEDIA_CREATOR account therefore passed eligibility and then failed to save,
 * as a Mongoose ValidationError — which carries no `code`, so the callback's
 * handler logged the useless
 *
 *   WARN Instagram callback failed { code: 'UNKNOWN', providerCode: null }
 *
 * and redirected the creator to a generic "please try again" that could never
 * succeed. Eligibility is now defined as a subset of what is storable, and a
 * test asserts that containment, so the two cannot separate again.
 */
export const INSTAGRAM_ACCOUNT_TYPES = ['PERSONAL', 'CREATOR', 'BUSINESS', 'MEDIA_CREATOR', 'UNKNOWN'];

/** Types that may complete a connection. PERSONAL cannot; UNKNOWN is judged by the login. */
export const ELIGIBLE_INSTAGRAM_ACCOUNT_TYPES = ['CREATOR', 'BUSINESS', 'MEDIA_CREATOR'];

/**
 * Connected Instagram account + tokens and synced profile data.
 * SRS §6 (instagram_accounts) and FR-4/FR-5.
 *
 * Security (SRS §7.1): the access token is stored on the backend only and is
 * never selected into API responses (select:false) — all IG calls are proxied
 * server-side. FR-5 fields are synced from the Graph API (or mocked in dev).
 */
const instagramAccountSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

    // OAuth / token material — never exposed to the client
    igUserId: { type: String },   // uniqueness declared as an index below
    accessToken: { type: String, select: false },
    tokenType: { type: String, default: 'bearer' },
    tokenExpiresAt: { type: Date },
    scopes: { type: [String], default: [] },

    // FR-5.1 synced profile fields
    username: { type: String },
    displayName: { type: String },
    profilePicture: { type: String },
    bio: { type: String },
    followers: { type: Number, default: 0 },
    following: { type: Number, default: 0 },
    mediaCount: { type: Number, default: 0 },

    // FR-5.2 insights (only where permissions allow)
    reach: { type: Number },
    insights: { type: Schema.Types.Mixed },

    accountType: { type: String, enum: INSTAGRAM_ACCOUNT_TYPES, default: 'UNKNOWN' },
    dataSource: { type: String, enum: ['self_reported', 'connected'], default: 'connected' },
    status: { type: String, enum: ['connected', 'revoked', 'expired'], default: 'connected', index: true },
    lastSyncedAt: { type: Date },
  },
  { timestamps: true },
);

/**
 * One Instagram account belongs to exactly one Marqueiver user.
 *
 * `igUserId` was indexed but not unique, so the same account could be attached
 * to any number of users — and because discovery ranks creators on connected
 * account data, one duplicated account meant the same audience counted several
 * times over. Sparse, because a record can exist mid-OAuth before Instagram has
 * returned the id.
 */
instagramAccountSchema.index({ igUserId: 1 }, { unique: true, sparse: true });

export const InstagramAccount = model('InstagramAccount', instagramAccountSchema);
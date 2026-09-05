import { Schema, model } from 'mongoose';

/**
 * A post, reel or carousel synced from a connected Instagram account.
 *
 * Separate from `InstagramAccount` because the cardinality is different — one
 * account, many media — and because embedding a growing array in the account
 * document would rewrite the whole document (tokens included) on every sync.
 *
 * ── What is deliberately NOT stored ────────────────────────────────────────
 * Media binaries. `media_url` and `thumbnail_url` are short-lived CDN links
 * that Meta expires, so they are stored as a cache to render with and refreshed
 * on sync, never treated as permanent. Re-hosting the image would be copying
 * the creator's content onto our infrastructure, which is a licensing decision
 * rather than a technical one and is not ours to make here.
 */
const instagramMediaSchema = new Schema(
    {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        account: { type: Schema.Types.ObjectId, ref: 'InstagramAccount', required: true, index: true },

        /** Instagram's own media id — the deduplication key. */
        mediaId: { type: String, required: true },

        caption: { type: String },
        mediaType: { type: String },          // IMAGE | VIDEO | CAROUSEL_ALBUM
        mediaProductType: { type: String },   // FEED | REELS | STORY
        mediaUrl: { type: String },
        thumbnailUrl: { type: String },
        permalink: { type: String },
        timestamp: { type: Date, index: true },

        /**
         * Counts Instagram serves on the media edge itself.
         *
         * Nullable rather than defaulted to 0, for the same reason the insights
         * do it: a post whose like count Instagram will not serve has not had
         * zero likes, and rendering it as `0` states something false about the
         * creator's performance.
         */
        likeCount: { type: Number, default: null },
        commentsCount: { type: Number, default: null },

        /**
         * Per-media insights, exactly as metric discovery resolved them:
         *   { reach: { available: true, value: 1234 },
         *     impressions: { available: false, reason: '…' } }
         *
         * Mixed because the metric set is Meta's to change — pinning a schema
         * to today's names would mean a migration every time Meta retires one,
         * which is the coupling this whole design exists to avoid.
         */
        insights: { type: Schema.Types.Mixed, default: {} },
        insightsSyncedAt: { type: Date },

        lastSyncedAt: { type: Date },
    },
    { timestamps: true },
);

/**
 * One row per media per account.
 *
 * Compound rather than a global unique on `mediaId`, because the same media
 * legitimately belongs to one account and the account is what scopes it. This
 * is what makes a re-sync idempotent: `updateOne(..., { upsert: true })` on
 * this key updates the existing row instead of appending a duplicate on every
 * run, which is the failure mode a sync without a uniqueness key always has.
 */
instagramMediaSchema.index({ account: 1, mediaId: 1 }, { unique: true });

/** The feed query: a user's media, newest first. */
instagramMediaSchema.index({ user: 1, timestamp: -1 });

export const InstagramMedia = model('InstagramMedia', instagramMediaSchema);
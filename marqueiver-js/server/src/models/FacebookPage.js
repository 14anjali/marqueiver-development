import mongoose from 'mongoose';

/**
 * A Facebook Page a Marq user has connected, and the tokens to act on it.
 *
 * ── What this model used to be ─────────────────────────────────────────────
 * Despite the name, nothing here was ever a Page. The connect handler called
 * Graph `/me` and wrote the person's own profile in, so `facebookPageId` held a
 * Facebook *user* id, `name` was the person's name, and `pageAccessToken` — a
 * `required: true` field — was never written at all. It saved regardless only
 * because Mongoose does not run validators on `findOneAndUpdate` by default, so
 * the schema stated a guarantee the data never met.
 *
 * It now stores what it says: the selected Page, its Page access token, and the
 * long-lived user token the Page token was derived from.
 *
 * ── Two tokens, two jobs ───────────────────────────────────────────────────
 *   userAccessToken  long-lived (~60 days). Used only to re-read /me/accounts —
 *                    to list Pages, to let someone change their selection, and
 *                    to re-derive a Page token.
 *   pageAccessToken  what every Page action uses: reading the Page, publishing,
 *                    moderating comments. Derived from the long-lived user
 *                    token, so it does not expire while the app stays
 *                    authorised. Never leaves the backend.
 *
 * Both are `select: false`, so they are absent from queries unless explicitly
 * asked for and cannot be leaked by a handler that forgets to strip them.
 */
const facebookPageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,        // one connected Page per Marq user
      index: true,
    },

    /**
     * The Facebook Page id.
     *
     * Not required: a connection exists in `pending_selection` from the moment
     * OAuth completes until the person picks which of their Pages to manage,
     * and there is no Page id before that choice. Marking it required would
     * have meant either failing that intermediate save or inventing a value.
     */
    facebookPageId: { type: String },

    /**
     * The app-scoped Facebook *user* id of the person who authorised.
     *
     * Meta's Deauthorize and Data Deletion callbacks identify a person by this
     * and nothing else, so a connection that does not record it cannot be found
     * when Meta asks us to delete it.
     */
    facebookUserId: { type: String, index: true, sparse: true },
    facebookUserName: { type: String },

    pageAccessToken: { type: String, select: false },
    userAccessToken: { type: String, select: false },
    tokenType: { type: String, default: 'bearer' },
    /** Expiry of the long-lived USER token. Page tokens inherit its lifetime. */
    tokenExpiresAt: { type: Date },
    scopes: { type: [String], default: [] },

    /**
     * What this user may do on this Page, straight from Graph `tasks`.
     *
     * Stored so the UI can disable "Publish" for someone with only ANALYZE
     * rather than discovering the limitation by failing a publish. Not an enum:
     * Meta adds task names, and a new one should narrow a button, not reject
     * the whole connection at save time.
     */
    tasks: { type: [String], default: [] },

    name: { type: String },
    username: { type: String },
    about: { type: String },
    description: { type: String },
    category: { type: String },
    profilePicture: { type: String },
    coverPhoto: { type: String },
    website: { type: String },
    link: { type: String },

    followersCount: { type: Number, default: 0 },
    likesCount: { type: Number, default: 0 },

    /**
     * Page insights, as metric discovery resolved them:
     *   { page_impressions_unique: { available: true, value: 4210 },
     *     page_video_views:        { available: false, reason: '…' } }
     *
     * Mixed because the metric set is Meta's to change — Facebook retires Page
     * metrics regularly, and a typed schema would mean a migration each time.
     * Declared explicitly rather than written ad hoc: strict mode drops
     * undeclared paths silently, which is how three fields in this codebase
     * were lost before anyone noticed.
     */
    insights: { type: mongoose.Schema.Types.Mixed, default: {} },

    /** The most recent posts with their engagement summaries, refreshed on sync. */
    recentPosts: { type: [mongoose.Schema.Types.Mixed], default: [] },

    dataSource: { type: String, enum: ['connected', 'manual'], default: 'connected' },

    /**
     * `pending_selection` is the real state between authorising and choosing a
     * Page. Without it the only options were to look connected while unusable,
     * or to throw away the user token and make the person authorise twice.
     */
    status: {
      type: String,
      enum: ['pending_selection', 'connected', 'expired', 'disconnected'],
      default: 'pending_selection',
      index: true,
    },

    lastSyncedAt: { type: Date },
  },
  { timestamps: true },
);

/**
 * One Facebook Page belongs to one Marq user.
 *
 * The original index was `{ user, facebookPageId }`, which stopped a single
 * user connecting the same Page twice and did nothing about two users both
 * claiming it — the opposite of what was needed. Sparse, because the Page id is
 * absent while a connection is in `pending_selection`.
 */
facebookPageSchema.index({ facebookPageId: 1 }, { unique: true, sparse: true });

/** Can this user publish to this Page, per Facebook's own answer? */
facebookPageSchema.methods.canPublish = function canPublish() {
  return this.tasks?.includes('CREATE_CONTENT') || this.tasks?.includes('MANAGE');
};

/** Can this user moderate comments on this Page? */
facebookPageSchema.methods.canModerate = function canModerate() {
  return this.tasks?.includes('MODERATE') || this.tasks?.includes('MANAGE');
};

export const FacebookPage = mongoose.model('FacebookPage', facebookPageSchema);
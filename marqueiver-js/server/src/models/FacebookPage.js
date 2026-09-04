import mongoose from 'mongoose';

const facebookPageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /**
     * NOTE: despite the name, this has always been populated from Graph `/me`,
     * so it holds the app-scoped Facebook *user* id rather than a Page id.
     * Renaming it would orphan every existing row, so `facebookUserId` below
     * records the same value under its true name and the Deauthorize / Data
     * Deletion callbacks match on either — see metaDataRemoval.service.js.
     */
    facebookPageId: {
      type: String,
      required: true,
    },

    /**
     * The app-scoped Facebook user id, stored explicitly because Meta's
     * Deauthorize and Data Deletion callbacks identify the person by this and
     * nothing else. Without it, those callbacks have no way to find the record
     * they are being told to delete.
     */
    facebookUserId: {
      type: String,
      index: true,
      sparse: true,
    },

    pageAccessToken: {
      type: String,
      required: true,
      select: false,
    },

    userAccessToken: {
      type: String,
      select: false,
    },

    tokenType: {
      type: String,
      default: 'bearer',
    },

    tokenExpiresAt: {
      type: Date,
    },

    scopes: {
      type: [String],
      default: [],
    },

    name: {
      type: String,
    },

    username: {
      type: String,
    },

    about: {
      type: String,
    },

    description: {
      type: String,
    },

    category: {
      type: String,
    },

    profilePicture: {
      type: String,
    },

    coverPhoto: {
      type: String,
    },

    website: {
      type: String,
    },

    followersCount: {
      type: Number,
      default: 0,
    },

    likesCount: {
      type: Number,
      default: 0,
    },

    dataSource: {
      type: String,
      enum: ['connected', 'manual'],
      default: 'connected',
    },

    status: {
      type: String,
      enum: ['connected', 'expired', 'disconnected'],
      default: 'connected',
    },

    lastSyncedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * One Facebook Page belongs to exactly one Marqueiver user.
 *
 * The previous index was `{ user, facebookPageId }`, which prevented a single
 * user connecting the same Page twice and did nothing about two different users
 * both claiming it — the opposite of what was needed. Uniqueness belongs on the
 * Page id alone.
 */
facebookPageSchema.index(
  { facebookPageId: 1 },
  { unique: true, sparse: true }
);

export const FacebookPage = mongoose.model(
  'FacebookPage',
  facebookPageSchema
);
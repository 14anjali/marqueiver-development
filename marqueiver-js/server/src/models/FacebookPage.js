import mongoose from 'mongoose';

const facebookPageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    facebookPageId: {
      type: String,
      required: true,
      index: true,
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

// Prevent the same Facebook Page from being connected repeatedly
facebookPageSchema.index(
  { user: 1, facebookPageId: 1 },
  { unique: true }
);

export const FacebookPage = mongoose.model(
  'FacebookPage',
  facebookPageSchema
);
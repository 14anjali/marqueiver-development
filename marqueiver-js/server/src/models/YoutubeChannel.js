import mongoose from 'mongoose';

const youTubeChannelSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    youtubeChannelId: {
      type: String,
      required: true,
    },
    accessToken: {
      type: String,
      required: true,
      select: false,
    },
    refreshToken: {
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
    title: {
      type: String,
    },
    description: {
      type: String,
    },
    customUrl: {
      type: String,
    },
    publishedAt: {
      type: Date,
    },
    thumbnails: {
      type: Object,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    subscriberCount: {
      type: Number,
      default: 0,
    },
    videoCount: {
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
 * One YouTube channel belongs to exactly one Marqueiver user. There was no
 * constraint here at all, so the same channel could back several profiles.
 */
youTubeChannelSchema.index({ youtubeChannelId: 1 }, { unique: true, sparse: true });

export const YouTubeChannel = mongoose.model('YouTubeChannel', youTubeChannelSchema);
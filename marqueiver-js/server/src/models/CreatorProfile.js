import { Schema, model } from 'mongoose';
const socialSchema = new Schema({
    platform: { type: String, required: true },
    handle: { type: String, required: true },
    followers: { type: Number, default: 0 },
    engagementRate: { type: Number, default: 0 },
    verified: { type: Boolean, default: false },
    dataSource: { type: String, enum: ['self_reported', 'connected'], default: 'self_reported' },
}, { _id: false });
const portfolioItemSchema = new Schema({
    title: { type: String, default: '' },
    mediaUrl: { type: String, required: true },
    thumbnailUrl: { type: String },
    mediaType: { type: String, enum: ['image', 'video'], default: 'image' },
    platform: { type: String, default: '' },   // optional: which platform this piece is from
    metrics: {
        views: { type: Number },
        likes: { type: Number },
        comments: { type: Number },
    },
    addedAt: { type: Date, default: Date.now },
}, { _id: true });
const creatorSchema = new Schema({
    /**
     * Policy 3.3 — Creators may unpublish their profile from discovery.
     * Unpublished profiles are excluded from search but stay intact, and
     * existing Collaborations are unaffected.
     */
    isPublished: { type: Boolean, default: true, index: true },
    unpublishedAt: Date,

    /**
     * Profile picture. The cover comment below has referred to "the existing
     * avatar" since this model was written, but the field was never actually
     * added — creator avatars were rendered from initials everywhere. Onboarding
     * now collects one, so it needs somewhere to live.
     */
    avatarUrl: { type: String, default: '' },

    /** Cover/banner image, alongside the avatar. */
    coverUrl: { type: String, default: '' },

    /**
     * Policy 3.2 / 13.2 — self-reported figures must never be presented as
     * verified. Kept apart from `socialAccounts`, which are API-sourced and
     * therefore verified, so the two can never be conflated downstream.
     */
    selfReportedMetrics: {
        followers: Number,
        avgViews: Number,
        engagementRate: Number,
        note: String,
        declaredAt: Date,
    },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    displayName: { type: String, required: true, index: 'text' },
    headline: { type: String, default: '' },
    bio: { type: String, default: '' },
    categories: { type: [String], default: [], index: true },
    languages: { type: [String], default: [] },

    /**
     * The contact channel the user did *not* sign up with, collected during
     * onboarding.
     *
     * Deliberately stored here and not on `User.email` / `User.phone`. Those two
     * are identity fields with unique indexes and they are what login resolves an
     * account by — writing an unverified value into them would let someone
     * occupy a phone number or address they do not control, and block its real
     * owner from ever signing up with it.
     *
     * These are profile data. To turn one into a real sign-in method the user
     * verifies it through the existing OTP flow (`POST /auth/link`), which is
     * what promotes it onto the User record.
     */
    contactEmail: { type: String, default: '' },
    contactPhone: { type: String, default: '' },
    gender: { type: String, enum: ['male', 'female', 'other'] },
    dob: Date,
    location: { city: String, country: { type: String, default: 'India' } },
    socialAccounts: { type: [socialSchema], default: [] },
    rateCard: {
        type: [{ contentType: String, price: Number, _id: false }],
        default: [],
    },
    collaborationTypes: { type: [String], default: ['paid'] },
    contentTypes: { type: [String], default: [] },
    availability: { type: Boolean, default: true, index: true },
    // Portfolio (feature #10) — creator-uploaded work samples, real data only.
    portfolio: { type: [portfolioItemSchema], default: [] },
    // Withdrawal destination for wallet payouts (feature: Wallet + Cashfree
    // Payouts). Stored once, reused on every withdrawal request.
    payoutMethod: {
        type: { type: String, enum: ['bank', 'upi'] },
        accountHolderName: String,
        bankAccount: String,
        ifsc: String,
        vpa: String,
    },
    creatorScore: { type: Number, default: 0 },
    responseTimeHrs: { type: Number, default: 24 },
    totalAudience: { type: Number, default: 0, index: true },
    avgEngagement: { type: Number, default: 0, index: true },
    minRate: { type: Number, default: 0, index: true },
}, { timestamps: true });
/** Recompute discovery rollups from embedded socials before every save. */
creatorSchema.pre('save', function (next) {
    const socials = this.socialAccounts ?? [];
    this.totalAudience = socials.reduce((s, a) => s + (a.followers || 0), 0);
    this.avgEngagement = socials.length
        ? Number((socials.reduce((s, a) => s + (a.engagementRate || 0), 0) / socials.length).toFixed(2))
        : 0;
    this.minRate = this.rateCard.length ? Math.min(...this.rateCard.map((r) => r.price)) : 0;
    next();
});
creatorSchema.index({ categories: 1, availability: 1, totalAudience: -1 });
export const CreatorProfile = model('CreatorProfile', creatorSchema);
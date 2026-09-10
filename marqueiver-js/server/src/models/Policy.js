import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * Policy versioning and acceptance — Policy 24, Policy 1.14, Policy 5.2.
 *
 * Three separate requirements drive this:
 *
 *  - **1.14** — "We may update these policies... Material changes will be
 *    notified at least 7 days before they take effect." So a policy needs an
 *    effective date in the future and a notification hook, not just a version
 *    string.
 *  - **24** — the platform must record which version a user accepted, when,
 *    and with what consent status.
 *  - **5.2** — a Collaboration must snapshot the governing policy version at
 *    Acceptance, so a later policy change never retroactively alters the terms
 *    of a deal already in flight.
 *
 * Acceptances are append-only. A user who accepts v2 after having accepted v1
 * gets a second row; the first is never overwritten, because the question
 * "what did this user agree to on the day they made that deal" has to remain
 * answerable.
 */

export const POLICY_SLUGS = [
  'terms-of-use',
  'privacy-policy',
  'creator-policy',
  'brand-policy',
  'campaign-collaboration-policy',
  'payment-escrow-policy',
  'cancellation-refund-policy',
  'content-ip-policy',
  'community-guidelines',
  'dispute-resolution-policy',
  'prohibited-activities-policy',
  'account-suspension-policy',
  'kyc-verification-policy',
  'commission-fees-policy',
  'advertising-disclosure-policy',
];

const policySchema = new Schema({
  slug: { type: String, enum: POLICY_SLUGS, required: true, index: true },
  title: { type: String, required: true },

  /** Semantic-ish version string, e.g. "1.0", "2.1". Unique per slug. */
  version: { type: String, required: true },

  /** Full policy text. Kept as text so an acceptance can always be read back. */
  body: { type: String, default: '' },
  documentUrl: String,

  /**
   * The same text as structured blocks, so the policy pages can render real
   * headings, lists and rate tables (Policy 7.1 and 14.2 are tables — flattening
   * them to prose would lose the numbers a user is agreeing to). `body` remains
   * the canonical text; this is a presentation of it.
   */
  sections: {
    type: [new Schema({
      number: String,
      heading: String,
      blocks: { type: [Schema.Types.Mixed], default: [] },
    }, { _id: false })],
    default: [],
  },
  intro: { type: [Schema.Types.Mixed], default: [] },

  /** Position in the policy document (1–15), for ordering the index page. */
  number: Number,

  /** Short public route for the policies named on the signup consent line. */
  route: String,
  signupPrimary: { type: Boolean, default: false },

  /**
   * Policy 1.14 — material changes need 7 days' notice, so a version can exist
   * and be notified before it governs anything. `effectiveFrom` in the future
   * means published-but-not-yet-binding.
   */
  effectiveFrom: { type: Date, required: true },

  /** Whether this change was material enough to require the 7-day notice. */
  materialChange: { type: Boolean, default: false },
  notifiedAt: Date,

  /** Which roles must accept this policy before using the platform. */
  requiredFor: {
    type: [String],
    enum: ['creator', 'brand', 'admin'],
    default: ['creator', 'brand'],
  },

  supersedes: { type: Schema.Types.ObjectId, ref: 'Policy' },
  publishedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

policySchema.index({ slug: 1, version: 1 }, { unique: true });
policySchema.index({ slug: 1, effectiveFrom: -1 });

/**
 * Ordering that decides which row governs. `effectiveFrom` is the policy
 * question; `version` then `_id` are tie-breakers, and they matter: two versions
 * of the same policy can legitimately share an effective date (V2 of the
 * Marqueiver Platform Policies carries the same 01 August 2026 date as the V1
 * rows it replaces). Sorting on `effectiveFrom` alone left that tie to be broken
 * arbitrarily by the storage engine, so which policy text a user was asked to
 * accept could vary between queries. It is deterministic now.
 */
const CURRENT_ORDER = { effectiveFrom: -1, version: -1, _id: -1 };

/** The version governing a given moment — the latest already in effect. */
policySchema.statics.currentFor = async function currentFor(slug, at = new Date()) {
  return this.findOne({ slug, effectiveFrom: { $lte: at } })
    .sort(CURRENT_ORDER)
    .lean();
};

/** Every policy in force right now, one row per slug. */
policySchema.statics.allCurrent = async function allCurrent(at = new Date()) {
  const rows = await this.find({ effectiveFrom: { $lte: at } })
    .sort({ slug: 1, ...CURRENT_ORDER })
    .lean();
  const seen = new Set();
  return rows.filter((p) => (seen.has(p.slug) ? false : seen.add(p.slug)));
};

const acceptanceSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  policy: { type: Schema.Types.ObjectId, ref: 'Policy', required: true },

  // Denormalised so an acceptance record stays readable even if the Policy row
  // is later edited. Policy 24 asks for an immutable record of what was agreed.
  slug: { type: String, required: true, index: true },
  version: { type: String, required: true },

  status: { type: String, enum: ['accepted', 'withdrawn'], default: 'accepted' },
  acceptedAt: { type: Date, default: Date.now },

  /** Where the acceptance happened: registration, onboarding, re-consent. */
  context: { type: String, default: 'registration' },
  ip: String,
  userAgent: String,
}, { timestamps: true });

acceptanceSchema.index({ user: 1, slug: 1, version: 1 }, { unique: true });

/**
 * Append-only. Policy 24 requires an immutable consent record — an acceptance
 * that could be edited afterwards proves nothing.
 */
acceptanceSchema.pre('findOneAndUpdate', function blockUpdate(next) {
  next(new Error('Policy acceptances are immutable and cannot be modified'));
});
acceptanceSchema.pre('updateOne', function blockUpdate(next) {
  next(new Error('Policy acceptances are immutable and cannot be modified'));
});
acceptanceSchema.pre('deleteOne', function blockDelete(next) {
  next(new Error('Policy acceptances are immutable and cannot be deleted'));
});

export const Policy = mongoose.models.Policy ?? mongoose.model('Policy', policySchema);
export const PolicyAcceptance =
  mongoose.models.PolicyAcceptance ?? mongoose.model('PolicyAcceptance', acceptanceSchema);

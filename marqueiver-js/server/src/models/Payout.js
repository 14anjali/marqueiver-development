import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * Money records — Policy 6.3, 6.4, 6.8, 14, 24.
 *
 * Policy 24 requires immutable audit records for money movement. A payout is
 * therefore a record of what happened, not a mutable status field on a deal:
 * once written, the amounts never change. A failed payout that is retried
 * produces a NEW record linked to the first, so the history of attempts stays
 * intact.
 *
 * The commission record exists separately from the payout because Policy 14.4
 * makes commission a deduction the Creator is entitled to see itemised, and
 * because platform revenue has to be reportable independently of whether a
 * particular payout succeeded.
 */

const commissionRecordSchema = new Schema({
  deal: { type: Schema.Types.ObjectId, ref: 'Deal', required: true, index: true },
  creator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  brand: { type: Schema.Types.ObjectId, ref: 'User', required: true },

  /** The Collaboration value the commission was computed from. */
  agreedValue: { type: Number, required: true },

  /**
   * Policy 14.7/14.8 — the rate applied is the one snapshotted at Acceptance,
   * not the rate in force when the release happened. Stored here as well so a
   * revenue report never has to re-derive it.
   */
  ratePct: { type: Number, required: true },
  amount: { type: Number, required: true },

  /**
   * Policy 5.5 / 7.1 / 10.4 — a release is not always the full value. This
   * records what the commission was actually charged on.
   */
  chargedOn: { type: Number, required: true },
  releaseReason: {
    type: String,
    enum: ['brand_approval', 'auto_completion', 'resolution', 'dispute_determination', 'cancellation'],
    required: true,
  },

  /** Policy 6.7 — GST on our fee, once registered. Zero while unregistered. */
  gstAmount: { type: Number, default: 0 },
  gstRatePct: { type: Number, default: 0 },

  recordedAt: { type: Date, default: Date.now },
}, { timestamps: true });

commissionRecordSchema.index({ recordedAt: -1 });

const payoutSchema = new Schema({
  deal: { type: Schema.Types.ObjectId, ref: 'Deal', required: true, index: true },
  creator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  /** Before deductions — what the Creator earned on this release. */
  grossAmount: { type: Number, required: true },

  commission: { type: Number, required: true, default: 0 },
  commissionRecord: { type: Schema.Types.ObjectId, ref: 'CommissionRecord' },

  /**
   * PENDING CA CONFIRMATION — Policy 6.8 (s.194-O / s.194R).
   * The fields exist so a payout can carry a deduction the day the treatment is
   * confirmed, without a schema migration. `tdsRatePct` stays null and
   * `tdsAmount` stays 0 until then; nothing here assumes a rate.
   */
  tdsAmount: { type: Number, default: 0 },
  tdsRatePct: { type: Number, default: null },
  tdsSection: { type: String, default: null },
  panOnRecord: { type: Boolean, default: false },
  otherDeductions: { type: Number, default: 0 },

  /** What actually leaves our account. */
  netAmount: { type: Number, required: true },

  status: {
    type: String,
    enum: ['pending', 'processing', 'paid', 'failed', 'reversed'],
    default: 'pending',
    index: true,
  },

  /** Policy 6.4 — payouts go to an account in the Creator's own name. */
  payoutMethod: { type: String, enum: ['upi', 'bank'], required: true },
  destinationMasked: String,      // never store the full account number here
  accountNameVerified: { type: Boolean, default: false },

  providerReference: { type: String, index: true },
  providerResponse: Schema.Types.Mixed,
  failureReason: String,

  /** Retries link back rather than overwriting the failed attempt. */
  supersedes: { type: Schema.Types.ObjectId, ref: 'Payout' },
  attempt: { type: Number, default: 1 },

  initiatedAt: { type: Date, default: Date.now },
  completedAt: Date,
}, { timestamps: true });

payoutSchema.index({ creator: 1, status: 1, initiatedAt: -1 });

/**
 * Policy 24 — money records are immutable. Status and provider fields are the
 * only things that may legitimately change as a payout progresses, so amounts
 * are frozen after creation and anything else must be a new record.
 */
const FROZEN_PAYOUT_FIELDS = [
  'grossAmount', 'commission', 'tdsAmount', 'otherDeductions', 'netAmount', 'deal', 'creator',
];

/**
 * Runs on `validate` rather than `save` so it fires BEFORE the balance check.
 * An edited amount should report that the record is immutable, not that the
 * arithmetic no longer adds up — the second message sends whoever hits it
 * looking for a maths bug that isn't there.
 */
payoutSchema.pre('validate', function freezeAmounts(next) {
  if (this.isNew) return next();
  const changed = FROZEN_PAYOUT_FIELDS.filter((f) => this.isModified(f));
  if (changed.length)
    return next(new Error(`Payout amounts are immutable; attempted to change: ${changed.join(', ')}`));
  next();
});

commissionRecordSchema.pre('save', function freezeRecord(next) {
  if (!this.isNew) return next(new Error('Commission records are immutable'));
  next();
});

/** Arithmetic must close: gross − deductions = net. */
payoutSchema.pre('validate', function checkArithmetic(next) {
  const expected = Math.round(
    (this.grossAmount - this.commission - this.tdsAmount - this.otherDeductions) * 100,
  ) / 100;
  if (Math.abs(expected - this.netAmount) > 0.01)
    return next(new Error(`Payout does not balance: ${this.grossAmount} − deductions ≠ ${this.netAmount}`));
  next();
});

export const CommissionRecord =
  mongoose.models.CommissionRecord ?? mongoose.model('CommissionRecord', commissionRecordSchema);
export const Payout = mongoose.models.Payout ?? mongoose.model('Payout', payoutSchema);

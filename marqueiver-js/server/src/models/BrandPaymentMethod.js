import { Schema, model } from 'mongoose';

/**
 * A brand's record of how it pays — NOT a chargeable instrument.
 *
 * ── Read this before using it for anything ─────────────────────────────────
 *
 * Marqueiver's Cashfree integration is the Payment Gateway *Orders* API
 * (`services/cashfree.service.js` → `createEscrowOrder`). Every escrow funding
 * creates a fresh order and hands the brand Cashfree's hosted checkout, where
 * the brand chooses the instrument on Cashfree's own page. There is no vault,
 * no saved-instrument token, and no Cashfree customer-instrument API in use
 * anywhere in this codebase.
 *
 * So a row here can never be charged. It is a reference record the brand keeps
 * for its own finance team: "campaign spend goes out of the HDFC current
 * account" or "we pay by UPI from this VPA". Every surface that shows one must
 * say so — `PaymentBilling.jsx` does — because a record that looks like a saved
 * card and silently is not is worse than no record at all.
 *
 * ── What is deliberately not stored ────────────────────────────────────────
 *
 * Nothing here is sensitive, by construction:
 *
 *  - **No card details, ever.** `type` has no card option. Accepting a PAN,
 *    expiry or CVV would put this application in PCI-DSS scope, and Cashfree's
 *    hosted checkout exists precisely so that never happens.
 *  - **No full bank account number.** The controller takes the number the brand
 *    types, keeps the last four digits, and discards the rest before the
 *    document is built. `accountLast4` plus `ifsc` is enough for a person to
 *    recognise their own account and not enough for anyone to move money.
 *  - **No verification claim.** `status` starts at `unverified` and nothing in
 *    the backend moves it: there is no bank-account penny-drop check and no
 *    admin review queue for brand payment accounts. The field exists so one can
 *    be added without a migration; until then the UI says "not verified"
 *    rather than implying a check that never ran.
 *
 * A UPI VPA is stored whole. It is a public payment address in the same sense
 * as an email address — it is how the brand identifies the method to itself,
 * and it cannot be used to pull money.
 */

export const BRAND_PAYMENT_METHOD_TYPES = ['bank', 'upi', 'netbanking'];

const brandPaymentMethodSchema = new Schema({
  /**
   * The owning brand's User, not the BrandProfile — authorization everywhere
   * else in this codebase keys on `req.auth.sub`, and matching that keeps the
   * ownership check a single equality rather than a join.
   */
  brand: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  type: { type: String, enum: BRAND_PAYMENT_METHOD_TYPES, required: true },

  /** What the brand calls it — "Marketing current account", "Founder UPI". */
  label: { type: String, default: '', trim: true, maxlength: 60 },

  /** bank / netbanking */
  bankName: { type: String, default: '', trim: true, maxlength: 80 },
  accountHolderName: { type: String, default: '', trim: true, maxlength: 120 },
  /** Last four digits only. The controller never lets the rest reach mongoose. */
  accountLast4: { type: String, default: '', match: /^[0-9]{0,4}$/ },
  ifsc: { type: String, default: '', uppercase: true, trim: true, maxlength: 11 },

  /** upi */
  vpa: { type: String, default: '', trim: true, lowercase: true, maxlength: 100 },

  /**
   * Exactly one default per brand, enforced in the controller by clearing every
   * row before setting one (the same order `setPrimaryPage` uses for Facebook
   * Pages — clear first, then set, so a crash between the two leaves no default
   * rather than two).
   */
  isDefault: { type: Boolean, default: false },

  /**
   * Reserved for a verification flow that does not exist yet. See the note
   * above: nothing writes anything but the default.
   */
  status: {
    type: String,
    enum: ['unverified', 'verified', 'rejected'],
    default: 'unverified',
  },
}, { timestamps: true });

brandPaymentMethodSchema.index({ brand: 1, createdAt: 1 });

export const BrandPaymentMethod = model('BrandPaymentMethod', brandPaymentMethodSchema);
/**
 * Platform commission — Policy 14, Policy 6.3, Policy 6.6/6.7.
 *
 * Replaces the earlier two-sided fee model, which Policy 14.5 forbids:
 * "The 12.5% commission is deducted from the Collaboration value and is not
 * charged additionally to the Brand." Policy 14.4: the only deduction from a
 * Creator is the commission on a completed Collaboration.
 *
 * Worked example from Policy 14.2, which this module must reproduce exactly:
 *   Agreed value            ₹10,000
 *   Funded into escrow      ₹10,000   ← brand pays the agreed value, nothing more
 *   Commission at 12.5%     ₹1,250
 *   Net to Creator          ₹8,750    (less statutory deduction, if any)
 *
 * Rate handling:
 *  - 14.7 — rates may change on 30 days' notice, and changes do not affect
 *    Collaborations already accepted.
 *  - 14.8 — promotional rates may apply, and "the applicable rate is that shown
 *    at the point of acceptance".
 * Both mean the rate must be SNAPSHOTTED onto the deal at acceptance and read
 * back from the deal at release. Never recompute from the live rate.
 *
 * GST (6.6): Marqueiver is not registered, so no tax is added. 6.7 requires
 * that this switch on cleanly with a rate and GSTIN, so it is configuration
 * rather than a code change. The default is off, matching the current position.
 *
 * PENDING CA CONFIRMATION (6.8): TDS under s.194-O / s.194R. The threshold
 * (₹5,00,000 gross receipts in a financial year) and the higher no-PAN rate are
 * left unconfigured deliberately — `statutoryDeduction` is always 0 until the
 * rules are confirmed, and the field exists so payouts can carry it later
 * without a schema change.
 */

const DEFAULT_COMMISSION_PCT = 12.5; // Policy 14.1

function readPct(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100)
    throw new Error(`${name} must be a percentage between 0 and 100, got "${raw}"`);
  return n;
}

/** The rate currently in force. Snapshot it at acceptance, never at release. */
export const currentCommissionPct = () => readPct('PLATFORM_COMMISSION_PCT', DEFAULT_COMMISSION_PCT);

/** GST is off until registration (6.6). Set both to switch it on (6.7). */
export const gstConfig = () => ({
  registered: process.env.GST_REGISTERED === 'true',
  gstin: process.env.GSTIN || null,
  ratePct: readPct('GST_RATE_PCT', 18),
});

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Money for a collaboration.
 *
 * @param {number} agreedValue      the Collaboration value agreed at acceptance
 * @param {number} [commissionPct]  the snapshotted rate; omit only before acceptance
 */
export function computeCollaborationMoney(agreedValue, commissionPct) {
  if (!Number.isFinite(agreedValue) || agreedValue < 0)
    throw new Error(`Invalid collaboration value: ${agreedValue}`);

  const pct = commissionPct ?? currentCommissionPct();
  const commission = round2((agreedValue * pct) / 100);

  const gst = gstConfig();
  // 6.7 — when registered, GST is charged in addition to the displayed amount.
  // It applies to our fee, not to the creator's earnings.
  const gstOnCommission = gst.registered ? round2((commission * gst.ratePct) / 100) : 0;

  return {
    agreedValue: round2(agreedValue),
    commissionPct: pct,
    commission,
    // 14.5 — the brand funds the agreed value and nothing more.
    escrowAmount: round2(agreedValue),
    brandPays: round2(agreedValue),
    gstOnCommission,
    gstApplied: gst.registered,
    // PENDING CA CONFIRMATION — always 0 until 194-O/194R rules are settled.
    statutoryDeduction: 0,
    // Derived by subtraction so the arithmetic always closes to the escrowed total.
    creatorNet: round2(agreedValue - commission),
  };
}

/**
 * The share of the collaboration paid up front.
 *
 * The confirmed requirement quoted in `modules/messaging/messaging.policy.js`
 * — "No collaboration communication before the required 50% escrow payment is
 * successfully verified", "Brand pays 50% advance" — is where this number comes
 * from. It is named rather than written as `/ 2` in three places, because a
 * split that is a literal in the code is a split nobody can change.
 */
export const ADVANCE_PCT = 50;

/**
 * The two tranches a collaboration is paid in.
 *
 * ── Split on the creator's net, not the gross ──────────────────────────────
 *
 * The advance is half of what the creator actually receives, after the
 * platform commission. Splitting the gross and deducting commission at the end
 * would put "50% advance: ₹31,000" in front of a creator whose first payment is
 * ₹27,125 — a number that is wrong in the direction that matters, and wrong at
 * the exact moment they are deciding whether to accept.
 *
 * ── The rounding closes ────────────────────────────────────────────────────
 *
 * `balance` is derived by subtraction rather than computed independently, so
 * advance + balance is exactly `creatorNet` at every value. Two halves each
 * rounded to the paisa can otherwise miss the total by a paisa, and a total
 * that does not add up is the one thing a payment summary may never do.
 */
export function paymentSchedule(agreedValue, commissionPct) {
  const money = computeCollaborationMoney(agreedValue, commissionPct);
  const advance = round2((money.creatorNet * ADVANCE_PCT) / 100);

  return {
    ...money,
    advancePct: ADVANCE_PCT,
    /** What the creator receives on each tranche. */
    creatorAdvance: advance,
    creatorBalance: round2(money.creatorNet - advance),
    /**
     * What the brand pays on each tranche — the same proportion of the gross,
     * because the commission is taken from the collaboration value rather than
     * added to it (Policy 14.1).
     */
    brandAdvance: round2((money.brandPays * ADVANCE_PCT) / 100),
    brandBalance: round2(money.brandPays - round2((money.brandPays * ADVANCE_PCT) / 100)),
  };
}

/**
 * Split a partial release — Policy 5.5 option C (50/50), Policy 7.1 stage-based
 * cancellation, and Policy 10.4 partial determinations all release less than
 * the full amount.
 *
 * Commission is charged on what the Creator actually receives, not on the full
 * agreed value: Policy 14.4 ties it to "a completed Collaboration", and
 * charging 12.5% of the whole on a 25% cancellation payment would take a third
 * of the creator's money.
 *
 * PENDING BUSINESS CONFIRMATION: the policy does not state whether commission
 * is charged at all on a cancellation settlement or a dispute split. This
 * module charges it on the released portion; set `chargeCommission: false` to
 * waive it once the position is confirmed.
 */
export function computePartialRelease({ agreedValue, commissionPct, creatorShare, chargeCommission = true }) {
  if (!Number.isFinite(creatorShare) || creatorShare < 0 || creatorShare > agreedValue)
    throw new Error('Creator share must be between zero and the agreed value');

  const pct = commissionPct ?? currentCommissionPct();
  const commission = chargeCommission ? round2((creatorShare * pct) / 100) : 0;

  return {
    agreedValue: round2(agreedValue),
    creatorGross: round2(creatorShare),
    commission,
    commissionPct: chargeCommission ? pct : 0,
    creatorNet: round2(creatorShare - commission),
    brandRefund: round2(agreedValue - creatorShare),
    statutoryDeduction: 0,
  };
}

/**
 * Cancellation outcomes — Policy 7.1 / 7.2, fixed by stage. These are NOT
 * discretionary: the policy states the split for each stage, so the system
 * computes it rather than asking an Admin.
 *
 * 7.1 Brand cancels:
 *   before acceptance            → creator 0%,   brand full refund
 *   after acceptance, pre-work   → creator 0%,   brand full refund
 *   after work begins, pre-submit→ creator 25%,  brand 75% refund
 *   after submission             → creator 100%, no refund
 *
 * 7.2 Creator cancels:
 *   after acceptance, pre-work   → brand full refund
 *   after work begins            → brand full refund unless partial deliverables
 *                                  are accepted, in which case pro-rata is agreed
 *   after submission             → cancellation unavailable
 */
export const BRAND_CANCELLATION_SHARE = {
  invitation: 0,
  negotiation: 0,
  accepted: 0,
  escrow_pending: 0,
  in_progress: 0.25,
  submitted: 1,
  revision: 1,
};

export function brandCancellationOutcome({ state, agreedValue, commissionPct }) {
  const share = BRAND_CANCELLATION_SHARE[state];
  if (share === undefined)
    throw new Error(`No cancellation rule defined for state "${state}"`);
  return computePartialRelease({
    agreedValue, commissionPct, creatorShare: round2(agreedValue * share),
  });
}

export function creatorCancellationOutcome({ state, agreedValue, commissionPct, acceptedPartialValue }) {
  if (state === 'submitted' || state === 'revision')
    throw new Error('A Creator cannot cancel after submission (Policy 7.2)');

  // Full brand refund unless the Brand has accepted partial deliverables.
  const creatorShare = acceptedPartialValue ?? 0;
  return computePartialRelease({ agreedValue, commissionPct, creatorShare });
}
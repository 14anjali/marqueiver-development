/**
 * Platform fee (B3).
 *
 * DECIDED: a fee is charged to **both** sides, at **different percentages**.
 * NOT DECIDED: the percentages themselves. They are explicitly TBD, and the
 * cleared decisions say "No percentage should be assumed until explicitly
 * decided."
 *
 * This module therefore ships with both rates at **0** and a loud warning on
 * boot. Zero is not a guess at the real rate — it is the only value that cannot
 * silently move someone's money by an amount nobody approved. Every escrow
 * figure in the system routes through `computeFees()`, so setting the real
 * numbers is a config change with no code change anywhere else.
 *
 * Set via env once decided:
 *   PLATFORM_FEE_BRAND_PCT=5      # charged on top of the agreed amount
 *   PLATFORM_FEE_CREATOR_PCT=10   # deducted from the creator's payout
 *
 * Rounding: fees round to the nearest paisa (2dp) and the creator payout is
 * derived by subtraction, so `creatorPayout + creatorFee` always equals the
 * agreed amount exactly and no rupee is created or lost to rounding.
 */

const pct = (name) => {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100)
        throw new Error(`${name} must be a percentage between 0 and 100, got "${raw}"`);
    return n;
};

export const BRAND_FEE_PCT = pct('PLATFORM_FEE_BRAND_PCT');
export const CREATOR_FEE_PCT = pct('PLATFORM_FEE_CREATOR_PCT');

/** True when the real percentages have not been configured yet. */
export const FEES_UNCONFIGURED = BRAND_FEE_PCT === null || CREATOR_FEE_PCT === null;

if (FEES_UNCONFIGURED && process.env.NODE_ENV !== 'test') {
    console.warn(
        '[platform-fee] B3 percentages are not configured — running with 0%% on both sides.\n' +
        '               Set PLATFORM_FEE_BRAND_PCT and PLATFORM_FEE_CREATOR_PCT before going live.',
    );
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Fee breakdown for an agreed amount.
 *
 * `agreedAmount` is what the two parties settled on in the offer. The brand
 * pays that plus its fee into escrow; the creator receives that minus its fee.
 *
 * @param {number} agreedAmount
 * @returns {{
 *   agreedAmount: number, brandFee: number, brandCharge: number,
 *   creatorFee: number, creatorPayout: number, platformRevenue: number,
 *   escrowAmount: number, brandFeePct: number, creatorFeePct: number,
 *   feesConfigured: boolean
 * }}
 */
export function computeFees(agreedAmount) {
    if (!Number.isFinite(agreedAmount) || agreedAmount < 0)
        throw new Error(`Invalid agreed amount: ${agreedAmount}`);

    const brandPct = BRAND_FEE_PCT ?? 0;
    const creatorPct = CREATOR_FEE_PCT ?? 0;

    const brandFee = round2((agreedAmount * brandPct) / 100);
    const creatorFee = round2((agreedAmount * creatorPct) / 100);

    return {
        agreedAmount: round2(agreedAmount),
        brandFeePct: brandPct,
        creatorFeePct: creatorPct,
        brandFee,
        // What the brand actually pays.
        brandCharge: round2(agreedAmount + brandFee),
        creatorFee,
        // Derived by subtraction so the arithmetic always closes.
        creatorPayout: round2(agreedAmount - creatorFee),
        platformRevenue: round2(brandFee + creatorFee),
        // What is held in escrow: the full brand charge.
        escrowAmount: round2(agreedAmount + brandFee),
        feesConfigured: !FEES_UNCONFIGURED,
    };
}

/**
 * Validates an Admin's custom escrow split (§8, A2/§4.4).
 *
 * The rule is `creator payout + brand refund = total escrow`. The split is
 * validated against the **escrowed total**, since that is the money actually
 * held. Whether the platform keeps its fee out of a split outcome is not
 * decided anywhere, so this deliberately does not skim one — the two figures
 * must account for the entire held amount.
 */
export function validateSplit({ escrowAmount, creatorPayout, brandRefund }) {
    for (const [name, v] of Object.entries({ escrowAmount, creatorPayout, brandRefund })) {
        if (!Number.isFinite(v) || v < 0)
            return { valid: false, reason: `${name} must be a non-negative number` };
    }
    if (creatorPayout > escrowAmount || brandRefund > escrowAmount)
        return { valid: false, reason: 'Neither party can receive more than the escrowed amount' };

    // Tolerance of one paisa for floating-point drift.
    if (Math.abs(round2(creatorPayout + brandRefund) - round2(escrowAmount)) > 0.01) {
        return {
            valid: false,
            reason: `Creator payout (${creatorPayout}) + brand refund (${brandRefund}) must equal the escrowed ${escrowAmount}`,
        };
    }
    return { valid: true };
}

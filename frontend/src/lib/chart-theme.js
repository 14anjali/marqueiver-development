/**
 * One chart theme, drawn from the Marqueiver tokens.
 *
 * Every chart in the product had been styled inline with hard-coded hexes that
 * belong to no palette — `#EAECF0` for the grid where the system's hairline is
 * the lilac-tinted `#E8E4F0`, `#6B7280` for tick labels where the muted ink is
 * `#6B4680`-family. Charts looked like a different product from the pages
 * around them.
 *
 * ── Why almost everything here is one hue ────────────────────────────────────
 *
 * The deals-by-state chart used to be a twelve-slice pie with a hand-written
 * colour per state. Two things were wrong with that beyond the look:
 *
 *  1. Three of its state names did not exist (`invited`, `negotiating`,
 *     `escrow_funded`), so those slices never coloured.
 *  2. "How many deals are in each state" is a **magnitude** question, and
 *     magnitude belongs on a common baseline, not in angles. A pie also forces
 *     identity into colour alone across twelve categories.
 *
 * Running a four-colour status palette through the colourblind-safety validator
 * settled it: the completed-green and ended-pink pair separates by ΔE 4.1 under
 * deuteranopia, well under the floor of 8 — a red-green colourblind reader
 * cannot tell "finished well" from "finished badly". No reordering fixes that;
 * the encoding was wrong.
 *
 * So state charts are ordered horizontal bars in ONE hue, with the state named
 * on the axis. Identity comes from the label, magnitude from the length. Colour
 * carries meaning only where it also carries a word — the `StatusPill` in the
 * tables, which pairs every colour with its label.
 */

/** Marqueiver tokens, mirrored here so charts cannot drift from the CSS. */
export const TOKEN = {
  brand: '#7C3AED',      // brand-600
  brandSoft: '#C4B5FD',  // brand-300
  money: '#C9821D',      // money-600 — passes 3:1 on the light surface
  jade: '#0F8A6A',       // jade-500
  pink: '#DB2777',       // pink-600
  ink: '#1B1130',
  muted: '#6B6480',
  line: '#E8E4F0',       // the lilac hairline, not a neutral grey
  surface: '#FFFFFF',
};

/**
 * Axis and grid styling.
 *
 * Recessive by design: the grid is a reference, not content. Horizontal rules
 * only — vertical grid lines on a time series add nothing a labelled x-axis
 * does not already give you.
 */
export const axis = {
  tick: { fontSize: 11, fill: TOKEN.muted },
  axisLine: false,
  tickLine: false,
};

export const grid = {
  strokeDasharray: '3 3',
  vertical: false,
  stroke: TOKEN.line,
};

/** Tooltip surface, matching the product's raised surfaces. */
export const tooltip = {
  contentStyle: {
    borderRadius: 12,
    border: `1px solid ${TOKEN.line}`,
    boxShadow: '0 8px 24px rgba(27,17,48,0.10)',
    fontSize: 12,
    padding: '8px 12px',
  },
  labelStyle: { color: TOKEN.ink, fontWeight: 600, marginBottom: 2 },
  cursor: { fill: 'rgba(124,58,237,0.06)' },
};

/**
 * Line marks. 2px, visible endpoints, no dot on every reading — a dot per point
 * on twelve months of data is twelve things competing with the line itself.
 */
export const line = (stroke = TOKEN.brand) => ({
  type: 'monotone',
  stroke,
  strokeWidth: 2,
  dot: false,
  activeDot: { r: 4, strokeWidth: 2, stroke: TOKEN.surface },
  isAnimationActive: false,
});

/** Bar marks: rounded at the data end only, so the baseline stays a baseline. */
export const bar = (fill = TOKEN.brand, horizontal = true) => ({
  fill,
  radius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
  isAnimationActive: false,
  maxBarSize: 28,
});

/** ₹1.2k / ₹3.4L — Indian units, because the audience reads in lakh. */
export const rupeeAxis = (v) => {
  if (Math.abs(v) >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (Math.abs(v) >= 1000) return `₹${Math.round(v / 1000)}k`;
  return `₹${v}`;
};

/** A readable label for a deal state, matching the pills elsewhere. */
export const stateLabel = (s) => ({
  escrow_pending: 'Awaiting payment',
  in_progress: 'In progress',
  pending_review: 'Awaiting review',
  resolution: 'Needs resolution',
  invitation: 'Invited',
  negotiation: 'Negotiating',
}[s] ?? String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));

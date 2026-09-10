/**
 * Shared types — single source of truth for backend + frontend.
 * Proposal §3: "shared types package … strict TypeScript end-to-end".
 */
export const PLATFORMS = [
    'instagram', 'youtube', 'linkedin', 'tiktok', 'x', 'facebook', 'pinterest',
];
export const DEAL_STATES = [
    'invited', 'negotiating', 'accepted', 'escrow_funded', 'in_progress',
    'submitted', 'revision', 'completed', 'disputed', 'cancelled',
];

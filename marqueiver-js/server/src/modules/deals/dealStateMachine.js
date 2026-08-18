export const TRANSITIONS = {
    invited: [
        { to: 'negotiating', actors: ['creator', 'brand'] },
        { to: 'accepted', actors: ['creator'] }, // creator accepts as-offered
        { to: 'cancelled', actors: ['creator', 'brand'] },
    ],
    negotiating: [
        { to: 'accepted', actors: ['creator', 'brand'] },
        { to: 'cancelled', actors: ['creator', 'brand'] },
    ],
    accepted: [
        { to: 'escrow_funded', actors: ['brand'], effect: 'fund_escrow' },
        { to: 'cancelled', actors: ['creator', 'brand'] },
    ],
    escrow_funded: [
        { to: 'in_progress', actors: ['creator', 'system'] },
        { to: 'disputed', actors: ['creator', 'brand'], effect: 'open_dispute' },
        { to: 'cancelled', actors: ['brand', 'admin'], effect: 'refund_escrow' },
    ],
    in_progress: [
        { to: 'submitted', actors: ['creator'] },
        { to: 'disputed', actors: ['creator', 'brand'], effect: 'open_dispute' },
    ],
    submitted: [
        { to: 'completed', actors: ['brand'], effect: 'release_escrow' },
        { to: 'revision', actors: ['brand'] },
        { to: 'disputed', actors: ['creator', 'brand'], effect: 'open_dispute' },
    ],
    revision: [
        { to: 'submitted', actors: ['creator'] },
        { to: 'disputed', actors: ['creator', 'brand'], effect: 'open_dispute' },
        { to: 'cancelled', actors: ['brand', 'admin'], effect: 'refund_escrow' },
    ],
    disputed: [
        // Admin-only resolution (proposal §5.3 — force refund / edit deal state).
        { to: 'completed', actors: ['admin'], effect: 'release_escrow' },
        { to: 'cancelled', actors: ['admin'], effect: 'refund_escrow' },
        { to: 'in_progress', actors: ['admin'], effect: 'resolve_dispute' },
    ],
    completed: [], // terminal
    cancelled: [], // terminal
};
export function canTransition(from, to, actor) {
    const rules = TRANSITIONS[from] ?? [];
    const rule = rules.find((r) => r.to === to);
    if (!rule)
        return { allowed: false, reason: `No transition ${from} → ${to}` };
    if (!rule.actors.includes(actor)) {
        return { allowed: false, reason: `${actor} may not perform ${from} → ${to}` };
    }
    return { allowed: true, rule };
}
export function isTerminal(state) {
    return TRANSITIONS[state].length === 0;
}

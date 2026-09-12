import { Types } from 'mongoose';
import { Deal } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { notify, dealPayload } from '../notifications/notifications.service.js';
import { bindingTerms, recordAmendment } from './terms.service.js';
import { TERMS_LOCKED_STATES } from './dealStateMachine.js';

/**
 * The Change Request workflow — the only way locked terms may change.
 *
 * ── Why this exists separately from negotiation ────────────────────────────
 *
 * Before the terms lock, a disagreement is settled by sending another proposal
 * version: nothing is binding yet, so a new version simply replaces the
 * position on the table. After the lock, the terms *are* binding, and a change
 * is a different kind of event — one party asking to be released from something
 * both of them agreed to. It needs the other party's consent, and it needs to
 * leave a record that survives the change.
 *
 * So a change request is not an offer. It names only the fields it wants to
 * move, it is answered rather than superseded, and accepting it appends an
 * amendment instead of rewriting the agreement.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 *
 * It does not move money. A change to `amount` changes what is owed; making the
 * escrow match is the payment path's job and is not wired here. A request that
 * would change the amount on a deal whose escrow is already funded is refused
 * for that reason, rather than accepted and quietly left inconsistent with the
 * money actually held.
 *
 * ── Relationship to Policy 5.5 option B ────────────────────────────────────
 *
 * Paid extra revisions are their own workflow (`additionalTerms.service.js`),
 * because they involve a fee and a payment. That path now records an amendment
 * through the same function this one uses, so both kinds of change appear in
 * one history and neither can change locked terms without leaving a trace.
 */

/** Fields a change request may move. A subset of the agreed terms, on purpose. */
export const CHANGEABLE_FIELDS = [
    'amount', 'deliverables', 'contentItems', 'guidelines',
    'startDate', 'deadline', 'usageRights', 'exclusivity',
    'otherTerms', 'revisionsAllowed',
];

/**
 * Once work has been submitted, or a dispute is running, a bilateral change is
 * no longer the right instrument — Policy 10 (dispute) and Policy 7
 * (cancellation) are. Allowing one here would let a party renegotiate scope
 * while an adjudication over that same scope was in progress.
 */
const REQUESTABLE_STATES = new Set(['accepted', 'escrow_pending', 'in_progress']);

function assertParty(deal, actorId, actorRole) {
    const expected = actorRole === 'creator' ? deal.creator : deal.brand;
    if (!expected || expected.toString() !== actorId)
        throw ApiError.forbidden('Not a party to this collaboration');
}

const otherParty = (deal, role) => (role === 'creator' ? deal.brand : deal.creator).toString();

/** The live request, if there is one. */
const livePending = (deal) => (deal.changeRequests ?? []).find((c) => c.status === 'pending');

/**
 * Propose a change to the locked terms.
 *
 * Only one may be open at a time. Two live requests would mean each party
 * answering a question whose premise the other was simultaneously changing, and
 * whichever landed second would be diffed against terms that had just moved.
 */
export async function proposeChange({ dealId, actorId, actorRole, changes, reason }) {
    const deal = await Deal.findById(dealId);
    if (!deal) throw ApiError.notFound('Collaboration not found');
    assertParty(deal, actorId, actorRole);

    if (!deal.agreedTerms?.lockedAt) {
        throw ApiError.unprocessable(
            'These terms are not locked yet — send a proposal instead. '
            + 'Change requests apply only after both parties have confirmed.',
        );
    }
    if (!REQUESTABLE_STATES.has(deal.state)) {
        throw ApiError.unprocessable(
            `Terms cannot be changed while a collaboration is ${deal.state}. `
            + 'Raise a dispute or a cancellation instead.',
        );
    }
    if (livePending(deal))
        throw ApiError.unprocessable('There is already a change request awaiting a response');

    const current = bindingTerms(deal) ?? {};
    const requested = {};
    for (const [field, to] of Object.entries(changes ?? {})) {
        if (!CHANGEABLE_FIELDS.includes(field)) continue;
        // Only fields that actually move. A request that changes nothing is one
        // the other party has to read and answer for no reason.
        if (JSON.stringify(current[field] ?? null) === JSON.stringify(to ?? null)) continue;
        requested[field] = to;
    }
    if (!Object.keys(requested).length)
        throw ApiError.unprocessable('Nothing in this request differs from the terms in force');

    /*
      A change to the fee once the money is held would leave escrow and the
      agreed amount disagreeing, and this workflow does not move money. Refused
      rather than accepted-and-inconsistent.
    */
    if ('amount' in requested && deal.escrow?.funded) {
        throw ApiError.unprocessable(
            'The fee cannot be changed once escrow is funded. Cancel and re-agree, '
            + 'or use additional terms for extra paid scope.',
        );
    }

    deal.changeRequests = [...(deal.changeRequests ?? []), {
        changes: requested,
        reason: reason ?? '',
        status: 'pending',
        proposedBy: new Types.ObjectId(actorId),
        proposedByRole: actorRole,
        proposedAt: new Date(),
    }];
    await deal.save();

    const created = deal.changeRequests[deal.changeRequests.length - 1];

    await notify({
        user: otherParty(deal, actorRole),
        type: 'deal.change_requested',
        title: 'Change requested',
        body: `The ${actorRole} has asked to change the agreed terms on "${deal.title}". `
            + 'Nothing changes unless you accept.',
        data: dealPayload(deal),
    }).catch(() => void 0);

    return { deal, changeRequest: created };
}

/**
 * Answer a change request.
 *
 * Only the party who did *not* raise it may answer — otherwise "both parties
 * agreed" would be one party clicking twice. Accepting appends an amendment;
 * the agreement itself is never rewritten.
 */
export async function respondToChange({ dealId, requestId, actorId, actorRole, accept, note }) {
    const deal = await Deal.findById(dealId);
    if (!deal) throw ApiError.notFound('Collaboration not found');
    assertParty(deal, actorId, actorRole);

    const request = (deal.changeRequests ?? []).id?.(requestId)
        ?? (deal.changeRequests ?? []).find((c) => String(c._id) === String(requestId));
    if (!request) throw ApiError.notFound('Change request not found');

    if (request.status !== 'pending')
        throw ApiError.unprocessable(`That change request is already ${request.status}`);
    if (request.proposedByRole === actorRole)
        throw ApiError.forbidden('The other party has to answer a change request');

    request.respondedAt = new Date();
    request.respondedBy = new Types.ObjectId(actorId);
    request.responseNote = note ?? '';

    if (!accept) {
        request.status = 'rejected';
        await deal.save();

        await notify({
            user: otherParty(deal, actorRole),
            type: 'deal.change_rejected',
            title: 'Change request declined',
            body: note
                ? `Your change request on "${deal.title}" was declined: ${note}`
                : `Your change request on "${deal.title}" was declined. The agreed terms stand.`,
            data: dealPayload(deal),
        }).catch(() => void 0);

        return { deal, changeRequest: request, amendment: null };
    }

    request.status = 'accepted';

    const amendment = recordAmendment(deal, {
        changes: request.changes,
        reason: request.reason,
        source: 'change_request',
        changeRequest: request._id,
        proposedBy: request.proposedBy,
        proposedByRole: request.proposedByRole,
        acceptedBy: new Types.ObjectId(actorId),
    });

    /*
      The working copy follows the amendment, so the rest of the app — revision
      counting, deadline reminders, the submission window — keeps reading one
      set of current terms rather than having to know about amendments.
      `usageRights` and `exclusivity` live at the top level (Policy 5.2).
    */
    for (const [field, change] of Object.entries(amendment?.changes ?? {})) {
        if (field === 'usageRights') deal.usageRights = change.to;
        else if (field === 'exclusivity') deal.exclusivity = change.to;
        else deal.terms[field] = change.to;
    }

    deal.timeline.push({
        from: deal.state, to: deal.state,
        by: new Types.ObjectId(actorId), byRole: actorRole,
        note: `Change request accepted — ${Object.keys(amendment?.changes ?? {}).join(', ')}`,
        at: new Date(),
    });

    await deal.save();

    await notify({
        user: otherParty(deal, actorRole),
        type: 'deal.change_accepted',
        title: 'Change accepted',
        body: `Your change request on "${deal.title}" was accepted. `
            + 'The agreed terms have been amended.',
        data: dealPayload(deal),
    }).catch(() => void 0);

    return { deal, changeRequest: request, amendment };
}

/**
 * Withdraw your own pending request.
 *
 * Unlike a proposal — which cannot be withdrawn, because the other party may be
 * relying on it while they decide — a change request asks for a concession, so
 * taking the ask back costs the other party nothing. Only the proposer, and
 * only while it is unanswered.
 */
export async function withdrawChange({ dealId, requestId, actorId, actorRole }) {
    const deal = await Deal.findById(dealId);
    if (!deal) throw ApiError.notFound('Collaboration not found');
    assertParty(deal, actorId, actorRole);

    const request = (deal.changeRequests ?? []).find((c) => String(c._id) === String(requestId));
    if (!request) throw ApiError.notFound('Change request not found');
    if (request.status !== 'pending')
        throw ApiError.unprocessable(`That change request is already ${request.status}`);
    if (request.proposedByRole !== actorRole)
        throw ApiError.forbidden('Only the party who raised a change request can withdraw it');

    request.status = 'withdrawn';
    request.respondedAt = new Date();
    await deal.save();

    return { deal, changeRequest: request };
}

/** Everything a party needs to see: the agreement, what applies now, and why. */
export function changeHistory(deal) {
    return {
        agreedTerms: deal.agreedTerms?.toObject?.() ?? deal.agreedTerms ?? null,
        bindingTerms: bindingTerms(deal),
        amendments: (deal.termsAmendments ?? []).map((a) => a.toObject?.() ?? a),
        changeRequests: (deal.changeRequests ?? []).map((c) => c.toObject?.() ?? c),
        locked: Boolean(deal.agreedTerms?.lockedAt),
        canRequest: Boolean(deal.agreedTerms?.lockedAt) && REQUESTABLE_STATES.has(deal.state),
    };
}

export { REQUESTABLE_STATES, TERMS_LOCKED_STATES };
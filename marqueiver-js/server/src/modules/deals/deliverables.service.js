import { bindingTerms } from './terms.service.js';

/**
 * The agreed deliverables, and what has been submitted against each.
 *
 * ── Where the list comes from ──────────────────────────────────────────────
 *
 * `bindingTerms(deal).contentItems` — the structured half of the agreed brief,
 * amendments applied. Not `deal.terms.contentItems`: an accepted amendment can
 * change what is being delivered, and a creator submitting against the original
 * list would be delivering the wrong thing while the page told them they were
 * on track.
 *
 * ── Keys ───────────────────────────────────────────────────────────────────
 *
 * `contentItems` are stored with `_id: false`, so there is no id to reference.
 * The key is therefore derived from the item's own content plus its position:
 * `reel|instagram|0`. That is stable for the ordinary case — nobody reorders a
 * brief — and it is deliberately not a bare index, so inserting an item does not
 * silently repoint every existing submission at a different deliverable.
 *
 * A submission also stores the label it was made against, so even if an
 * amendment does move the list, the submission keeps saying what it was for.
 *
 * ── Quantity ───────────────────────────────────────────────────────────────
 *
 * "2 × Reel" is one deliverable line, not two. Splitting it into two trackable
 * items would be inventing structure the brief does not have — the parties
 * agreed a line, and the line is what gets approved.
 */

const slug = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '-');

export const deliverableKey = (item, index) =>
    `${slug(item?.contentType) || 'item'}|${slug(item?.platform)}|${index}`;

export const deliverableLabel = (item) => {
    const qty = item?.quantity ?? 1;
    const type = item?.contentType || 'Deliverable';
    return `${qty} × ${type}${item?.platform ? ` (${item.platform})` : ''}`;
};

/** Images, video, everything else. Decided from the content type, once. */
export const deliverableFileKind = (contentType = '') => {
    if (/^image\//i.test(contentType)) return 'image';
    if (/^video\//i.test(contentType)) return 'video';
    return 'file';
};

/** One uploaded file, normalised. The single place `kind` is decided. */
export const toSubmissionFile = (f = {}, role = 'content') => ({
    url: f.url,
    name: f.name ?? '',
    contentType: f.contentType ?? '',
    kind: deliverableFileKind(f.contentType),
    ...(f.size != null ? { size: f.size } : {}),
    role: role === 'support' ? 'support' : 'content',
});

/** The agreed deliverables, in brief order. Empty when the brief has no items. */
export function agreedDeliverables(deal) {
    const items = bindingTerms(deal)?.contentItems ?? deal?.terms?.contentItems ?? [];
    return items.map((raw, i) => {
        const item = raw?.toObject?.() ?? raw;
        return {
            key: deliverableKey(item, i),
            label: deliverableLabel(item),
            contentType: item?.contentType ?? '',
            platform: item?.platform ?? '',
            quantity: item?.quantity ?? 1,
            notes: item?.notes ?? '',
        };
    });
}

const submissionsOf = (deal) => (deal?.workSubmissions ?? [])
    .map((s) => s?.toObject?.() ?? s);

/**
 * Every agreed deliverable with its submission history, newest first.
 *
 * History is never collapsed. A resubmission is an additional row, so "what did
 * they send us the first time" stays answerable — which is the whole reason a
 * revision request has to be evidenced by something.
 */
export function deliverableProgress(deal) {
    const agreed = agreedDeliverables(deal);
    const subs = submissionsOf(deal);

    const rows = agreed.map((d) => {
        const mine = subs
            .filter((s) => s.deliverable?.key === d.key)
            .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
        const latest = mine[0] ?? null;
        return {
            ...d,
            submissions: mine,
            latest,
            status: !latest ? 'not_submitted' : latest.reviewStatus ?? 'pending',
        };
    });

    /*
      Submissions that name no deliverable — collaborations agreed before this
      existed, and briefs with no structured items. They are not dropped: a
      submission nobody can see is a submission that did not happen.
    */
    const untagged = subs
        .filter((s) => !s.deliverable?.key || !agreed.some((d) => d.key === s.deliverable.key))
        .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    return { deliverables: rows, untagged };
}

/**
 * Has every agreed deliverable been approved by the brand?
 *
 * The gate on releasing payment. With no structured items the brief cannot say
 * what "every deliverable" means, so it falls back to the collaboration having
 * at least one approved submission — the same question, asked of what exists.
 */
export function allDeliverablesApproved(deal) {
    const { deliverables } = deliverableProgress(deal);
    const subs = submissionsOf(deal);

    if (!deliverables.length)
        return subs.some((s) => s.reviewStatus === 'approved');

    return deliverables.every((d) => d.status === 'approved');
}

/** What is still in the brand's court, in words a UI can show. */
export function outstandingDeliverables(deal) {
    const { deliverables } = deliverableProgress(deal);
    return deliverables.filter((d) => d.status !== 'approved').map((d) => d.label);
}
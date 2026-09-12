import { z } from 'zod';

/**
 * What a creator may send when applying, and how it is checked against the
 * campaign they are applying to.
 *
 * ── Two layers, because one cannot do the job ──────────────────────────────
 *
 * `applicationSchema` is the shape: field types, lengths, URL formats. It is a
 * plain zod object, so it plugs into the existing `validate()` middleware and
 * fails the request before the handler runs.
 *
 * `validateAgainstCampaign` is everything zod cannot express, because it
 * depends on the campaign: which questions exist, which are required, which
 * options a choice question offers, and whether this campaign accepts a
 * proposed price at all. A schema cannot know that; only the handler, holding
 * the campaign, can.
 *
 * ── What is deliberately not enforced ──────────────────────────────────────
 *
 * Eligibility. A creator who misses a follower floor may still apply — the
 * brand decides who it works with, and `campaignEligibility.service.js` exists
 * to inform that decision, not to gate it. Nothing here consults it.
 */

/** Public links only. A `javascript:` or `data:` URL is not a portfolio. */
const httpUrl = z.string().trim().url().refine(
    (u) => /^https?:\/\//i.test(u),
    { message: 'Links must start with http:// or https://' },
);

export const MAX_PITCH = 2000;
export const MAX_ANSWER = 1000;
export const MAX_LINKS = 8;
export const MAX_ATTACHMENTS = 6;

export const applicationSchema = z.object({
    /**
     * "Why are you the right creator?" — required, and with a floor rather than
     * just a ceiling: a one-word pitch is an application the brand cannot act
     * on, and letting it through wastes both sides' time.
     */
    pitch: z.string().trim().min(40, 'Tell the brand a little more — at least 40 characters.').max(MAX_PITCH),

    proposedPrice: z.number().min(0).max(100_000_000).nullable().optional(),

    portfolioLinks: z.array(httpUrl).max(MAX_LINKS).optional(),

    attachments: z.array(z.object({
        url: httpUrl,
        name: z.string().trim().max(200).optional(),
        kind: z.string().trim().max(100).optional(),
    })).max(MAX_ATTACHMENTS).optional(),

    answers: z.array(z.object({
        key: z.string().trim().min(1).max(40),
        value: z.string().trim().max(MAX_ANSWER).optional(),
        values: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    })).max(20).optional(),
}).strict();

/** Question types whose answer lives in `values`, not `value`. */
const MULTI = new Set(['multi_choice']);
const CHOICE = new Set(['single_choice', 'multi_choice']);

/**
 * Check a validated submission against the campaign it is for.
 *
 * Returns a list of human-readable problems — empty means it is fine. Messages
 * name the question rather than its key, because "q_a1b2c3 is required" is not
 * something a creator can act on.
 */
export function validateAgainstCampaign(submission, campaign) {
    const problems = [];
    const questions = campaign?.extras?.questions ?? [];
    const byKey = new Map(questions.map((q) => [q.key, q]));

    const answers = submission.answers ?? [];
    const answerByKey = new Map(answers.map((a) => [a.key, a]));

    /**
     * A price the campaign did not ask for.
     *
     * Silently dropping it would be worse than refusing: the creator would
     * believe they had named a price and the brand would never see one.
     */
    if (submission.proposedPrice != null && campaign?.commercials?.allowProposedPrice === false) {
        problems.push('This campaign is at a fixed fee and does not take a proposed price.');
    }

    for (const answer of answers) {
        if (!byKey.has(answer.key)) {
            // An answer to a question that does not exist means the form was
            // built from a different version of the campaign.
            problems.push('This campaign’s questions have changed since you opened the form. Reload and try again.');
            break;
        }
    }

    for (const q of questions) {
        const answer = answerByKey.get(q.key);
        const given = MULTI.has(q.type)
            ? (answer?.values ?? []).filter(Boolean)
            : String(answer?.value ?? '').trim();
        const empty = MULTI.has(q.type) ? given.length === 0 : given.length === 0;

        if (q.required && empty) {
            problems.push(`"${q.prompt}" is required.`);
            continue;
        }
        if (empty) continue;

        if (CHOICE.has(q.type)) {
            const allowed = new Set(q.options ?? []);
            const chosen = MULTI.has(q.type) ? given : [given];
            for (const pick of chosen) {
                if (!allowed.has(pick)) problems.push(`"${pick}" is not one of the options for "${q.prompt}".`);
            }
            if (!MULTI.has(q.type) && chosen.length > 1) {
                problems.push(`"${q.prompt}" takes one answer.`);
            }
        }

        if (q.type === 'link' && !/^https?:\/\/\S+$/i.test(given)) {
            problems.push(`"${q.prompt}" needs a link starting with http:// or https://`);
        }

        if (q.type === 'number' && !/^-?\d+(\.\d+)?$/.test(given)) {
            problems.push(`"${q.prompt}" needs a number.`);
        }
    }

    return problems;
}

/**
 * Keep only answers to questions the campaign actually asks.
 *
 * Validation has already refused an unknown key, so this is belt-and-braces
 * for the shape that reaches the database: a stored answer with no question
 * beside it is a row nothing will ever render.
 */
export function pruneAnswers(answers = [], campaign) {
    const keys = new Set((campaign?.extras?.questions ?? []).map((q) => q.key));
    return answers
        .filter((a) => keys.has(a.key))
        .map((a) => ({ key: a.key, value: a.value ?? '', values: a.values ?? [] }));
}
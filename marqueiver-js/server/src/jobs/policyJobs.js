import { Deal } from '../models/index.js';
import { transitionDeal } from '../modules/deals/deals.service.js';
import { notify } from '../modules/notifications/notifications.service.js';
import { REVIEW_WINDOW_DAYS, RESOLUTION_AUTO_DAYS } from '../modules/deals/dealStateMachine.js';

/**
 * Scheduled policy jobs — Policy 5.3, 5.5, 10.3.
 *
 * In-process scheduler rather than a queue: the platform runs a single API
 * process today, and adding Redis for three periodic sweeps would be
 * infrastructure without a payer. Every job is idempotent and driven by
 * database state rather than by in-memory timers, so a restart loses nothing
 * and a missed tick is picked up on the next run. If the deployment ever scales
 * to multiple instances this needs a lock — see `SCHEDULER_ENABLED`.
 *
 * Jobs:
 *  - 5.3 — Brand review reminders at day 3 and day 6, then automatic
 *    completion and release at day 7.
 *  - 5.5 — Resolution option C (release without use, 50/50) applies
 *    automatically after 7 days without agreement.
 *  - 10.3 — dispute SLA breach surfacing for Admin.
 */

const TICK_MS = Number(process.env.SCHEDULER_TICK_MS ?? 15 * 60 * 1000); // 15 min

/**
 * Off by default in test. Set SCHEDULER_ENABLED=false on every instance but one
 * if the API is ever horizontally scaled, otherwise two instances will race to
 * auto-complete the same Collaboration.
 */
const enabled = () => process.env.SCHEDULER_ENABLED !== 'false' && process.env.NODE_ENV !== 'test';

const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);

/**
 * Policy 5.3 — "If the Brand does not respond within 7 days, the deliverable is
 * deemed approved and payment is released."
 *
 * Deemed approval is not a dispute and not a penalty; it is the policy's
 * default outcome, so it runs as `system` and takes the normal release path,
 * which deducts commission and writes the Payout record like any other release.
 */
export async function runAutoCompletion(now = new Date()) {
    const due = await Deal.find({
        state: 'submitted',
        reviewDeadline: { $lte: now },
        'escrow.funded': true,
        'escrow.releasedAt': null,
    }).select('_id title brand creator').lean();

    const completed = [];
    for (const d of due) {
        try {
            await transitionDeal({
                dealId: String(d._id),
                to: 'completed',
                actor: 'system',
                actorId: null,
                note: `Automatically completed — the Brand did not respond within ${REVIEW_WINDOW_DAYS} days (Policy 5.3)`,
                releaseReason: 'auto_completion',
            });
            completed.push(String(d._id));

            for (const [user, body] of [
                [d.creator, `"${d.title}" was automatically completed and your payment has been released.`],
                [d.brand, `"${d.title}" was automatically completed because the review period ended without a response.`],
            ]) {
                await notify({
                    user: String(user),
                    type: 'deal.auto_completed',
                    title: 'Collaboration completed automatically',
                    body,
                    data: { dealId: String(d._id) },
                }).catch(() => void 0);
            }
        } catch (err) {
            // One bad deal must not stop the sweep.
            console.error(`[scheduler] auto-completion failed for ${d._id}:`, err.message);
        }
    }
    return completed;
}

/**
 * Policy 5.3 — review reminders. `reviewRemindersSent` records which have gone
 * out so a restart cannot send day 3 twice.
 */
export async function runReviewReminders(now = new Date()) {
    const sent = [];
    for (const day of [3, 6]) {
        const cutoff = new Date(now.getTime() - day * 24 * 3600 * 1000);
        const deals = await Deal.find({
            state: 'submitted',
            'workSubmissions.submittedAt': { $lte: cutoff },
            reviewRemindersSent: { $ne: day },
        }).select('_id title brand reviewDeadline').lean();

        for (const d of deals) {
            const remaining = REVIEW_WINDOW_DAYS - day;
            await notify({
                user: String(d.brand),
                type: 'deal.review_reminder',
                title: `Review needed on "${d.title}"`,
                body: `You have ${remaining} day${remaining === 1 ? '' : 's'} left to approve or request a revision. `
                    + 'After that the collaboration completes automatically and payment is released.',
                data: { dealId: String(d._id), day },
            }).catch(() => void 0);

            await Deal.updateOne({ _id: d._id }, { $addToSet: { reviewRemindersSent: day } });
            sent.push({ deal: String(d._id), day });
        }
    }
    return sent;
}

/**
 * Policy 5.5 option C — "release without use", 50/50, applied automatically if
 * the parties do not agree an outcome within 7 days of entering Resolution.
 */
export async function runResolutionAutoOptionC(now = new Date()) {
    const due = await Deal.find({
        state: 'resolution',
        resolutionDeadline: { $lte: now },
        'escrow.releasedAt': null,
    }).select('_id title brand creator escrow').lean();

    const applied = [];
    for (const d of due) {
        try {
            await Deal.updateOne({ _id: d._id }, { $set: { resolutionOption: 'C' } });
            await transitionDeal({
                dealId: String(d._id),
                to: 'completed',
                actor: 'system',
                actorId: null,
                note: `Resolution option C applied automatically after ${RESOLUTION_AUTO_DAYS} days (Policy 5.5)`,
                creatorShare: (d.escrow?.amount ?? 0) / 2,
            });
            applied.push(String(d._id));

            for (const user of [d.creator, d.brand]) {
                await notify({
                    user: String(user),
                    type: 'deal.resolution_auto',
                    title: 'Resolution applied automatically',
                    body: `No outcome was agreed on "${d.title}" within ${RESOLUTION_AUTO_DAYS} days, so the fee has been `
                        + 'split equally and the Brand may not use the content.',
                    data: { dealId: String(d._id) },
                }).catch(() => void 0);
            }
        } catch (err) {
            console.error(`[scheduler] resolution option C failed for ${d._id}:`, err.message);
        }
    }
    return applied;
}

async function tick() {
    try {
        await runReviewReminders();
        await runAutoCompletion();
        await runResolutionAutoOptionC();
    } catch (err) {
        console.error('[scheduler] tick failed:', err.message);
    }
}

let handle = null;

export function startScheduler() {
    if (!enabled()) return null;
    if (handle) return handle;
    // First run shortly after boot so a restart during a due window catches up.
    setTimeout(tick, 30_000);
    handle = setInterval(tick, TICK_MS);
    handle.unref?.();
    console.log(`[scheduler] policy jobs running every ${Math.round(TICK_MS / 60000)} min`);
    return handle;
}

export function stopScheduler() {
    if (handle) clearInterval(handle);
    handle = null;
}

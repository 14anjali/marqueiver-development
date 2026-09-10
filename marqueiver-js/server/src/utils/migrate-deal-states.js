/**
 * Migration: old deal states → cleared lifecycle (§1 of the cleared rules).
 *
 *   node src/utils/migrate-deal-states.js --dry-run
 *   node src/utils/migrate-deal-states.js --apply
 *
 * Defaults to a dry run. Nothing is written without `--apply`.
 *
 * MAPPING AND ITS JUDGEMENT CALLS — read before applying:
 *
 *   invited        → requested        straight rename
 *   negotiating    → negotiating      unchanged
 *   accepted       → terms_agreed     **see below**
 *   escrow_funded  → active           money is in and work is running
 *   in_progress    → active           straight rename
 *   submitted      → submitted        unchanged
 *   revision       → revision         unchanged
 *   completed      → completed        unchanged
 *   cancelled      → cancelled        **see below**
 *   disputed       → NOT MIGRATED     **needs a human decision**
 *
 * A45 — legacy `accepted` deals go back to `negotiating`, not forward to
 * `terms_agreed`. Under the cleared rules terms_agreed requires both parties to
 * have clicked Confirm Terms (§5), and these deals never had that UI, so the
 * confirmation genuinely never happened. Both parties re-confirm. This is the
 * conservative reading and it is what was decided; the cost is that deals which
 * had settled terms are briefly reopened.
 *
 * Deals already PAST acceptance (funded, in progress, submitted, in revision,
 * completed) are NOT sent back — money has moved or work has been done, and
 * reopening their terms would be destructive. They keep their mapped state and
 * get their confirmations back-filled as `legacyImplied`.
 *
 * A46 — old `cancelled` rows stay `cancelled`. No attempt is made to guess
 * which were rejections; only new deals use the rejected/cancelled distinction.
 *
 * A44 — `disputed` rows are left untouched. They migrate together with the
 * ticket system, once there is a ticket to attach each dispute to.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Deal } from '../models/index.js';

const STATE_MAP = {
    invited: 'requested',
    negotiating: 'negotiating',
    accepted: 'negotiating',
    escrow_funded: 'active',
    in_progress: 'active',
    submitted: 'submitted',
    revision: 'revision',
    completed: 'completed',
    cancelled: 'cancelled',
};

const apply = process.argv.includes('--apply');

/** Deals past acceptance keep their state; only `accepted` is sent back (A45). */
const PAST_ACCEPTANCE = ['escrow_funded', 'in_progress', 'submitted', 'revision', 'completed'];

async function main() {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 8000 });
    console.log(`Connected. Mode: ${apply ? 'APPLY' : 'DRY RUN'}\n`);

    const deals = await Deal.find({}).lean();
    const counts = {};
    const disputed = [];
    const needsReconfirm = [];
    let changed = 0;

    for (const deal of deals) {
        if (deal.state === 'disputed') {
            disputed.push(deal);
            continue;
        }

        let target = STATE_MAP[deal.state];
        if (!target) {
            // Already migrated, or an unexpected value.
            counts[`${deal.state} (untouched)`] = (counts[`${deal.state} (untouched)`] ?? 0) + 1;
            continue;
        }

        const update = { state: target };

        if (deal.state === 'accepted') {
            // A45 — terms were never dual-confirmed, so clear any confirmation
            // and send the deal back to negotiation for both parties to confirm.
            update.termsConfirmation = { brand: {}, creator: {}, agreedAt: null };
            needsReconfirm.push(deal._id);
        } else if (PAST_ACCEPTANCE.includes(deal.state)) {
            // Money has moved or work has been done — do not reopen terms.
            const at = deal.updatedAt ?? deal.createdAt ?? new Date();
            update.termsConfirmation = {
                brand: { at, by: deal.brand },
                creator: { at, by: deal.creator },
                agreedAt: at,
                legacyImplied: true,
            };
        }

        counts[`${deal.state} → ${target}`] = (counts[`${deal.state} → ${target}`] ?? 0) + 1;
        changed++;

        if (apply) await Deal.updateOne({ _id: deal._id }, { $set: update });
    }

    console.log('State changes:');
    for (const [k, v] of Object.entries(counts)) console.log(`  ${v.toString().padStart(5)}  ${k}`);
    console.log(`\n  ${changed} deal(s) ${apply ? 'updated' : 'would be updated'}`);

    if (needsReconfirm.length)
        console.log(`\n  ${needsReconfirm.length} deal(s) sent back to negotiating — both parties must re-confirm terms (A45)`);

    if (disputed.length) {
        console.log(`\n   ${disputed.length} deal(s) in "disputed" left untouched (A44) — they migrate with the ticket system.`);
        for (const d of disputed)
            console.log(`   ${d._id}  "${d.title}"  raised ${d.dispute?.raisedAt ?? 'unknown'}  ₹${d.escrow?.amount ?? 0}`);
    }

    if (!apply) console.log('\nDry run — nothing was written. Re-run with --apply.');
    await mongoose.connection.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

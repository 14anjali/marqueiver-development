/**
 * Migration — let a creator connect more than one Facebook Page.
 *
 * `FacebookPage.user` used to carry `unique: true`, so MongoDB holds a unique
 * index named `user_1`. Removing the flag from the schema does **not** drop
 * that index: Mongoose creates indexes, it never deletes them, so without this
 * script the database keeps rejecting a second Page with E11000 while the code
 * happily tries to insert one. That failure mode is quiet and confusing — the
 * app looks correct and the write fails — so this is a required step, not an
 * optional tidy-up.
 *
 * What it does, in order:
 *
 *   1. Drops the `user_1` unique index if it is present and unique. A non-unique
 *      `user_1` is exactly what we want to keep, so it is left alone.
 *   2. Creates the replacement indexes via `syncIndexes()`.
 *   3. Marks one Page per user as primary. Every existing user has exactly one
 *      Page, so this is unambiguous — but it has to be set, because discovery
 *      and the public profile now read the primary flag, and a user whose only
 *      Page is not flagged would silently drop off their own profile.
 *
 * Safe to run repeatedly: each step checks the current state first.
 *
 * Dry run by default, matching `migrate-auth-identity.js`: dropping an index
 * cannot be undone by re-running the script, so the report comes first.
 *
 *   node src/utils/migrate-facebook-multipage.js           # report only
 *   node src/utils/migrate-facebook-multipage.js --apply   # make the changes
 */
import { connectDb, disconnectDb } from '../config/db.js';
import { FacebookPage } from '../models/index.js';
import { logger } from '../config/logger.js';

const APPLY = process.argv.includes('--apply');

const say = (...a) => console.log(APPLY ? '[migrate]' : '[dry-run]', ...a);

/**
 * @param {boolean} apply  write changes; false reports only
 */
export async function migrateFacebookMultipage(apply = APPLY) {
    const DRY = !apply;
    const collection = FacebookPage.collection;

    /* ── 1. the old unique index ─────────────────────────────────────────── */
    let indexes = [];
    try {
        indexes = await collection.indexes();
    } catch (err) {
        // An empty collection has no indexes yet, which is not an error here.
        if (err.codeName !== 'NamespaceNotFound') throw err;
        say('collection does not exist yet — nothing to migrate');
        return { droppedIndex: false, primariesSet: 0 };
    }

    const userIndex = indexes.find((i) => i.name === 'user_1');
    let droppedIndex = false;

    if (userIndex?.unique) {
        say('found unique index user_1 — this is what blocks a second Page');
        if (DRY) {
            say('would drop user_1');
        } else {
            await collection.dropIndex('user_1');
            droppedIndex = true;
            say('dropped user_1');
        }
    } else if (userIndex) {
        say('user_1 exists and is not unique — already migrated, leaving it');
    } else {
        say('no user_1 index — nothing to drop');
    }

    /* ── 2. the replacement indexes ──────────────────────────────────────── */
    if (!DRY) {
        await FacebookPage.syncIndexes();
        say('synced indexes (facebookPageId unique, one_pending_selection_per_user, user+status)');
    }

    /* ── 3. one primary Page per user ────────────────────────────────────── */
    const usersWithoutPrimary = await FacebookPage.aggregate([
        { $match: { status: 'connected' } },
        // `$first` only means "oldest" if the pipeline is sorted — without this
        // the chosen Page varies between runs, so a re-run could move a
        // creator's public Facebook presence to a different Page.
        { $sort: { createdAt: 1, _id: 1 } },
        {
            $group: {
                _id: '$user',
                anyPrimary: { $max: { $cond: ['$isPrimary', 1, 0] } },
                // Oldest connected Page wins, so a re-run is deterministic and
                // the choice matches what the profile showed before.
                first: { $first: '$_id' },
            },
        },
        { $match: { anyPrimary: 0 } },
    ]);

    say(`${usersWithoutPrimary.length} user(s) have connected Pages but no primary`);

    let primariesSet = 0;
    if (!DRY) {
        for (const row of usersWithoutPrimary) {
            await FacebookPage.updateOne({ _id: row.first }, { isPrimary: true });
            primariesSet += 1;
        }
    }

    say(DRY
        ? `would set ${usersWithoutPrimary.length} primary Page(s)`
        : `set ${primariesSet} primary Page(s)`);
    return { droppedIndex, primariesSet };
}

/* Run directly, not when imported by a test. */
const isMain = process.argv[1]?.endsWith('migrate-facebook-multipage.js');

if (isMain) {
    try {
        await connectDb();
        const result = await migrateFacebookMultipage();
        say('done', result);
        if (!APPLY) {
            say('');
            say('Nothing was written. Re-run with --apply to make these changes.');
        }
    } catch (err) {
        logger.error('Facebook multi-Page migration failed', err);
        process.exitCode = 1;
    } finally {
        await disconnectDb().catch(() => {});
    }
}
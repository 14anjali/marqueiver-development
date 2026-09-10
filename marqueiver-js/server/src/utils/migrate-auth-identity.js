import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { User, Policy } from '../models/index.js';
import { logger } from '../config/logger.js';
import { toE164 } from '../services/msg91.service.js';

/**
 * Migrate existing accounts onto the rebuilt auth model.
 *
 *   node src/utils/migrate-auth-identity.js            # report only, changes nothing
 *   node src/utils/migrate-auth-identity.js --apply    # make the changes
 *
 * It is a dry run by default because two of these steps are destructive-looking
 * and one of them (index rebuilding) cannot be undone by re-running the script.
 * Read the report first.
 *
 * What it does, and why each step is needed:
 *
 *  1. **Strip synthetic phone numbers.** The old schema made `phone` required
 *     and globally unique, so email-only and Google signups stored
 *     `e_alice@example.com` and `g_109741...` in the phone field. Those values
 *     hold the unique index, so the user could never add their real number, and
 *     they make "find the account for this phone" return nonsense.
 *
 *  2. **Normalise real numbers to E.164.** Login looks accounts up by exact
 *     match. `+91 90000 00000`, `9190000000000` and `09000000000` are the same
 *     person, and today only one of them can sign in.
 *
 *  3. **Backfill verification timestamps.** Policy 13.1 asks *when* an
 *     identifier was verified, not only whether. Existing rows have the boolean
 *     and not the date; `createdAt` is the honest approximation and is recorded
 *     as such.
 *
 *  4. **Backfill `authProviders`** from the identifiers each account actually
 *     holds, so the login screen can tell a returning user how they signed up.
 *
 *  5. **Report duplicate identities.** One phone or email may now belong to only
 *     one account (Policy 1.3, and a hard requirement of role-free login).
 *     Duplicates are *reported, never merged or deleted* — choosing which of two
 *     real accounts survives is a business decision with money attached, not
 *     something a migration should decide at 3am. The unique indexes are not
 *     built while duplicates exist.
 *
 *  6. **Retire superseded placeholder policy rows.** Earlier boots seeded the
 *     fifteen policies as v1.0 with an empty body. Those rows are removed once
 *     the real v2.0 text is published, because a policy page that renders
 *     nothing is worse than no page. PolicyAcceptance rows are untouched —
 *     they denormalise slug and version, so historical consents stay readable.
 *
 *  7. **Rebuild indexes** to match the current schema.
 */

const APPLY = process.argv.includes('--apply');
const tag = APPLY ? '' : '  [dry run]';

async function main() {
    await connectDb();
    logger.info(`▶ auth identity migration${tag}`);

    const report = {
        syntheticPhones: 0,
        normalisedPhones: 0,
        emailsLowercased: 0,
        verifiedAtBackfilled: 0,
        providersBackfilled: 0,
        duplicatePhones: [],
        duplicateEmails: [],
        placeholderPoliciesRemoved: 0,
    };

    const users = await User.find({}).select(
        'phone email googleId phoneVerified emailVerified phoneVerifiedAt emailVerifiedAt '
        + 'authProviders role createdAt accountStatus status',
    );

    for (const u of users) {
        const set = {};
        const unset = {};

        /* 1 + 2 — phone */
        if (u.phone) {
            if (/^(e_|g_)/.test(u.phone)) {
                unset.phone = '';
                report.syntheticPhones += 1;
            } else {
                const e164 = toE164(u.phone);
                if (e164 && e164 !== u.phone) {
                    set.phone = e164;
                    report.normalisedPhones += 1;
                }
            }
        }

        /* email casing — lookups are exact-match, so casing decides who signs in */
        if (u.email && u.email !== u.email.toLowerCase()) {
            set.email = u.email.toLowerCase();
            report.emailsLowercased += 1;
        }

        /* 3 — verification timestamps */
        if (u.phoneVerified && !u.phoneVerifiedAt) {
            set.phoneVerifiedAt = u.createdAt ?? new Date();
            report.verifiedAtBackfilled += 1;
        }
        if (u.emailVerified && !u.emailVerifiedAt) {
            set.emailVerifiedAt = u.createdAt ?? new Date();
            report.verifiedAtBackfilled += 1;
        }

        /* 4 — auth providers */
        if (!u.authProviders?.length) {
            const providers = [];
            const realPhone = u.phone && !/^(e_|g_)/.test(u.phone);
            if (realPhone) providers.push('phone');
            if (u.email) providers.push('email');
            if (u.googleId) providers.push('google');
            if (providers.length) {
                set.authProviders = providers;
                report.providersBackfilled += 1;
            }
        }

        /* accountStatus mirrors the legacy `status` where it was never set */
        if (!u.accountStatus) set.accountStatus = u.status === 'suspended' ? 'suspended' : 'active';

        const hasWork = Object.keys(set).length || Object.keys(unset).length;
        if (hasWork && APPLY) {
            await User.updateOne({ _id: u._id }, {
                ...(Object.keys(set).length ? { $set: set } : {}),
                ...(Object.keys(unset).length ? { $unset: unset } : {}),
            });
        }
    }

    /* 5 — duplicate identities, reported after normalisation */
    const dupe = async (field) => User.aggregate([
        { $match: { [field]: { $type: 'string', $ne: '' } } },
        { $group: { _id: `$${field}`, ids: { $push: '$_id' }, roles: { $push: '$role' }, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
    ]);

    report.duplicatePhones = await dupe('phone');
    report.duplicateEmails = await dupe('email');

    /* 6 — retire superseded placeholder policy rows */
    const published = new Set((await Policy.find({ version: '2.0' }).select('slug').lean()).map((p) => p.slug));
    const placeholders = await Policy.find({
        version: { $ne: '2.0' },
        $or: [{ body: '' }, { body: { $exists: false } }],
    }).select('slug version').lean();
    const removable = placeholders.filter((p) => published.has(p.slug));
    report.placeholderPoliciesRemoved = removable.length;
    if (APPLY && removable.length) {
        await Policy.deleteMany({ _id: { $in: removable.map((p) => p._id) } });
    }

    /* 7 — indexes */
    const blocked = report.duplicatePhones.length || report.duplicateEmails.length;
    if (APPLY && !blocked) {
        // Drop the retired compound indexes explicitly; syncIndexes only removes
        // what it can see in the current schema.
        for (const name of ['phone_1_role_1', 'email_1_role_1']) {
            await User.collection.dropIndex(name).catch(() => {});
        }
        await User.syncIndexes();
        await mongoose.model('Otp').syncIndexes().catch(() => {});
        logger.info('✔ indexes rebuilt');
    }

    print(report, blocked);
    await disconnectDb();
    process.exit(blocked && APPLY ? 1 : 0);
}

function print(r, blocked) {
    const lines = [
        '',
        `─── auth identity migration${tag} ───`,
        `  synthetic phones removed        ${r.syntheticPhones}`,
        `  phone numbers normalised        ${r.normalisedPhones}`,
        `  emails lowercased               ${r.emailsLowercased}`,
        `  verifiedAt timestamps filled    ${r.verifiedAtBackfilled}`,
        `  authProviders backfilled        ${r.providersBackfilled}`,
        `  placeholder policy rows removed ${r.placeholderPoliciesRemoved}`,
        '',
    ];

    if (blocked) {
        lines.push('  ⚠  DUPLICATE IDENTITIES — indexes NOT rebuilt.');
        lines.push('     One phone or email may belong to only one account (Policy 1.3),');
        lines.push('     and role-free login has no way to choose between two matches.');
        lines.push('     Decide which account survives, then re-run with --apply.');
        lines.push('');
        for (const d of r.duplicatePhones)
            lines.push(`     phone ${d._id} → ${d.n} accounts (${d.roles.join(', ')})  ids: ${d.ids.join(' ')}`);
        for (const d of r.duplicateEmails)
            lines.push(`     email ${d._id} → ${d.n} accounts (${d.roles.join(', ')})  ids: ${d.ids.join(' ')}`);
        lines.push('');
    } else {
        lines.push('  ✔ no duplicate identities');
    }

    if (!APPLY) {
        lines.push('');
        lines.push('  Nothing was written. Re-run with --apply to make these changes.');
    }
    lines.push('');
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
}

main().catch(async (err) => {
    logger.error('Migration failed', err);
    await disconnectDb().catch(() => {});
    process.exit(1);
});

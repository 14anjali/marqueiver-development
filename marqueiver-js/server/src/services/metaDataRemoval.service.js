import { InstagramAccount, FacebookPage, CreatorProfile } from '../models/index.js';

/**
 * Removal of Meta-derived data, for the Deauthorize and Data Deletion callbacks.
 *
 * ── Scope, and why it is not "delete the account" ──────────────────────────
 * Meta's requirement is that we delete the data we obtained *from Meta* about
 * the person. It is not an instruction to erase their Marqueiver account, and
 * acting as though it were would be actively harmful: a creator mid-deal has an
 * escrow balance, a signed brief and a payout trail, and Indian tax and
 * accounting rules require those financial records to be retained regardless of
 * a social disconnection. Deleting the account here would also mean a person
 * who merely revoked an app permission in Facebook's settings — something
 * people do routinely, without any intention of leaving — would silently lose
 * their money and their history.
 *
 * So what is removed is everything sourced from Meta:
 *  - the connection record itself, including the access tokens;
 *  - the synced profile fields and insights on that record;
 *  - the mirrored entry in `CreatorProfile.socialAccounts`, which is a copy of
 *    Meta data and would otherwise keep the handle and follower count visible
 *    in discovery after the source was deleted.
 *
 * Account deletion is a separate, user-initiated flow (`User.deletedAt`).
 *
 * ── Why both id fields are matched for Facebook ────────────────────────────
 * `FacebookPage.facebookPageId` has, since the integration was written, been
 * populated from Graph `/me` — so it holds the app-scoped *user* id, not a Page
 * id. `facebookUserId` now records that value under its real name, but existing
 * rows only have the mis-named field, and a deletion request that failed to
 * match them would be a deletion we told Meta we had performed and had not.
 * Both are therefore matched until the data is backfilled.
 */

/** Remove the mirrored copy of a platform from each creator profile. */
async function pullSocialMirror(userIds, platform) {
    if (!userIds.length) return 0;
    const result = await CreatorProfile.updateMany(
        { user: { $in: userIds } },
        { $pull: { socialAccounts: { platform } } },
    );
    return result.modifiedCount ?? 0;
}

/**
 * @param {string} providerUserId  app-scoped Facebook user id from signed_request
 * @returns {Promise<{userIds: string[], removed: object}>}
 */
export async function removeFacebookData(providerUserId) {
    const id = String(providerUserId);

    const pages = await FacebookPage
        .find({ $or: [{ facebookUserId: id }, { facebookPageId: id }] })
        .select('_id user')
        .lean();

    if (!pages.length) {
        return { userIds: [], removed: { facebookPages: 0, socialProfileEntries: 0 } };
    }

    const userIds = [...new Set(pages.map((p) => String(p.user)))];

    const deleted = await FacebookPage.deleteMany({ _id: { $in: pages.map((p) => p._id) } });
    const mirrored = await pullSocialMirror(userIds, 'facebook');

    return {
        userIds,
        removed: {
            facebookPages: deleted.deletedCount ?? 0,
            socialProfileEntries: mirrored,
        },
    };
}

/**
 * @param {string} providerUserId  Instagram user id from signed_request
 * @returns {Promise<{userIds: string[], removed: object}>}
 */
export async function removeInstagramData(providerUserId) {
    const id = String(providerUserId);

    const accounts = await InstagramAccount
        .find({ igUserId: id })
        .select('_id user')
        .lean();

    if (!accounts.length) {
        return { userIds: [], removed: { instagramAccounts: 0, socialProfileEntries: 0 } };
    }

    const userIds = [...new Set(accounts.map((a) => String(a.user)))];

    const deleted = await InstagramAccount.deleteMany({ _id: { $in: accounts.map((a) => a._id) } });
    const mirrored = await pullSocialMirror(userIds, 'instagram');

    return {
        userIds,
        removed: {
            instagramAccounts: deleted.deletedCount ?? 0,
            socialProfileEntries: mirrored,
        },
    };
}

export const REMOVERS = {
    facebook: removeFacebookData,
    instagram: removeInstagramData,
};
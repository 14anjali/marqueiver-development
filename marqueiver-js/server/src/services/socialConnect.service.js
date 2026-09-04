import { ApiError } from '../utils/apiError.js';
import { InstagramAccount, FacebookPage, YouTubeChannel } from '../models/index.js';
import { ELIGIBLE_INSTAGRAM_ACCOUNT_TYPES } from '../models/InstagramAccount.js';

/**
 * Rules that must hold before any social account counts as connected.
 *
 * These live in one service rather than in each platform controller because
 * they are the same rules three times over, and because they were previously
 * missing in ways the database could not catch:
 *
 *  - **`InstagramAccount.igUserId` was indexed but not unique**, so the same
 *    Instagram account could be attached to any number of Marqueiver users.
 *    Discovery ranks creators on connected-account data, so one duplicated
 *    account meant the same audience counted repeatedly across profiles.
 *  - **`FacebookPage`'s unique index was `{ user, facebookPageId }`**, which
 *    stops one user connecting the same Page twice and does nothing at all
 *    about two users claiming the same Page — the opposite of what was needed.
 *  - **`YouTubeChannel` had no uniqueness constraint** on the channel id.
 *  - **Instagram's `accountType` was stored and never checked**, so a PERSONAL
 *    account connected happily and then returned no insights.
 *
 * The unique indexes on the models are the real guarantee. These checks run
 * first so the user gets an explanation instead of a duplicate-key error.
 */

/** Platform → model and the field holding the provider's own account id. */
const PLATFORMS = {
    instagram: { model: () => InstagramAccount, idField: 'igUserId', label: 'Instagram account' },
    facebook: { model: () => FacebookPage, idField: 'facebookPageId', label: 'Facebook Page' },
    youtube: { model: () => YouTubeChannel, idField: 'youtubeChannelId', label: 'YouTube channel' },
};

/**
 * Refuse a provider account that already belongs to somebody else.
 *
 * Reconnecting an account you already hold is fine and common — tokens expire,
 * people revoke and re-grant — so the check is scoped to *other* users.
 */
export async function assertNotLinkedElsewhere(platform, providerAccountId, userId) {
    const spec = PLATFORMS[platform];
    if (!spec) throw ApiError.badRequest(`Unknown platform "${platform}"`);
    if (!providerAccountId) return;

    const existing = await spec.model()
        .findOne({ [spec.idField]: String(providerAccountId), user: { $ne: userId } })
        .select('_id')
        .lean();

    if (existing) {
        throw new ApiError(409, 'SOCIAL_ACCOUNT_ALREADY_LINKED',
            `This ${spec.label} is already connected to another Marqueiver account.`,
            { platform });
    }
}

/**
 * Instagram must be a Creator or Business account.
 *
 * This is Meta's restriction rather than ours: the Graph API only returns
 * insights, and only permits the business_discovery calls discovery depends on,
 * for those two types. A PERSONAL account can complete OAuth and then silently
 * return nothing, which is the worst of both worlds — connected, and useless.
 *
 * The error carries `switchUrl` so the UI can offer the fix rather than only
 * naming the problem.
 */
export function assertInstagramEligible(profile, { businessLogin = false } = {}) {
    const raw = profile?.account_type ?? profile?.accountType;
    const type = String(raw ?? 'UNKNOWN').toUpperCase();

    // The eligible list lives beside the schema enum, because these two silently
    // drifted apart once: MEDIA_CREATOR was accepted here and missing from the
    // enum, so the account passed this gate and then failed to save.
    if (ELIGIBLE_INSTAGRAM_ACCOUNT_TYPES.includes(type)) return type;

    /**
     * Instagram did not report an account type at all.
     *
     * `account_type` is not returned under every configuration of the Instagram
     * Login API, and the connect flow used to paper over that by defaulting a
     * missing value to 'BUSINESS' — which meant this gate could never fail: it
     * was judging a value we had manufactured, not one Instagram sent.
     *
     * When the profile came from Business Login, the login *is* the evidence.
     * The `instagram_business_*` scopes can only be granted by a professional
     * account; a personal account cannot complete that flow, so holding a token
     * already proves what this check is asking. Refusing here instead would
     * reject every eligible creator the moment Meta stopped returning the
     * field — a far worse failure than trusting the proof we already have.
     *
     * An explicit PERSONAL is still refused, and anywhere outside that flow an
     * unknown type is still refused.
     */
    if (!raw && businessLogin) return 'UNKNOWN';

    throw new ApiError(422, 'INSTAGRAM_ACCOUNT_TYPE_INELIGIBLE',
        'Your Instagram account must be a Creator or Business account to connect with Marqueiver.',
        {
            platform: 'instagram',
            accountType: type,
            howTo: [
                'Open the Instagram app and go to your profile.',
                'Tap the menu, then Settings and privacy.',
                'Open Account type and tools, then Switch to professional account.',
                'Choose Creator (or Business), finish the steps, and come back here to reconnect.',
            ],
            switchUrl: 'https://help.instagram.com/502981923235522',
        });
}

/**
 * Facebook needs an actual Page, not just a personal profile.
 *
 * The integration reads Page-level data, so a login that grants no Page is not
 * a usable connection. Marking it connected anyway would leave the user past
 * onboarding with an integration that returns nothing.
 */
export function assertFacebookEligible(pages) {
    const list = Array.isArray(pages) ? pages : [];
    if (!list.length) {
        throw new ApiError(422, 'FACEBOOK_PAGE_REQUIRED',
            'Marqueiver needs a Facebook Page. Your account did not grant access to one.',
            {
                platform: 'facebook',
                howTo: [
                    'Create a Facebook Page, or ask its owner to give you a role on it.',
                    'Reconnect and make sure you tick the Page in Facebook\'s permission screen.',
                    'A personal Facebook profile on its own cannot be used.',
                ],
                switchUrl: 'https://www.facebook.com/pages/creation/',
            });
    }
    return list;
}

/**
 * How many platforms this user actually has connected, and which.
 *
 * Onboarding requires at least one — not Instagram specifically — so this is
 * the single place that question is answered, for the completion gate and for
 * the onboarding status endpoint alike.
 */
export async function connectedPlatforms(userId) {
    const [ig, fb, yt] = await Promise.all([
        InstagramAccount.findOne({ user: userId, status: 'connected' })
            .select('username followers accountType').lean(),
        FacebookPage.findOne({ user: userId, status: 'connected' })
            .select('name facebookPageId followers').lean(),
        YouTubeChannel.findOne({ user: userId, status: 'connected' })
            .select('title youtubeChannelId subscriberCount thumbnails').lean(),
    ]);

    const connected = [];
    if (ig) {
        connected.push({
            platform: 'instagram',
            handle: ig.username ? `@${ig.username}` : 'Instagram',
            followers: ig.followers ?? 0,
            accountType: ig.accountType,
        });
    }
    if (fb) {
        connected.push({
            platform: 'facebook',
            handle: fb.name ?? 'Facebook Page',
            followers: fb.followers ?? 0,
        });
    }
    if (yt) {
        connected.push({
            platform: 'youtube',
            handle: yt.title ?? 'YouTube channel',
            followers: yt.subscriberCount ?? 0,
            image: yt.thumbnails?.default?.url ?? yt.thumbnails?.medium?.url ?? null,
        });
    }
    return connected;
}
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/apiError.js';
import { describeError } from '../utils/describeError.js';
import { InstagramAccount, InstagramMedia, FacebookPage, CreatorProfile } from '../models/index.js';
import * as ig from './instagram.service.js';
import * as fb from './facebook.service.js';

/**
 * Synchronising a connected account: profile, content, engagement, insights.
 *
 * ── The governing rule: one failed call must not fail the sync ─────────────
 * A sync touches four or five Meta endpoints, and they fail independently and
 * routinely — insights need a permission the profile does not, a single media
 * item can 400 on its own, a metric gets retired mid-quarter. If any one of
 * those took the whole run down, the common outcome would be a connected
 * account showing nothing because one optional call failed.
 *
 * So every step is isolated: it records its own outcome, and a failure marks
 * that step failed and moves on. The exception is an authorisation failure —
 * an expired or revoked token makes every subsequent call meaningless, so that
 * one stops the run, marks the account `expired`, and asks the person to
 * reconnect. Anything else degrades.
 *
 * The result is a report, not a boolean: the caller can say which parts are
 * fresh and which could not be refreshed, instead of showing stale numbers as
 * though they were current.
 *
 * ── Scheduling ─────────────────────────────────────────────────────────────
 * This project has no BullMQ or Redis — `jobs/policyJobs.js` runs a plain
 * `setInterval` tick. A second job system for one periodic refresh would be
 * infrastructure nobody asked for, so scheduled syncs use that same tick.
 */

/** How stale a connection may get before a scheduled run refreshes it. */
export const SYNC_STALE_AFTER_MS = 6 * 60 * 60 * 1000;  // 6 hours

/** Is this the provider telling us the token is dead? */
const isAuthFailure = (err) =>
    err?.code === 'INSTAGRAM_TOKEN_INVALID'
    || err?.code === 'FACEBOOK_TOKEN_INVALID'
    || err?.status === 401;

/**
 * Run one named step, recording its outcome without letting it end the sync.
 *
 * Rethrows only authorisation failures, which the caller turns into a
 * reconnect prompt — everything else is captured and reported.
 */
async function runStep(report, name, fn) {
    try {
        const result = await fn();
        report.steps[name] = { status: 'ok' };
        return result;
    } catch (err) {
        if (isAuthFailure(err)) throw err;

        // describeError redacts, so no token can reach the log or the report.
        const described = describeError(err);
        report.steps[name] = {
            status: 'failed',
            code: described.code ?? described.name,
            message: described.message,
        };
        logger.warn('Social sync step failed:', { platform: report.platform, step: name, ...described });
        return null;
    }
}

/* ────────────────────────────── Instagram ────────────────────────────────── */

/**
 * @param {object} account  an InstagramAccount with `+accessToken` selected
 */
export async function syncInstagram(account, { mediaLimit = 25, withMediaInsights = true } = {}) {
    const report = { platform: 'instagram', startedAt: new Date(), steps: {}, counts: {} };
    const token = account.accessToken;

    try {
        // 1 — profile.
        const profile = await runStep(report, 'profile', () =>
            ig.fetchProfile(token, account.igUserId));

        if (profile) {
            Object.assign(account, {
                username: profile.username,
                displayName: profile.name,
                profilePicture: profile.profile_picture_url,
                bio: profile.biography,
                followers: profile.followers_count ?? account.followers,
                following: profile.follows_count ?? account.following,
                mediaCount: profile.media_count ?? account.mediaCount,
                ...(profile.account_type ? { accountType: profile.account_type } : {}),
            });
        }

        // 2 — account insights.
        const insights = await runStep(report, 'accountInsights', () =>
            ig.fetchAccountInsights(token, account.igUserId));
        if (insights) {
            account.insights = insights;
            report.counts.accountMetrics = Object.values(insights).filter((m) => m.available).length;
        }

        // 3 — media. Upserted on (account, mediaId), so a re-run updates rows
        //     rather than appending a second copy of every post.
        const media = await runStep(report, 'media', () =>
            ig.fetchMedia(token, account.igUserId, mediaLimit));

        if (Array.isArray(media)) {
            let saved = 0;
            for (const item of media) {
                if (!item?.id) continue;
                await InstagramMedia.updateOne(
                    { account: account._id, mediaId: String(item.id) },
                    {
                        $set: {
                            user: account.user,
                            account: account._id,
                            mediaId: String(item.id),
                            caption: item.caption ?? null,
                            mediaType: item.media_type ?? null,
                            mediaProductType: item.media_product_type ?? null,
                            mediaUrl: item.media_url ?? null,
                            thumbnailUrl: item.thumbnail_url ?? null,
                            permalink: item.permalink ?? null,
                            timestamp: item.timestamp ? new Date(item.timestamp) : null,
                            // `?? null`, never `?? 0`: a count Instagram did not
                            // serve is unknown, and rendering it as zero would
                            // state something false about the post.
                            likeCount: item.like_count ?? null,
                            commentsCount: item.comments_count ?? null,
                            lastSyncedAt: new Date(),
                        },
                    },
                    { upsert: true, runValidators: true },
                );
                saved += 1;
            }
            report.counts.media = saved;

            // 4 — per-media insights, newest first and capped. Each is its own
            //     request, so this is the step most likely to hit a rate limit;
            //     the cap is what keeps one sync from spending the app's whole
            //     budget on an account with a thousand posts.
            if (withMediaInsights) {
                const recent = media.slice(0, 10);
                let done = 0;
                for (const item of recent) {
                    const mediaInsights = await runStep(report, `mediaInsights:${item.id}`, () =>
                        ig.fetchMediaInsights(token, item.id));
                    if (mediaInsights) {
                        await InstagramMedia.updateOne(
                            { account: account._id, mediaId: String(item.id) },
                            { $set: { insights: mediaInsights, insightsSyncedAt: new Date() } },
                        );
                        done += 1;
                    }
                }
                report.counts.mediaInsights = done;
            }
        }

        account.status = 'connected';
        account.lastSyncedAt = new Date();
        await account.save();

        await mirrorToCreatorProfile(account.user, 'instagram', {
            handle: account.username ? `@${account.username}` : 'Instagram',
            followers: account.followers ?? 0,
        });
    } catch (err) {
        if (isAuthFailure(err)) {
            // The connection is dead until the person reconnects. Recording that
            // is the point: a scheduled run must stop retrying a token that
            // cannot work, and the UI must be able to say why.
            account.status = 'expired';
            await account.save();

            report.steps.authorisation = { status: 'failed', code: 'TOKEN_INVALID' };
            report.finishedAt = new Date();
            report.ok = false;
            report.requiresReconnect = true;
            return report;
        }
        throw err;
    }

    report.finishedAt = new Date();
    report.ok = Object.values(report.steps).every((s) => s.status === 'ok');
    report.partial = !report.ok;
    return report;
}

/* ────────────────────────────── Facebook ─────────────────────────────────── */

/**
 * @param {object} page  a FacebookPage with `+pageAccessToken` selected
 */
export async function syncFacebook(page, { postLimit = 25 } = {}) {
    const report = { platform: 'facebook', startedAt: new Date(), steps: {}, counts: {} };

    if (page.status !== 'connected' || !page.facebookPageId) {
        throw new ApiError(409, 'FACEBOOK_PAGE_NOT_SELECTED',
            'Choose which Facebook Page to manage before syncing.',
            { platform: 'facebook', action: 'select-page' });
    }

    const token = page.pageAccessToken;

    try {
        const detail = await runStep(report, 'page', () => fb.fetchPage(token, page.facebookPageId));
        if (detail) {
            Object.assign(page, {
                name: detail.name,
                username: detail.username,
                about: detail.about,
                description: detail.description,
                category: detail.category,
                profilePicture: detail.picture,
                coverPhoto: detail.cover,
                website: detail.website,
                link: detail.link,
                followersCount: detail.followers ?? page.followersCount,
                likesCount: detail.likes ?? page.likesCount,
            });
        }

        const insights = await runStep(report, 'pageInsights', () =>
            fb.fetchPageInsights(token, page.facebookPageId));
        if (insights) {
            page.insights = insights;
            report.counts.pageMetrics = Object.values(insights).filter((m) => m.available).length;
        }

        const posts = await runStep(report, 'posts', () =>
            fb.fetchPagePosts(token, page.facebookPageId, postLimit));
        if (Array.isArray(posts)) {
            // Posts are held on the Page document rather than a separate
            // collection: unlike Instagram media they carry no per-item
            // insights here, so there is nothing a second collection would buy.
            page.recentPosts = posts.slice(0, 25);
            report.counts.posts = posts.length;
        }

        page.lastSyncedAt = new Date();
        await page.save();

        await mirrorToCreatorProfile(page.user, 'facebook', {
            handle: page.username ? `@${page.username}` : (page.name ?? 'Facebook Page'),
            followers: page.followersCount ?? 0,
        });
    } catch (err) {
        if (isAuthFailure(err)) {
            page.status = 'expired';
            await page.save();
            report.steps.authorisation = { status: 'failed', code: 'TOKEN_INVALID' };
            report.finishedAt = new Date();
            report.ok = false;
            report.requiresReconnect = true;
            return report;
        }
        throw err;
    }

    report.finishedAt = new Date();
    report.ok = Object.values(report.steps).every((s) => s.status === 'ok');
    report.partial = !report.ok;
    return report;
}

/* ─────────────────────────────── shared ──────────────────────────────────── */

/**
 * Keep the creator profile's rollup in step with the synced numbers.
 *
 * This is the copy discovery ranks on, and letting it drift from the source is
 * how a creator ends up listed with follower counts they no longer have.
 */
async function mirrorToCreatorProfile(userId, platform, { handle, followers }) {
    const creator = await CreatorProfile.findOne({ user: userId });
    if (!creator) return;

    const existing = creator.socialAccounts?.find((s) => s.platform === platform);
    const entry = {
        platform,
        handle,
        followers,
        engagementRate: existing?.engagementRate ?? 0,
        verified: existing?.verified ?? false,
        dataSource: 'connected',
    };

    const idx = (creator.socialAccounts || []).findIndex((s) => s.platform === platform);
    if (idx >= 0) creator.socialAccounts[idx] = entry;
    else creator.socialAccounts.push(entry);

    await creator.save();
}

/**
 * Refresh every connection that has gone stale.
 *
 * Called from the existing scheduler tick. Accounts already marked `expired`
 * are skipped: their token cannot work until the person reconnects, and
 * retrying it every cycle only spends rate-limit budget to fail.
 */
export async function syncStaleAccounts({ limit = 25 } = {}) {
    const cutoff = new Date(Date.now() - SYNC_STALE_AFTER_MS);
    const results = { instagram: 0, facebook: 0, failed: 0 };

    const igAccounts = await InstagramAccount
        .find({ status: 'connected', $or: [{ lastSyncedAt: { $lt: cutoff } }, { lastSyncedAt: null }] })
        .select('+accessToken').limit(limit);

    for (const account of igAccounts) {
        try {
            await syncInstagram(account, { withMediaInsights: false });
            results.instagram += 1;
        } catch (err) {
            results.failed += 1;
            logger.warn('Scheduled Instagram sync failed', describeError(err));
        }
    }

    const pages = await FacebookPage
        .find({ status: 'connected', $or: [{ lastSyncedAt: { $lt: cutoff } }, { lastSyncedAt: null }] })
        .select('+pageAccessToken').limit(limit);

    for (const page of pages) {
        try {
            await syncFacebook(page);
            results.facebook += 1;
        } catch (err) {
            results.failed += 1;
            logger.warn('Scheduled Facebook sync failed', describeError(err));
        }
    }

    return results;
}
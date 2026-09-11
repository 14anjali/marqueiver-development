/**
 * Can this creator apply to this campaign, and if not, why not?
 *
 * ── Why the server answers this ────────────────────────────────────────────
 *
 * A creator deciding whether to apply is deciding whether to spend an hour
 * writing a pitch. "You need 20,000 followers and you have 8,400" is worth more
 * than a grey button, and it has to be computed from the creator's real profile
 * — their connected-account follower totals, their categories, their verified
 * state — not guessed at in the browser from whatever happens to be in React
 * state.
 *
 * ── Advisory, not enforcement ──────────────────────────────────────────────
 *
 * Nothing here blocks anything. `applyToCampaign` is unchanged and still
 * accepts an application from a creator who misses a requirement: the brand
 * decides who it works with, and a creator at 19,000 followers against a 20,000
 * floor may still be exactly who a brand wants. This tells the creator where
 * they stand; it does not decide for either party.
 *
 * That distinction matters for a second reason. These checks read
 * `totalAudience` and `avgEngagement`, which are derived from connected
 * accounts — a creator who has not connected Instagram yet reads as zero
 * followers, which is a statement about the connection, not about them. So a
 * missed check says what is missing and stays out of the way.
 */

/** Whole years between a date of birth and now. Null when there is no DOB. */
function ageFrom(dob) {
    if (!dob) return null;
    const birth = new Date(dob);
    if (Number.isNaN(birth.getTime())) return null;

    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();
    // Birthday not reached yet this year.
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
    return age;
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** Does any of `have` match any of `want`? An empty `want` is no requirement. */
function overlaps(want = [], have = []) {
    if (!want.length) return true;
    const mine = new Set(have.map(norm));
    return want.some((w) => mine.has(norm(w)));
}

/**
 * A location requirement is matched loosely on purpose.
 *
 * A brand types "Mumbai" and a creator's profile says city "Mumbai", country
 * "India"; another brand types "Maharashtra". Requiring an exact match on a
 * free-text field would fail honest creators, and this is advisory, so a
 * substring match in either direction is the right level of strictness.
 */
function locationMatches(want = [], location = {}) {
    if (!want.length) return true;
    const mine = [location.city, location.country].filter(Boolean).map(norm);
    if (!mine.length) return false;
    return want.some((w) => {
        const target = norm(w);
        return mine.some((m) => m.includes(target) || target.includes(m));
    });
}

const fmt = (n) => Number(n ?? 0).toLocaleString('en-IN');

/**
 * @param campaign  a lean Campaign document
 * @param profile   the applying creator's lean CreatorProfile, or null
 * @param user      that creator's lean User (for phone/email verification), or null
 * @param verifiedSocial  whether the creator holds an approved `social` Verification
 */
export function creatorEligibility(campaign, profile, user, { verifiedSocial = false } = {}) {
    const r = campaign?.creatorRequirements ?? {};
    const p = profile ?? {};

    /**
     * A creator with no profile at all cannot be measured against anything.
     * Saying so once is clearer than failing every check for the same reason.
     */
    if (!profile) {
        return {
            evaluated: false,
            eligible: false,
            met: 0,
            total: 0,
            checks: [],
            note: 'Complete your creator profile to see how you match this campaign.',
        };
    }

    const age = ageFrom(p.dob);
    const followers = Number(p.totalAudience) || 0;
    const engagement = Number(p.avgEngagement) || 0;

    const checks = [];
    const add = (check) => { if (check) checks.push(check); };

    if (r.categories?.length) {
        add({
            id: 'categories',
            label: `Works in ${r.categories.join(' or ')}`,
            ok: overlaps(r.categories, p.categories),
            detail: p.categories?.length
                ? `Your categories: ${p.categories.join(', ')}`
                : 'You have not set any categories yet.',
            fix: 'personal',
        });
    }

    if (r.locations?.length) {
        add({
            id: 'location',
            label: `Based in ${r.locations.join(' or ')}`,
            ok: locationMatches(r.locations, p.location),
            detail: p.location?.city
                ? `Your location: ${[p.location.city, p.location.country].filter(Boolean).join(', ')}`
                : 'You have not set a location yet.',
            fix: 'personal',
        });
    }

    if (r.ageMin != null || r.ageMax != null) {
        const bounds = [
            r.ageMin != null ? `${r.ageMin}+` : null,
            r.ageMax != null ? `up to ${r.ageMax}` : null,
        ].filter(Boolean).join(', ');
        add({
            id: 'age',
            label: `Age ${bounds}`,
            // Unknown age is not a failure the creator can act on from here —
            // date of birth is collected at signup, not on the profile.
            ok: age == null ? null : (r.ageMin == null || age >= r.ageMin) && (r.ageMax == null || age <= r.ageMax),
            detail: age == null ? 'We do not have your date of birth on record.' : `You are ${age}.`,
        });
    }

    if (r.genders?.length && !r.genders.includes('any')) {
        add({
            id: 'gender',
            label: `Open to ${r.genders.join(', ')} creators`,
            ok: p.gender ? r.genders.map(norm).includes(norm(p.gender)) : null,
            detail: p.gender ? `Your profile says ${p.gender}.` : 'Not set on your profile.',
            fix: 'personal',
        });
    }

    if (r.followerMin != null || r.followerMax != null) {
        const bounds = [
            r.followerMin != null ? `${fmt(r.followerMin)}+` : null,
            r.followerMax != null ? `up to ${fmt(r.followerMax)}` : null,
        ].filter(Boolean).join(', ');
        add({
            id: 'followers',
            label: `${bounds} followers`,
            ok: (r.followerMin == null || followers >= r.followerMin)
                && (r.followerMax == null || followers <= r.followerMax),
            detail: followers > 0
                ? `You have ${fmt(followers)} across your connected accounts.`
                : 'Connect a social account so your reach is counted.',
            fix: followers > 0 ? undefined : 'social',
        });
    }

    if (r.minEngagement != null) {
        add({
            id: 'engagement',
            label: `${r.minEngagement}% engagement or higher`,
            ok: engagement >= r.minEngagement,
            detail: engagement > 0
                ? `Your average is ${engagement}%.`
                : 'Connect a social account so your engagement is measured.',
            fix: engagement > 0 ? undefined : 'social',
        });
    }

    if (r.languages?.length) {
        add({
            id: 'languages',
            label: `Creates in ${r.languages.join(' or ')}`,
            ok: overlaps(r.languages, p.languages),
            detail: p.languages?.length
                ? `Your languages: ${p.languages.join(', ')}`
                : 'You have not set any languages yet.',
            fix: 'personal',
        });
    }

    if (r.requireVerifiedIdentity) {
        // Policy 13.1 Basic: a verified mobile and email. The documents behind
        // any higher level are never read here and never shown to a brand.
        add({
            id: 'verifiedIdentity',
            label: 'Identity verified',
            ok: Boolean(user?.phoneVerified && user?.emailVerified),
            detail: 'Your mobile and email both have to be verified.',
            fix: 'verification',
        });
    }

    if (r.requireVerifiedSocial) {
        add({
            id: 'verifiedSocial',
            label: 'Social accounts verified',
            ok: Boolean(verifiedSocial),
            detail: 'Marqueiver has to have verified at least one of your accounts.',
            fix: 'verification',
        });
    }

    // `null` means "we could not tell" — counted as unmet for the headline, but
    // never reported as a failure the creator caused.
    const decided = checks.filter((c) => c.ok === true).length;

    return {
        evaluated: true,
        eligible: checks.every((c) => c.ok === true),
        met: decided,
        total: checks.length,
        checks,
        unmet: checks.filter((c) => c.ok !== true),
    };
}

/**
 * Is this campaign still taking applications?
 *
 * Separate from eligibility because it is about the campaign, not the creator,
 * and because a passed deadline is the one thing no amount of profile work
 * fixes. Derived rather than stored: a stored flag would need a job to flip it
 * and would be wrong for however long that job took.
 */
export function applicationWindow(campaign, { now = new Date() } = {}) {
    const deadline = campaign?.schedule?.applicationDeadline
        ? new Date(campaign.schedule.applicationDeadline)
        : null;

    const closedByDeadline = Boolean(deadline && !Number.isNaN(deadline.getTime()) && deadline < now);
    const closedByStatus = campaign?.status !== 'open';

    return {
        deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline.toISOString() : null,
        open: !closedByDeadline && !closedByStatus,
        closedByDeadline,
        closedByStatus,
    };
}
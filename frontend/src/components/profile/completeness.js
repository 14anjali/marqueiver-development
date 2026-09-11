/**
 * How complete a creator profile is, and what would improve it.
 *
 * One definition, used by the sidebar meter and by the Overview panel. Two
 * definitions would disagree the first time either changed, and "your profile
 * is 80% complete" next to a list of four things to fix is the kind of detail
 * people notice and stop trusting.
 *
 * The weights are not arbitrary. They are ordered by what actually decides
 * whether a brand shortlists someone:
 *
 *  - A **connected social account** is the whole basis of discovery — without
 *    one there are no verified numbers to rank on — so it carries the most.
 *  - **Categories** are what brands filter by, and the product requires three.
 *  - A **rate card** turns a profile from a browse into a shortlist; brands
 *    filter on price, and a creator with no rates is excluded from that filter
 *    rather than shown as "ask me".
 *  - **Avatar, bio, headline** are the card itself.
 *  - **Portfolio, banner, location, languages** are the finish.
 *
 * Everything here reads the real profile. Nothing is assumed present.
 */

const MIN_CATEGORIES = 3;

/**
 * @param {object} profile        CreatorProfile as the API returns it
 * @param {Array}  connectedList  socialAccounts, or any connected-platform list
 * @returns {{ percent: number, done: Array, todo: Array }}
 */
export function profileCompleteness(profile, connectedList) {
  const p = profile ?? {};
  const socials = connectedList ?? p.socialAccounts ?? [];

  const checks = [
    {
      id: 'social',
      weight: 22,
      label: 'Connect a social account',
      why: 'Brands search on verified audience data — without a connected account you do not appear in discovery.',
      section: 'social',
      done: socials.length > 0,
    },
    {
      id: 'categories',
      weight: 16,
      label: `Choose ${MIN_CATEGORIES} or more categories`,
      why: 'Categories are the main filter brands use.',
      section: 'personal',
      done: (p.categories?.length ?? 0) >= MIN_CATEGORIES,
    },
    {
      id: 'rates',
      weight: 14,
      label: 'Add at least one rate',
      why: 'Brands filter by budget. With no rates you are left out of that filter rather than shown as negotiable.',
      section: 'rates',
      done: (p.rateCard?.length ?? 0) > 0,
    },
    {
      id: 'avatar',
      weight: 12,
      label: 'Add a profile picture',
      why: 'A profile with no picture is the least-opened card in a search result.',
      section: 'personal',
      done: Boolean(p.avatarUrl),
    },
    {
      id: 'bio',
      weight: 12,
      label: 'Write a bio',
      why: 'The one place to say what you make and who you make it for.',
      section: 'personal',
      done: Boolean(p.bio?.trim()),
    },
    {
      id: 'headline',
      weight: 8,
      label: 'Add a headline',
      why: 'The single line shown under your name everywhere on the platform.',
      section: 'personal',
      done: Boolean(p.headline?.trim()),
    },
    {
      id: 'portfolio',
      weight: 6,
      label: 'Add work samples or a portfolio link',
      why: 'Shows brands what you actually make, rather than describing it.',
      section: 'portfolio',
      done: (p.portfolio?.length ?? 0) > 0 || Boolean(p.portfolioLink),
    },
    {
      id: 'location',
      weight: 4,
      label: 'Add your city',
      why: 'Many campaigns are regional, and location is a common filter.',
      section: 'personal',
      done: Boolean(p.location?.city),
    },
    {
      id: 'languages',
      weight: 3,
      label: 'Add the languages you create in',
      why: 'Brands running regional campaigns filter on this.',
      section: 'personal',
      done: (p.languages?.length ?? 0) > 0,
    },
    {
      id: 'banner',
      weight: 3,
      label: 'Add a banner image',
      why: 'Fills the top of your public profile.',
      section: 'personal',
      done: Boolean(p.coverUrl),
    },
  ];

  const earned = checks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
  const total = checks.reduce((sum, c) => sum + c.weight, 0);

  return {
    // Rounded, and capped — the weights total 100 today, but a future check
    // added without adjusting the others should not produce "103% complete".
    percent: Math.min(100, Math.round((earned / total) * 100)),
    done: checks.filter((c) => c.done),
    todo: checks.filter((c) => !c.done),
  };
}
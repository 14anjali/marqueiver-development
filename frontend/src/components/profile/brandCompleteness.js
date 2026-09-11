/**
 * How complete a brand profile is.
 *
 * The sibling of `profileCompleteness` in `completeness.js`, which does the
 * same job for creators. They are separate functions rather than one
 * parameterised by role because the field sets barely overlap — a brand has no
 * rate card or languages, a creator has no GSTIN or campaign preferences — and
 * a single function threading two unrelated checklists through role branches
 * would be harder to read than two short lists.
 *
 * The shape they return is identical, so `ProfileNav`'s completeness meter
 * renders either without knowing which it has.
 *
 * The weights are ordered by what actually decides whether a creator accepts a
 * brief from this brand:
 *
 *  - **Verification** is the strongest single signal a brand can offer. Policy
 *    13.1 makes it concrete, and creators are being asked to do work before
 *    being paid.
 *  - **Logo and about** are the card itself — an unbranded brand looks like a
 *    scraped listing.
 *  - **Website and industry** are how a creator checks the brand is real.
 *  - **Campaign preferences** let a creator judge fit before applying, which is
 *    the difference between relevant applications and noise.
 *  - **GSTIN and billing** matter for invoicing (Policy 4.1) rather than for
 *    presentation, so they are weighted low but present — a brand that cannot
 *    be invoiced will hit a problem eventually.
 */

export function brandCompleteness(profile) {
  const p = profile ?? {};
  const prefs = p.campaignPreferences ?? {};
  const level = p.verificationLevel ?? {};

  const checks = [
    {
      id: 'verified',
      weight: 18,
      label: 'Complete brand verification',
      why: 'Creators are asked to produce work before being paid. A verified badge is the strongest reassurance you can give them.',
      section: 'verification',
      done: Boolean(level.brandVerified),
    },
    {
      id: 'logo',
      weight: 14,
      label: 'Add your logo',
      why: 'Your logo appears on every brief a creator receives.',
      section: 'identity',
      done: Boolean(p.logo),
    },
    {
      id: 'about',
      weight: 13,
      label: 'Describe your brand',
      why: 'What you sell and who you sell to — the first thing a creator reads.',
      section: 'identity',
      done: Boolean(p.about?.trim()),
    },
    {
      id: 'website',
      weight: 11,
      label: 'Add your website',
      why: 'The quickest way for a creator to confirm you are a real business.',
      section: 'business',
      done: Boolean(p.website?.trim()),
    },
    {
      id: 'industry',
      weight: 9,
      label: 'Set your industry',
      why: 'Used to match you with creators who work in your space.',
      section: 'business',
      done: Boolean(p.industry?.trim()) || (p.categories?.length ?? 0) > 0,
    },
    {
      id: 'preferences',
      weight: 9,
      label: 'Say what collaborations you want',
      why: 'Creators can judge fit before applying, so you get fewer irrelevant applications.',
      section: 'preferences',
      done: (prefs.creatorCategories?.length ?? 0) > 0
        || (prefs.contentTypes?.length ?? 0) > 0,
    },
    {
      id: 'tagline',
      weight: 7,
      label: 'Add a tagline',
      why: 'One line under your name, shown everywhere your brand appears.',
      section: 'identity',
      done: Boolean(p.tagline?.trim()),
    },
    {
      id: 'contact',
      weight: 6,
      label: 'Add a work email',
      why: 'Required for brand verification, and how the Marqueiver team reaches you.',
      section: 'business',
      done: Boolean(p.contactEmail?.trim()),
    },
    {
      id: 'location',
      weight: 5,
      label: 'Add your location',
      why: 'Many creators prefer working with brands in their region.',
      section: 'business',
      done: Boolean(p.location?.city),
    },
    {
      id: 'banner',
      weight: 4,
      label: 'Add a banner image',
      why: 'Fills the top of your public brand profile.',
      section: 'identity',
      done: Boolean(p.coverUrl),
    },
    {
      id: 'billing',
      weight: 4,
      label: 'Add invoicing details',
      why: 'Policy 4.1 — accurate company details, and GSTIN where applicable, are needed for invoicing.',
      section: 'billing',
      done: Boolean(p.billing?.legalName?.trim()) && Boolean(p.billing?.city?.trim()),
    },
  ];

  const earned = checks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
  const total = checks.reduce((sum, c) => sum + c.weight, 0);

  return {
    // Capped, so adding a check later cannot produce "104% complete".
    percent: Math.min(100, Math.round((earned / total) * 100)),
    done: checks.filter((c) => c.done),
    todo: checks.filter((c) => !c.done),
  };
}
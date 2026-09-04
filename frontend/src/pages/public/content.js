/**
 * Content model for the public Marqueiver website (scope §3, §4).
 *
 * Kept as data in one file rather than inline JSX across four pages so the
 * marketing copy and the product's real rules stay in sync — the lifecycle
 * stages below mirror `server/src/modules/deals/dealStateMachine.js` and the
 * messaging lock mirrors `modules/messaging/messaging.policy.js`. If a rule
 * changes in the backend, this file is the one place the website has to follow.
 */

/**
 * Scope §4 — "Campaign/Deal Flow: visually explain Discover → Invite/Request →
 * Negotiate → Agree → Escrow → Campaign Active → Deliver → Approve/Revision →
 * Payout/Completion → Review."
 *
 * `state` maps each public stage onto the real deal state so the diagram is not
 * a marketing fiction. `chat` records whether free-text messaging is open at
 * that stage — this is a real enforced rule, and it is one of the more
 * surprising things about the product, so the public site explains it up front.
 */
export const LIFECYCLE = [
  {
    n: 1,
    stage: 'Discover',
    state: null,
    actor: 'Brand',
    chat: false,
    body: 'A brand searches creators by category, audience size, engagement, location and rate. Creators are ranked on real connected-account data, not self-reported numbers.',
  },
  {
    n: 2,
    stage: 'Invite',
    state: 'invited',
    actor: 'Brand',
    chat: false,
    body: 'The brand sends a collaboration request with a proposed budget, deliverables and deadline. The creator sees the real request in their deals list.',
  },
  {
    n: 3,
    stage: 'Negotiate',
    state: 'negotiating',
    actor: 'Both',
    chat: false,
    body: 'Either side can counter with revised terms. Every offer is kept — amount, deliverables and deadline are versioned, so nothing is quietly overwritten.',
  },
  {
    n: 4,
    stage: 'Agree',
    state: 'accepted',
    actor: 'Creator',
    chat: false,
    body: 'Accepting an offer locks the terms of that specific version. Both parties are looking at the same numbers before any money moves.',
  },
  {
    n: 5,
    stage: 'Fund escrow',
    state: 'escrow_funded',
    actor: 'Brand',
    chat: true,
    body: 'The brand funds the agreed amount into escrow. The creator can see the money is committed before starting work, and the brand keeps it until the work is approved.',
  },
  {
    n: 6,
    stage: 'Campaign active',
    state: 'in_progress',
    actor: 'Creator',
    chat: true,
    body: 'Work begins and the campaign chat opens. Messages are tied to this campaign, so context never gets lost in a general inbox.',
  },
  {
    n: 7,
    stage: 'Deliver',
    state: 'submitted',
    actor: 'Creator',
    chat: true,
    body: 'The creator submits the agreed deliverables against the terms that were accepted, not against a moving target.',
  },
  {
    n: 8,
    stage: 'Approve or revise',
    state: 'revision',
    actor: 'Brand',
    chat: true,
    body: 'The brand approves the work or sends it back with revision notes. A returned campaign goes back to the creator with the original terms intact.',
  },
  {
    n: 9,
    stage: 'Payout',
    state: 'completed',
    actor: 'System',
    chat: true,
    body: 'Approval releases the escrowed amount to the creator. The payout is tied to the approval event, so there is no separate invoice to chase.',
  },
  {
    n: 10,
    stage: 'Review',
    state: 'completed',
    actor: 'Both',
    chat: true,
    body: 'Both sides review each other. Reviews only come from completed campaigns, which is what keeps ratings on the platform meaningful.',
  },
];

/** Scope §4 — "For Creators" section. */
export const CREATOR_STEPS = [
  {
    title: 'Build a profile that reflects real numbers',
    body: 'Add your categories, languages, bio and rate card. Your audience and engagement figures come from the accounts you connect, so brands are looking at verified data.',
  },
  {
    title: 'Connect at least one account',
    body: 'Instagram, YouTube or Facebook. One eligible connected account is what unlocks your dashboard — Instagram needs to be a Creator or Business account, which is a Meta requirement, not ours.',
  },
  {
    title: 'Receive real collaboration requests',
    body: 'Brands that find you send an actual offer with a budget, deliverables and a deadline attached. No cold pitching into a void.',
  },
  {
    title: 'Negotiate on the record',
    body: 'Counter the amount, the deliverables or the timeline. Every version of the offer stays visible to both sides, so agreed terms cannot be quietly changed later.',
  },
  {
    title: 'Start work knowing the money exists',
    body: 'A campaign only becomes active once the brand has funded escrow. You are never producing work against an unfunded promise.',
  },
  {
    title: 'Get paid on approval',
    body: 'Approved deliverables release the escrowed payout to your wallet, and the completed campaign becomes a review on your profile.',
  },
];

/** Scope §4 — "For Brands" section. */
export const BRAND_STEPS = [
  {
    title: 'Set up your brand profile',
    body: 'Company details, industry, size, founded year and what you are looking for. Creators see who they would be working with before they accept.',
  },
  {
    title: 'Search creators on real criteria',
    body: 'Filter by category, audience size, engagement rate, location, language and rate. Save shortlists and export them for internal review.',
  },
  {
    title: 'Send a real offer, not a message',
    body: 'A collaboration request carries the budget, deliverables and deadline. The creator responds to specific terms rather than an open-ended conversation.',
  },
  {
    title: 'Negotiate without losing the thread',
    body: 'Counter-offers are versioned. You can always see what was proposed, by whom, and when — which matters when a campaign is questioned months later.',
  },
  {
    title: 'Fund escrow to start the campaign',
    body: 'Your payment is held until you approve the work. Escrow is what makes a creator comfortable starting, and it keeps your money protected until delivery.',
  },
  {
    title: 'Approve, request changes, or dispute',
    body: 'Review submitted deliverables and approve to release payment, send revision notes, or raise a dispute for the Marqueiver team to resolve.',
  },
];

/** Scope §4 — "Platform Features". */
export const FEATURES = [
  { icon: 'Search', title: 'Creator discovery', body: 'Faceted search across category, audience, engagement, location, language and rate, with saved shortlists and CSV export.' },
  { icon: 'Grid', title: 'Campaign management', body: 'Every collaboration is a tracked campaign with its own terms, status and history rather than a thread of messages.' },
  { icon: 'Handshake', title: 'Structured negotiation', body: 'Offers and counter-offers are versioned records. Amount, deliverables and deadlines are kept for every round.' },
  { icon: 'ShieldCheck', title: 'Escrow payments', body: 'Brand funds are held until deliverables are approved, then released to the creator. Disputes go to the Marqueiver team.' },
  { icon: 'Send', title: 'Campaign messaging', body: 'Chat is scoped to an active campaign, so conversations stay attached to the work they are about.' },
  { icon: 'Bell', title: 'Notifications', body: 'Real-time alerts for new requests, counter-offers, submissions, approvals and payouts, in-app and on WhatsApp.' },
  { icon: 'Users', title: 'Profiles and verification', body: 'Connected-account data, portfolios and verification badges, so both sides know who they are dealing with.' },
  { icon: 'Star', title: 'Reviews', body: 'Ratings come only from completed campaigns, which keeps the signal on both creator and brand profiles honest.' },
  { icon: 'BarChart', title: 'Analytics', body: 'Audience and campaign performance for creators; spend, reach and creator performance for brands.' },
];

/** Scope §4 — FAQ / supporting informational content. */
export const FAQ = [
  {
    q: 'Does it cost anything to join?',
    a: 'Creating a profile and browsing is free for creators and brands. Charges apply on campaign payouts; the exact fee is shown on the deal before either side commits.',
  },
  {
    q: 'Why do I have to connect a social account?',
    a: 'Audience and engagement figures on Marqueiver come from connected accounts rather than being typed in. That is what makes discovery trustworthy, so one eligible connected account is required before your dashboard opens.',
  },
  {
    q: 'My Instagram will not connect.',
    a: 'Meta only allows Creator and Business accounts to be connected through its API — personal accounts are not eligible. Switch the account type in the Instagram app, then retry the connection. Nothing on your Marqueiver profile is lost while you do.',
  },
  {
    q: 'Can creators and brands message each other freely?',
    a: 'Not before a campaign is funded and active. Until then the conversation happens through structured offers and counter-offers. It keeps terms on the record and keeps both sides out of an unaccountable side-channel.',
  },
  {
    q: 'When does a creator actually get paid?',
    a: 'The brand funds escrow before work begins, and approval of the submitted deliverables releases that money to the creator. Payment is tied to approval rather than to an invoice sent afterwards.',
  },
  {
    q: 'What happens if the work is not what was agreed?',
    a: 'A brand can send deliverables back with revision notes against the agreed terms. If the two sides cannot resolve it, either can raise a dispute and the Marqueiver team reviews the campaign record and the escrowed amount.',
  },
];

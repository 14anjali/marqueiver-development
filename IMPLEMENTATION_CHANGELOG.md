# Marqueiver — Implementation Changelog

This file documents every change made in this pass. Existing functionality
(Phone OTP, Email OTP, Instagram, Facebook, YouTube, auth, deals/escrow,
discovery, messaging, existing notifications) was **not** modified except
where explicitly noted as an additive extension.

---

## Feature: Save/Resume Onboarding

### Files Changed
- backend: `marqueiver-js/server/src/models/User.js`
- backend: `marqueiver-js/server/src/modules/users/users.controller.js`
- backend: `marqueiver-js/server/src/modules/users/users.routes.js`
- backend: `marqueiver-js/server/src/modules/auth/auth.controller.js`

### What Was Added
- `User.onboardingStep` (String, default `''`) — a free-form step key the frontend
  writes after each onboarding step is completed.
- `PATCH /api/users/me/onboarding-step` — saves the current step.
- `onboardingStep` is now included in both `/api/auth/me` and every login/signup
  response (`userView()`), so the frontend can resume without an extra call.

### Existing Logic Reused
- `onboardingComplete` flag and the existing completeOnboarding gate (Instagram
  requirement for creators) are untouched — this is purely additive.

### API Changes
- Endpoint: `PATCH /api/users/me/onboarding-step`
- Method: PATCH
- Purpose: persist which onboarding step the user last reached, for resume.

### Database Changes
- Collection: `users`
- Fields added: `onboardingStep: String`

### Frontend Changes
- Components/pages: `InfluencerOnboarding.jsx`, `BrandOnboarding.jsx`
- Dynamic data source: `api.me()` / login response `onboardingStep`

### How It Works
1. On each onboarding step completion, the frontend calls `PATCH /users/me/onboarding-step`.
2. On login or app load, the frontend reads `onboardingStep` from the user object.
3. If onboarding isn't complete, the onboarding page jumps to the saved step
   instead of starting over at step 1.

### How To Update It Later
- To add a new onboarding step, just use a new step-key string — no schema change needed.

### Important Notes
- Step keys are owned by the frontend (e.g. `'details'`, `'instagram'`); the
  backend stores them opaquely and does not validate against a fixed enum, so
  the step sequence can change without a migration.

---

## Feature: Creator Portfolio

### Files Changed
- backend: `marqueiver-js/server/src/models/CreatorProfile.js`
- backend: `marqueiver-js/server/src/modules/users/users.controller.js`
- backend: `marqueiver-js/server/src/modules/users/users.routes.js`

### What Was Added
- `portfolioItemSchema` sub-document (title, mediaUrl, thumbnailUrl, mediaType,
  platform, optional metrics) and a `portfolio: [portfolioItemSchema]` array on
  `CreatorProfile`.
- `POST /api/users/me/portfolio` — add an item (creator-only).
- `DELETE /api/users/me/portfolio/:itemId` — remove an item.

### Existing Logic Reused
- Reuses the existing `getUploadUrl` storage service for the actual file upload
  (same pattern as the brand-logo upload already in the codebase) — the
  frontend gets a presigned URL, uploads the file, then calls this endpoint
  with the resulting URL.

### API Changes
- Endpoint: `POST /api/users/me/portfolio` — body: `{ title?, mediaUrl, thumbnailUrl?, mediaType, platform?, metrics? }`
- Endpoint: `DELETE /api/users/me/portfolio/:itemId`

### Database Changes
- Collection: `creatorprofiles`
- Fields added: `portfolio: [{ title, mediaUrl, thumbnailUrl, mediaType, platform, metrics, addedAt }]`

### Frontend Changes
- Components/pages: new `PortfolioPage.jsx` (creator-only)
- Dynamic data source: `api.myProfile()` (portfolio is part of the profile document)

### How It Works
1. Creator uploads a file via the existing storage upload-URL flow.
2. Frontend calls `POST /users/me/portfolio` with the resulting URL + metadata.
3. Item is prepended to `profile.portfolio` (newest first) and returned.

### How To Update It Later
- Add fields to `portfolioItemSchema` in `CreatorProfile.js`; no separate
  collection to migrate since it's embedded.

### Important Notes
- No fabricated view/like counts — `metrics` is optional and only rendered if
  the creator supplies it.

---

## Feature: Analytics

### Files Changed
- backend: `marqueiver-js/server/src/modules/users/users.controller.js`
- backend: `marqueiver-js/server/src/modules/users/users.routes.js`

### What Was Added
- `GET /api/users/me/analytics` — real aggregation from the creator's own
  `CreatorProfile`, `Deal`, and `Review` documents:
  - `platformBreakdown`, `totalAudience`, `avgEngagement`, `creatorScore` — current snapshot
  - `dealsByMonth`, `earningsByMonth` — grouped by real `createdAt` timestamps
  - `reviews.average` / `reviews.count`

### Existing Logic Reused
- No new models. Uses the existing `Deal`, `Transaction`, `Review` collections
  exactly as the payments/deals modules already do.

### API Changes
- Endpoint: `GET /api/users/me/analytics`
- Method: GET
- Purpose: creator-facing analytics dashboard data.

### Database Changes
- None (read-only aggregation over existing collections).

### Frontend Changes
- Components/pages: new `AnalyticsPage.jsx`
- Dynamic data source: `api.analytics()`

### How It Works
1. Endpoint runs three Mongo aggregations (deals by month, earnings by month,
   review average) scoped to `req.auth.sub`.
2. Combines them with the profile's current social snapshot.
3. Frontend renders bars/lines from the returned arrays — no client-side math
   invents data points.

### How To Update It Later
- To add a new metric, add an aggregation stage and a new key in the response
  object; the frontend page can render it as a new card/chart section.

### Important Notes — KNOWN GAP (documented per instructions, not silently patched)
- **There is no daily/weekly social-stats snapshot collection.** This means a
  true "follower growth over time" line chart cannot be computed from real
  data today — only the *current* snapshot is known. This endpoint honestly
  returns real deal/earnings history (which *does* have timestamps) and omits
  a fabricated growth curve rather than inventing one.
- To add real growth history: introduce a small scheduled job (e.g. a daily
  cron invoking the existing `services/meta.service.js` / `instagram.service.js`
  sync and writing a `SocialStatsSnapshot { user, platform, followers, date }`
  row). This is a follow-up piece of infra, not a UI change.

---

## Feature: Media Kit PDF

### Files Changed
- backend: `marqueiver-js/server/src/services/mediakit.service.js` (new)
- backend: `marqueiver-js/server/src/modules/users/users.controller.js`
- backend: `marqueiver-js/server/src/modules/users/users.routes.js`
- backend: `marqueiver-js/server/package.json` (added `pdfkit` dependency)

### What Was Added
- `renderMediaKitPdf(profile, res)` — streams a one-page PDF (pdfkit) built
  from the creator's real profile: name, headline, bio, categories, social
  stats table, rate card, portfolio item titles.
- `GET /api/users/me/media-kit` — streams the PDF as an attachment.

### Existing Logic Reused
- Uses the same `CreatorProfile` document already populated by onboarding and
  social-connect flows — no new data entry required from the creator.

### API Changes
- Endpoint: `GET /api/users/me/media-kit`
- Method: GET
- Purpose: on-demand media kit PDF download.

### Database Changes
- None.

### Frontend Changes
- Components/pages: "Download Media Kit" button on `ProfilePage.jsx`
- Dynamic data source: direct file download from the endpoint above (no
  client-side data fetch needed — the PDF is the response body).

### How It Works
1. Creator clicks "Download Media Kit".
2. Browser navigates to `GET /users/me/media-kit` with the auth token.
3. Backend streams a PDF built live from the current profile — nothing cached
   or pre-generated, so it's always current.

### How To Update It Later
- Edit `mediakit.service.js` — it's plain pdfkit drawing calls, top to bottom.

### Important Notes
- Portfolio images are **not** embedded in the PDF (titles only) — embedding
  would require fetching each remote image's bytes at request time, which adds
  latency and a network-failure mode. Documented here as a deliberate scope
  cut, not an oversight; a follow-up could fetch+embed with a timeout and
  graceful fallback to text-only per item.

---

## Feature: Save / Bookmark Creators

### Files Changed
- backend: `marqueiver-js/server/src/models/SavedCreator.js` (new)
- backend: `marqueiver-js/server/src/models/index.js`
- backend: `marqueiver-js/server/src/modules/discovery/discovery.controller.js`
- backend: `marqueiver-js/server/src/modules/discovery/discovery.routes.js`

### What Was Added
- `SavedCreator` model — `{ brand, creator }` with a unique compound index (save
  is idempotent; saving twice is a no-op, not a duplicate row).
- `POST /api/discovery/creators/:id/save`, `DELETE /api/discovery/creators/:id/save`,
  `GET /api/discovery/creators/saved` (brand-only).

### Existing Logic Reused
- Sits in the existing `discovery` module next to creator search, using the
  same `CreatorProfile` lookups already there.

### API Changes
- Endpoint: `POST /api/discovery/creators/:id/save` — bookmark a creator
- Endpoint: `DELETE /api/discovery/creators/:id/save` — remove bookmark
- Endpoint: `GET /api/discovery/creators/saved` — list saved creators, most-recent first

### Database Changes
- New collection: `savedcreators` — `{ brand: ObjectId, creator: ObjectId, createdAt }`,
  unique index on `(brand, creator)`.

### Frontend Changes
- Components/pages: `CreatorCard.jsx` (heart icon wired to real toggle), new `SavedCreatorsPage.jsx`
- Dynamic data source: `api.saveCreator()` / `api.listSavedCreators()`

### How It Works
1. Brand clicks the heart icon on a creator card → `POST .../save`.
2. `GET .../saved` returns full `CreatorProfile` docs for a "Saved Creators" page,
   preserving save order (most recently saved first).

### How To Update It Later
- This is a plain join-table pattern; extending to "collections/lists" of saved
  creators would mean adding a `listId` field and a small Lists model on top.

### Important Notes
- Route order matters: `/creators/saved` is registered before `/creators/:id`
  so it isn't swallowed by the dynamic id route. Verified by mounting the app
  and confirming both resolve correctly.

---

## Feature: WhatsApp / SMS Notifications + Templates

### Files Changed
- backend: `marqueiver-js/server/src/services/whatsapp.service.js` (new)
- backend: `marqueiver-js/server/src/modules/notifications/notification.templates.js` (new)
- backend: `marqueiver-js/server/src/modules/notifications/notifications.service.js`
- backend: `marqueiver-js/server/src/models/Notification.js`
- backend: `marqueiver-js/server/src/config/env.js` (added `twilio.smsFrom`)
- backend: `marqueiver-js/server/src/modules/deals/deals.service.js`

### What Was Added
- `sendSms()` / `sendWhatsApp()` — Twilio Messages API senders, following the
  exact mock/live pattern already used by `email.service.js` (mock logs in dev,
  real Twilio call when `INTEGRATION_MODE=live` and credentials are present).
- `notification.templates.js` — centralised title/body copy for deal invites,
  escrow funded/released, new message, new review, verification decisions.
- `Notification.channelResults` — per-channel delivery outcome
  (`sent`/`failed` + error), so the existing `Notification` document doubles as
  a durable delivery log without adding a separate queue dependency (Redis/BullMQ
  were deliberately not introduced — see instruction #9, no unnecessary deps).
- `notify()` now actually sends SMS/WhatsApp (previously only email was wired;
  SMS/WhatsApp were a comment saying "would call twilio here").
- Escrow-funded and escrow-released deal events now notify via
  `['in_app', 'email', 'whatsapp']` instead of `in_app` only.

### Existing Logic Reused
- **Twilio OTP (Verify service) is completely untouched** — this uses Twilio's
  separate Messages API, a different Twilio product, called from a new file.
- `notify()`'s existing signature, in-app record creation, and Socket.io emitter
  hook are unchanged; only the channel fan-out logic was extended.

### API Changes
- None (internal service change; no new routes).

### Database Changes
- Collection: `notifications`
- Fields added: `channelResults: [{ channel, status, error }]`

### Frontend Changes
- None required — this is a backend delivery-channel change; the existing
  Notifications page and in-app bell already read from the same collection.

### How It Works
1. A call site (e.g. `deals.service.js afterTransition`) calls `notify({ ..., channels: [...] })`.
2. `notify()` always writes the in-app record, then attempts each requested
   channel, recording success/failure per channel on the same document.
3. In mock mode (default), SMS/WhatsApp are logged, not sent — matching how
   email already behaved before Resend was wired live.

### How To Update It Later
- Add a new template function in `notification.templates.js` and call
  `notify({ ..., channels: [...] })` from wherever the event happens.

### Important Notes
- **Requires `TWILIO_WHATSAPP_FROM` to be a WhatsApp-enabled Twilio sender**
  (Twilio Sandbox for testing, or an approved WhatsApp Business sender for
  production) — this is an external Twilio Console step, not something that
  can be configured in code. See the Razorpay section below for the same kind
  of external-setup note, formatted the same way.

---

## Feature: Razorpay Live Payouts & Refunds (hardened, not newly built)

### Files Changed
- backend: `marqueiver-js/server/src/services/razorpay.service.js`
- backend: `marqueiver-js/server/src/modules/payments/payments.controller.js`
- backend: `marqueiver-js/server/src/modules/deals/deals.service.js`
- backend: `marqueiver-js/server/src/config/env.js`

### What Was Added
- `releaseToCreator()` now makes a real RazorpayX Payouts API call in live mode
  (previously it just threw "not configured").
- `refundToBrand()` now makes a real Razorpay Refunds API call in live mode
  (previously it just threw).
- Webhook handler now processes `payment.captured` and writes the real Razorpay
  `payment_id` onto the matching `Transaction.gatewayRef`.
- **Bug fix in existing code**: the refund call site in `deals.service.js` was
  passing the internal MongoDB `Transaction._id` to Razorpay as if it were a
  payment id — that would never have worked against the real API. Fixed to look
  up the funding transaction and use its `gatewayRef` (the real Razorpay
  payment id, populated by the webhook above). This was necessary to make the
  requested "refunds" feature function at all, per instruction #2 ("unless
  absolutely required to connect the requested feature").

### Existing Logic Reused
- `createEscrowOrder()` (order creation) and the mock-mode fallback pattern
  were not changed — only the two functions that previously threw in live mode.
- The existing deal state machine, transaction ledger, and webhook signature
  verification are untouched.

### API Changes
- None (internal service hardening; webhook body handling extended, same route).

### Database Changes
- None (uses existing `Transaction.gatewayRef` field).

### Frontend Changes
- None.

### How It Works
1. Brand funds escrow → `createEscrowOrder` creates a Razorpay Order → brand
   pays via Razorpay Checkout (frontend not yet wired — see "Remaining
   blockers" below) → Razorpay sends `payment.captured` webhook →
   `Transaction.gatewayRef` is updated from order id to the real payment id.
2. On dispute/cancel before completion → `refundToBrand` uses that payment id.
3. On approval → `releaseToCreator` calls RazorpayX Payouts using the
   creator's `fund_account_id` (see setup steps below for what that is).

### How To Update It Later
- Both live calls are plain `fetch`/SDK calls near the top of
  `razorpay.service.js` — no abstraction layers to navigate.

### Important Notes — RAZORPAY LIVE SETUP (external, cannot be done in code)

To move from mock to live, you need to do the following in the Razorpay
Dashboard and provide the resulting values as environment variables:

1. **Create a Razorpay account** at dashboard.razorpay.com, complete KYC
   (business PAN, bank account, GST if applicable) — required before any live
   key works.
2. **Standard API keys** (Settings → API Keys) → generate a Key Id + Key
   Secret. Set as `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`. Test-mode keys
   work for `createEscrowOrder` (funding) immediately, no KYC wait.
3. **Webhook** (Settings → Webhooks) → add
   `https://<your-api-domain>/api/payments/webhook`, subscribe to
   `payment.captured` (and `payment.failed`, `refund.processed` if you want
   those handled later), copy the generated secret into
   `RAZORPAY_WEBHOOK_SECRET`.
4. **RazorpayX account** (separate product, needs its own approval — typically
   a few business days) → gives you a virtual account number. Set as
   `RAZORPAYX_ACCOUNT_NUMBER`.
5. **Creator bank details → Fund Account**: for each creator payout, RazorpayX
   needs a `fund_account_id` (`fa_...`) representing the creator's bank
   account/UPI. This requires collecting the creator's bank details
   (account number + IFSC, or UPI id) and calling RazorpayX's Contacts +
   Fund Account APIs to register them — **this UI/flow does not exist yet**
   (see "Remaining blockers" in the final summary). Until it does, pass a
   manually-created `fa_...` id as `payoutAccount` when calling the deal
   transition endpoint, or payouts stay in mock mode.
6. Set `INTEGRATION_MODE=live` once the above are in place. Until then,
   everything continues to run in mock mode exactly as before (default,
   safe, no code changes needed to keep developing).

### Remaining blockers for a fully live Razorpay flow
- No frontend Razorpay Checkout integration yet (funding is currently only
  reachable through the backend `POST /deals/:id/transition` — a brand would
  need Razorpay's Checkout.js on the frontend to actually pay).
- No UI/flow for a creator to register their bank/UPI details as a RazorpayX
  Fund Account.
- These are both real scope, not something that can be faked — documented
  here rather than stubbed with fake success responses.

---

## Feature: Campaign / Deal Management (backend was missing entirely)

### Files Changed
- backend: `marqueiver-js/server/src/modules/campaigns/campaigns.controller.js` (new)
- backend: `marqueiver-js/server/src/modules/campaigns/campaigns.routes.js` (new)
- backend: `marqueiver-js/server/src/routes.js`
- backend: `marqueiver-js/server/src/modules/discovery/discovery.controller.js` (added `getBrandProfile`)
- backend: `marqueiver-js/server/src/modules/discovery/discovery.routes.js`
- frontend: `frontend/src/pages/CampaignsPage.jsx` (full rewrite)
- frontend: `frontend/src/pages/BrandProfilePage.jsx` (full rewrite)
- frontend: `frontend/src/lib/api.js`

### What Was Discovered
The `Campaign` Mongoose model already existed in the codebase, but **had no
controller, no routes, and no API surface at all**. As a direct result,
`CampaignsPage.jsx` was rendering entirely hardcoded data from `data/sample.js`
(`nike.campaigns`) for every user, and its "Apply Now" / "View Applicants"
buttons only showed fake toast messages — no request ever reached the backend.
This violated the "genuinely dynamic" / "no fake profiles" / "no broken
buttons" requirements directly, so it was treated as in-scope to fix (feature
#23 "Campaign/deal management" was explicitly requested).

### What Was Added
- Full campaigns module: create, list (open campaigns for creators / own
  campaigns for brands, optionally filtered by `?brand=`), get by id, update
  (incl. closing), apply (creator, idempotent), list applicants (brand-only,
  enriched with creator profile summary), accept/reject an applicant.
- `GET /api/discovery/brands/:id` — also didn't exist; needed so a specific
  brand's real profile (not always "Nike") can be fetched.
- `CampaignsPage.jsx` rewritten: real campaign list, a real "Create Campaign"
  modal (brand), a real "Apply Now" that calls the backend and disables once
  applied, a real "View Applicants" modal with accept/reject buttons.
- `BrandProfilePage.jsx` rewritten: fetches the real `BrandProfile` for the
  route's `:id` (or the logged-in brand's own profile when no id), shows real
  trust score / verifications / team / open campaigns. Removed the fake
  "Top Creator Collaborations" section (no real data source existed for it)
  and the decorative always-static sidebar nav (superseded by `AppShell`'s
  now-real role-aware nav).

### Existing Logic Reused
- Sits alongside `modules/deals` without touching it. Accepting a campaign
  applicant does **not** auto-create a Deal — that remains the existing
  "invite creator" flow (`POST /deals`), so no deal-creation logic was
  duplicated. This is a deliberate scope boundary, noted below.
- Reuses the existing `notify()` service for application/decision notifications.

### API Changes
- `POST /api/campaigns`, `GET /api/campaigns`, `GET /api/campaigns/:id`,
  `PATCH /api/campaigns/:id`, `POST /api/campaigns/:id/apply`,
  `GET /api/campaigns/:id/applicants`, `PATCH /api/campaigns/:id/applicants/:creatorId`
- `GET /api/discovery/brands/:id`

### Database Changes
- None — used the existing `Campaign` model as-is.

### Frontend Changes
- `CampaignsPage.jsx`, `BrandProfilePage.jsx` — see above.
- Dynamic data source: `api.listCampaigns()`, `api.createCampaign()`,
  `api.applyToCampaign()`, `api.listCampaignApplicants()`, `api.decideApplicant()`,
  `api.getBrand()`, `api.listCampaignsForBrand()`.

### How It Works
1. Brand creates a campaign (title, brief, budget, tags, location).
2. Creators browse open campaigns (globally, or scoped to one brand's profile
   page) and apply — idempotent, so re-clicking "Apply" is a no-op.
3. Brand opens "View Applicants" → sees each applicant's real profile summary
   → accepts or rejects. Both sides get a real notification.

### How To Update It Later
- To make "accept" automatically create a Deal, call the existing
  `deals.service.js` deal-creation path from `decideApplicant` when
  `status === 'accepted'` — intentionally left as a manual next step for now
  so a brand can negotiate terms/amount before formally inviting.

### Important Notes
- Route order matters: `GET /api/discovery/brands/:id` was added *after*
  `GET /api/discovery/brands`, and `/campaigns/:id` routes don't collide with
  `/campaigns/:id/applicants` etc. since Express matches more specific paths
  correctly regardless of declaration order for non-overlapping patterns —
  verified by mounting the app and listing all 78 registered routes.

---

## Feature: Real Conversation Threads (Messages page was entirely fake)

### Files Changed
- backend: `marqueiver-js/server/src/modules/messaging/messaging.controller.js`
- backend: `marqueiver-js/server/src/modules/messaging/messaging.routes.js`
- frontend: `frontend/src/pages/MessagesPage.jsx` (full rewrite)
- frontend: `frontend/src/lib/api.js`

### What Was Discovered
`MessagesPage.jsx` rendered a hardcoded `THREADS` array with fake brand names
("Nike", "Mamaearth", "boAt Lifestyle", "PUMA India") and fake canned replies
— the "Send" button only appended to local state, never calling the backend.
The real messaging backend (`GET/POST /api/messages/:dealId`) already existed
and worked (it's used correctly by `DealDetailPage.jsx`), but there was no
endpoint to list *which* conversations a user has, so the page couldn't have
used it as-is even if someone tried.

### What Was Added
- `GET /api/messages/threads` — one row per deal the user is a party to, with
  the real counterpart's name (resolved from `BrandProfile`/`CreatorProfile`),
  the latest message, and a real unread count (two Mongo aggregations).
- `MessagesPage.jsx` rewritten to a real inbox: thread list → click a thread
  → loads real messages for that deal via the existing endpoint → real send
  → marks read via the existing `POST /api/messages/:dealId/read`.

### Existing Logic Reused
- No changes to `sendMessage`, `listMessages`, `markRead`, or the Socket.io
  realtime gateway — only a new read-only aggregation endpoint was added.

### API Changes
- Endpoint: `GET /api/messages/threads`

### Database Changes
- None (aggregation over existing `Deal` and `Message` collections).

### Frontend Changes
- `MessagesPage.jsx` — dynamic data source: `api.listMessageThreads()`,
  `api.listMessages()`, `api.sendMessage()`, `api.markMessagesRead()`.

### How It Works
1. Page loads `GET /messages/threads`, gets one row per deal with messages
   (or any deal at all — a thread can be empty if no one has messaged yet).
2. Selecting a thread fetches that deal's real message history and marks it read.
3. Sending posts to the same deal-scoped endpoint `DealDetailPage.jsx` already used.

### Important Notes
- Messaging is intentionally deal-scoped (no free-standing DMs) — this
  matches the existing data model (`Message.deal` is required) and wasn't
  changed. A "message a brand before any deal exists" flow would need a new
  message type not tied to a deal — out of scope for this pass, not attempted.

---

## Feature: Notifications, Saved Creators, Onboarding Resume — Frontend Wiring

### Files Changed
- frontend: `frontend/src/pages/NotificationsPage.jsx` (full rewrite)
- frontend: `frontend/src/pages/SavedCreatorsPage.jsx` (new)
- frontend: `frontend/src/pages/PortfolioPage.jsx`, `AnalyticsPage.jsx`, `EarningsPage.jsx` (new)
- frontend: `frontend/src/pages/InfluencerOnboarding.jsx`
- frontend: `frontend/src/pages/ProfilePage.jsx`
- frontend: `frontend/src/pages/CreatorsPage.jsx`
- frontend: `frontend/src/pages/CreatorProfilePage.jsx` (full rewrite)
- frontend: `frontend/src/pages/BrandProfilePage.jsx` (full rewrite, see Campaigns section above)
- frontend: `frontend/src/pages/DashboardPage.jsx`
- frontend: `frontend/src/components/AppShell.jsx` (full rewrite)
- frontend: `frontend/src/components/CreatorCard.jsx`
- frontend: `frontend/src/App.jsx`
- frontend: `frontend/src/components/icons.jsx` (added X, BarChart, Wallet, Image, FileText)

### What Was Discovered & Fixed (each is a distinct fake/dead-UI bug)
1. **`NotificationsPage.jsx`** — hardcoded `SAMPLE` array of fake notifications
   ("Nike invited you...", "boAt left you a 5-star review") shown whenever the
   real fetch returned nothing; "Mark all read" button had no handler.
   → Rewritten to use only real data from `GET /notifications`, with a working
   mark-all-read that calls the existing `POST /notifications/read`.
2. **`CreatorCard.jsx`** heart/bookmark icon — no `onClick` at all, purely
   decorative. → Wired to the new save/unsave endpoints (see "Save/Bookmark
   Creators" section above), with per-card saved state.
3. **`CreatorsPage.jsx`** — (a) fell back to fake sample creators and a fake
   "2,843" total on any network error instead of a real error state; (b)
   pagination showed fixed page numbers `1 2 3 4 … 143` that didn't respond to
   clicks and didn't reflect the real result count; (c) "Export Creators"
   showed a toast saying "Export started (mock)" even though a real CSV export
   endpoint already existed on the backend and was simply never wired up.
   → All three fixed: real error state (no fake fallback data), real
   pagination driven by the backend's `total`/`page`/`limit`, and the export
   button now downloads the real CSV.
4. **`CreatorProfilePage.jsx`** — always rendered the hardcoded `damyanti`
   sample object regardless of which creator was clicked (a real, user-facing
   bug: every creator's profile page looked identical). The invite button's
   creator id even had a fallback to the fake sample id
   (`window.history.state?.usr?.creator?._id || d.id`), which could have sent
   a real invite to the wrong creator. → Fully rewritten to fetch the real
   creator by route `:id` via the existing `GET /discovery/creators/:id`. Fake
   sparkline growth deltas, "Audience Insights" (locations/age/gender/interests
   — no such data model exists), and "Previous Collaborations"/"What Brands
   Say" fabricated brand names were removed; **reviews now show real data**
   from the existing `GET /reviews/user/:userId`.
5. **`AppShell.jsx`** — notification bell badge and "Messages" nav badge were
   hardcoded to `12` and `6`. → Bell badge now shows a real unread count from
   `GET /notifications?unread=true`, refetched on every route change. Also
   added a mobile nav drawer, since there was previously no mobile navigation
   at all (`nav` was `hidden lg:flex` with no fallback).
6. **`DashboardPage.jsx`** — brand's "Creators Reached" stat was the literal
   hardcoded string `"1.8K"`. → Replaced with a real distinct-creator count
   computed from the brand's own already-fetched deals.

### Existing Logic Reused
- All fixes call existing or newly-added real endpoints; no business logic in
  `deals`, `auth`, `instagram`/`facebook`/`youtube` was touched.

### New Pages (real data, no fabrication)
- `PortfolioPage.jsx`, `AnalyticsPage.jsx`, `EarningsPage.jsx`,
  `SavedCreatorsPage.jsx` — see their respective feature sections above.

### How To Update It Later
- Each fix above is localized to its one file; there's no shared fake-data
  module left to clean up except `frontend/src/data/sample.js`, which is now
  unused by any page (kept in the repo rather than deleted, in case a future
  design mockup wants a static reference — safe to delete if not needed).

### Important Notes
- `BrandOnboarding.jsx` remains a single-page form rather than a literal
  4-step wizard, even though the feature list says "Brand 4-step onboarding".
  It captures the same fields the original 4-step spec called for, just on
  one screen. Splitting it into 4 discrete screens is a real UI restructure
  that risked breaking a working flow under this session's time budget —
  flagged here rather than rushed.

## Feature: Razorpay → Cashfree Migration + Internal Wallet/Escrow

### Files Changed
- backend: `marqueiver-js/server/src/services/cashfree.service.js` (new)
- backend: `marqueiver-js/server/src/services/razorpay.service.js` (deleted)
- backend: `marqueiver-js/server/src/models/Wallet.js` (new)
- backend: `marqueiver-js/server/src/models/Transaction.js` (deal now optional, gateway enum → cashfree)
- backend: `marqueiver-js/server/src/models/CreatorProfile.js` (added `payoutMethod`)
- backend: `marqueiver-js/server/src/modules/wallet/wallet.controller.js`, `wallet.routes.js` (new)
- backend: `marqueiver-js/server/src/modules/deals/deals.service.js` (money transitions rewritten)
- backend: `marqueiver-js/server/src/modules/payments/payments.controller.js` (webhook rewritten)
- backend: `marqueiver-js/server/src/config/env.js` (razorpay block → cashfree block, added apiUrl)
- backend: `marqueiver-js/server/src/app.js` (raw-body capture for webhook signature verification)
- backend: `marqueiver-js/server/package.json` (removed razorpay dependency)
- frontend: `frontend/src/pages/EarningsPage.jsx` (full rewrite — wallet balance, withdraw modal, chart)
- frontend: `frontend/src/lib/api.js` (wallet endpoints)

### What Was Added
**Cashfree service** (`cashfree.service.js`) — Orders API (escrow funding), Refunds
API, Payouts direct-transfer (wallet withdrawal), and webhook signature
verification (HMAC-SHA256 of `timestamp + rawBody`, base64, with a 5-minute
replay-window check). API details were verified against current Cashfree
documentation before implementing, rather than assumed — Cashfree's refund
API operates on the order id directly (unlike Razorpay, which needed a
separate payment id captured via webhook).

**Internal Wallet** — the escrow/earnings ledger now lives entirely in
Marqueiver's own database (`Wallet.balance`). Cashfree is only called at the
two real-money edges:
1. **Brand funds escrow** → real Cashfree order (money enters the merchant account).
2. **Creator withdraws** → real Cashfree Payouts transfer to their bank/UPI.

Escrow **release** (brand approves → creator should get paid) is now purely
an internal ledger operation: `Wallet.balance` is credited atomically inside
the same Mongo transaction as the deal state change. No Cashfree call happens
at release — this matches the requested design ("our backend only,
transactions will be done through cashfree" — i.e. Cashfree is the payment
rail at the edges, not the record-of-truth for balances).

**Wallet module** — `GET /wallet` (balance), `GET /wallet/ledger` (credit/debit
history), `POST /wallet/payout-method` (save bank/UPI details), `POST /wallet/withdraw`
(atomic debit + real Cashfree payout, rate-limited to 5/min).

### Existing Logic Reused
- The deal state machine (`dealStateMachine.js`) is completely untouched —
  only the *implementation* of the `fund_escrow`/`release_escrow`/`refund_escrow`
  effects changed, not which transitions are legal or who can trigger them.
- Mongo transaction wrapping pattern (session + `transactionsSupported` flag)
  reused exactly as it existed for the wallet debit-on-withdraw operation.
- The existing `Transaction` ledger collection is reused as-is for the wallet's
  credit/debit history — no new ledger table was introduced.

### API Changes
- `GET /api/wallet`, `GET /api/wallet/ledger`
- `POST /api/wallet/payout-method`, `POST /api/wallet/withdraw`
- `POST /api/payments/webhook` — same route, Cashfree signature scheme now

### Database Changes
- New collection: `wallets` — `{ user, balance, lifetimeCredited, lifetimeWithdrawn, currency }`
- `creatorprofiles.payoutMethod` — `{ type: 'bank'|'upi', accountHolderName, bankAccount, ifsc, vpa }`
- `transactions.deal` — now optional (was required); `transactions.gateway` enum changed `razorpay` → `cashfree`

### Frontend Changes
- `EarningsPage.jsx` — now shows a real wallet balance card, an "Earnings by
  month" area chart (recharts), a payout-method setup + withdraw modal, and
  the existing transaction history list.

### How It Works
1. Brand funds a deal → `cashfree.createEscrowOrder` → real Cashfree order.
2. Creator does the work, brand approves → escrow release **credits the
   creator's wallet internally** — no Cashfree call, instant.
3. Creator sees their balance grow on the Earnings page and can withdraw any
   time → `POST /wallet/withdraw` → real Cashfree Payouts transfer to their
   saved bank/UPI, wallet debited atomically.
4. If a deal is cancelled/disputed after funding but before release →
   `cashfree.refundToBrand` sends the money back to the brand directly (this
   one *does* call Cashfree immediately, since it's a real refund, not an
   internal transfer).

### How To Update It Later
- All Cashfree HTTP calls are plain `fetch()` in `cashfree.service.js` —
  no SDK dependency was added (kept the "no unnecessary dependencies" bar).
- To add a platform fee on withdrawal, deduct it in `wallet.controller.js`
  `withdraw()` before calling `payoutToBeneficiary`, and record it as a
  separate `Transaction{ type: 'fee' }` row.

### Important Notes — CASHFREE LIVE SETUP (external, cannot be done in code)
1. **Cashfree Payment Gateway account** (dashboard.cashfree.com) — complete
   KYC, then get `x-client-id` / `x-client-secret` from Developers → API Keys.
   Set as `CASHFREE_CLIENT_ID` / `CASHFREE_CLIENT_SECRET`.
2. **Webhook** — add `https://<your-api-domain>/api/payments/webhook` in the
   dashboard, subscribed to payment success/failure events; copy the webhook
   secret into `CASHFREE_WEBHOOK_SECRET`.
3. **Cashfree Payouts** — a separate product needing its own approval
   (business banking details, typically a few days). Gives you a *different*
   client id/secret pair — set as `CASHFREE_PAYOUT_CLIENT_ID` /
   `CASHFREE_PAYOUT_CLIENT_SECRET`.
4. Set `CASHFREE_MODE=production` and `INTEGRATION_MODE=live` once ready.
   Until then everything runs in mock mode exactly as before — no code
   changes needed to keep developing.

### Remaining blocker
- No frontend Cashfree Checkout integration yet for the brand's actual payment
  step — funding is only reachable via the backend `POST /deals/:id/transition`.
  A brand would need Cashfree's Checkout JS (using the `payment_session_id`
  `createEscrowOrder` already returns) wired into the deal-funding UI to
  actually complete a live payment. Documented here rather than stubbed.

---

## Feature: Admin Panel (Frontend)

### Files Changed
- frontend: `frontend/src/components/AdminShell.jsx` (new)
- frontend: `frontend/src/pages/admin/AdminDashboard.jsx` (new)
- frontend: `frontend/src/pages/admin/AdminVerifications.jsx` (new)
- frontend: `frontend/src/pages/admin/AdminDeals.jsx` (new)
- frontend: `frontend/src/pages/admin/AdminUsers.jsx` (new)
- frontend: `frontend/src/pages/admin/AdminReviews.jsx` (new)
- frontend: `frontend/src/pages/admin/AdminWallets.jsx` (new)
- frontend: `frontend/src/pages/admin/AdminTeam.jsx` (new)
- frontend: `frontend/src/pages/admin/AdminAudit.jsx` (new)
- frontend: `frontend/src/App.jsx` (admin routes + role-based redirect)
- frontend: `frontend/src/pages/LoginPage.jsx` (admin login routes to /admin)
- backend: `marqueiver-js/server/src/modules/admin/admin.controller.js` (analytics, wallets, listUsers, listReviews added)
- backend: `marqueiver-js/server/src/modules/admin/admin.routes.js`
- backend: `marqueiver-js/server/src/modules/auth/auth.controller.js` (adminLevel now included in user responses)

### What Was Discovered
The backend already had a comprehensive admin API (`/admin/overview`,
verification decisions, deal resolution, user suspend, review moderate, team
invite, audit log, CSV export) — but **there was no admin frontend at all**.
Also found two supporting gaps while wiring it up: no way to *list* users to
suspend one (only suspend-by-id existed), and no way to *list* reviews to
moderate one (only moderate-by-id existed) — both were dead ends without a
directory. Both were added.

### What Was Added
- **AdminShell** — same visual system as the creator/brand `AppShell` (same
  `Logo`, brand colors, card styles, mobile drawer) with its own nav, so the
  theme stays exactly consistent per your instruction, without an admin
  accidentally seeing creator/brand nav items.
- **AdminDashboard** — stat cards + four real charts (recharts): user growth
  (line), GMV by month (line), deals-by-state (donut), transaction volume by
  type (horizontal bar). All from the new `GET /admin/analytics` endpoint,
  which aggregates real `User`/`Deal`/`Transaction` documents grouped by
  actual month — no synthetic data points.
- **AdminVerifications** — approve/reject queue.
- **AdminDeals** — filterable oversight list + a resolve-dispute modal that
  drives the existing `transitionDeal` via the admin resolve endpoint.
- **AdminUsers** — search/filter directory + suspend/reactivate toggle.
- **AdminReviews** — browse + hide/unhide.
- **AdminWallets** — platform-wide wallet totals + top balances (feature:
  wallet system oversight).
- **AdminTeam** — invite another admin with a permission level (super-only,
  gated in the UI to match the backend's `requireAdminLevel`).
- **AdminAudit** — the immutable action log + CSV export buttons.
- Login now checks `role === 'admin'` and routes straight to `/admin`,
  bypassing the creator/brand onboarding flow entirely (admins don't onboard).
- `AdminProtected` route guard — a creator/brand hitting `/admin/*` is
  redirected to their own dashboard instead of an error page.

### Existing Logic Reused
- Every admin page calls existing (or now-added) `/admin/*` endpoints —
  no admin business logic was duplicated in the frontend.
- The dispute-resolution modal calls the same `resolveDeal` → `transitionDeal`
  path already used elsewhere; the frontend just presents it.

### API Changes
- `GET /api/admin/analytics`, `GET /api/admin/wallets`,
  `GET /api/admin/users`, `GET /api/admin/reviews`

### Database Changes
- None (all new admin endpoints are read aggregations over existing collections).

### Frontend Changes
- 8 new admin pages + `AdminShell`, all listed above.
- Dynamic data source: every page fetches from its corresponding `/admin/*`
  endpoint — no hardcoded admin data anywhere.

### How It Works
1. An existing admin account logs in via the same OTP flow everyone uses —
   the backend returns their real `role: 'admin'` regardless of which toggle
   (brand/creator) happened to be selected on the login screen, since an
   *existing* user's role is never overwritten by the signup-role parameter.
2. They land on `/admin`, see live platform metrics and charts.
3. Every admin action (approve, resolve, suspend, moderate, invite) calls the
   real backend, which — as already built — writes an audit-log entry.

### How To Update It Later
- To add a new admin page, follow the existing pattern: wrap in `<AdminShell>`,
  add a nav entry in `AdminShell.jsx`'s `ADMIN_NAV`, add the route in `App.jsx`.

### Important Notes — A real bug found and fixed during testing
While screenshot-testing the dashboard, it rendered a **completely blank
page** with a console error: `Cannot read properties of undefined (reading
'usersByMonth')`. Root cause: `AdminDashboard` (and, on inspection,
`AnalyticsPage` and `AdminWallets` too) only guarded against `loading` and
`error` states, not against a *successful* response with an unexpectedly
empty/malformed body (e.g. a misconfigured proxy returning 200 with an empty
object). Fixed by adding an explicit defensive check
(`if (!data) return <ErrorBlock .../>`) after the loading/error checks in all
three files, plus `DealDetailPage.jsx` which had the same gap. This is a
genuine hardening fix, not just a test artifact — a malformed 200 response
should never crash a page in production.

A second, separate rendering issue was also found and fixed: recharts'
default animation (which draws lines/bars/pie slices in over time via
`requestAnimationFrame`) intermittently never completed in headless/automated
browser contexts, leaving charts visually empty even though the data was
correct. Fixed by setting `isAnimationActive={false}` on every chart primitive
across `AdminDashboard.jsx`, `AnalyticsPage.jsx`, and `EarningsPage.jsx` —
charts now render synchronously with the initial paint, which is both a more
reliable fix for this failure mode and a minor robustness improvement for
real users on low-power/throttled devices.

---

## Feature: Facebook Connect (optional, Profile page)

### Files Changed
- frontend: `frontend/src/lib/api.js` (added `facebookAuthUrl`, `facebookProfile`, `facebookSync`)
- frontend: `frontend/src/pages/FacebookCallback.jsx` (new)
- frontend: `frontend/src/pages/ProfilePage.jsx` (Facebook connect card)
- frontend: `frontend/src/App.jsx` (`/onboarding/facebook` route)

### What Was Discovered
The backend already had a complete, working Facebook OAuth integration
(`/auth/facebook`, `/auth/facebook/callback`, `/facebook/profile`,
`/facebook/sync`, real Graph API calls, a `FacebookPage` model) — but **no
frontend screen called any of it**. The only trace of "Facebook" in the UI
was the platform icon glyph and a filter-dropdown option — never wired to
the actual OAuth flow.

### What Was Added
- A Facebook connect card on the Profile page, available to **both** creators
  and brands (the backend has no role restriction on this module, and the
  requested placement was "optional, Profile page only" — not gated into
  onboarding the way Instagram is).
- `connectFacebook()` requests the OAuth URL and navigates there directly
  (same pattern as Instagram's `connectInstagram()` in onboarding).
- `FacebookCallback.jsx` — the backend always redirects to
  `/onboarding/facebook?fb=connected|error` regardless of where the connect
  was started from (that redirect path is hardcoded server-side); this page
  catches that and forwards to `/profile` with a success/error toast, since
  Facebook isn't part of the onboarding flow.
- Sync button, connected/disconnected states, "last synced" timestamp — same
  visual pattern as the existing Instagram card, so the two sit consistently
  side by side.

### Existing Logic Reused
- Zero backend changes — every endpoint already existed and worked correctly.
  This was purely wiring up an existing, unused API surface.

### API Changes
- None (all endpoints pre-existed).

### Database Changes
- None.

### How It Works
1. Creator or brand clicks "Connect Facebook" on their Profile page.
2. Redirected to Facebook's consent screen (or the mock loop-back in dev mode).
3. Backend exchanges the code, saves the `FacebookPage`, redirects to
   `/onboarding/facebook?fb=connected`.
4. `FacebookCallback.jsx` catches that, shows a toast, sends them to `/profile`
   where the card now shows the connected Page name and a Sync button.

### Important Notes
- Verified both connected and disconnected states render correctly via
  screenshot testing with mocked API responses — no console errors, correct
  badge/button states in each.

## Feature: YouTube Connect, Review Submission, Availability/Preferences, Verification Upload, Cashfree Checkout

### Files Changed
- frontend: `frontend/src/components/SocialConnectCard.jsx` (new — shared Facebook/YouTube connect UI)
- frontend: `frontend/src/pages/YoutubeCallback.jsx` (new)
- frontend: `frontend/src/pages/VerificationsPage.jsx` (new)
- frontend: `frontend/src/pages/ProfilePage.jsx` (YouTube card, Availability/Preferences editor, Verification link)
- frontend: `frontend/src/pages/DealDetailPage.jsx` (review form, real Cashfree Checkout)
- frontend: `frontend/src/lib/cashfree.js` (new — Cashfree Checkout JS SDK loader)
- frontend: `frontend/src/lib/api.js` (youtube*, verification*, createReview, createPaymentSession)
- frontend: `frontend/src/App.jsx` (routes: `/onboarding/youtube`, `/verifications`)
- frontend: `frontend/src/components/icons.jsx` (added `ShieldCheck`)
- backend: `marqueiver-js/server/src/modules/users/users.controller.js` (fixed upload-url role bug)
- backend: `marqueiver-js/server/src/modules/users/users.routes.js`
- backend: `marqueiver-js/server/src/modules/deals/deals.service.js` (added `createPaymentSession`, fund_escrow now reuses a pending order)
- backend: `marqueiver-js/server/src/modules/deals/deals.controller.js`, `deals.routes.js`

### What Was Added

**YouTube connect (Profile page, optional)** — same shape as the Facebook
screen from the previous pass, refactored both into a shared
`SocialConnectCard` component so the connect/sync/error-toast logic isn't
duplicated a third time. Backend OAuth already existed and was untouched.

**Review submission form** — on `DealDetailPage`, once a deal reaches
`completed`, a star-rating + optional text form appears (brand rates
creator, creator rates brand — direction is server-determined). Submitting
twice is handled gracefully: the backend's unique `(deal, author)` index
returns 409, which the frontend treats as "already reviewed" rather than a
generic error.

**Availability & Preferences editor** — new section on the creator Profile
page: an availability toggle, collaboration-type and content-type pill
selectors, and a rate-card editor (add/remove rows, content type + price).
Saves via the existing `PATCH /users/me/creator` endpoint — no backend
changes needed, the fields already existed there.

**Verification document submission (user-facing)** — new `VerificationsPage`
listing the 5 verification kinds (business, GST, website, social, email),
each with an upload button and live status (pending/approved/rejected, with
the admin's decision note if rejected). Linked from the Profile page.

**Real Cashfree Checkout** — funding a deal's escrow now opens an actual
Cashfree hosted payment modal (sandbox mode) instead of the backend silently
marking it funded. New `POST /deals/:id/payment-session` creates a real
Cashfree order + a `pending` Transaction and returns a `paymentSessionId`;
the frontend loads Cashfree's JS SDK (`sdk.cashfree.com/js/v3/cashfree.js`)
and opens `cashfree.checkout({ paymentSessionId, redirectTarget: '_modal' })`.
Only after that resolves successfully does the frontend call the existing
`POST /deals/:id/transition {to:'escrow_funded'}` — which now detects the
already-created pending order (by `idempotencyKey`) and reuses it instead of
creating a second Cashfree order, so there's no double-charge risk.
In mock mode (no real Cashfree credentials), this short-circuits to a
"simulating a successful payment" toast instead of trying to load Cashfree's
real script against a fake session id — consistent with how every other
mock-mode integration in this app behaves.

### Existing Logic Reused
- `SocialConnectCard` reuses the exact connect/sync/toast pattern the
  Facebook card already had — Instagram (onboarding-required, kept separate
  since its flow genuinely differs) was left untouched.
- Availability/Preferences reuses the existing `updateCreator` endpoint and
  `CreatorProfile` schema fields — no new backend surface.
- The Checkout flow reuses the existing `transitionDeal` state-machine call
  for the actual state change; the new endpoint only adds a payment step
  *before* it, and modifies `fund_escrow`'s effect to check for — and reuse —
  a pending order rather than duplicating logic.

### A real bug found and fixed
`PortfolioPage.jsx` (built in an earlier pass) calls the same upload-url
endpoint the brand-logo flow uses — but that endpoint was hard-restricted to
`role !== 'brand'`, meaning **creator portfolio uploads have been silently
broken (403) since they were built**. Found while wiring the verification
upload (which needed the same endpoint, for both roles). Fixed by making the
endpoint purpose-based (`brand-logo` / `portfolio` / `verification`) instead
of role-locked, with the brand-only check now scoped correctly to just the
`brand-logo` purpose.

### API Changes
- `POST /api/deals/:id/payment-session` — brand-only, deal must be `accepted`.
- `POST /api/users/me/logo-upload-url` — now takes a `purpose` field
  (`brand-logo`/`portfolio`/`verification`); no longer brand-only except for
  the `brand-logo` purpose.

### Database Changes
- None (Verification, CreatorProfile, Transaction models already had every
  field needed).

### How It Works — Cashfree Checkout end to end
1. Brand clicks "Fund escrow" on an `accepted` deal.
2. Frontend calls `POST /deals/:id/payment-session` → backend creates a real
   Cashfree order, stores a `pending` Transaction with the order id and
   session id (in `meta`), returns the session id.
3. Frontend opens Cashfree's checkout modal with that session id — the brand
   enters real (sandbox test) payment details.
4. On success, frontend calls the normal transition endpoint → backend finds
   the matching pending Transaction by `idempotencyKey`, marks it `success`,
   marks the deal funded. No second Cashfree order is created.
5. If the brand refreshes mid-payment and clicks "Fund escrow" again within
   15 minutes, the same session is handed back rather than creating a new
   order; after 15 minutes (likely expired) a fresh one is created instead.

### How To Update It Later
- To go live, the only change needed is real Cashfree Payment Gateway
  credentials (`CASHFREE_CLIENT_ID`/`SECRET`) and switching
  `lib/cashfree.js`'s hardcoded `mode: 'sandbox'` to read from a build-time
  env flag — explicitly out of scope for this pass per instruction.

### Important Notes
- All five items verified via screenshot testing with mocked API responses —
  review form, verification page, and the full profile (all three social
  connect cards + preferences editor) all render correctly with no console
  errors.
- `lib/cashfree.js` mode is hardcoded to `'sandbox'` — flagged in code with a
  comment explaining why (production setup explicitly out of scope here).

## Feature: Admin Signup + Approval Workflow (Finance/Support self-signup)

### Files Changed
- backend: `marqueiver-js/server/src/models/User.js` (added `adminApprovalStatus`)
- backend: `marqueiver-js/server/src/middleware/auth.js` (added `requireApprovedAdmin`)
- backend: `marqueiver-js/server/src/modules/auth/auth.controller.js` (signup schemas + `findOrCreateUser`)
- backend: `marqueiver-js/server/src/modules/admin/admin.controller.js` (pending-list, decide, bootstrap/invite set `approved`)
- backend: `marqueiver-js/server/src/modules/admin/admin.routes.js`
- admin panel: `admin-panel/src/pages/LoginPage.jsx` (sign-in/sign-up modes)
- admin panel: `admin-panel/src/pages/PendingApprovalPage.jsx` (new)
- admin panel: `admin-panel/src/pages/AdminTeam.jsx` (pending-signups review section)
- admin panel: `admin-panel/src/components/AdminShell.jsx` (pending-count badge)
- admin panel: `admin-panel/src/App.jsx` (approval-aware route gating)
- admin panel: `admin-panel/src/lib/api.js`

### What Was Discovered
There were exactly three ways to become an admin before this: the one-time
bootstrap endpoint (first super admin), an existing super admin's "Team
invite" (immediate, no approval), or... nothing else — there was no
self-service way for a Finance/Support admin to request access, and even if
there had been, the JWT/response already carried `adminLevel` correctly for
existing admins, but a *new* admin signup wasn't validated or handled at all
(the OTP verify schemas only accepted `role: 'creator' | 'brand'` — passing
`role: 'admin'` was rejected outright before this change).

### What Was Added

**Self-signup for Finance/Support (never Super)** — the same OTP verify
endpoints (`/auth/otp/verify`, `/auth/verify-phone-otp`,
`/auth/verify-email-otp`) now accept `role: 'admin'` alongside a required
`adminLevel: 'finance' | 'support'`. This is enforced by a zod `.refine()`,
not just a runtime check — `adminLevel: 'super'` is rejected by validation
before it ever reaches the database, so there's no code path where
self-signup can produce a super admin.

**Pending approval state** — a new `User.adminApprovalStatus` field
(`pending` / `approved` / `rejected`). A self-signed-up admin is created with
`pending`. Admins created via **bootstrap** or **Team invite** are set to
`approved` immediately at creation — those are trusted, super-admin-initiated
paths and were never meant to require a second approval step.

**Enforcement (`requireApprovedAdmin` middleware)** — every `/admin/*` route
now checks this live from the database (not from the JWT, since approval can
happen *after* a token was already issued — a pending admin logging in
immediately after signup must start working the moment they're approved,
without logging in again). A pending admin gets a clear
`403 ADMIN_PENDING_APPROVAL`; a rejected one gets `403 ADMIN_REJECTED`.

**Approval management** — `GET /admin/team/pending` (list) and
`POST /admin/team/pending/:id/decide` (approve/reject), both super-only,
audit-logged like every other admin action.

**Admin Panel UI**:
- `LoginPage.jsx` — a Sign in / Request access toggle. Request access shows
  the Finance/Support picker (with a note that Super can't be requested
  here) before the OTP step.
- `PendingApprovalPage.jsx` — shown instead of the dashboard for a
  pending/rejected account. Has a manual "Check again" button (polls
  `/auth/me` on demand — approval is a manual human step, so there's no
  reason to auto-poll) and Sign out.
- `AdminTeam.jsx` — super admins now see a "Pending Signup Requests" list
  with Approve/Reject next to the existing direct-invite form.
- `AdminShell.jsx` — a badge on the "Team" nav item shows the pending count
  for super admins, same pattern as an unread-notification badge.
- Route gating (`App.jsx`) — a pending/rejected admin hitting any real admin
  page (e.g. typing `/deals` directly) is redirected to `/pending-approval`,
  not shown a broken page or bounced to `/login` (they *are* authenticated,
  just not yet authorized).

### Existing Logic Reused
- **Creator and brand signup/login are untouched.** `findOrCreateUser`'s
  existing branches for those two roles are byte-for-byte the same code,
  just reached after an early-return for the new `role === 'admin'` case —
  verified with a dedicated zod test (9/9 assertions, including "creator
  signup still works unchanged" and "brand signup still works unchanged").
- Bootstrap and Team invite keep their exact existing behavior for who can
  call them and what they create — the only change is one added field
  (`adminApprovalStatus: 'approved'`) on the documents they create/update,
  which doesn't alter any existing check elsewhere (nothing previously read
  this field, since it didn't exist).
- The audit log, JWT issuance, and `/auth/me` response shape are all reused
  as-is — `adminLevel` was already in the token; this only adds
  `adminApprovalStatus` alongside it.

### API Changes
- `POST /api/auth/otp/verify`, `/api/auth/verify-phone-otp`,
  `/api/auth/verify-email-otp` — now accept `role: 'admin'` + `adminLevel`.
- `GET /api/admin/team/pending`, `POST /api/admin/team/pending/:id/decide`

### Database Changes
- `users.adminApprovalStatus` — `'pending' | 'approved' | 'rejected'`,
  undefined/unused for creator, brand, and pre-existing admin documents.

### How It Works
1. Someone picks "Request access" on the Admin Panel login screen, chooses
   Finance or Support, verifies OTP like anyone else.
2. Backend creates their `User` with `role: 'admin'`, the chosen
   `adminLevel`, and `adminApprovalStatus: 'pending'`. A token is issued
   immediately (so they don't need to re-verify OTP later) but every
   `/admin/*` call will 403 until approved.
3. Frontend sees `adminApprovalStatus !== 'approved'` and routes them to
   the pending screen instead of the dashboard.
4. A super admin opens Team → sees the request in "Pending Signup
   Requests" → Approves (or Rejects).
5. The requester's *already-issued* token now works — next time they hit
   "Check again" (or reload, or their next API call), they're in.

### How To Update It Later
- To add a cooldown/expiry on pending requests (e.g. auto-reject after 30
  days), add a scheduled job checking `adminApprovalStatus: 'pending'` +
  `createdAt` age — no schema change needed.
- To notify a super admin by email/SMS the moment a new request comes in,
  call the existing `notify()` service from `findOrCreateUser`'s admin
  branch (not added here, since no "who are the super admins to notify"
  query existed yet — a reasonable next step, not attempted to keep this
  change scoped).

### Important Notes
- Verified end-to-end via screenshot testing: the signup form (with the
  Finance/Support picker and the "Super can't be requested here" note), the
  pending screen (shows the correct requested level), and route-gating
  (visiting `/deals` directly as a rejected admin redirects to
  `/pending-approval` rather than showing the page or erroring).
- Both Postman collections (the standalone Admin Panel's and the full
  platform one) were updated with the new signup + approval requests.

---

# Scope-Alignment Pass

Changes made to bring the implementation in line with *Marqueiver — Final Scope
& Implementation Requirements*. See `SCOPE_STATUS.md` for the full
requirement-by-requirement status.

---

## Feature: Public Marqueiver Website (scope §3, §4)

### Files Changed
- frontend (new): `src/pages/public/content.js`, `src/pages/public/HomePage.jsx`,
  `src/pages/public/RolePages.jsx`
- frontend (new): `src/components/public/PublicChrome.jsx`,
  `src/components/public/LifecycleTrack.jsx`,
  `src/components/public/FeatureGrid.jsx`, `src/components/public/FaqList.jsx`
- frontend: `src/App.jsx`, `src/pages/LoginPage.jsx`

### What Was Added
- Public routes outside `<Protected>`: `/`, `/how-it-works`, `/for-creators`,
  `/for-brands`, `/faq`. Previously `/` and `*` were both protected, so a new
  visitor landed on `/login`.
- `/app` is the new signed-in landing target, since `/` is now public.
- Unknown paths redirect to `/` instead of the login bounce.

### Frontend Changes
- All marketing copy lives in `pages/public/content.js`. The lifecycle stages
  carry the real deal state they correspond to, and the messaging-lock flag
  mirrors `messaging.policy.js`, so the site cannot drift from the state machine.

### Important Notes
- `RoleHome` now sends non-admins to `/dashboard` rather than `/discover`,
  because creators no longer have a creator directory (§10).

---

## Feature: Signup With Role Selection (scope §5)

### Files Changed
- frontend (new): `src/pages/SignupPage.jsx`
- frontend: `src/App.jsx`, `src/pages/LoginPage.jsx`

### What Was Added
- `/signup` opens on Creator/Brand selection, then OTP, then routes into the
  matching onboarding flow.
- `?role=creator|brand` (used by the marketing CTAs) counts as the selection
  having been made, and stays reversible on the next step.
- Login and signup cross-link in both directions.

---

## Feature: Structured Negotiation With Offer History (scope §11, §12)

### Files Changed
- backend: `src/models/Deal.js`
- backend (new): `src/modules/deals/negotiation.service.js`
- backend: `src/modules/deals/deals.controller.js`, `deals.routes.js`
- frontend (new): `src/components/deals/NegotiationPanel.jsx`
- frontend: `src/lib/api.js`, `src/pages/DealDetailPage.jsx`

### What Was Added
- `deal.offers[]` — an immutable row per negotiation round carrying amount,
  deliverables, deadline, revisions, author, status and timestamp.
- `deal.terms.acceptedOffer` — which offer version the binding terms came from.
- Endpoints: `POST /api/deals/:id/offers`, `.../offers/:offerId/accept`,
  `.../offers/:offerId/reject`, `.../offers/:offerId/withdraw`.

### Existing Logic Reused
- Acceptance still routes through `transitionDeal()` and the existing state
  machine; nothing bypasses it. Escrow still funds from `deal.terms.amount`.

### Database Changes
- Collection: `deals`
- Fields added: `offers[]` (subdocument array), `terms.acceptedOffer` (ObjectId)

### How It Works
1. Creating a deal records the invite as offer #1 rather than as bare `terms`.
2. A counter-offer marks any open offer `superseded` (kept, never deleted) and
   appends a new row; an `invited` deal moves to `negotiating`.
3. Accepting a version copies its terms onto `deal.terms` and transitions to
   `accepted`.
4. Deals predating this change get a reconstructed opening offer at read time,
   flagged in the UI — no migration, and nothing fabricated is written to the DB.

### Important Notes
- **Why this was needed:** `deal.terms` was a single object, so a counter-offer
  overwrote the previous amount and the earlier offer was lost. Scope §11
  explicitly prohibits that.
- **Offers alternate.** You cannot counter your own outstanding offer — that
  would let a party silently revise the number the other side is looking at.
  Revising your own offer is withdraw-then-offer, and both stay in the record.
- The generic "Accept terms" transition button was removed from the deal page;
  it would let a party reach `accepted` with no offer version recorded.
- Terms are locked once past `negotiating`. Re-opening agreed terms is §15
  question 9 and is deliberately not implemented.

---

## Fix: Messaging Restricted To Active Campaigns (scope §13)

### Files Changed
- backend (new): `src/modules/messaging/messaging.policy.js`
- backend: `src/modules/messaging/messaging.controller.js`, `messaging.gateway.js`
- frontend: `src/pages/MessagesPage.jsx`

### What Was Fixed
- `assertParty()` checked party membership only. Either party could send messages
  at `invited` or `negotiating` by calling the API directly — the exact bypass
  §13 prohibits. It now checks deal state and returns 403 `MESSAGING_LOCKED`.
- **`markRead` had no authorization at all** — any authenticated user could mark
  any deal's messages read. Now party-checked.
- **`deal:join` on the Socket.io gateway was unauthorized** — any authenticated
  socket could join `deal:<anyId>` and receive the live message stream for a deal
  it was not part of, bypassing the REST checks entirely. Now verifies membership
  and state, and emits `deal:join:denied` with a reason. `typing` only fans out to
  rooms the socket was actually allowed to join.

### API Changes
- `GET/POST /api/messages/:dealId` → 403 `MESSAGING_LOCKED` before escrow funding.
- `GET /api/messages/threads` now returns `messagingUnlocked` per thread.

### Frontend Changes
- Locked threads show an explanation and a link to the deal instead of a composer
  that would 403, and skip the message fetch entirely.

### Important Notes
- Allowed states live in one file. §15 question 1 ("what exact events permit
  normal messaging") is unanswered; `escrow_funded` onward is the conservative
  reading of §13/§14 and is the single line to change.
- Admins bypass the state check for support and dispute handling.

---

## Fix: Role-Based Discovery Enforcement (scope §10)

### Files Changed
- backend: `src/modules/discovery/discovery.routes.js`
- frontend: `src/components/AppShell.jsx`, `src/App.jsx`

### What Was Fixed
- Discovery routes gated on `authenticate` only, so a creator could call
  `GET /api/discovery/creators` and receive the full creator directory, and a
  brand could list brands. Scope §10 requires backend enforcement, not UI hiding.
- `/creators*` is now brand-only; `/brands` is creator-only. Admin keeps both.
- Single-profile lookups stay open — a creator needs to read the profile of the
  brand it is dealing with. The rule is about directories, not counterparts.

### Frontend Changes
- "Discover" moved from the shared nav to brand-only; creators use Campaigns.
- `/discover` and `/saved` sit behind a `RoleRoute` guard.

---

## Removal: AI Integration (scope §1, §20)

### Files Changed
- backend (deleted): `src/modules/ai/`, `src/services/ai.service.js`
- backend: `src/routes.js`, `src/modules/users/users.routes.js`,
  `users.controller.js`, `src/modules/discovery/discovery.controller.js`
- frontend: `src/lib/api.js`, `src/pages/CreatorProfilePage.jsx`

### What Was Removed
- The `/api/ai` mount and `GET /api/ai/compatibility/:creatorId`.
- `POST /api/users/me/ai-analysis` and `runAiAnalysis`.
- The compatibility score attached to `getCreatorProfile`, and the "AI
  Compatibility" panel on the creator profile page.

### Important Notes
- `getCreatorProfile` keeps its `{ profile }` response envelope so existing
  callers don't break; only `compatibility` is gone.
- Scope §20 already listed AI as "Removed" — the code had not caught up.

---

## Fix: Legacy Deals Could Not Be Advanced (regression)

### Files Changed
- backend: `src/modules/deals/negotiation.service.js`, `deals.controller.js`
- backend: `src/models/Deal.js`

### What Was Fixed
Introducing offer-based acceptance broke every deal created before `offers[]`
existed. Those deals had their opening terms only on `deal.terms`, and the
back-fill was synthesised at read time with `_id: null` — so the accept call
resolved to `/offers/null/accept` and 404'd. Combined with the removal of the
generic "Accept terms" transition button, **legacy deals had no way forward at
all.**

`withOfferHistory()` (read-time, non-persisting) is replaced by
`ensureOfferHistory()`, which writes the opening offer so it has a real,
addressable `_id`. It runs on `getDeal` and at the top of every negotiation
action, and only ever writes when `offers` is empty.

### Database Changes
- Field added: `offers[].reconstructed` (Boolean) — marks a row derived from a
  pre-offers deal's terms rather than captured when the offer was made. Without
  it on the schema, mongoose silently dropped the flag.

### Important Notes
- Idempotent: a second read does not add a duplicate row.
- For a deal already past negotiation the back-filled offer is written as
  `accepted` and linked from `terms.acceptedOffer`, so history stays consistent.

---

## Feature: Design System & Public Site Visual Pass (scope §17)

### Files Changed
- frontend: `tailwind.config.js`, `src/styles/index.css`
- frontend: `src/pages/public/HomePage.jsx`, `RolePages.jsx`
- frontend: `src/components/public/LifecycleTrack.jsx`, `FeatureGrid.jsx`, `FaqList.jsx`
- frontend: `src/components/deals/NegotiationPanel.jsx`, `src/pages/SignupPage.jsx`
- frontend: `src/components/icons.jsx` (added `Lock`)

### What Was Added
- **Money palette.** `money-*` (ochre) marks amounts and escrow state and
  nothing else. `jade-*` confirms. No decorative accent colours.
- **Elevation scale.** `.panel` / `.card` / `.card-lifted` replace a single card
  shadow used for every surface.
- **Type scale.** `display-sm/md/lg/xl` with tracking that tightens as size
  grows; `.money` and `.tnum` set amounts in the display face with tabular
  figures so offer histories align column-wise.
- **Control tokens.** `.btn`, `.field`, `.pill-*` with visible keyboard focus
  rings, which the previous classes lacked.
- `prefers-reduced-motion` honoured globally.
- `ink` changed `#1A1A2E` → `#1B1130` (warm aubergine, in the violet family).

### Frontend Changes
- Hero rebuilt around a stack of three offer versions with the accepted one
  lifted, mirroring `deal.offers[]`. One load animation; no per-section reveals.
- Escrow and payout stages in the lifecycle carry the money colour.
- Removed the decorative gradient blob from the closing CTA and the
  middle-dot meta string from the hero.

### Important Notes
- The authenticated app (dashboards, campaigns, discovery, profile, analytics,
  admin) has **not** had a design pass. It inherits the new palette and control
  tokens where it already uses `.card` / `.btn-*`, but its layout, hierarchy,
  empty states and loading states are unchanged.

---

# Cleared Business Rules — Re-architecture (Part 1)

Implements steps 2 and parts of 3–6 of the implementation order in
*Marqueiver — Cleared Business Assumptions*. Step 1 (messaging) remains blocked
by §22. See `CONFLICTS_vs_cleared_rules.md` for the full conflict list.

## Feature: New Deal Lifecycle (§1, §6, §7, §14)

### Files Changed
- backend: `src/modules/deals/dealStateMachine.js` (rewritten), `src/models/Deal.js`
- backend (new): `src/utils/migrate-deal-states.js`, `tests/state-machine.test.js`
- backend: `deals.service.js`, `deals.controller.js`, `deals.routes.js`
- backend: `modules/admin/admin.controller.js`, `modules/payments/payments.controller.js`, `utils/seed.js`
- frontend: `pages/DealDetailPage.jsx`, `pages/DealsPage.jsx`

### What Changed
States are now `requested → negotiating → terms_agreed → escrow_pending →
active → submitted → revision → completed`, with `rejected` and `cancelled` as
distinct terminals.

| Old | New |
| --- | --- |
| invited | requested |
| accepted | terms_agreed |
| escrow_funded / in_progress | active (+ new escrow_pending) |
| disputed | removed — disputes move to tickets (§13) |

### Rules Now Enforced
- **Activation is webhook-only.** `escrow_pending → active` is actor `system`.
  No brand, creator or admin can activate a deal (non-negotiable rule 4).
- **No direct cancellation after `terms_agreed`** — admin-only from there on
  (rule 7). This closes the hole where a brand could cancel from `revision` and
  take a full refund after the creator had already delivered.
- **Deal rejection only before `terms_agreed`** (§7).
- **Admin reopening** of `rejected`/`cancelled` into one of four live states
  (§14), via a separate `canReopen()` that the normal transition endpoint
  cannot reach.

### Database Changes
- `deals.state` enum replaced.
- Added: `termsConfirmation` (brand/creator/agreedAt), `sourceOffer`,
  `escrowFundingDeadline`, `closure`, `escrow.settlement`,
  `escrow.lastFailure`, `escrow.needsAdminReview`,
  `offers[].expiresAt`, `workSubmissions[].late`, `workSubmissions[].reviewedAt`.
- Offer status enum: `superseded` and `withdrawn` removed, `expired` added.

### Migration
`node src/utils/migrate-deal-states.js --dry-run` then `--apply`.
Dry run by default. Two judgement calls are documented in the file header:
`accepted → terms_agreed` back-fills a dual confirmation that never happened
(flagged `legacyImplied`), and `disputed` rows are **not** migrated — they are
listed for manual handling, because the new lifecycle has no disputed state.

### Important Notes
- OPEN ASSUMPTION, flagged not decided: the cleared lifecycle omits `disputed`
  and §13 puts disputes on tickets, so a deal now keeps its state while a
  ticket is open against it. Confirm before the ticket module is built.

---

## Fix: Escrow Activation Moved To The Cashfree Webhook (§6, rules 4 and 5)

### Files Changed
- backend: `modules/payments/payments.controller.js`, `modules/deals/deals.service.js`

### What Was Fixed
The webhook previously verified its HMAC signature correctly but only updated
`Transaction.status`. The deal was moved by a **client** call to
`POST /deals/:id/transition {to:'escrow_funded'}`, and the `fund_escrow` effect
wrote `status: 'success'` on the transaction itself — so the frontend asserted
its own payment success and the deal activated on a user's click.

Now `PAYMENT_SUCCESS_WEBHOOK` calls `confirmEscrowFunded()`, the only path to
`active`. It is idempotent (Cashfree retries) and refuses to run unless the
transaction is genuinely marked success by the gateway.

`PAYMENT_FAILED_WEBHOOK` calls `flagEscrowFailure()`, which records the failure,
sets `escrow.needsAdminReview` and notifies the brand. No auto-retry, no
auto-cancel (A11).

---

## Feature: Escrow Splits (§8)

`admin_escrow_decision` replaces `refund_escrow`. Admin resolves with a full
refund, a full payout, or a custom split, validated to the paisa:
`creatorPayout + brandRefund === escrow total`. Rejected otherwise.

---

## Rework: Negotiation Model (§3, §4, §5)

### Files Changed
- backend: `modules/deals/negotiation.service.js` (rewritten)
- frontend: `components/deals/NegotiationPanel.jsx`, `lib/api.js`

### What Changed — and why the previous version was wrong
The earlier implementation enforced a single outstanding offer alternating
between the parties, superseded other offers on acceptance, and provided a
withdraw endpoint. The cleared rules overrule all three:

- **Multiple pending offers** from both parties simultaneously (§4). The
  alternating-party invariant is explicitly prohibited.
- **Accepting one offer leaves the others `proposed`** and acceptable (§4).
- **Offers cannot be withdrawn** — endpoint removed (§4).
- **Optional `expiresAt`** set by the proposer; expired offers cannot be
  accepted, swept lazily on read and before any action (§4).
- **Acceptance is not agreement** (§5). New `POST /deals/:id/confirm-terms`;
  both parties confirm separately and the second confirmation moves the deal to
  `terms_agreed` with actor `system`.
- **An invitation is no longer offer #1** (§3). Offers can only be posted once
  the receiving party accepts and the deal reaches `negotiating`.
- **`POST /deals/:id/reject`** rejects the whole deal, distinct from rejecting a
  single offer.

### Important Notes
- §4's "multiple accepted offers create separate deals" needs offers to become a
  top-level collection that spawns deals (step 3). Until then a second
  acceptance on the same deal is **refused with an explicit message** rather
  than silently doing the wrong thing.

---

## Tests

`tests/state-machine.test.js` — 8 cases, no database required, covering the
non-negotiable rules: nothing but `system` activates a deal, no party cancels
after `terms_agreed`, no brand cancellation from `revision`, rejection only
pre-terms, one party alone cannot agree terms, admin reopening constrained to
the four listed states. All pass.

---

# Cleared-Rules Re-architecture — Pass 1

Implements the dependency-chain root from `CLEARED_ASSUMPTIONS_FINAL.md`
(steps 1–3 of §23, plus the fee model). See `CONFLICTS_vs_cleared_rules.md` for
what these replace.

## Deal state machine rewritten (§1, §6, §7, §12, §14, A43, A47, A50, A51)

- New lifecycle: `requested → negotiating → terms_agreed → escrow_pending →
  active → submitted → revision → submitted → completed`, with `disputed`,
  `rejected` and `cancelled`. `rejected` and `cancelled` are distinct.
- `escrow_pending → active` is actor `system` only — no user action can
  activate a deal (rule 4).
- `cancelled` is admin-only from `terms_agreed` onward (rule 7). This removes
  the path where a brand could cancel from `revision` and take a full refund
  after the creator had already delivered.
- `rejected` is only reachable before `terms_agreed` (Q7).
- Admin reopening is a separate function (`canReopen`), never reachable through
  the normal transition endpoint. `completed` is final for everyone (A51).

## Offers moved to their own collection (B2)

`models/Negotiation.js` adds `NegotiationThread` and `Offer`. Offers were a
subdocument array on Deal, which could not express "an accepted offer spawns a
separate deal". Now: a thread holds many offers; accepting one creates a Deal
and closes the thread (B2 follow-up).

- One live offer per party, both may have one at once (A55)
- Max 10 pending per thread (A56)
- No withdrawal, no superseding (§4, rule 13)
- Optional `expiresAt` set by the proposer, evaluated lazily at accept time
  (A53) so a missing scheduled job can never make a stale offer acceptable

## Dual terms confirmation (§5, A47, A48)

`modules/deals/terms.service.js`. Accepting an offer is not agreement — both
parties confirm separately, and only the second confirmation moves the deal to
`terms_agreed`. A confirmation can be withdrawn until the other lands (A48).
`assertTermsEditable()` is the single enforcement point for immutability.

`proceedToPayment()` is the brand's explicit "Proceed to payment" click (A47),
which opens the 48-hour window (A49). `isFundingBlocked()` evaluates the window
on read, so funding stops after 48 hours without needing a cron (A50).

## Platform fee (B3)

`services/platformFee.js`. The model is decided — both sides, different rates —
but the percentages are explicitly TBD. Ships at **0%% on both sides** with a
boot warning; 0 is not a guess at the real rate, it is the only value that
cannot move money by an amount nobody approved. Every escrow figure routes
through `computeFees()`, so setting the real numbers is a config change:

```
PLATFORM_FEE_BRAND_PCT=…    PLATFORM_FEE_CREATOR_PCT=…
```

`validateSplit()` enforces `creator payout + brand refund = escrow total` (§8).

## Migration updated

`utils/migrate-deal-states.js` — `accepted` deals go back to `negotiating` for
re-confirmation (A45); deals past acceptance keep their state with
`legacyImplied` confirmations, since money has moved; `cancelled` rows are left
alone (A46); `disputed` rows are untouched pending the ticket system (A44).
Dry-run by default.

## Tests

`tests/cleared-rules.test.js` — 14 cases, no database needed. All pass.

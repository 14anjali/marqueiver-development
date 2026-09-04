# Marqueiver — Scope Implementation Status

Every requirement in *Marqueiver — Final Scope & Implementation Requirements*,
marked per scope §19: **Existing** / **Partial** / **Missing** / **Needs Change**,
with what changed in this pass.

Status is as of this pass. Anything marked **Blocked** needs a client decision
from §15 before it can be implemented correctly, and has deliberately not been
guessed at.

---

## §1 Preserve existing working functionality

| Requirement | Status | Notes |
| --- | --- | --- |
| Keep React + Vite (no Next.js migration) | Existing | Untouched. |
| Don't rewrite working auth / APIs / DB / Socket.io | Existing | All additive except the security fixes in §13 below, which were required by scope. |
| Remove AI from scope | **Done this pass** | Deleted `modules/ai/`, `services/ai.service.js`, the `/api/ai` mount, `POST /users/me/ai-analysis`, the compatibility score in `getCreatorProfile`, and the frontend API methods and UI block. |

## §2 Technology stack

| Area | Scope says | Code actually is | Status |
| --- | --- | --- | --- |
| Frontend | React + Vite + **TypeScript** | React + Vite, **plain JSX** — no TS toolchain, no `tsconfig.json` | **Doc is wrong** |
| State | **Redux** | React Context (`lib/auth.jsx`, `lib/ui-state.jsx`); Redux is not a dependency | **Doc is wrong** |
| Backend / API / DB / Real-time / Auth | Node + Express, REST, MongoDB, Socket.io, JWT + OTP + Google OAuth | Matches | Existing |

**Action needed:** correct §2 of the scope document rather than migrating the code.
Converting a 33-page app to TypeScript and Redux would violate §1, and neither
choice is load-bearing for any other requirement.

## §3–§4 Public website

| Requirement | Status |
| --- | --- |
| Public site exists; app doesn't open on bare signup | **Done this pass** |
| Explains Marqueiver, creators, brands, collaboration, features | **Done this pass** |
| Login / Sign Up in public nav | **Done this pass** |
| Hero, How It Works, For Creators, For Brands, Platform Features, Campaign flow, FAQ, CTAs | **Done this pass** |

New routes, all outside `<Protected>`: `/`, `/how-it-works`, `/for-creators`,
`/for-brands`, `/faq`. Content lives in one file (`pages/public/content.js`) and
the lifecycle stages are mapped to real deal states, so the marketing copy cannot
drift from the state machine. Unknown paths now land on the public site instead
of bouncing an anonymous visitor through a login redirect.

## §5 Authentication & signup flow

| Requirement | Status |
| --- | --- |
| Existing auth mechanisms retained | Existing |
| Public site has Login and Sign Up | **Done this pass** |
| Signup starts with role selection | **Done this pass** — `/signup` opens on Creator/Brand choice |
| Signup page contains a Login link | **Done this pass** — both pages cross-link |
| Role-specific onboarding after selection | Existing — routes to `/onboarding/influencer` or `/onboarding/brand` |
| Account created only after onboarding completes | Partial — the account row is created at OTP verification; `onboardingComplete` gates dashboard access |
| Social connection step after account creation | Existing |
| Dashboard requires one connected platform | Partial — see §8 |

**Open point:** the OTP verification step creates the user before onboarding
fields are collected. Making account creation strictly atomic with onboarding
would mean holding a verified identity in a pending state, which is a larger auth
change than §1 invites. Flagging rather than doing it.

## §6–§7 Creator and brand onboarding

Existing. Creator collects basic info, categories, socials, bio, languages,
gender/DOB and rate card; brand collects company info, industry, size, socials,
founded year and about. Scope says to check existing implementation before
changing fields — no changes were needed.

## §8 Social media connection

| Requirement | Status |
| --- | --- |
| At least one eligible platform before dashboard | **Needs change** — `completeOnboarding` checks Instagram specifically, not "any eligible platform". A creator who connects only YouTube is blocked. |
| Zero connected → blocked; one → allowed | Partial, per above |
| Connect more later from settings | Existing |
| Disconnect later | **Partial (confirmed)** — only `DELETE /api/instagram/disconnect` exists. YouTube and Facebook expose auth, callback, profile and sync routes but **no disconnect endpoint**. And no disconnect control is wired into the UI for any platform (see §16). |
| Real OAuth, real data, no dummy connections | Existing |

## §9 Meta / Instagram account-type rule

Existing. `modules/instagram` handles the ineligible-account case and surfaces
Meta's account-type guidance. Worth a manual retest against a real personal
account before sign-off, since the failure modes §9 prohibits (blank screen,
infinite loader, redirect loop) are runtime behaviours a code read can't confirm.

## §10 Role-based discovery rules

| Requirement | Status |
| --- | --- |
| Brand can discover creators | Existing |
| Brand must not get a brand directory | **Fixed this pass** |
| Creator can see campaigns | Existing |
| Creator must not get a creator directory | **Fixed this pass** |
| Enforced in frontend **and** backend | **Fixed this pass** |

Before: `discovery.routes.js` gated only on `authenticate`, so any creator could
call `GET /api/discovery/creators` and get the full creator directory. Now
`/creators*` is brand-only and `/brands` is creator-only, both at the route
layer. Single-profile lookups (`/creators/:id`, `/brands/:id`) stay open, because
a creator legitimately needs to read the profile of the brand it is dealing with —
the rule is about directories, not counterpart resolution.

Frontend matched: "Discover" moved out of the shared nav into brand-only, and
`/discover` and `/saved` sit behind a `RoleRoute` guard.

## §11 Campaign / deal system

| Requirement | Status |
| --- | --- |
| Real DB-backed workflow, not static cards | Existing |
| Brand discovers creators | Existing |
| Request persisted as real data | Existing |
| Receiving party sees the real request | Existing |
| Dedicated negotiation workspace | **Done this pass** |
| Brand offer visible to creator | **Done this pass** |
| Creator can accept or counter | **Done this pass** |
| Counter-offer is a real stateful action | **Done this pass** |
| Both sides see the current offer | **Done this pass** |
| **Previous offers must not be silently overwritten** | **Fixed this pass** |
| Each offer version preserves amount, deliverables, deadline | **Fixed this pass** |
| UI shows status, terms, history, next actions | **Done this pass** |
| No hardcoded campaign data in production flow | Existing |

This was the most serious functional gap. The `Deal` model had a single `terms`
object, so a counter-offer **overwrote** the previous amount and the earlier offer
was gone — directly contrary to §11. `timeline[]` recorded state changes only, not
terms.

Added `deal.offers[]` (`negotiation.service.js`), where every round is an
immutable row carrying its own amount, deliverables, deadline, revisions, author,
status and timestamp. `deal.terms` remains the binding terms that escrow is funded
against, but is now written **only** by accepting a specific offer version, and
records which one via `terms.acceptedOffer`. New endpoints:

```
POST /api/deals/:id/offers                      counter-offer
POST /api/deals/:id/offers/:offerId/accept      adopt that version as terms
POST /api/deals/:id/offers/:offerId/reject      decline without countering
POST /api/deals/:id/offers/:offerId/withdraw    pull back your own offer
```

Key invariant: **offers alternate**. You cannot counter your own outstanding
offer, because that would let a party quietly revise the number the other side is
looking at — the silent overwrite §11 prohibits. Revising your own offer is
withdraw-then-offer, and both actions stay in the record.

Deals created before this change get a reconstructed opening offer at read time
(marked as such in the UI), so no migration is needed and no fabricated row is
written to the database.

Verified against five invariants: history is preserved across a counter, the
superseded amount survives, self-counter is refused, non-parties are refused, and
terms don't move until an offer is accepted.

**Regression found and fixed.** The first version of this change synthesised the
opening offer for pre-existing deals at read time, with no `_id`. Because
acceptance now runs through an offer version, and the generic "Accept terms"
button had been removed, **every deal created before this change became
impossible to advance** — the accept call addressed `/offers/null/accept` and
404'd. `ensureOfferHistory()` now persists the opening offer on first read and
before any negotiation action, so it has a real, addressable id. It is
idempotent, and the legacy accept path is covered by a test.

## §12 Negotiation dashboard

All required elements are rendered from backend data in
`components/deals/NegotiationPanel.jsx`: deal name and participants, current
offer, proposed amount, deliverables, deadline, terms, accept / counter-offer /
reject actions, full offer history with author and timestamp, a current-state
indicator ("Your response needed" / "Waiting on the brand" / "Terms agreed"), and
notifications on new offers. **Done this pass.**

The generic "Accept terms" transition button was removed from the deal page —
leaving it would let a party reach `accepted` without any offer version being
recorded, reopening the §11 hole from a different direction.

## §13 Messaging rules

| Requirement | Status |
| --- | --- |
| No unrestricted messaging before campaign-active | **Fixed this pass** |
| Messaging opens when business rules permit | **Fixed this pass** (see §15 caveat) |
| Enforced on backend, not just hidden UI | **Fixed this pass** |
| Cannot bypass by calling the message API | **Fixed this pass** |
| Message area tied to campaign context | Existing |
| No dummy messaging flow | Existing |

Before: `assertParty()` checked only that you were the brand or creator on the
deal. Any party could send messages at `invited` or `negotiating` by calling the
API directly — exactly the bypass §13 prohibits.

Two further holes found while fixing it:

- **`markRead` had no authorization at all.** Any authenticated user could mark
  any deal's messages as read.
- **`deal:join` on the Socket.io gateway was unauthorized.** Any authenticated
  socket could join `deal:<anyId>` and receive the live message stream for a deal
  it was not party to — bypassing the REST checks entirely, including after they
  were fixed.

All three now verify membership and deal state server-side. The allowed states
live in one file (`messaging.policy.js`) and are also surfaced to the UI as
`messagingUnlocked` per thread, so a locked conversation explains itself instead
of producing a 403 after the user has typed a message.

## §14 Campaign execution flow

Existing and correct. `dealStateMachine.js` implements all fourteen steps with
per-actor transition rules and escrow effects. Steps 4–5 (negotiation workspace,
structured offers) were the gap, now closed under §11.

## §15 Business rules requiring confirmation — **BLOCKED, 15 open questions**

Not guessed at, per the scope's explicit instruction. Two have been given a
conservative default that is isolated to one file for easy change; the rest block
implementation.

**Given a documented default:**

1. *What exact events permit normal messaging?* → currently `escrow_funded`
   onward. Single source: `messaging.policy.js`.
2. *When does the negotiation workspace open?* → immediately on invite; the
   invite is offer #1. Change point: `NEGOTIABLE_STATES` in `negotiation.service.js`.

**Still blocking:**

3. **Can a creator apply to a campaign, or only a brand initiate?** This one is
   urgent: `POST /api/campaigns/:id/apply` **already exists and works**, letting
   any creator apply to an open campaign — which contradicts the scope's statement
   that the proposal excludes open campaigns. Either the endpoint comes out or the
   scope changes. It cannot stay ambiguous.
4. Is negotiation strictly structured offers, or is there a separate negotiation chat?
5. What exact action moves a deal from agreed to escrow-pending?
6. Is campaign activation automatic after escrow funding, or does someone confirm?
7. Exact conditions permitting each side to reject a request?
8. What happens when an offer expires? (No expiry exists today — offers stay open indefinitely.)
9. Can either party cancel after terms are agreed but before campaign start?
10. What happens to escrow on cancellation or dispute?
11. What exact event releases payout?
12. What is the revision limit? (`revisionsAllowed` defaults to 1 and is carried per offer, but nothing enforces it.)
13. What happens when a deadline is missed? (No deadline enforcement exists.)
14. Who can open a dispute, and at which states?
15. What are the exact allowed states and transitions? (A machine exists and is sound; it needs sign-off as *the* definition.)

## §16 Profile page — **Partial** *(corrected — previously marked Existing in error)*

| Requirement | Status |
| --- | --- |
| Profile picture, name, bio | Existing |
| All relevant onboarding information | Existing |
| Connected social accounts and handles | Existing |
| Connected/disconnected status | Existing |
| Edit Profile action | Existing |
| **Disconnect action for connected platforms** | **Missing** |
| Connect action for platforms not yet connected | Existing |
| Role-specific fields for Creator vs Brand | Existing |
| Real persisted data | Existing |

`ProfilePage.jsx` renders connect actions for Instagram, Facebook and YouTube but
has **no disconnect control for any of them**. `api.disconnectInstagram()` exists
in `lib/api.js` and is called from nowhere. §16 lists disconnect as a required
element, so this is a genuine gap, not a nice-to-have.

## §17 UI/UX redesign — **Partial**

**Design system (done).** `tailwind.config.js` and `styles/index.css` now define
a real token layer rather than ad-hoc utility strings:

- **Palette rule: ochre is money.** `money-*` marks amounts and escrow state and
  is used for nothing else, so a rupee figure is identifiable at a glance
  anywhere in the product. `jade-*` confirms, violet carries interaction. No
  colour is purely decorative.
- `ink` moved from a tinted near-black (`#1A1A2E`) to a warm aubergine
  (`#1B1130`) in the violet family, so dark sections read as Marqueiver rather
  than as generic dark mode.
- A real **elevation scale** — `.panel` (flat), `.card` (raised), `.card-lifted`
  (the one picked-up object on a page) — instead of one shadow under everything.
- A **display type scale** with tracking that tightens as size grows, and
  `.money` / `.tnum`: amounts are set in the display face with tabular figures,
  so offer histories align column-wise and can be compared down the page.
- Control tokens with **visible keyboard focus rings** (`.btn`, `.field`), which
  the previous button classes did not have, and `prefers-reduced-motion`
  honoured globally.

**Public site (done).** Rebuilt around the offer stack — three offer versions
rendered as paper with the accepted one lifted, which is literally how
`deal.offers[]` works. One orchestrated load animation, no per-section fade-ins.

**Not done: the authenticated app.** Dashboards, campaigns, discovery, profile,
analytics and admin still use the pre-token styling. They will pick up the new
palette and control tokens automatically where they use `.card` / `.btn-*`, but
they have not had a design pass — layout, hierarchy, empty states and loading
states are unchanged. This is the largest remaining item in the scope.

## §18 Data & production quality

| Requirement | Status |
| --- | --- |
| Real persistence of all workflow data | Existing; strengthened by `offers[]` |
| Frontend consumes real APIs | Existing |
| State transitions validated server-side | Existing (state machine) |
| Authorization role-aware and state-aware | **Fixed this pass** — it was role-aware but not state-aware, and had the gaps in §10/§13 |
| Understandable, actionable errors | Improved this pass (`MESSAGING_LOCKED`, offer conflicts) |
| No dummy data in production flow | Existing. `frontend/src/data/sample.js` still exists but is imported nowhere — safe to delete. |

## §19 Implementation method — **Partially followed**

Done: existing code inspected before change, requirements marked, ambiguous rules
left unimplemented, negotiation invariants unit-tested, both builds verified.

**Not done — and §19 requires it:**

- "Test both the normal path and failure/edge cases" — only the negotiation
  service has tests. Nothing else does.
- "Test role-based access from both UI and direct API requests" — the discovery
  and messaging rules were verified by reading the route definitions, **not** by
  issuing direct API calls against a running server.
- "Test campaign/deal state transitions so invalid actions cannot be performed" —
  verified by reading `dealStateMachine.js`, not by exercising it.
- "Verify that real data persists correctly across refresh/login/logout" — not
  done at all. The app has never been run against a live MongoDB in this work.

**Consequence:** by §19's own closing rule — "Only mark a feature complete after
its frontend, backend, database, authorization, error handling, and user
experience are all working" — nothing in this document should be treated as
*complete*. The marks above describe the state of the code, not a passed test.
A runtime pass against a real database, real Meta credentials and real Cashfree
credentials is required before sign-off.

---

## Recommended order from here

1. **Answer §15.** Question 3 (creator applications) is contradicted by shipped
   code today. Questions 8–13 block correct escrow, dispute and deadline handling.
2. **Fix §8** — accept any eligible platform, not Instagram specifically.
3. **§17 UI pass** over the authenticated app.
4. **Correct §2** of the scope document to match the real stack.
5. **Runtime test** the Meta account-type flow and the escrow path against real
   credentials.

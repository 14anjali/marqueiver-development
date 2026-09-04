# Marqueiver — Policy V2 Impact Report

Source of truth: **Marqueiver Platform Policies**, effective 01 August 2026,
operated by Dahmion Technologies. Fifteen policies.

This report is the deliverable required before code changes. Nothing in the
codebase has been modified for Policy V2 yet.

**Headline:** the policy document is materially different from what we built. It
overrules a large part of the cleared-assumptions work — including decisions
that were explicitly cleared with you as recently as this week. Where they
conflict, the policy wins and I have marked the reversal rather than quietly
keeping the old behaviour.

---

# PART 0 — Where the policy overrules already-cleared decisions

These are the ones to look at first, because work has been built on them.

| Cleared decision | Policy says | Verdict |
| --- | --- | --- |
| **B3** — fee charged to **both** sides, different percentages, both TBD | **14.5**: "The 12.5% commission is deducted from the Collaboration value and is **not charged additionally to the Brand**." **14.4**: the only deduction from a Creator is that commission. | **Reversed.** One rate, 12.5%, creator-side only. B3's TBD percentages are resolved and the two-sided model is dead. |
| **A2/§8** — Admin resolves escrow with a free custom split | **7.1** fixes the outcome by *stage*: 25/75 after work begins, 100/0 after submission. **5.5 option C** fixes 50/50 as the automatic default. Admin discretion applies only inside a **dispute** (10.4). | **Mostly reversed.** Cancellation is deterministic and self-service, not an Admin decision. Discretion survives only in disputes. |
| **A58/A59** — 3-day unreviewed submission is a *dispute trigger* | **5.3**: 7 days, and silence causes **automatic completion and payment release**, not a dispute. | **Reversed.** Wrong duration and wrong consequence. |
| **A57** — revision limit, code default 1 | **5.4**: default **two** rounds. | **Modify.** Default changes to 2. |
| **A62/A63 + §13** — a general Ticket subsystem, one open ticket per deal, deal-linked | The policy has no tickets. It has **Disputes** (Policy 10) with fixed SLAs, and a **Grievance Officer** channel (1.13) for complaints against Marqueiver. | **Rescope.** Build Disputes to Policy 10, not the generic ticket system. Saves significant work. |
| **§1 scope + A20** — AI removed from scope; I deleted `modules/ai` and `services/ai.service.js` | **3.4**: the Platform *generates* category classification, tone and language analysis, brand-fit suggestions, media-kit and indicative rate card. **2.5**: public profile content is sent to an AI provider. | **Reversed — restore.** AI analysis is now a policy-mandated feature. The deletion must be reverted. |
| **A43–A51** — state names `requested / terms_agreed / escrow_pending / active` | **5.1** names the stages Invitation → Negotiation → Acceptance → Escrow funding → In progress → Submission → Review → Completion. | **Modify.** The shape survives; the vocabulary and one state boundary change. See Part 8. |
| **B2** — an accepted offer spawns a **separate** deal; thread closes | The policy treats one Collaboration as running continuously through Negotiation into Acceptance. Nothing supports one negotiation producing several Collaborations. | **Pending confirmation.** Not contradicted outright, but not supported either. Do not build further on it until confirmed. |
| **A72** — account created only after onboarding completes | **1.3** requires 18+, accurate information, one account per type. **13.1** requires verified mobile *and* email at Basic level for all users at registration. | **Modify.** Stricter than what we cleared: email verification is now mandatory too, and an age gate is required. |
| **§10 discovery gates** (brand sees creators, creator sees campaigns) | **2.4** and **4.2** go much further — see Part 1, Creator Privacy. | **Extend.** Our rule was about directories; the policy is about fields. |

---

# PART 1 — Requirements Impact Report

## A. Already compatible — keep

| Feature | Note |
| --- | --- |
| JWT + OTP auth, role-based middleware | Meets 1.4. Needs the additions in Part 1D. |
| Deal state machine *mechanism* (`canTransition`, actor rules, effects) | The engine is right; the states get renamed. Keep the machine. |
| Escrow-before-work rule, webhook-only activation | Matches **4.5**, **6.2**. The webhook-only fix already made is exactly right. |
| Razorpay/Cashfree escrow integration | Matches 6.2. Provider terms still need confirming (see Pending). |
| In-platform messaging, deal-scoped | Matches **1.5**, **10.1** — the chat *is* the dispute record. |
| Social OAuth (Instagram, YouTube, Facebook) | Matches **13.1** social verification level. |
| Admin audit log (`AdminAuditLog`, before/after, actor, IP) | Matches **24**. Needs the extensions in Part 1C. |
| Notification service, in-app + WhatsApp | Keep; the event list expands considerably. |
| Reviews from completed collaborations only | Compatible. |

## B. Needs modification

| Feature | Current | Policy | Change |
| --- | --- | --- | --- |
| Commission | `platformFee.js` — two-sided, both 0%, TBD | 12.5%, creator-side, deducted at release (**6.3**, **14.1**) | Rewrite to a single configurable rate; keep it configurable for **14.7** (30 days' notice) and **14.8** (promotional rates). Rate must be **snapshotted at acceptance** — 14.7/14.8 both say the applicable rate is the one at acceptance. |
| Deal states | `requested … cancelled` | 5.1 vocabulary | Rename; add `resolution` (5.5); keep `disputed`. |
| Review step | No timer | 7 days → auto-complete + release (**5.3**) | Needs a scheduled job, reminders, and audit. |
| Revisions | Stored, unenforced | 2 rounds, enforced; out-of-scope requests are new scope (**5.4**) | Enforce the counter; block a 3rd request into Resolution. |
| Cancellation | Admin-only after terms | Stage-based, self-service, fixed percentages (**7.1/7.2**) | Rewrite entirely. |
| Disputes | `disputed` state, no structure | 14-day window, evidence, SLAs, four outcomes (**10.2–10.4**) | Build the full workflow. |
| Discovery | Role-gated directories | Field-level privacy + Credits gate (**2.4**, **4.3**) | Reveal model, not just a role gate. |
| Creator profile | Metrics undifferentiated | Verified vs self-reported must be visually distinct (**3.2**, **13.2**) | Add provenance to every metric. |
| Deal terms | amount/deliverables/deadline/revisions | Must also record **usage rights** and **exclusivity** at acceptance (**5.2**, **8.2**) | Extend the terms object. |
| Onboarding | Phone OTP | Mobile **and** email verified; 18+ (**1.3**, **13.1**) | Add email verification + age gate. |

## C. Conflicts with policy — remove or rewrite

| Item | Why |
| --- | --- |
| Two-sided fee model in `platformFee.js` | 14.5 forbids charging the brand additionally. |
| Admin free-choice escrow split on **cancellation** | 7.1 fixes the percentages. Free choice survives only in disputes (10.4). |
| Generic ticket subsystem (cleared §13) | Replaced by Disputes (Policy 10) + Grievance Officer (1.13). |
| 3-day unreviewed dispute trigger | Replaced by 7-day auto-completion (5.3). |
| `deal.state = 'cancelled'` as a single outcome | Cancellation now has stage-dependent money outcomes that must be recorded. |
| Unrestricted creator field exposure in discovery responses | 2.4 — phone, email, PAN, payout details must never reach a brand. **Verify this is not currently leaking** (see Part 10). |

## D. New — does not exist at all

Credits (wallet, purchase, consumption, expiry, ledger) · Reveal tracking ·
Age verification · Email verification · KYC levels and documents · Verified vs
self-reported metric provenance · Profile unpublish · Paid visibility tiers
(3.9) · Content usage rights and licence records (Policy 8) · Advertising
disclosure capture (Policy 15) · Reporting and moderation · Enforcement ladder
(Warning → Restriction → Suspension → Termination) · Appeals · Policy versioning
and acceptance records · Resolution stage with options A–D · Auto-completion job
· Payout records and TDS handling · Grievance Officer workflow with 24h/15-day
SLA · Minimum 30-day content longevity tracking (5.8)

## E. Pending — do not invent

**Commercial, not in the policy:**
1. **Credit pricing.** No price per Credit anywhere.
2. **Credits consumed per reveal.** Not specified.
3. **What "reveal" unlocks.** 2.4 rules out phone/email permanently, so a reveal must unlock something else — full metrics? audience insights? chat access? Undefined.
4. Paid visibility tier pricing (3.9).
5. Credit refund window — 6.1 says 7 days for unused Credits; confirm this is the only route given 6.5's table.

**Flagged in the policy itself as requiring professional confirmation:**
6. GST registration trigger and GSTIN (6.6/6.7) — architecture must make tax configurable.
7. TDS under 194-O/194R — ₹5,00,000 threshold logic, higher rate without PAN (6.8).
8. Escrow / payment-aggregator structure under RBI norms — the document explicitly says to confirm with Razorpay and counsel, and that Udyam registration alone does not permit an escrow arrangement.
9. Legal constitution of the entity.
10. Published HQ address (Consumer Protection E-Commerce Rules).

**Structural, from Part 0:**
11. B2 — does one negotiation still spawn separate deals?
12. Does dual terms confirmation (A45–A48) survive as the mechanism for 5.1 "Acceptance"? It is compatible, but the policy does not require it.

---

# PART 2 — Updated user flows

**Creator onboarding:** register → 18+ declaration → mobile OTP → email verify →
accept Terms + Privacy + Creator Policy (version recorded) → profile → connect ≥1
social (verified metrics) → optional self-reported metrics, labelled → AI
analysis generated (3.4) → payout KYC (PAN + UPI/bank in own name) → publish.
*Payout KYC may be deferred until first collaboration; it must be complete before
release.*

**Brand onboarding:** register → mobile + email verify → accept Terms + Privacy +
Brand Policy → business details, work email on business domain, website, GSTIN
where applicable (13.1) → verification status → buy Credits.

**Discovery and reveal:** browse limited public profile → spend Credits to reveal
→ Credits deducted and non-refundable from that moment (6.1) → reveal recorded in
the ledger → contact via in-platform chat only.

**Collaboration:** Invitation (brief: deliverables, format, timeline, messaging,
budget, exclusivity, **usage rights**) → Negotiation → Acceptance (scope frozen,
commission rate snapshotted, policy version recorded) → Escrow funding in full →
In progress → Submission (**disclosure confirmed first**, Policy 15) → Review (7
days) → Completion → commission deducted → payout in 3 working days.

**Review branches:** approve → complete · request revision (within scope, max 2) →
back to In progress · silence for 7 days → auto-complete and release · revisions
exhausted → **Resolution**.

**Resolution (5.5):** A reduced fee · B further paid revision (new scope, funded
before work) · C release without use — 50/50, **automatic after 7 days** · D
escalate to dispute.

**Cancellation:** stage determines the outcome automatically per 7.1/7.2. No
negotiation, no Admin step.

**Dispute:** raise within 14 days → escrow held → acknowledge ≤2 working days →
evidence ≤5 working days → determine ≤10 working days → one of the four outcomes
in 10.4 → audit.

**Enforcement:** report or detection → Warning → Restriction → Suspension (funds
and payouts held, 12.3) → Termination → appeal.

---

# PART 3 — Screens

**New:** age gate · email verification · policy acceptance (versioned) · Credits
wallet, purchase, history · reveal confirmation · KYC (creator payout, brand
business, enhanced) · usage-rights builder at brief and acceptance · disclosure
confirmation before submission · review countdown · Resolution screen (A–D) ·
cancellation with stage-specific consequence shown *before* confirming ·
dispute raise/evidence/status · report content or user · enforcement and appeal
· profile visibility toggle · payout details and TDS · Admin: credits,
commission, disputes, KYC queue, enforcement, policy versions, payouts.

**Modified:** creator profile (verified vs self-reported badges, unpublish) ·
discovery (locked fields + reveal CTA) · deal detail (usage rights, disclosure,
review timer, revision counter) · brand dashboard (credit balance) · admin.

---

# PART 4 — APIs

**Credits:** `GET /credits/wallet` · `POST /credits/purchase` ·
`POST /credits/reveal/:creatorId` · `GET /credits/transactions` ·
`GET /credits/reveals` · `POST /credits/refund-request`

**KYC:** `POST /kyc/creator-payout` · `POST /kyc/brand` · `POST /kyc/enhanced` ·
`GET /kyc/status` · admin `PATCH /admin/kyc/:id`

**Collaboration:** existing deals routes renamed to 5.1 vocabulary, plus
`POST /deals/:id/submit` (disclosure required) · `POST /deals/:id/approve` ·
`POST /deals/:id/request-revision` · `POST /deals/:id/resolution/:option` ·
`POST /deals/:id/cancel` (returns the stage outcome for confirmation first)

**Disputes:** `POST /disputes` · `POST /disputes/:id/evidence` ·
`GET /disputes/:id` · admin `POST /disputes/:id/determine`

**Policy:** `GET /policies` · `GET /policies/:slug` · `POST /policies/accept` ·
`GET /policies/my-acceptances`

**Moderation:** `POST /reports` · admin `POST /admin/enforcement` ·
`POST /appeals`

**Profile:** `PATCH /profile/visibility` · `POST /profile/metrics/self-reported`
· `POST /profile/ai-analysis` *(restored)*

## PART 5 — Database

**New:** `CreditWallet`, `CreditTransaction`, `CreatorReveal`, `KycVerification`,
`Dispute`, `DisputeEvidence`, `Cancellation`, `Payout`, `CommissionRecord`,
`ContentUsageRights`, `AdvertisingDisclosure`, `Policy`, `PolicyAcceptance`,
`Report`, `EnforcementAction`, `SocialMetricSnapshot`, `Deliverable`, `Revision`

**Modified:** `User` (+dob, emailVerifiedAt, accountStatus, enforcementLevel) ·
`Deal` (+usageRights, exclusivity, commissionRateAtAcceptance,
policyVersionAtAcceptance, reviewDeadline, revisionRound, resolutionOption,
publishedAt, liveUntil) · `CreatorProfile` (+isPublished, metric provenance,
aiAnalysis restored) · `BrandProfile` (+businessEmailDomain, gstin,
verificationLevel)

**Constraints:** one account per type per person (1.3) · unique reveal per
(brand, creator) so a brand is never charged twice · immutable
`CreditTransaction` and `AuditLog` · payout account name must match the creator
(6.4/3.8).

---

# PART 6 — Role & permission matrix (abridged)

| Capability | Creator | Brand | Admin |
| --- | --- | --- | --- |
| See creator phone/email/PAN/payout | Own only | **Never** (2.4) | Support only, audited |
| See creator full metrics | Own | After Credit reveal | Yes |
| Fund escrow | No | Own deals | No |
| Approve deliverables | No | Own deals | On dispute |
| Cancel | Per 7.2 stage | Per 7.1 stage | 7.3 only |
| Determine dispute | No | No | Yes (10.4) |
| See KYC documents | Own | Own | Yes, audited — **never** cross-user (13.5) |
| Enforcement actions | No | No | Yes, Super Admin for severe |

---

# PART 7 — Notification matrix (abridged)

Invitation received → Creator · Negotiation update → counterpart · Accepted →
both · **Escrow funded → both** · Work started → Brand · Submitted → Brand ·
**Review reminders at day 3 and day 6 → Brand** · **Auto-completion → both** ·
Payment released → Creator · Payout initiated → Creator · Revision requested →
Creator · Resolution entered → both · **Option C auto-applies in 7 days →
both** · Cancellation → both, with the money outcome stated · Dispute raised →
other party + Admin · Evidence deadline → both · Determination → both · KYC
required/approved/rejected → user · Credits low / expiring in 30 days → Brand ·
Warning/Restriction/Suspension → user · Policy update → all, **7 days before
effect** (1.14).

---

# PART 8 — State machines

**Collaboration:** `invitation → negotiation → accepted → escrow_pending →
in_progress → submitted → (revision → in_progress)×2 → completed`, with
`resolution` from exhausted revisions, `disputed` from any funded state,
`cancelled` per stage, `declined` pre-acceptance.

Escrow may only be released by: brand approval · auto-completion · dispute
determination · resolution option (6.2).

**Payment:** `unfunded → funding → funded → held → releasing → released →
paid_out`, plus `refunding → refunded` and `split`.

**Cancellation:** stage determines the outcome deterministically — no discretion.

**Dispute:** `raised → acknowledged(2wd) → evidence(5wd) → under_review →
determined(10wd) → closed`.

**KYC:** `none → submitted → under_review → verified | rejected → resubmit`.

**Enforcement:** `none → warning → restricted → suspended → terminated`, with
`appealed` from the last three.

---

# PART 9 — Implementation plan

**Phase 0 — decide.** Answer Part 1E items 1–5 and 11–12. Credits cannot be built
without pricing and without knowing what a reveal unlocks.

**Phase 1 — privacy and safety.** Audit every creator-facing response for leaked
phone/email/PAN/payout (2.4). This is a live compliance exposure and goes first
regardless of everything else. Add the age gate and email verification.

**Phase 2 — policy plumbing.** `Policy` + `PolicyAcceptance`, acceptance at
registration and onboarding, version snapshot on every collaboration.

**Phase 3 — money correctness.** Commission to 12.5% creator-side with the rate
snapshotted at acceptance; commission records; payouts; TDS hooks left
configurable pending CA confirmation.

**Phase 4 — lifecycle.** Rename to 5.1 vocabulary; migrate; usage rights and
exclusivity in terms; revision enforcement; 7-day review with the scheduled job,
reminders and auto-completion; Resolution A–D with the automatic C.

**Phase 5 — cancellation and disputes.** Stage-based cancellation; the full
Policy 10 dispute workflow with SLA tracking.

**Phase 6 — Credits.** Wallet, purchase, reveal, ledger, expiry, refunds.

**Phase 7 — KYC and verification.** Levels, documents, badges, metric
provenance.

**Phase 8 — content, IP, disclosure.** Licence records, disclosure capture before
submission, 30-day longevity tracking.

**Phase 9 — moderation, enforcement, appeals, admin.**

Phases 1 and 3 are the ones with real exposure — one is data protection, the
other is money moving at the wrong rate.

---

# PART 10 — Immediate verification I recommend

Before any of the above, one check worth running now: whether
`GET /api/discovery/creators/:id` and the campaign applicant endpoints currently
return creator phone, email or payout fields to a brand. The role gates added
earlier control *which directory* a user can list, not *which fields* come back.
If those fields are in the response, that is a live breach of 2.4 and should be
fixed today, independently of the Policy V2 programme.

# Marqueiver — Policy V2 Compliance Audit

Audited against the **code**, not against the previous status report. That
report was wrong in the ways you identified, and worse: three things it called
Done could not run at all. Those are listed under ❌ below.

**Standard applied:** a requirement is ✅ only if it works end to end — model,
service, controller, route, enforcement, and the UI where the policy requires
the user to see or do something. Schema alone is 🟡.

Verified this pass: `npm test` 40 pass · backend route graph loads ·
`vite build` succeeds.

---

# ❌ Conflicts with Policy V2 — found and fixed this pass

### 1. Commission was never charged (Policy 6.3, 14.1)
`release_escrow` credited the Creator the **full escrow amount**. Every
completed Collaboration paid out 100% and collected ₹0. On the Policy 14.2
example that is ₹1,250 lost per ₹10,000 deal.
**Fixed:** all four release routes now go through one `settleRelease()`.

### 2. Automatic completion crashed (Policy 5.3)
`applyStateFields` called `new Types.ObjectId(p.actorId)`, which throws on
`null`. Automatic completion and automatic option C both run with no human
actor, so **every** run would have thrown.
**Fixed:** `actorRef()` makes the actor id optional. Regression test added.

### 3. Review reminders queried a field that does not exist (Policy 5.3)
The job filtered on `submissions.submittedAt`; the model field is
`workSubmissions`. Day-3 and day-6 reminders would never have fired.
**Fixed.**

### 4. Commission rate was never snapshotted (Policy 14.7, 14.8)
Nothing wrote `deal.commission.ratePct`, so `settleRelease` fell back to the
**live** rate. A deal accepted under a promotional rate would have been
re-priced at release — the exact thing 14.8 forbids.
**Fixed:** frozen at Acceptance in `confirmTerms`, alongside the governing
policy versions (Policy 5.2/24).

### 5. Admin could choose any cancellation split (Policy 7.1)
The `admin_escrow_decision` effect allowed an arbitrary split on a normal
cancellation. 7.1 fixes the percentages by stage.
**Fixed:** effect removed. Discretion survives only in `dispute_determination`
(10.4).

### 6. Creator payout details were returned to Brands (Policy 2.4)
Four discovery queries ran `.lean()` with no projection, returning
`payoutMethod` — bank account, IFSC, UPI VPA, account name.
**Fixed** in the previous pass; re-verified.

### 7. Frontend deal flow referenced states that no longer exist
`DealDetailPage` and `DealsPage` used `requested`, `terms_agreed`, `active`,
`rejected`. None are in the enum. The deal screens were broken.
**Fixed:** migrated to Policy 5.1 vocabulary.

### 8. Seed data used an invalid state
`seed.js` created a deal with `state: 'negotiating'`, which now fails schema
validation on first boot. **Fixed.**

---

# ✅ Fully compliant

| Requirement | Policy | Evidence |
| --- | --- | --- |
| Commission 12.5%, Creator-side, brand not charged extra | 14.1–14.5 | 14.2 worked example reproduced exactly in tests |
| Commission snapshot at Acceptance | 14.7, 14.8 | frozen in `confirmTerms`, read by `settleRelease` |
| Commission on partial releases | 5.5, 7.1, 10.4 | charged on the released portion (see ⚠️ 3) |
| Escrow release only by the four permitted routes | 6.2 | single `settleRelease()` path; no route to `completed` from an unfunded state (tested) |
| Activation webhook-only | 4.5, 6.2 | `escrow_pending → in_progress` is actor `system` |
| Deterministic cancellation outcomes | 7.1, 7.2 | computed by stage; creator blocked after submission |
| Lifecycle vocabulary and transitions | 5.1 | back end, front end and seed aligned |
| `declined` distinct from `cancelled` | 7.2, 6 | separate states, separately styled |
| Revision cap of 2, then Resolution | 5.4, 5.5 | enforced in `requestRevision` |
| Late submission accepted and flagged | 11 | deadline + 24h |
| Disclosure blocks submission | 15 | 422 `DISCLOSURE_REQUIRED` |
| Creator PII never in discovery responses | 2.4 | `PRIVATE_CREATOR_FIELDS` on every query |
| Immutable money and consent records | 24 | Payout, CommissionRecord, PolicyAcceptance |
| Payout arithmetic balances | 6.3 | gross − deductions = net, validated |
| Dispute determination is Admin-only | 10.4 | tested |

---

# ✅ Completed end-to-end this pass (backend + UI)

| Requirement | Policy | Backend | Frontend |
| --- | --- | --- | --- |
| **Cancellation with consequence preview** | 7.1, 7.2, **28** | `GET /deals/:id/cancellation-preview` computes the stage outcome; `POST /deals/:id/cancel` executes it. Amounts computed server-side — the client cannot propose them. | `CancellationDialog` — loads the preview before enabling confirm, shows the exact money breakdown, requires typing CANCEL when escrow settles, skeleton/error/blocked states, Escape to close. |
| **Policy acceptance** | 1.14, 24 | `requirePolicyAcceptance` middleware blocks collaboration actions with `POLICY_ACCEPTANCE_REQUIRED`; 15 policy versions seeded on boot. | `PolicyAcceptanceGate` mounted in `AppShell` — checks proactively, lists outstanding versions, explicit checkbox, sign-out escape rather than dismiss. |
| **Age + verification gates** | 1.3, 13.1 | `requireAdult` and `requireBasicVerification` middleware with distinct error codes so the UI can route to the right screen. | Error codes surface through the existing toast/error path. **Signup UI still to build — see 🟡.** |

The preview and the settlement call the **same** function, tested explicitly, so
the figure shown to the user cannot drift from the money that moves.

# 🟡 Partially compliant — backend exists, not usable end to end

| Requirement | Policy | What exists | What is missing |
| --- | --- | --- | --- |
| **Age 18+** | 1.3 | Model, `meetsMinimumAge()`, `requireAdult` middleware, seeded gate | **DOB/declaration UI not built.** A user with no DOB is now blocked from acting but has no screen to fix it — this must ship before the gate is enabled in production. |
| **Email verification mandatory** | 13.1 | `hasBasicVerification()`, `requireBasicVerification` middleware | Same: enforced, but no verification screen wired into onboarding. |
| **Automatic completion** | 5.3 | Scheduler, reminders, release path — now runnable | Unverified against a live database; no review countdown in the UI. |
| **Resolution A–D** | 5.5 | States, settlement effects, automatic option C | No Resolution screen; options A/B have no endpoint. |
| **Usage rights / exclusivity** | 5.2, 8.2 | Full schema with the 8.2 defaults | Not captured in the brief, not shown before Acceptance. |
| **Enforcement ladder** | 12 | `accountStatus`, `enforcementLevel` | No actions, no appeals, no admin workflow. |
| **Disclosure** | 15 | Endpoint + submission gate | No UI to confirm it, so submission is currently unreachable in the app. |
| **Social disconnect** | — | All three endpoints + UI | Verified; genuinely complete. |

---

# ❌ Not started

Credits and reveals (6.1, 4.3 — also ⚠️ 1) · Dispute workflow with SLAs (10.2,
10.3) · KYC levels and documents (13) · Verified vs self-reported metric
provenance (3.2, 13.2) · Profile unpublish (3.3) · AI analysis restoration
(3.4) · Reporting and moderation (11, 20) · Content longevity tracking (5.8) ·
Admin panel expansion (23) · Notification matrix beyond the lifecycle events.

---

# ⚠️ Genuinely missing from Policy V2 — not invented

1. **What a Credit reveal unlocks.** 2.4 permanently forbids phone and email,
   so a reveal must unlock something else. Never stated. **Blocks Credits.**
2. **Credit price and credits per reveal.** Absent. **Blocks Credits.**
3. **Is commission charged on a partial release?** 14.4 ties it to "a completed
   Collaboration". Currently charged on the released portion only;
   `chargeCommission: false` is ready either way.
4. **Paid visibility tier pricing** (3.9).
5. **TDS treatment** — s.194-O/194R threshold and no-PAN rate (6.8). Fields
   exist, `tdsAmount` is 0 and `tdsRatePct` is null.
6. **GST registration trigger** (6.6/6.7). Configurable, off.
7. **Escrow legal structure under RBI norms** — the policy itself says Udyam
   registration alone does not permit it and to confirm with Razorpay.
8. **Does one negotiation spawn multiple Collaborations?** The B2 assumption is
   neither supported nor contradicted by Policy V2.
9. **Does dual terms confirmation remain mandatory?** Compatible with 5.1
   "Acceptance" but not required by it. Currently implemented.

---

## The honest summary

The **money layer and the state machine are correct and tested**. That is the
part with real exposure and it is the part that was most broken.

Everything above the money layer is **backend-only**. A user cannot currently
complete a Policy-compliant journey in the UI: they cannot accept a policy
version, declare their age, confirm a disclosure, see a review countdown, choose
a resolution option, or see what a cancellation will cost them before
confirming. Policy 28 requires that last category explicitly.

Next: enforce Phase 1–2 (age gate, email verification, policy acceptance at
registration) end to end, since those are cheap and currently sit as unused
methods, then Phase 5 disputes.

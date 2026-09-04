# Business Rules — Decisions Needed

The fifteen items scope §15 says must not be guessed. Each one below gives what
the code does *today*, the options, and a recommendation you can accept or
override. Answering in this document is enough — each answer maps to a named
place in the code.

Two are currently running on a documented default. The other thirteen block
implementation.

---

## 1. Can a creator apply to a campaign, or can only a brand initiate?

**This one contradicts shipped code and should be answered first.**

**Today:** `POST /api/campaigns/:id/apply` exists and works. Any creator can
apply to an open campaign. The scope says the proposal *explicitly excludes*
open campaigns.

**Options**
- **A.** Brand-initiated only. Remove the apply endpoint and the campaign
  application UI. Creators discover campaigns but cannot self-nominate.
- **B.** Keep creator applications. The scope statement changes, and an
  application becomes a real deal state needing its own accept/decline rules.

**Recommendation:** A, because it is what the scope says and because B needs its
own answers to questions 7 and 8. But B is already built, so if it is wanted,
say so before it is torn out.

**Answer:** ☐ A  ☐ B  ☐ Other: ______

---

## 2. When does the negotiation workspace open?

**Today (defaulted):** immediately on invite. The invite is offer #1.

**Options**
- **A.** On invite — the creator sees the offer and can counter straight away.
- **B.** Only after the creator accepts an initial request, so a two-step
  handshake precedes any terms.

**Recommendation:** A. It is fewer steps, and the offer record already carries
everything B's handshake would.

**Change point:** `NEGOTIABLE_STATES` in `negotiation.service.js`.

**Answer:** ☐ A  ☐ B  ☐ Other: ______

---

## 3. During negotiation, structured offers only, or a separate chat?

**Today:** structured offers only. Free-text chat is locked until escrow.

**Options**
- **A.** Offers only. Notes attach to each offer version.
- **B.** A negotiation chat separate from campaign messaging.

**Recommendation:** A. B needs care — it must not become the unrestricted
pre-campaign messaging §13 prohibits, and the line between "negotiation chat"
and "messaging" would be hard to defend.

**Answer:** ☐ A  ☐ B  ☐ Other: ______

---

## 4. What exact action moves a deal from agreed to escrow-pending?

**Today:** the brand calls `POST /deals/:id/payment-session`, allowed only at
`accepted`. There is no explicit "agreed → escrow pending" state between them.

**Options**
- **A.** Acceptance itself makes the deal payable; the brand funds when ready.
- **B.** An explicit "proceed to payment" action creating an `escrow_pending`
  state, so an accepted-but-unfunded deal is visibly waiting on the brand.

**Recommendation:** B if you want to chase unfunded deals or expire them.
A is simpler and is what exists.

**Answer:** ☐ A  ☐ B  ☐ Other: ______

---

## 5. Is campaign activation automatic after escrow funding?

**Today:** funding sets `escrow_funded`. A separate transition moves it to
`in_progress`. So activation is **not** automatic.

**Options**
- **A.** Automatic — funding activates the campaign immediately.
- **B.** The creator confirms and starts the work.
- **C.** The brand starts it.

**Recommendation:** B. It gives the creator a moment to confirm scope before the
clock starts, and it makes the deadline defensible.

**Answer:** ☐ A  ☐ B  ☐ C  ☐ Other: ______

---

## 6. What exact events permit normal messaging?

**Today (defaulted):** `escrow_funded`, `in_progress`, `submitted`, `revision`,
`disputed`, `completed`. Blocked at `invited` and `negotiating`.

**Note:** this currently opens chat at funding, which is slightly *before*
"campaign active". The reasoning is that money is committed at that point. If
§13 should be read strictly, remove `escrow_funded` from the set.

**Change point:** `MESSAGING_ALLOWED_STATES` in `messaging.policy.js` — one line.

**Answer:** ☐ Keep as-is  ☐ Strict: `in_progress` onward  ☐ Other: ______

---

## 7. Conditions for each side to reject a request?

**Today:** either party can reject any outstanding offer from the other, at any
negotiable state. Rejection closes the offer but leaves the deal open.

**Needs deciding**
- Can a brand withdraw an invite the creator has not answered? (Currently yes.)
- Does rejecting end the deal, or leave it open for a new offer? (Currently the
  latter.)
- Is there a limit on rejection rounds before the deal auto-closes?

**Answer:** ______

---

## 8. What happens when an offer expires?

**Today:** nothing. Offers stay open indefinitely. There is no expiry field and
no scheduled job.

**Needs deciding**
- Is there an expiry window at all? (e.g. 7 days from sending)
- On expiry: offer lapses and the deal stays open, or the whole deal closes?
- Who is notified?

**Recommendation:** a 7-day expiry that lapses the offer without closing the
deal. Anything shorter is hard on creators who post weekly.

**Answer:** ______

---

## 9. Can either party cancel after terms are agreed but before campaign start?

**Today:** `cancelled` is reachable from the negotiable states. Behaviour after
`accepted` and after funding is not specified.

**Needs deciding**
- Cancellable between `accepted` and funding? By whom?
- Cancellable after funding but before work starts? By whom?
- Any penalty or cooling-off window?

**Answer:** ______

---

## 10. What happens to escrow on cancellation or dispute?

**Blocks the money path. Cannot be guessed.**

**Needs deciding**
- Cancelled after funding, before work: full refund to brand? Fee retained? (The machine currently refunds in full, and also does so from `revision` — after the creator has already delivered once.)
- Cancelled mid-work: is the creator owed a partial release?
- Dispute: does the money freeze pending admin decision? (The machine already says yes — only an admin can move a disputed deal, see question 15.)
- Who can authorise a split, and is a partial release supported at all?

**Answer:** ______

---

## 11. What exact event releases the payout?

**Today:** brand approval of submitted deliverables releases escrow to the
creator's wallet.

**Needs deciding**
- Is there an auto-release if the brand does not review within N days? Without
  one, a brand can hold a creator's money indefinitely by never approving. This
  is the single most creator-hostile gap in the current rules.
- Any hold period before the creator can withdraw?

**Recommendation:** auto-approve after 7 days of brand inaction, with reminders
at 3 and 6 days.

**Answer:** ______

---

## 12. What is the revision limit?

**Today:** `revisionsAllowed` defaults to 1 and is carried on every offer
version, but **nothing enforces it.** A brand can request unlimited revisions.

**Needs deciding**
- Is the per-deal negotiated number binding?
- What happens when it is exhausted — forced approval, dispute, or renegotiation?

**Answer:** ______

---

## 13. What happens when a deadline is missed?

**Today:** nothing. Deadlines are stored and displayed; nothing acts on them.

**Needs deciding**
- Grace period?
- Does a missed deadline let the brand cancel and recover escrow?
- Automatic notification, or does the brand raise it manually?

**Answer:** ______

---

## 14. Who can open a dispute, and at which states?

**Today:** a `disputed` state exists in the machine. Entry conditions are not
constrained by role or state.

**Needs deciding**
- Who may *open* one? The machine lets either party open from `escrow_funded` onward, but only an admin may resolve it. Confirm both halves.
- From which states? (Presumably `submitted` and `revision` at minimum.)
- Can a dispute be raised after completion and payout?
- Who resolves — any admin, or a specific role?

**Answer:** ______

---

## 15. Sign off the exact allowed states and transitions

`dealStateMachine.js` already constrains **who** may make each move and **what
happens to the money**. It matches §14 and is sound. It needs confirming as *the*
definition rather than one developer's reading.

| From | To | Who may do it | Escrow effect |
| --- | --- | --- | --- |
| invited | negotiating | creator, brand | — |
| invited | accepted | creator only | — |
| invited | cancelled | creator, brand | — |
| negotiating | accepted | creator, brand | — |
| negotiating | cancelled | creator, brand | — |
| accepted | escrow_funded | **brand only** | funds escrow |
| accepted | cancelled | creator, brand | — |
| escrow_funded | in_progress | creator, system | — |
| escrow_funded | disputed | creator, brand | opens dispute |
| escrow_funded | cancelled | **brand, admin** | **refunds brand** |
| in_progress | submitted | creator only | — |
| in_progress | disputed | creator, brand | opens dispute |
| submitted | completed | **brand only** | **releases to creator** |
| submitted | revision | brand only | — |
| submitted | disputed | creator, brand | opens dispute |
| revision | submitted | creator only | — |
| revision | disputed | creator, brand | opens dispute |
| revision | cancelled | **brand, admin** | **refunds brand** |
| disputed | completed | **admin only** | releases to creator |
| disputed | cancelled | **admin only** | refunds brand |
| disputed | in_progress | **admin only** | resolves, work resumes |
| completed | — | terminal | |
| cancelled | — | terminal | |

**Things worth a second look before you sign it off:**

- **A cancellation after funding refunds the brand in full**, including from
  `revision` — i.e. after the creator has already delivered once. That is
  question 10, and as written it favours the brand heavily.
- **Only an admin can resolve a dispute.** Parties cannot settle between
  themselves once one is opened. That answers part of question 14 but means
  every dispute needs staff time.
- **There is no route out of `in_progress` except submit or dispute.** A creator
  who wants to withdraw mid-campaign has no path.
- **Nothing enters `disputed` after `completed`.** Once paid, it is final.

**Answer:** ☐ Confirmed as-is  ☐ Changes: ______

# RelianceGT@26-10-2026 bug sheet — Resolution Sheet

Companion document to `RelianceGT@26-10-2026.docx` (Downloads). This sheet is
not a formal QA execution report like the Module 08/10/11/16 resolutions —
it is a raw, unstructured list of ~30 items spanning the admin console, the
API, and the technician mobile app: real bugs, UI-copy complaints, feature
requests, and explicit "doubt"/business-logic-clarification items, with no
severity ratings or defect IDs. Items are referenced by their position in
the document (#1 through #30; two numbers, #21 and part of #23, carried no
extractable content and are not actioned).

Of ~27 actionable items: **10 are fixed**, **2 confirmed already fixed in
`dev`**, **2 confirmed not reproducible**, **7 confirmed intended/already
correct**, **4 deferred** (payment/earnings work and a vendor-handover
feature, per explicit decision), and **2 recommended for live verification
before any speculative fix**.

| # | Title | Disposition |
|---|---|---|
| #1 | Franchisee Details page has excessive empty space | **Fixed** |
| #2 | Base-location message/link persists after setting a base | Confirmed intended, no change |
| #3 | Change Password is a separate page, not a modal | **Fixed** |
| #4 | Employee Statements month dropdown shows "(so far)" and truncates | **Fixed** |
| #5 | Doubt: multiple franchise admins per franchise? | Answered — already allowed, no change |
| #6 | Unclear Travel Allowance field labels | **Fixed** |
| #7 | "Please check the UI" | Not actionable — no detail given |
| #8 | Paused products selectable in Speed Rule | **Fixed** |
| #9 | Choose Category modal missing duplicate-rule message | **Fixed** |
| #10 | Doubt: Speed Rule priority, Super Admin vs Franchisee Admin | Answered — no conflict possible by the data model |
| #11 | Current franchise shown in handover list | Confirmed intended, no change |
| #12 | "Pincodes" redirects to Edit Franchise | Not reproducible, no fix |
| #13 | Ticket timeline shows "Manager" instead of the real role | **Fixed** |
| #14 | Speed Rule from one category applied to a different category | Recommend live-data verification, no speculative fix |
| #15 | Serial correction fails with "Missing feature: jobs.view" | **Fixed** |
| #16 | No earnings/transaction-history view in the console | Deferred — no payment work this pass |
| #17 | Spare-parts approval confirmation message unclear | **Fixed** |
| #18 | "Slot Closed" tickets stay in Upcoming | **Fixed** (added approved sub-filter; underlying design unchanged) |
| #19 | Upcoming/In Progress not sorted FCFS | Already correct, no change |
| #20 | Admin-created technician has no Edit Details option | Confirmed franchisee-scoping rule, not a bug, no change |
| #22 | Travel field validation delayed until Save | **Fixed** |
| #23 | Travel distance stuck at ~4.5km | Recommend live-data verification, no speculative fix |
| #24 | Spare Parts nav throws "masters.view" error | Not reproducible, no fix |
| #25a | Handover should restrict to pincode-eligible franchises | Confirmed intended, no change |
| #25b | Vendor-initiated handover | Deferred — out of scope, sized like a feature |
| #25c | Mandatory pincode range on franchise create | Confirmed intended (optional), no change |
| #26 | High Priority tag keeps blinking after close | Already fixed in `dev`, no fix needed |
| #27 | No search filter in technician app | **Fixed** |
| #28 | Earnings math discrepancies (₹50, ₹100) | Deferred — no payment work this pass |
| #29 | Closed high-priority tickets appear in both tabs | Already fixed in `dev`, no fix needed |
| #30 | — | No content extracted from the document |

---

## #1 — Franchisee Details page layout

**Disposition: Fixed.**

**Root cause.** `FranchiseePage.tsx`'s single `grid gap-3.5 lg:grid-cols-2`
laid every section out in source order with no `col-span` or height
balancing, so a short card (Technicians: one line + one button) landed
beside a much taller one (Details, 7 rows) with uneven blank space between.

**What changed.** The Header section now spans the full width. The short
Pincodes and Technicians cards are stacked together in one column via a
wrapping flex div, so together they roughly balance the tall Details card
beside them. The Franchisee Admins panel and Home Facility Users card now
span the full width (both read better as wide lists). Allowances already
spanned full-width and is untouched. The loading skeleton was updated to
match.

---

## #2 — Base-location message persists after setting one

**Disposition: Confirmed intended, no change.**

Travel is frozen at accept (`accept_snapshot.travel`) and deliberately
never recomputed — setting a base location afterward correctly has zero
effect on an already-accepted job. The message is already worded in past
tense ("wasn't set **when you accepted**"), which already explains the
freeze. No code change, per the confirmed decision.

---

## #3 — Change Password as a centered modal

**Disposition: Fixed.**

**Root cause.** One shared `ChangePasswordPage.tsx`, mounted at three
routes, rendered as a full page with a heading and a Card.

**What changed.** The page body now renders as an always-open, centered
`Dialog`. All three routes (`/account/password`, `/portal/password`,
`/franchise/password`) are unchanged — `RequirePasswordChange` depends on
them staying routable for the forced-password-change gate. When the
signed-in user must change an admin-issued temporary password
(`mustChangePassword`), both the dialog's close button and the Cancel
action are hidden, since there's nowhere to return to and the route guard
would otherwise snap the dialog back open.

---

## #4 — Employee Statements month dropdown

**Disposition: Fixed.**

**Root cause.** The dropdown trigger was a fixed `w-40` (160px), further
narrowed by a redundant `"Month: "` prefix, so the longest real label
("Month: September 2026 (so far)") didn't fit and was clamped by a global
style rule.

**What changed.** Dropped the redundant prefix (the control's own
`aria-label` already names it) and widened the trigger to `w-56` (224px),
comfortably fitting "September 2026 (so far)." The `"(so far)"` label logic
itself and the global clamp style are untouched.

---

## #5 — Doubt: multiple franchise admins per franchise?

**Disposition: Answered — already allowed, no code change.**

Confirmed by both schema (`memberships.franchisee_id` has no unique
constraint) and service (`add_admin()` never caps the count; only a floor
of "at least one" is enforced). The repository's own documentation already
presupposes more than one is normal.

---

## #6 — Unclear Travel Allowance field labels

**Disposition: Fixed.**

**What changed.** Relabeled four of the five fields per QA's suggestions
("Chargeable Distance Interval (km)," "Allowance per Interval (₹)," "Road
Distance Adjustment (%)," "Maximum Travel Allowance per Job (₹)"), added
short hints to the two fields that had none, and renamed "Worked example"
to "Travel Allowance Calculator." One shared component renders both the
Freelancer and Employee cards, so this single edit fixes both. (The
`TechnicianRulesPanel`'s own, separate copies of similar labels were left
untouched — flagged as a known follow-up, not part of this fix's scope.)

---

## #7 — "Please check the UI"

**Disposition: Not actionable.** No further detail was given in the
document to identify what to check.

---

## #8 — Paused products selectable in Speed Rule

**Disposition: Fixed.**

**Root cause.** Both the staff-side picker and the franchise-side catalogue
endpoint filtered on approval status only, never on whether a product was
paused — and the franchise endpoint's own docstring incorrectly claimed
"approved, live models only."

**What changed.** Carried an `isActive` flag through both paths. A paused
product now shows a "Paused" label and cannot be selected for a new rule —
matching exactly how a paused category already behaves. Categories' own
selectability is unchanged.

---

## #9 — Choose Category modal missing duplicate-rule message

**Disposition: Fixed.**

**Root cause.** Both the Add form and the nested picker ran the identical
duplicate check, but the picker only ever rendered the terse "Already has
a rule" instead of the Add form's full sentence naming the target and
technician type.

**What changed.** Extracted the full sentence into one shared helper used
by both the Add form's validator and the picker, so the picker now shows
the same informative message. (The existing default-to-"Freelancer"
behavior before a technician type is chosen is an existing limitation of
the Add form too — left as-is, not introduced by this fix.)

---

## #10 — Doubt: Speed Rule priority, Super Admin vs Franchisee Admin

**Disposition: Answered — no conflict is possible, no code change.**

`FranchiseeSpeedRule.franchisee_id` is `NOT NULL` with no company-wide
scope at all; every unique index is keyed by franchisee, technician type,
and target. A write to an existing key is an upsert, not a second row. Two
different franchisees can each have their own rule for the same product,
but each only ever applies to that franchisee's own technicians (frozen
into `accept_snapshot` at accept) — no cross-franchise collision is
structurally possible.

---

## #11 — Current franchise shown in handover list

**Disposition: Confirmed intended, no change.** It's shown with a disabled
radio and a "Current" badge, additionally blocked server-side if somehow
submitted — a deliberate design, not an unguarded bug. Per the confirmed
decision, this stays as-is.

---

## #12 — "Pincodes" redirects to Edit Franchise

**Disposition: Not reproducible, no fix.** Current code already opens a
dedicated Pincode Ranges modal when "Pincodes" is clicked; "Edit" is a
separate button with its own handler. Likely describes stale or
pre-release behavior.

---

## #13 — Ticket timeline shows "Manager" instead of the real role

**Disposition: Fixed.**

**Root cause.** Exactly two staff timeline-event titles ("assigned" and
"rescheduled") were hardcoded to "…by a manager" regardless of the actor's
real role. The actor's real name already showed correctly in a separate
field; only the bold title's role word was wrong.

**What changed.** Added a nullable `actor_role` column to `ticket_events`,
storing the acting staff member's role at the moment they act (not
resolved later from a join, which would show their *current* role rather
than the one they held at the time — and the creator field is often null
on the "assigned" write path anyway). The timeline title now renders the
real role ("Assigned by an Admin," "Rescheduled by a Regional Head," etc.)
when it's known. Every historical row has `actor_role = NULL` and falls
back to today's unchanged "…by a manager" wording — no backfill needed.

**Migration note:** the new migration (which also merges the two Alembic
heads that existed before it) was written and verified — a clean import,
the full unit-test suite, and `alembic heads` confirming exactly one head
— but **was not run against any database**. Applying it to dev and then
production remains a manual step for whoever owns that, per this repo's
two-database migration discipline.

---

## #14 — Speed Rule from one category applied to a different category

**Disposition: Recommend live verification, no speculative fix.**

The matching code itself (`speed_rules.py`/`speed.py`) is strictly
UUID-based and never compares by name — a category-name collision bug is
not possible in this code, and it is unit-tested. The most likely real
explanations are either a mis-parented catalog node (the product genuinely
sitting under the wrong category in the live tree) or a stale
`accept_snapshot` frozen before a correction was made. Recommend checking
the live catalog tree and the specific rule's stored ids before writing any
fix — not done in this pass.

---

## #15 — Serial correction fails with "Missing feature: jobs.view"

**Disposition: Fixed.**

**Root cause.** The PATCH route for correcting a ticket serial requires the
`jobs.view` feature. Staff and vendors hold it; franchise-portal roles
(whose ticket access is deliberately read-only) hold `franchise.tickets`
instead and are always refused — but the frontend's "Correct the order
serial" button rendered unconditionally, so a franchise user would see and
click an action they'd always be refused.

**What changed.** Gated the button behind the same `jobs.view` check the
server actually requires, mirroring the established gating pattern already
used elsewhere on the same page. The informational banner itself still
renders for anyone who can read the ticket, including franchise accounts,
read-only; only the action button that would 403 is hidden. The backend's
generic "Missing feature: X" wording was deliberately left unchanged — it's
a uniform pattern across the whole app.

---

## #16 — No earnings/transaction-history view in the console

**Disposition: Deferred.** Confirmed genuinely absent (only a pool-wide
penalty/bonus screen and a CSV statement download exist today). Per
explicit decision, no payment/earnings work was done in this pass —
documented as a confirmed gap for a future dedicated module.

---

## #17 — Spare-parts approval confirmation message unclear

**Disposition: Fixed.** Replaced `"{name} is told it's approved."` with
wording naming the real ticket code and part, explaining the actual
outcome: `"{technicianName} will be notified once you approve the
{partName} request for {ticketCode}."`

---

## #18 — "Slot Closed" tickets stay in Upcoming

**Disposition: Fixed** (a new approved sub-filter was added; the underlying
"a job stays Upcoming even once its slot has closed" design is unchanged —
confirmed intentional, since a late technician can still go and do the
job).

**What changed.** Added a secondary filter row — "All" / "Slot closed,"
each with a count — directly below the main 3-way segmented control,
visible only while "Upcoming" is selected and only when at least one job
in it is currently slot-closed. It filters the already-fetched list
client-side using the app's existing slot-closed badge logic; no backend
change. Resets to "All" whenever the main tab changes away from Upcoming.

---

## #19 — Upcoming/In Progress not sorted FCFS

**Disposition: Already correct, no change.** Both segments already sort
ascending by slot time (or SLA deadline when no slot exists) server-side,
and a reschedule already invalidates the query, which naturally re-sorts
on refetch.

---

## #20 — Admin-created technician has no Edit Details option

**Disposition: Confirmed franchisee-scoping rule, not a bug, no change.**
Company staff (Admin/National Head) can only *manage* technicians on the
company's home franchisee — they can still read any franchisee's
technician, just not edit one on a non-home franchisee, regardless of who
created it. This matches the project's documented hard rule exactly.

---

## #22 — Travel field validation delayed until Save

**Disposition: Fixed.** The Travel Allowance form's validation mode
defaulted to validating only on submit. Added `mode: "onBlur"`, so a field
now shows its error as soon as it's left invalid rather than only after
Save is clicked; the existing default re-validate-on-change behavior
already clears the error live once corrected.

---

## #23 — Travel distance stuck at ~4.5km

**Disposition: Recommend live verification, no speculative fix.** The
distance arithmetic itself is correct and unit-tested, with no hardcoded
fallback found anywhere in the path. The most likely explanations are
either checking the figure on an already-accepted ticket (where travel is
frozen at accept and never recomputed, by design) or the two specific
pincodes' stored coordinates genuinely being close together in the live
data. Recommend verifying the ticket's accept state and the two pincodes'
actual stored coordinates before writing any fix — not done in this pass.

---

## #24 — Spare Parts nav throws "masters.view" error

**Disposition: Not reproducible, no fix.** The Spare Parts queue is
correctly gated on `parts.handle`, not `masters.view`. This exact failure
class (a staff-only permission check leaking into the franchise portal) has
already been found and fixed at least twice before in this codebase, with
a regression test pinning one of those fixes. Recommend fresh, specific
repro steps before concluding a live gap exists.

---

## #25 — Franchise pincode mapping & ticket handover (three sub-items)

**#25a (restrict handover to pincode-eligible franchises) — Disposition:
Confirmed intended, no change.** Flagged a real tension before finalizing
this: this app's hard rule is that a pincode belongs to exactly one
franchisee, so filtering the handover list to "franchisees whose pincode
ranges include the customer's pincode" would almost always leave exactly
one eligible franchisee — the one that already owns it — making the
handover feature pointless. After raising this, the decision was to leave
today's design as-is: any active franchisee stays offered, with staff
judgment as the guard, matching the already-documented "staff override"
intent.

**#25b (vendor-initiated handover) — Disposition: Deferred.** Confirmed
genuinely absent (no UI, no permission, no reachable backend route from
the vendor portal). Needs a new permission model — sized like a feature,
not a bug fix; out of scope for this pass.

**#25c (mandatory pincode range on franchise create) — Disposition:
Confirmed intended, no change.** A zero-pincode franchise is an explicitly
supported state today ("owns nothing, offered no tickets"); making
pincodes mandatory would mean restructuring the create flow's deliberate
two-step design. Left optional.

---

## #26 — High Priority tag keeps blinking after close

**Disposition: Already fixed in `dev`, no fix needed.** The described
symptom matches the pre-fix code exactly from a merge already in `dev`
(2026-11-02). Current `HEAD` already keeps the badge visible but stops it
blinking once a ticket is Closed or Force-Closed. Recommend QA retest
against a build from after that merge.

---

## #27 — No search filter in technician app

**Disposition: Fixed.** Added a plain, controlled search box to My Jobs,
filtering the active tab's already-fetched list by ticket code, customer
name, and pincode, case-insensitively — reusing the same no-debounce,
pure-predicate pattern already used on the Spare Parts request screen. It
composes on top of the Slot Closed sub-filter (#18) when both are active.
Two genuinely new strings (the search placeholder and a "no jobs match"
empty-state line) were added to all five locale files to satisfy the
project's i18n consistency gate; the four non-English versions are
placeholder translations and **must be reviewed by a native speaker**
before a production build, per this repo's own process.

---

## #28 — Earnings math discrepancies (₹50, ₹100)

**Disposition: Deferred.** Both gaps traced to plausible, documented
mechanisms during research (not confirmed bugs): the ₹50 gap has no
reproducing code path (the "Earned" total and the transaction list are
built from the identical table, filter, and window); the ₹100 gap matches
the technician-holding deduction exactly. Per the explicit decision to do
no payment-related work in this pass, neither was investigated further or
fixed.

---

## #29 — Closed high-priority tickets appear in both tabs

**Disposition: Already fixed in `dev`, no fix needed.** Same merge as #26.
A ticket's status already makes "Active High Priority" and "Closed
Tickets" mutually exclusive server-side. Recommend QA retest against a
build from after that merge.

---

## #30 — (no content extracted)

Nothing to action — the source document carried no readable content at
this item.

---

## Verification performed

- `api`: all touched backend modules (`app.models.ticket_event`,
  `app.features.tickets.service`, `app.core.reschedule`,
  `app.core.speed_rules`) import cleanly together; full `pytest` suite
  (unit, no database) passes with no failures; `alembic heads` confirms
  exactly one head after the new migration merges the two that existed
  before it.
- `adminWeb`: `npx tsc --noEmit` (clean) and `eslint` (clean) across all 16
  touched files; the three touched test files (`TravelRulesForm.test.tsx`,
  `pickTree.test.ts`, `SpeedRulesSection.test.tsx`) pass in full (26/26).
- `mobileapp`: `npm run lint` (clean, including the i18n consistency check
  across all five locale files), `npm run typecheck` (clean), and the full
  test suite (24 suites / 219 tests, all passing).
- Manual review of the riskiest diffs: the migration's head-merge and the
  `actor_role` wiring through both the "assigned" write site and the
  separate `move_slot` reschedule path (#13); the `isTaken`
  contract change and the paused/taken precedence in the Speed Rule picker
  (#8/#9); the forced-password-change dialog logic (#3).
- No database migration was run against any database in this pass.

## Not run (manual steps remaining)

- Apply the new `ticket_events.actor_role` migration to the dev database
  (upgrade → downgrade → upgrade round trip), then to production, per this
  repo's two-database discipline (#13).
- Live verification before any fix is considered for #14 (wrong Speed Rule
  category match) and #23 (travel distance stuck at ~4.5km) — check the
  live catalog tree/rule ids and the specific ticket's accept state and
  pincode coordinates respectively.
- Fresh, specific repro steps for #24 (Spare Parts nav → masters.view
  error) before concluding a live gap exists.
- QA retest of #26 and #29 (High Priority tag behavior) against a current
  build, to confirm the already-merged fix resolves both as expected.
- Native-speaker review of the four new Hindi/Telugu/Kannada/Tamil strings
  added for #27 before a production build.
- Manual re-test of every "Fixed" item against a live environment,
  mirroring the original report's steps.

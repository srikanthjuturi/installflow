# Module 16 — Territory Mapping — Resolution Sheet

Companion document to `Module-16-Territory-Mapping.docx` (QA: Sneha). Of 52
executed tests: 40 passed, 7 passed with issues, 5 failed. Of the 10 logged
defects, all 10 are fixed. Of the 5 open questions, 2 are resolved by a new
fix (per product-owner decision), 2 are confirmed intended behavior, and 1
is a data characteristic of the uploaded geography spreadsheet, not code.

| ID | Title | Disposition |
|---|---|---|
| ADM-038 | The map shows no state name when hovering | **Fixed** |
| ADM-047 | Technicians page shows "District: all" while filtered | **Fixed** |
| ADM-048 | Assign an Area Manager doesn't open the form or carry the state | **Fixed** |
| ADM-049 | Technicians search by pincode finds nothing | **Fixed** |
| ADM-050 | Territory/district counts still include a Suspended/Inactive technician | **Fixed** |
| ADM-051 | Invited technician row doesn't show its pincode | **Fixed (pincode only — category dash is correct, see below)** |
| ADM-052 | A suspended area manager still counts as covering the state | **Fixed** |
| ADM-053 | Re-adding a removed technician's number says "already a technician" | **Fixed** |
| ADM-054 | A regional head is shown a Remove button the server refuses | **Fixed** |
| ADM-055 | On a phone the zoom buttons cover states; small states hard to tap | **Fixed** |
| OQ-2 | Why does the Central region have no states? | Answered — data characteristic, not a code defect |
| OQ-A1 | Can an area manager hold states in two regions? | Answered — no, already enforced in code |
| OQ-A20 | Region-card names/state chips aren't clickable | Answered — fixed, made clickable |
| OQ-A21 | Pending invites don't move the Territory counts | Answered — fixed, added a note |
| OQ-A22 | Territory never shows the National Head | Answered — confirmed intended, no change |

---

## ADM-038 — The map shows no state name when hovering

**Linked test:** TY-03 · **Severity:** Low · **Disposition: Fixed**

**Root cause.** Hovering a state (`adminWeb/src/components/geo/IndiaMap.tsx`)
already tracked a `hovered` state internally, but the only things that
rendered it were a plain SVG `<title>` (the browser's own delayed, unstyled
tooltip) and a screen-reader-only `aria-label` — nothing visible to a
sighted mouse user.

**What changed.** Added a small floating label that follows the cursor,
showing the state name and its coverage detail, reusing the map's existing
pan-hint visual treatment. It's suppressed while panning/dragging. The
existing `<title>`/`aria-label` are untouched — they remain the accessible
and keyboard path.

---

## ADM-047 — Technicians page shows "District: all" while filtered

**Linked test:** TY-15 · **Severity:** Low · **Disposition: Fixed**

**Root cause.** The list genuinely filtered correctly from a `?districtId=`
URL param, but the District combobox's displayed label was resolved only by
searching the first 30 locally-paginated options
(`useIncrementalOptions`). A district reached via a deep link almost never
falls in that first-30 window, so the lookup failed and the combobox fell
back to its "District: all" placeholder. The Franchisee filter had the
identical latent bug once a company has more than 10 franchisees.

**What changed.** Added an optional `selectedOption` to the shared
`FilterDef` type; the toolbar now falls back to it when the chosen value
isn't in the paginated window. Both the District and Franchisee comboboxes
now resolve the selected option against their **full** underlying arrays,
not just the paginated slice — fixing the latent franchisee case too before
it became its own ticket.

---

## ADM-048 — Assign an Area Manager doesn't open the form or carry the state

**Linked test:** TY-14 · **Severity:** Low · **Disposition: Fixed**

**Root cause.** Both the "Assign an Area Manager" button (on an uncovered
state's panel) and the page-level "Assign in Users & roles" button just
linked to `/settings/users` with no state carried — the Invite form had no
existing mechanism to accept a pre-selected state.

**What changed.** Both buttons now carry the state through a `?invite=am&state=<id>`
URL param. Users & Roles reads it once on load, auto-opens the Invite
dialog pre-selecting role "Area Manager" and that state, then clears the
params so a page refresh doesn't reopen it.

---

## ADM-049 — Technicians search by pincode finds nothing

**Linked test:** TY-25 · **Severity:** Medium · **Disposition: Fixed**

**Root cause.** The search box promised "name, mobile, ID or pincode," but
the backend's free-text filter only ever matched `User.full_name`,
`User.phone`, and `TechnicianProfile.code` — never a technician's pincode. A
*different*, exact-match `pincode` parameter existed for the district
drill-down, but the free-text search never reused it.

**What changed.** The free-text search now also matches via the technician's
pincodes (reusing the existing exact-match query's pattern), for both
registered technicians and pending invites — so the search box now does
what its own placeholder has always claimed.

---

## ADM-050 — Territory/district counts still include a Suspended/Inactive technician

**Linked test:** TY-26 · **Severity:** Medium · **Disposition: Fixed**

**Root cause.** The district-breakdown visibility query filtered by
role/territory only, never by `TechnicianProfile.status` — so a suspended
or inactive technician counted identically to an active one. The correct
filter pattern already existed one file over, in `core/coverage.py`, used
for job-pool eligibility with a comment calling out this exact failure mode.

**What changed.** Added the `status == ACTIVE` filter to the district count
query. To keep the panel's own promise that "the numbers here and the rows
behind them agree," also updated the district drill-through link to add
`&status=active`, so clicking a count doesn't open a list that still
includes the technicians just excluded from it.

---

## ADM-051 — Invited technician row doesn't show its pincode

**Linked test:** TY-35 · **Severity:** Low · **Disposition: Fixed (pincode) /
confirmed correct as-is (category)**

**Root cause.** The backend genuinely stores and returns a pending invite's
assigned pincodes, but the frontend's TypeScript type for an invite never
declared that field, and the row renderer unconditionally showed a dash for
any unregistered row without reading it.

**What changed.** Added the field to the frontend type and render it for an
invite row when non-empty. The **Categories** column is untouched — it's
correct as a dash, since an invite never collects a category at all (the
technician picks their own from the app after joining).

---

## ADM-052 — A suspended area manager still counts as covering the state

**Linked test:** TY-43 · **Severity:** Medium · **Disposition: Fixed**

**Root cause.** Two independent queries both needed the fix. The
membership/user query that builds the region cards never filtered
`Membership.is_active`, so a suspended AM still appeared in the counts and
in `covering`. Separately, the `taken` set (which decides whether a state
shows as covered at all) was built straight from `MembershipState` with no
join to `Membership` — so fixing only the first query would have left the
state marked covered through the second, untouched one.

**What changed.** Both queries now filter on `Membership.is_active`. A
suspended AM's state(s) now immediately re-enter the "no Area Manager" list
and the region card's AM count drops — this is a visible behavior change
from today's purely cosmetic "· Suspended" label, and it's exactly what the
QA report expects.

---

## ADM-053 — Re-adding a removed technician's number says "already a technician"

**Linked test:** TY-44 · **Severity:** Low · **Disposition: Fixed**

**Root cause.** This one ran deeper than wording. The system has a partial
unique index on `users.phone`, explicitly commented "a removed number can be
re-onboarded," and a fully-built revival code path waiting to use it — but
removing a technician only ever soft-deleted the `Membership` row, never
`User.deleted_at`. Since the uniqueness check tests `User.deleted_at`, it
was always `NULL` for a removed technician, so the 409 always fired and the
revival branch was unreachable dead code.

**What changed.** `_remove_technician` now also sets `user.deleted_at` and
`user.is_active = False`, so the partial unique index actually frees the
number and the already-correct revival logic finally runs. Verified no
other part of the codebase (auth, lists, counts, notifications, audit)
assumes a removed technician's `User.deleted_at` stays `NULL` — the
invite-flow's own re-invite check is fixed by the same change, as a
correct side effect.

---

## ADM-054 — A regional head is shown a Remove button the server refuses

**Linked test:** TY-48 · **Severity:** Low · **Disposition: Fixed**

**Root cause.** Users & Roles' row actions (Edit access, Suspend/Activate,
Reset password, Remove) rendered based only on role rank — never on the
caller's actual `users.edit`/`users.delete` feature grant. A Regional
Head's default role grants include neither, so they could see and click
"Remove" on an Area Manager they created, and only the server's 403 stopped
it.

**What changed.** Each action now gates on the caller's real feature grant
(`useFeatureAccess().has(...)`), mirroring the pattern already used on the
Technicians list. Suspend/Activate is also gated (it calls the same
endpoint `users.edit` already protects) — a small scope extension beyond
the three buttons named in the ticket, since it's the identical bug.

---

## ADM-055 — On a phone the zoom buttons cover states; small states hard to tap

**Linked test:** TY-49 · **Severity:** Low · **Disposition: Fixed**

**Root cause.** The zoom buttons sat at a fixed `absolute end-5 top-5` with
no responsive variant — since the map is drawn north-up, that corner is
always the north-east states. Separately, every state's tap target was
just its SVG path, scaled purely by container width, with no minimum
touch-target handling for a small state like Telangana.

**What changed.** The zoom-button cluster now repositions to the map's
empty south-east sea on narrow viewports, keeping today's placement at
larger widths. Each state also gained an invisible, wider hit-stroke behind
its visible outline to enlarge its effective tap target without changing
how it looks.

---

## OQ-2 — Why does the Central region have no states?

Not a code defect. Five regions are seeded by the schema
(North/South/East/West/Central), but states are never seeded by code — they
arrive from an uploaded geography spreadsheet, and region assignment is
whatever that sheet's own column says. If the sheet never labels any state
"Central," the region legitimately has 0 states, and the importer already
surfaces this by name on every re-upload. No code change made.

## OQ-A1 — Can an area manager hold states in two regions?

Answered: no — already enforced. `_check_single_region` refuses with 422 if
an Area Manager's states span more than one region, wired into both the
create and edit-access paths. No gap existed; no code change made.

## OQ-A20 — Region-card names/state chips aren't clickable

Fixed, per the confirmed decision. A Regional Head's or Area Manager's name
now links to their row in Users & Roles; each state chip (covered or
unassigned) now navigates to that state's drill-down panel. Both
destinations are independently scoped server-side already, so this adds no
new reachable data for any role, including a Regional Head viewing their
own card.

## OQ-A21 — Pending invites don't move the Territory counts

Fixed, per the confirmed decision. The district breakdown now also returns
a count of pending invites whose pincodes fall in that state but aren't yet
in the totals; the panel shows a quiet note ("N invited, not yet counted")
when that count is non-zero.

## OQ-A22 — Territory never shows the National Head

Confirmed intended, no change. A National Head holds no region/state rows
at all — their scope is "all of it, by the absence of a restriction" — so
there is nothing meaningful to attach to a region card.

---

## Verification performed

- `api`: the two touched backend modules
  (`app.features.technicians.service`, `app.features.technicians.schemas`)
  and `app.features.territory.service` import cleanly together; full
  `pytest` suite (unit, no database) passes with no failures.
- `adminWeb`: `npx tsc --noEmit` (clean) and `eslint` (clean) across every
  touched file, after one fix of my own on top of the implementation agents'
  work — an eslint `react-hooks/set-state-in-effect` violation in
  `UsersRolesPage.tsx` (Fix 3/ADM-048's URL-seeded invite state was
  originally set via `setState` inside a `useEffect` body; restructured to
  compute both pieces of state from a lazy `useState` initializer on the
  initial render instead, leaving only the URL-param cleanup — a genuine
  side effect — inside the effect).
- Manual review of the riskiest diffs: both coordinated query changes in
  `territory/service.py` (ADM-052), the `User.deleted_at` write in
  `_remove_technician` (ADM-053), and the `Map`→`MapIcon` import alias one
  implementation agent made on its own initiative in `TerritoryTree.tsx` to
  avoid shadowing the global `Map` constructor (correct, matches the same
  pattern already used in `TerritoryPage.tsx`).
- No database migration was needed or run for any fix in this pass — all
  are query/logic changes against existing columns and the existing partial
  unique index.

## Not run (manual steps remaining)

- Manual re-test of each fix against a live environment, mirroring the
  original QA steps: hover a state (ADM-038); reach Technicians via a
  district click-through, and again via an 11+-franchisee company
  (ADM-047); click "Assign an Area Manager" on an uncovered state
  (ADM-048); search technicians by a pincode they hold (ADM-049); suspend a
  technician and re-check the district count (ADM-050); invite a technician
  with a pincode and check the row (ADM-051); suspend an Area Manager and
  re-check their state (ADM-052); remove a technician and re-add the same
  number (ADM-053); sign in as a Regional Head and check the row actions
  (ADM-054); open Territory on a 390px viewport (ADM-055); click a region
  card's manager name and a state chip (OQ-A20); invite a technician with a
  pincode and check the summary note (OQ-A21).

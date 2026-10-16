# Task 05 — Technician operations and their money move to the franchisee

> Layer: **api** · Depends on: **04** (and through it 01–03) · Migration: **`7c4f2e9a1d58`**
> (`7c4f2e9a1d58_franchisee_admins_review_and_are_notified.py`, `down_revision = "5d2a8c6e0b13"`)
>
> Read `00-index.md` first. Every table, column, role, feature key, error code and helper name used here is
> the index's; where this task needs something the index does not name it is marked **Decision (writer)** and
> listed in §8 "Index additions". The portal endpoints match **Task 09 §4.2–4.3 exactly** (the console
> contract is fixed).
>
> **Ships in the same API publish as Task 06** (§8 trap 1). Do not publish 05 to production alone.

---

## 1. Goal and why

### In plain words

After Tasks 01–04 every technician, ticket, ledger row and redemption carries a `franchisee_id`, and a ticket
is only offered to its franchisee's technicians. But the **people who manage those technicians and their
money** are still the company's Area Managers, Regional Heads, National Heads and Admins. This task moves that
to the **franchisee admin** (F7), except for the **home** franchisee, which keeps today's rules exactly (F8):

| Duty | Home franchisee | Any other franchisee |
|---|---|---|
| Add / invite / edit / set type / remove a technician | AM, RH, NH, Admin as today **+** home's franchisee admins (portal) | **Only** that franchisee's admins (portal) |
| Approve a technician's UPI change | today's AM → RH → NH → Admin chain **+** home's franchisee admins | **Only** that franchisee's admins |
| Pay a redemption | National Head, else Admin, as today **+** home's franchisee admins | **Only** that franchisee's admins |
| Reverse a penalty | today's rule (ticket's AM or anyone senior) **+** home's franchisee admins | That franchisee's admins **and** company Admin/NH |
| Pool / ledger entries | Admin/NH (entries), `jobs.assign` holders (balance) **+** home's franchisee admins | That franchisee's admins; Admin/NH read-only |
| Work **tickets** (assign, reschedule, force-close, escalations) | unchanged — company staff | unchanged — company staff (F7) |

It also makes **money land in the right pool** (F12): every ledger row carries the technician's franchisee
(Task 01 stamps it) and the pool balance is computed per franchisee (this task).

### Worked example

*Acme Appliances* has **Acme Home** (home) and **SkyFix Services** (external, 500030–500040). Ravi is a SkyFix
freelancer; Priya is SkyFix's franchisee admin; Kiran is Acme's Area Manager for Telangana; Nisha is Acme's
National Head.

1. Priya adds Ravi in the portal (`POST /franchise/technicians`, pincodes 500032 + 500033, type `freelancer`,
   no `regionId` — both codes sit in *South*, so it is derived). Ravi is stamped `franchisee_id = SkyFix`.
   Kiran tries `POST /technicians` with 500032 → 422 `PINCODE_OUTSIDE_FRANCHISEE` (Task 04's range check:
   500032 is not the home franchisee's).
2. Kiran's Technicians list shows Ravi (Kiran still assigns escalated SkyFix tickets in his territory, F7) with
   `canManage: false` and no UPI ID. `PUT /technicians/{ravi}` from Kiran → **403** "Managed by SkyFix
   Services". `GET /franchise/technicians/{ravi}` from another franchisee's admin → **404** (franchise wall).
3. Ravi asks to change his UPI ID. `upi_reviewer` answers `franchisee_admin`; the bell row is
   `audience='franchisee_admin', franchisee_id=SkyFix, to='/technicians/{ravi}'` (staff-style; the console
   rewrites it). Priya's bell rings, Kiran's does not. Priya approves via
   `POST /franchise/technicians/{ravi}/upi-change/approve`.
4. Ravi cancels a job 3 hours before the slot: a ₹500 `penalty` row with `franchisee_id = SkyFix`. SkyFix's pool
   (`GET /franchise/ledger/pool`) reads +₹500; Acme Home's (`GET /ledger/pool`) does not move.
5. A SkyFix ticket escalates; Kiran's bonus screen now reads **SkyFix's** balance
   (`GET /ledger/pool?franchiseeId=SkyFix`) and funds ₹400. Ravi completes → the `bonus` row is SkyFix's.
6. Ravi disputes the penalty. On the ticket page Kiran does **not** see it (AM "cannot see SkyFix's money").
   Priya reverses it from her Pool screen (`POST /franchise/ledger/{entryId}/reverse`); the `reversal` row is
   SkyFix's. Nisha could also reverse it from the ticket page.
7. Ravi redeems ₹3,200: the redemption is SkyFix's; only Priya's bell rings; the app says "Your **Franchisee
   Admin** will be asked…". Priya claims (`POST /franchise/redemptions/{id}/claim`); Ravi confirms.

On the day this ships every technician is home (F5), so every existing screen behaves exactly as before.

---

## 2. Decisions implemented

| ID | How |
|---|---|
| **F7** | Technician management, UPI approvals, redemption payment, penalty reversal and the pool narrow by franchisee; ticket operations untouched. |
| **F8** | Home: every staff rule unchanged; home's franchisee admins act alongside through the portal. Non-home: only that franchisee's admins, plus company Admin/NH for penalty reversal and read-only money views. |
| **F12** | `core.ledger.pool` takes a `franchisee_id`; staff and portal pool/ledger reads are per franchisee. |
| **T1** | `technicianType` on create / invite / update (staff and portal). |
| §3.2 | `notifications.franchisee_id` (this migration). |
| §3.3 | `notifications.audience` += `franchisee_admin`; `upi_change_requests.reviewer_role` += `franchisee_admin`. |
| §5.1 | Franchise wall: a franchise principal asking for another franchisee's technician / invite / ledger row / redemption / UPI change → **404**. |
| §5.6 | `coverage.payer_role`, `coverage.upi_reviewer`, `coverage.users_notified_by` (mirror of `notifications.service._visible`) and `visibility.technician_scope` changed. |

**Decision (writer) — where the `/franchise/*` twins live.** Task 09 fixes the URLs (`/franchise/technicians*`,
`/franchise/upi-changes*`, `/franchise/redemptions*`, `/franchise/ledger*`). The **handlers** live as a second
`APIRouter` **inside the slice that owns the logic** — `features/technicians/franchise_router.py`,
`features/redemptions/franchise_router.py`, `features/ledger/franchise_router.py` — each with
`prefix="/franchise"`, registered in `app/api/router.py`, calling **the same service functions** as the staff
router. Reasons: hard rule 4 forbids `features/franchise_portal` importing `technicians.service` (2,200 lines:
OTP, WhatsApp, invites, coverage) or `redemptions.service`; a second copy is the copy that drifts; the codebase
already splits one slice across two routers by audience (`credits/platform_router.py`,
`vendor_credits/staff_router.py`). The **service** decides scope from the principal (`technician_scope`,
`_visible_invites`, `can_manage_technician`, `_payer_scope`), so a twin is ~10 lines of routing.
`features/franchise_portal/` (created here) holds only endpoints with no owning slice: `GET
/franchise/technician-options`, `GET /franchise/pincodes`; Task 06 adds statements, Tasks 10/11 settings.

---

## 3. Schema — migration `7c4f2e9a1d58`

File `api/alembic/versions/7c4f2e9a1d58_franchisee_admins_review_and_are_notified.py`, `revision =
"7c4f2e9a1d58"`, `down_revision = "5d2a8c6e0b13"`. Hand-written. CHECK names are passed **bare** in both
directions (the convention prefixes `ck_<table>_`).

### 3.1 `notifications`

| Change | Exact |
|---|---|
| New column | `franchisee_id UUID NULL` |
| Composite FK | `fk_notifications_company_franchisee (company_id, franchisee_id) → franchisees (company_id, id) ON DELETE CASCADE` (target `uq_franchisees_company_id_id`, Task 01) |
| Covering index | `ix_notifications_company_franchisee (company_id, franchisee_id)` |
| `audience` CHECK rebuilt | `audience IS NULL OR audience IN ('payers', 'area_manager', 'regional_head', 'national_head', 'admin', 'billing', 'vendor', 'franchisee_admin')` |
| New CHECK `franchisee_audience` | `audience IS DISTINCT FROM 'franchisee_admin' OR franchisee_id IS NOT NULL` — an addressed franchise row must say which franchisee. |

`String(16)` fits `'franchisee_admin'` (exactly 16) — do not widen. **This migration does not touch
`notifications.kind`** (nor `ticket_events.kind`): `technician_moved` and `franchisee_changed` are widened by
Task 01's `3b7e1f0a9c41` (01 §3.3a), so Task 03 depends on nothing here. The two CHECKs this migration does
rewrite (`audience`, `reviewer_role`) list **every** earlier value, as written above.

Model `app/models/notification.py`: `franchisee_id: Mapped[uuid.UUID | None] = mapped_column(Uuid,
nullable=True)` after `audience`; `"franchisee_admin"` appended to `AUDIENCES` with a docstring paragraph
("the franchisee admins of `franchisee_id` and nobody else; `payers` additionally reaches them when the row's
franchisee is theirs — see `core.audience`"); the FK, index and
`CheckConstraint("audience IS DISTINCT FROM 'franchisee_admin' OR franchisee_id IS NOT NULL",
name="franchisee_audience")`. The "Three places decide who hears a row" comment names `core.audience.hears`.

### 3.2 `upi_change_requests`

`reviewer_role` CHECK rebuilt: `reviewer_role IN ('area_manager', 'regional_head', 'national_head', 'admin',
'franchisee_admin')`; same edit on the model and its "Whose bell rang" comment.

### 3.3 `ledger_entries.technician_type` — **Decision (writer), index addition**

| Change | Exact |
|---|---|
| Column | `technician_type VARCHAR(16)` — add NULL, backfill, `SET NOT NULL`, **no server default** |
| Backfill | `UPDATE ledger_entries le SET technician_type = tp.technician_type FROM technician_profiles tp WHERE tp.company_id = le.company_id AND tp.id = le.technician_id` (every row is `freelancer` after Task 01's F5 backfill; reading the profile keeps it right whatever ran first) |
| CHECK `technician_type` | `technician_type IN ('employee', 'freelancer')` |

**Why.** Task 06 must answer "which of this person's money is redeemable by UPI" (freelancer money) and
"which goes on the salary statement" (employee money). The type can change (T1), so the *current* profile type
cannot answer either for an old row. Stamping the stream on the row at write time, beside `franchisee_id`
(index §5.3), makes both a plain `WHERE`. No server default: a writer that forgets it must fail on NOT NULL,
not silently file salary money as redeemable.

Model `app/models/ledger.py`: `technician_type: Mapped[str] = mapped_column(String(16), nullable=False)` after
`franchisee_id`; `CheckConstraint("technician_type IN ('employee', 'freelancer')", name="technician_type")`.
No new index: Task 01's `ix_ledger_entries_company_franchisee (company_id, franchisee_id, created_at)` already
serves the per-franchisee pool, ledger list and Task 06's month statement.

### 3.4 Downgrade (refuse rather than lose a fact — the `f4b28d1a67c3` shape)

1. `SELECT count(*) FROM upi_change_requests WHERE reviewer_role = 'franchisee_admin'` > 0 → `RuntimeError("N
   UPI change request(s) are addressed to a franchisee admin; narrowing the CHECK would make them unstorable.
   Decide them first.")`.
2. `SELECT count(*) FROM ledger_entries WHERE technician_type = 'employee'` > 0 → `RuntimeError` (dropping the
   column would let salary money be redeemed by UPI).
3. `DELETE FROM notifications WHERE audience = 'franchisee_admin'` (bells, not records — `b8e3f14a9c27`'s shape
   for `vendor`).
4. Drop `franchisee_audience`; rebuild `audience` without `franchisee_admin`; drop FK, index, column.
5. Rebuild `reviewer_role` without `franchisee_admin`.
6. Drop CHECK `technician_type` then the column.

**Round trip (dev only):** `upgrade head` → `downgrade 5d2a8c6e0b13` → `upgrade head`, with `SELECT id FROM
ledger_entries ORDER BY id` recorded before and compared after (rule 6: the trip proves the schema, the id
comparison proves the data). Production is migrated by the owner (X5).

### 3.5 `app/scripts/audit_tenancy.py`

Append to `TENANT_LINKS`: `("notifications", "franchisee_id", "franchisees")` with a one-line "what would leak"
comment ("a bell addressed to another company's franchisee"). Run `python -m app.scripts.audit_tenancy`.

---

## 4. API / service changes

Throughout: `home_id = await core.franchise.home_franchisee_id(db, company_id)` (Task 01);
`FRANCHISEE_ADMIN`, `FRANCHISE_ROLES`, `FACILITY_ROLES` from `app/models/role.py` (Task 02);
`Principal.franchisee_id`, `Principal.is_franchise` (Task 02). `ROLE_LABELS[FRANCHISEE_ADMIN]` is **exactly
`"Franchisee Admin"`** — the mobile app translates that string (Task 07 §4.2). Never put a franchisee's name in
`payerLabel` / `reviewerLabel`.

**Notification `to` is always staff-style** (`/technicians/{id}`, `/redemptions/{id}`, `/tickets/{id}`); the
console rewrites it for a portal reader (Task 09 §4.5/§5.8).

### 4.1 What this task uses from Task 02 (`core/deps.py`, `core/franchise_scope.py`)

* **`FranchisePrincipal` / `require_franchise_principal`** = role is exactly `franchisee_admin` with a
  franchisee (Task 02 §4.1). Every portal twin here carries it **plus** `require_feature("franchise.…")`.
  (`require_facility_principal` = any franchise role — not used in this task.)
* **`require_staff_principal`** refuses franchise roles after Task 02. Every **staff** route touched here
  additionally carries it, so a Feature Access override that hands a franchise role a staff key still cannot
  reach a staff door.
* **`managed_franchisee_ids(db, principal, *, purpose)`**, **`can_manage_technician(db, principal, tech, *,
  purpose)`** and the pure **`decide_managed_franchisees(role=, principal_franchisee_id=, home_id=, purpose=)`** /
  **`decide_can_manage(managed, tech_franchisee_id)`**, with Task 02's matrix:

  | role | `MANAGE` | `VIEW` | `REVERSE` |
  |---|---|---|---|
  | admin, national_head | {home} | all | all |
  | regional_head, area_manager | {home} | all (territory still applies) | {home} |
  | franchisee_admin | {own} | {own} | {own} |
  | facility roles, technician, vendor | {} | {} | {} |

  Task 05 uses `MANAGE` for every technician write and for paying / approving, and **`REVERSE` both for giving a
  penalty back and for seeing a franchisee's money** (§4.3). Technician *list* visibility is
  `technician_scope` (Task 02 already added its franchise branch).

### 4.2 (no new guard)

Task 05 adds no guard of its own: `FranchisePrincipal` + `require_feature` is the portal pair, and the staff
routes keep theirs + `require_staff_principal`.

### 4.3 New pure module `app/core/franchise_money.py`

"May this caller see / act on this franchisee's money" — the one helper Task 11 §4.11 asks to reuse. Thin,
named wrappers over Task 02's pure functions, so the money rule has one place to read and one source of truth.

```python
def may_see_money(*, role: str, principal_franchisee_id: UUID | None,
                  money_franchisee_id: UUID, home_id: UUID) -> bool:
    """decide_can_manage(decide_managed_franchisees(role=…, principal_franchisee_id=…, home_id=home_id,
    purpose=REVERSE), money_franchisee_id). F8 grants company Admin/NH 'penalty reversal and read-only views'
    on the same footing, and an AM 'cannot see SkyFix's money' — exactly the REVERSE column. So: admin/NH →
    any; RH/AM → home only; franchisee admin → own; everyone else → False."""

def may_reverse(*, role, principal_franchisee_id, penalty_franchisee_id, home_id) -> bool:
    """The same expression (territory is _load's job on Door 1)."""

def pool_franchisee(*, is_franchise: bool, own: UUID | None, requested: UUID | None,
                    home_id: UUID, known: set[UUID]) -> UUID | None:
    """Which pool a read is about. Franchise: `own` (None if own is None). Staff: `requested` if it is in
    `known` (this company's non-deleted franchisees), home_id when requested is None. None → 404."""

def redemption_audience(*, is_home: bool) -> str:
    """'payers' for the home franchisee, 'franchisee_admin' otherwise."""

def type_change_refusal(*, old: str, new: str, open_jobs: int) -> tuple[str, str] | None:
    """None when allowed. old != new and open_jobs > 0 →
    ("TECHNICIAN_HAS_OPEN_JOBS", "<n> open job(s). Finish or reassign them before changing the type.").
    Task 06 adds a balance clause."""
```

Plus `async def money_context(db, company_id) -> tuple[UUID, set[UUID]]` (home id and the company's
non-deleted franchisee ids, one query) for the callers.

### 4.4 Visibility — `app/core/visibility.py` and invites

`technician_scope` — **no change here**: Task 02 already added the franchise branch (franchisee admin →
`TechnicianProfile.franchisee_id == principal.franchisee_id`; facility roles → nothing). Staff branches stay
**unchanged**: staff still *see* every technician in their territory whatever the franchisee,
because they still assign every franchisee's tickets (F7) and the assign shortlist is `GET
/technicians?subcategoryId=&pincode=&onDay=`. What staff may *do* is narrowed by `can_manage_technician`; what
they may *see of the money* by `may_see_money`.

`technicians.service._visible_invites(stmt, principal, own, home_id)` (gains `home_id`; update both callers,
`list_technicians` and `_load_invite`): the franchise branch is Task 02's; **staff** → today's rule **AND**
`TechnicianInvite.franchisee_id == home_id`. **Decision (writer):** a non-home invite is invisible to staff of every rank — an invite is a
pre-technician no staff member may act on.

### 4.5 Technicians — `app/features/technicians/`

#### Schemas (`schemas.py`)

| Schema | Change |
|---|---|
| `TechnicianCreateRequest`, `InviteCreateRequest` | `technicianType: Literal["employee", "freelancer"] = "freelancer"` (T1 default) |
| `TechnicianUpdateRequest` | `technicianType: Literal["employee", "freelancer"] \| None = None` |
| `TechnicianOut` (→ `TechnicianDetailOut`, `TechnicianCreatedOut`) | `franchiseeId: uuid.UUID`, `franchiseeName: str`, `franchiseeIsHome: bool`, `technicianType: Literal["employee","freelancer"]`, `canManage: bool` |
| `TechnicianInviteOut` | `franchiseeId: uuid.UUID`, `franchiseeName: str`, `technicianType: Literal[...]` |
| New `UpiChangeRowOut(UpiChangeOut)` | `+ technicianId: uuid.UUID, technicianName: str, technicianCode: str` (Task 09's `UpiChangeRow`) |
| New `UpiChangeCountOut` | `pending: int` |
| `UpiChangeOut.reviewerLabel` | unchanged code; `ROLE_LABELS` yields `"Franchisee Admin"` |

No `franchiseeId` on any request body: the franchisee is the caller's (portal) or home (staff) — structural
pinning, as `ProductSubmitRequest` does for a vendor.

#### Service (`service.py`) — shared by both routers

* **`_technicians_out`** — one `IN` query `select(Franchisee.id, Franchisee.name, Franchisee.is_home)` for the
  page; fill the five fields. `canManage` = `decide_can_manage(decide_managed_franchisees(..., purpose=MANAGE), row.franchisee_id)` per row (home id resolved once) (always true for a franchise principal, whose
  rows are all its own). When `may_see_money(...)` is False: `upiId=None`, `upiName=None`,
  `upiChangePending=False`.
* **`list_technicians`** — new keyword filters `franchisee_id` and `technician_type` (exact match; an unknown
  type → empty page via `canonical_filter`, never 422) applied to both halves of the union
  (`TechnicianProfile.*` / `TechnicianInvite.*`). For a franchise principal the scope already pins the
  franchisee; a foreign `franchiseeId` just yields an empty page.
* **New `_load_managed(session, principal, technician_id)`** = `_load`, then `if not await
  can_manage_technician(...)`: `HTTPException(403, f"Managed by {franchisee_name} — only its franchisee admin
  can change this technician")`. A franchise principal never reaches it (`_load` already 404'd). Used by
  `update_technician`, `delete_technician`, `resend_app_link`, `_decide`, and `get_upi_change`
  (**Decision (writer):** a money read answers 403, not a fake `null`).
* **`resolve_region(session, principal, region_id, pincodes)`** (gains `pincodes`; update callers) — franchise
  principal: skip the "own regions" check (a franchisee admin has no `membership_regions`); when `region_id` is
  None derive it: `select(distinct(State.region_id)).join(Pincode).where(Pincode.code.in_(pincodes))` — exactly
  one → that region, else 422 "Select the region this technician will work in". Staff unchanged.
* **`create_technician`** / **`create_invite`**:
  1. `franchisee_id = principal.franchisee_id if principal.is_franchise else home_id`.
  2. After `check_pincodes_in_own_area`, call **Task 04's coverage-in-range check** for that franchisee →
     **422 `PINCODE_OUTSIDE_FRANCHISEE`** naming the codes (Task 09 §4.2's status). The index does not name the
     helper; this doc calls it `core.franchise.assert_pincodes_in_franchisee(db, company_id, franchisee_id,
     pincodes)` — use Task 04's, do not reimplement.
  3. Franchise principal: `manager_id` / `manager_membership_id` = the caller's own membership id;
     `body.managerId` is ignored (it could name a staff membership).
  4. Replace Task 01's constants: `franchisee_id=franchisee_id, technician_type=body.technicianType` on the new
     profile / invite. Re-add branch (a removed technician brought back): **Decision (writer):** set both too
     (whoever re-adds them now manages them); a removed technician holds no open jobs, so no guard is needed.
  5. `technician_joined` (direct add) and `onboarding.service.register`'s `technician_joined`: pass
     `franchisee_id=` to `notify` / `publish_notification`. They stay unaddressed — staff by pincode as today
     **and** that franchisee's admins (§4.8).
* **`update_technician`** — `_load_managed`. Pincodes: also Task 04's range check against
  `profile.franchisee_id`. New block:
  ```python
  if body.technicianType is not None and body.technicianType != profile.technician_type:
      refusal = type_change_refusal(old=profile.technician_type, new=body.technicianType,
                                    open_jobs=await _open_job_count(session, profile))  # extracted from _refuse_if_open_jobs
      if refusal:
          raise AppError(status.HTTP_409_CONFLICT, *refusal)
      profile.technician_type = body.technicianType
  ```
  **Settled as built (owner ruling 2026-10-15, R5; was Decision (writer)):** a type change is refused while the technician holds an open job (`TECHNICIAN_HAS_OPEN_JOBS`, 409; listed in index §3.3). It makes "type now"
  and "type at accept" (T1) the same fact for every row Tasks 05/06 write before Task 10's `accept_snapshot`,
  and removes Task 07 §5.9's "*In salary* on a job that will pay" edge. `franchisee_id` is **not** editable here
  (moving a technician is Task 03's carve-out).
* **`delete_technician`** — `_load_managed`.
* **`_decide`** (UPI approve/reject) — `_load_managed`; otherwise unchanged.
* **New `list_upi_changes(session, principal, params, *, state)` / `count_pending_upi_changes`** — franchise
  principals only (`assert principal.is_franchise`): `UpiChangeRequest` joined to `TechnicianProfile`
  (`franchisee_id == principal.franchisee_id`), `Membership`, `User`; `state` ∈ `pending` (oldest first),
  `approved`, `rejected`; absent = all, newest first; unknown → empty page. Ties broken by `id`.

#### UPI reviewer — `app/core/coverage.upi_reviewer`

```python
async def upi_reviewer(db, *, company_id, technician_id) -> tuple[str, str | None, uuid.UUID]:
    """(role, pincode, franchisee_id). Non-home technician → (FRANCHISEE_ADMIN, None, their franchisee).
    Home → today's AM → RH → NH → Admin walk, unchanged, third element = home id."""
```

One query first for `TechnicianProfile.franchisee_id` + `Franchisee.is_home`. `request_upi_change` unpacks
three values and passes `franchisee_id=` to `notify` / `publish_notification`; `to` stays `/technicians/{id}`;
`reviewer_role=role` stored as before. **Decision (writer):** a home request is not addressed to home's
franchisee admins (today's chain stays exact, F8) — they can still decide it in the portal. **Owner
ruling 2026-10-15 (R3):** a non-home franchisee has **no fallback** — Admin/NH cannot manage that technician and are
never asked to approve a UPI change or pay a redemption for it (F8). That is safe, not a gap, because Task 03 now
**refuses to deactivate the last active admin of a non-home franchisee** (409 `FRANCHISEE_LAST_ADMIN`), so an
`upi_reviewer` / payer of a non-home franchisee always has somebody to ring. (A non-home franchisee created and not
yet given an admin has no technicians to request anything, F9.) Nothing in this task needs a fallback branch.

#### Routers

**Staff `router.py`** — paths and feature guards unchanged; add `require_staff_principal` (§4.2); list gains
query params `franchiseeId: uuid | None`, `technicianType: str | None`.

**New `franchise_router.py`** — `APIRouter(prefix="/franchise", tags=["franchise"])`. Every route carries
`FranchisePrincipal` (Task 02: franchisee admin only) **and** `require_feature(<key in the Guard column>)`.
Literal paths before `/{technician_id}` (the 422 trap the staff router documents).

| Method & path | Guard (feature key) | Service call | Notes |
|---|---|---|---|
| `GET /franchise/technicians` | `franchise.technicians` | `list_technicians` | same params as staff (`view`, `status`, `onboarding`, `regionId`, `subcategoryId`, `pincode`, `districtId`, `onboardingMode`, `onDay`) + `technicianType`; `PaginatedEnvelope[TechnicianRowOut]` |
| `GET /franchise/technicians/{id}` | `franchise.technicians` | `get_technician` | 404 outside the franchisee |
| `POST /franchise/technicians` | `franchise.technicians` | `create_technician` | 201, `TechnicianCreatedOut`; `regionId` optional (derived) |
| `PUT /franchise/technicians/{id}` | `franchise.technicians` | `update_technician` | |
| `DELETE /franchise/technicians/{id}` | `franchise.technicians` | `delete_technician` | 409 `TECHNICIAN_HAS_OPEN_JOBS` |
| `POST /franchise/technicians/{id}/app-link` | `franchise.technicians` | `resend_app_link` | `AppLinkOutcome` |
| `POST /franchise/technicians/invites` · `POST …/invites/{id}/resend` · `DELETE …/invites/{id}` | `franchise.technicians` | `create_invite` / `resend_invite` / `cancel_invite` | |
| `GET /franchise/technicians/{id}/upi-change` | `franchise.payouts` | `get_upi_change` | `UpiChangeOut \| null` |
| `POST /franchise/technicians/{id}/upi-change/approve` · `/reject {reason}` | `franchise.payouts` | `approve_upi_change` / `reject_upi_change` | 409 `NO_PENDING_CHANGE` |
| `GET /franchise/upi-changes?page&limit&state` | `franchise.payouts` | `list_upi_changes` | `PaginatedEnvelope[UpiChangeRowOut]` |
| `GET /franchise/upi-changes/count` | `franchise.payouts` | `count_pending_upi_changes` | `{ "pending": 1 }` |

Response bodies are the staff ones (standard envelope), e.g.

```json
POST /franchise/technicians   {"fullName":"Ravi Teja","phone":"+919800000001","subcategoryIds":["…"],
                               "pincodes":["500032","500033"],"technicianType":"freelancer"}
201 { "success": true, "statusCode": 201, "message": "Technician added",
      "data": { "id": "…", "code": "TCH-4021", "name": "Ravi Teja", "regionName": "South",
                "franchiseeId": "6f0c…", "franchiseeName": "SkyFix Services", "franchiseeIsHome": false,
                "technicianType": "freelancer", "canManage": true, "appLinkStatus": "sent", "…": "…" },
      "errors": [] }
422 { "success": false, "statusCode": 422, "code": "PINCODE_OUTSIDE_FRANCHISEE",
      "message": "Not in SkyFix Services's area: 500099.", "data": null, "errors": ["…"] }
```

### 4.6 `app/features/franchise_portal/` (new slice)

`__init__.py`, `router.py` (`prefix="/franchise"`), `service.py`, `schemas.py`; registered in
`app/api/router.py`.

**`GET /franchise/technician-options`** — `FranchisePrincipal` + `require_feature("franchise.technicians")`.

```json
{ "success": true, "statusCode": 200, "message": "OK",
  "data": { "regions": [ { "id": "…", "name": "South" } ],
            "subcategories": [ { "id": "…", "name": "Television", "rootId": "…",
                                 "rootName": "Electronics", "pathLabel": "Television" } ] },
  "errors": [] }
```

* `regions`: distinct regions holding ≥ 1 pincode the franchisee owns —
  `select(Region.id, Region.name).join(State).join(Pincode).where(Pincode.code.in_(
  franchisee_pincodes_subquery(company_id, franchisee_id, is_home=…))).distinct().order_by(Region.name)`.
* `subcategories`: `ProductNode` rows of this company at `depth == CERTIFY_DEPTH` (`core.product_tree`), not
  deleted, active; `rootId = ancestor_ids[0]`, `rootName` by one `IN` lookup; `pathLabel = name`. Ordered by
  root name, then name. (Mirrors what `validate_subcategories` accepts.)

**`GET /franchise/pincodes?page&limit&search&regionId`** — same guard. `PaginatedEnvelope` of rows with
`PincodeOut`'s exact shape (`code, stateId, stateName, regionId, regionName, districts, districtIds, isActive,
source`) — duplicate the schema here as `FranchisePincodeOut` (rule 4). Codes in
`franchisee_pincodes_subquery(...)` (home: the catch-all set) **and** `Pincode.is_active` (a picker — the
`list_pincodes` reasoning); `search` = code prefix; ordered by code; districts by one `IN` query on
`PincodeDistrict`/`District` for the page.

### 4.7 Redemptions — payer moves to the franchisee

**`core/coverage.payer_role(db, *, company_id, franchisee_id: uuid.UUID | None = None) -> str`** — a non-home
`franchisee_id` → `FRANCHISEE_ADMIN`; otherwise today's National-Head-else-Admin query. Callers asking about the
**company** payer (`_visible`'s `is_payer`, `_Visibility.load`, `users_notified_by`'s `payers`) pass no kwarg.

**`features/redemptions/service.py`** (Task 01 already sets `Redemption.franchisee_id = locked.franchisee_id`):

| Function | Change |
|---|---|
| `summary` | `role = await payer_role(..., franchisee_id=profile.franchisee_id)`; `payerLabel = ROLE_LABELS.get(role, role)` → `"Franchisee Admin"` for a non-home technician. |
| `request` | `audience = redemption_audience(is_home=…)`; `notify(..., audience=audience, franchisee_id=row.franchisee_id, to=f"/redemptions/{row.id}")`; `publish_notification(..., audience=audience, franchisee_id=row.franchisee_id)`. |
| `confirm` ("not yet" bell) | same addressing from `row.franchisee_id`. |
| New `_payer_scope(stmt, principal, home_id, *, requested, known)` | Franchise principal → `Redemption.franchisee_id == principal.franchisee_id`. Staff → `== pool_franchisee(...)`-style resolution: `requested` honoured only for Admin/NH and only if known; default home. |
| `list_page`, `count_to_pay`, `staff_detail` | apply `_payer_scope`; staff accept optional `franchisee_id`. |
| `_load_for_staff` (claim/decline) | apply `_payer_scope` with `requested=None` — franchise principal: own; staff: **home only**. Outside → `_not_found()` (404). |
| `StaffRedemptionOut` / `StaffRedemptionDetailOut` | `+ franchiseeId: uuid.UUID, franchiseeName: str, canAct: bool` (False only for Admin/NH reading another franchisee). |

So staff claim/decline on a non-home redemption → 404; Admin/NH may read it with `?franchiseeId=`.

**Staff `router.py`:** unchanged guards (`redemptions.pay` + `require_min_rank(NATIONAL_HEAD)`) +
`require_staff_principal`; `list_redemptions`, `count_redemptions`, `get_redemption` gain `franchiseeId:
uuid.UUID | None = Query(None)`.

**New `franchise_router.py`** (`prefix="/franchise"`, `FranchisePrincipal` + `require_feature("franchise.payouts")`):
`GET /franchise/redemptions?page&limit&state`, `GET /franchise/redemptions/count` (→ `{ "toPay": n }`),
`GET /franchise/redemptions/{id}`, `POST /franchise/redemptions/{id}/claim` (`ClaimRequest`),
`POST /franchise/redemptions/{id}/decline` (`DeclineRequest`) — same service functions, same response models,
**no confirm route**. `/count` declared before `/{redemption_id}`.

The technician's `/redemptions/me*` routes are unchanged here; Task 06 adds the employee refusal.

### 4.8 Notification audience — one rule, four places

For a row `N` and a reader `R` of the same company:

| Reader | Hears `N` when |
|---|---|
| Vendor | unchanged |
| `franchisee_admin` of F | `N.franchisee_id == F` **and** `N.audience IN (NULL, 'franchisee_admin', 'payers')` — no territory, no company-wide rows |
| facility roles | nothing in this task (Task 12 adds `facility`) |
| Staff | **unchanged**; `franchisee_id` ignored. No staff role is spelled `franchisee_admin`, so those rows never reach staff. |

`payers` therefore reaches today's payer role **plus** the franchisee admins of the row's franchisee — how
home's franchisee admins hear home redemptions (F8), while non-home redemptions are `franchisee_admin` rows that
never reach the company payer.

**Pure spec — new `app/core/audience.py`:**

```python
@dataclass(frozen=True)
class Reader:
    role: str
    vendor_id: UUID | None
    franchisee_id: UUID | None
    is_payer: bool
    all_india: bool
    pincodes: frozenset[str]

def hears(reader: Reader, *, pincode: str | None, vendor_id: UUID | None,
          audience: str | None, franchisee_id: UUID | None) -> bool
```

Today's `tickets/ws.py::_Visibility.hears_notification` body moved here, plus the franchise branch right after
the `vendor` audience test (`if reader.role in FRANCHISE_ROLES: return <table row>`). Unknown audience → False.

Changes:

1. **`core/notifications.notify(..., franchisee_id: uuid.UUID | None = None)`** — stored on the row.
2. **`core/realtime.NotificationRaised`** — `franchisee_id: uuid.UUID | None = None`; `as_payload` writes
   `"franchisee_id"`; `from_payload` reads it optionally (an older worker mid-deploy → None);
   `publish_notification(..., franchisee_id=None)`.
3. **`features/notifications/service._visible`** — **replace** Task 02's fail-closed line
   (`if principal.is_franchise: return stmt.where(sql_false())`) with the opening below, still placed after the
   vendor branch and before `visible_pincodes`:
   ```python
   if principal.is_franchise:
       if principal.franchisee_id is None:
           return stmt.where(sql_false())
       allowed = ([Notification.audience.is_(None), Notification.audience == "franchisee_admin",
                   Notification.audience == "payers"] if principal.role == FRANCHISEE_ADMIN else [])
       # Task 12 appends Notification.audience == "facility" here — for franchise staff of THIS franchisee only;
       # no Admin/NH clause and no `handles_home_parts` on `Reader` (owner ruling 2026-10-15, R4: no staff fallback for parts).
       if not allowed:
           return stmt.where(sql_false())                 # facility roles: still nothing (Task 02)
       return stmt.where(Notification.franchisee_id == principal.franchisee_id,
                         or_(*allowed)).order_by(*_NEWEST_FIRST)
   ```
   The `franchisee_id ==` clause is what keeps Task 02's guarantee: a company-wide row (`franchisee_id IS
   NULL`) still never reaches a franchise reader.
4. **`core/coverage.users_notified_by(..., franchisee_id: uuid.UUID | None = None)`** — mirror:
   `franchisee_admin` → `franchisee_id is None → []`, else `(User.role == FRANCHISEE_ADMIN) &
   (Membership.franchisee_id == franchisee_id)`; `payers` → today's clause OR that clause when `franchisee_id`
   is set; `audience is None` with `franchisee_id` set → append that clause to the territory list. Update the
   docstring's branch list.
5. **`core/notification_relay._deliver`** — pass `franchisee_id=row.franchisee_id`.
6. **`features/tickets/ws.py::_Visibility`** — Task 02 added the slot `franchise` (set in `load()` for a
   franchise principal, which returns early) and made `hears_notification` and `may_hear` return False first
   for it — closing the company-wide leak. This task **widens only the notification half**, consistently with
   item 3: add slot `franchisee_id` (set in that same early branch from `principal.franchisee_id`);
   `hears_notification(pincode, vendor, audience=None, franchisee=None)` builds a `Reader` and delegates to
   `core.audience.hears`, whose franchise branch requires `franchisee == reader.franchisee_id` (so `None`, i.e.
   every company-wide row, is still False — Task 02's test 13 keeps passing unchanged); the relay loop passes
   `event.franchisee_id`. `may_hear` (ticket frames) stays False for franchise readers — Task 04 widens it.

**Task 03 hook** (Task 03 §4, step 8): after a pincode save that moved or trimmed technicians, additionally
write one `technician_moved` row **per affected non-home franchisee** (source or target) with
`audience="franchisee_admin"`, `franchisee_id=<that franchisee>`, `to="/technicians"` (staff-style list route;
the console rewrites it), same title/detail as Task 03's row, and publish it with the same addressing. Home is
skipped (staff already hear Task 03's company-wide row).

### 4.9 Ledger writers

**`franchisee_id` is Task 01's and is not re-specified here:** `core.ledger.entry()` stamps the technician's
franchisee inside the INSERT, and a `reversal` copies the reversed entry's. This task adds the **stream** the
same way (Task 01 §4.6's pattern):

```python
def entry(*, …, franchisee_id=None, technician_type: str | None = None) -> LedgerEntry:
    # technician_type defaults to the technician's TechnicianProfile.technician_type, read in the same INSERT
    # (embedded scalar subquery, company- and id-scoped, exactly like Task 01's franchisee_id). Pass it only
    # to override — the reversal passes penalty.technician_type.
```

No other writer changes: payout (`feedback_service.record_feedback`, `force_close_ticket`), bonus
(`jobs.service.complete`), penalty (`jobs.service.cancel`, `record_no_show`) all take the default. The reversal
(§4.10) passes `technician_type=penalty.technician_type` beside Task 01's franchisee override — it undoes that
row, in that pool, in that stream. Task 01's trap applies to both columns: after a flush they are **expired**;
read them only after `await db.refresh(row, ["franchisee_id", "technician_type"])`.

The escalation **bonus** is therefore paid from the completing technician's pool, which Task 04's eligibility
makes the ticket's franchisee.

### 4.10 Penalty reversal — two doors, one body

**Extract** the body of `tickets/service.reverse_penalty` (lines ~3292–3393) into
**`app/core/penalty_reversal.py`** (rule 4; Task 11 expects it in `core`):

```python
REVERSIBLE_KINDS = ("penalty",)   # Task 11 moves this tuple to app/models/ledger.py (adding
                                  # "speed_penalty") and this module imports it from there

async def reverse(db, *, penalty: LedgerEntry, ticket: Ticket, reason: str,
                  actor_user_id: UUID, actor_label: str) -> LedgerEntry:
    """422 'Say why the penalty is being reversed' under 3 chars; lock the technician's profile
    (with_for_update); 409 PENALTY_ALREADY_REVERSED if a reversal exists; add the reversal via
    ledger.entry(kind='reversal', reverses_id=penalty.id, franchisee_id=penalty.franchisee_id,
    technician_type=penalty.technician_type, amount_paise=penalty.amount_paise, reason=reason[:160]);
    add the 'penalty_reversed' TicketEvent (built inline, actor_kind='staff'); publish_ticket_changed +
    publish_job_changed; commit (IntegrityError → rollback + same 409); then the 'penalty.reversed' push with
    data={'type': 'job'}. Returns the reversal row (refreshed)."""
```

Wording, event note (`₹{amount:,} penalty to {name} reversed · {reason}`) and push are byte-for-byte today's.

**Door 1 — ticket page (staff), unchanged** `POST /tickets/{ticket_id}/penalties/{entry_id}/reverse`
(`penalties.reverse` + `AreaManagerUp` + `require_staff_principal`). `tickets/service.reverse_penalty`: `_load`
→ load the penalty (`kind IN REVERSIBLE_KINDS`, this ticket, this company) → if not `may_reverse(...)` → **404
"Penalty not found"** (an AM/RH cannot see a non-home penalty on the page, §4.11) → `core.penalty_reversal.reverse`
→ `get_ticket`. Home: as today. Non-home: Admin/NH only.

**Door 2 — portal Pool screen** `POST /franchise/ledger/{entry_id}/reverse` in
`features/ledger/franchise_router.py`, `FranchisePrincipal` + `require_feature("franchise.pool")`. **Decision (writer):**
`franchise.pool`, not a new key — the index has no `franchise.penalties`, and reversal is pool money (F12).
Body `{ "reason": "…" }` (3–160; schema duplicated in `features/ledger/schemas.py`). Service
`ledger.service.reverse_entry(db, principal, entry_id, reason)`: `LedgerEntry` by `(company_id, id)`, `kind IN
REVERSIBLE_KINDS`, `franchisee_id == principal.franchisee_id` — any miss → **404 "Penalty not found"**; ticket by
`(company_id, penalty.ticket_id)`; `core.penalty_reversal.reverse`; return **the new reversal** as
`LedgerEntryOut` (Task 09 §4.3):

```json
{ "success": true, "statusCode": 200, "message": "Penalty reversed",
  "data": { "id": "…", "at": "2026-10-15T06:10:00Z", "kind": "reversal", "amountPaise": 50000,
            "technicianId": "…", "technicianName": "Ravi Teja", "ticketId": "…",
            "ticketCode": "ACM-INST-0412", "reason": "Customer moved the visit, not his fault",
            "reversed": false, "franchiseeId": "6f0c…", "technicianType": "freelancer" },
  "errors": [] }
```

Errors: 404, 409 `PENALTY_ALREADY_REVERSED`, 422. Home's franchisee admins use this door for home penalties.
A franchise principal never uses Door 1 (F13).

### 4.11 Ticket detail — whose money a staff member sees

`tickets/service.get_ticket` (non-vendor branch), with `home_id` resolved once:

* `_penalties(db, row, principal, home_id)` keeps only rows where `may_see_money(...)` is True for
  `penalty.franchisee_id`; `TicketPenaltyOut` gains `franchiseeId: uuid.UUID`, `canReverse: bool`
  (`may_reverse(...)`; **False** for a franchise principal reading through Task 04's read-only scope).
* `technicianCreditedPaise`: select the payout row's `franchisee_id` too; null when `may_see_money` is False.
* `_penalty_reviewer`: ticket's franchisee not home → its first active `franchisee_admin` by `full_name`
  (`PenaltyReviewerOut(name=…, role="franchisee_admin")`) or None; home → today's `nearest_manager_for(...)`.
  Computed only when the filtered list is non-empty.

### 4.12 The pool and the ledger list per franchisee

**`core/ledger.py`:** extract `pool()`'s arithmetic into **pure** `pool_arithmetic(totals: dict[str, tuple[int,
int]]) -> dict[str, int]` (input `{kind: (amount_paise, count)}`, output today's five keys; non-pool kinds
ignored — Task 11 extends it). `pool(db, *, company_id, franchisee_id)` — `franchisee_id` **required**, adds
`LedgerEntry.franchisee_id == franchisee_id`. `charged_this_month`, `credited`, `cap_remaining` unchanged (the
cap is the technician's month across franchisees; Task 06 changes `credited`).

**`features/ledger/service.py`:** `get_pool(db, *, company_id, franchisee_id)`; `_entries_query(*, company_id,
franchisee_id, kind)`; `list_entries(..., franchisee_id)`. `LedgerPoolOut` gains `franchiseeId`,
`franchiseeName`; `LedgerEntryOut` gains `franchiseeId`, `technicianType`. Docstrings: "one pool per franchisee
(F12)".

| Route | Guard | Behaviour |
|---|---|---|
| `GET /ledger/pool?franchiseeId=` (staff) | unchanged `earnings.view` or `jobs.assign` + `require_staff_principal` | `pool_franchisee(...)`; absent → **home** (today's console unchanged); unknown → 404 "Franchisee not found". **Decision (writer):** an AM/RH (`jobs.assign`) may read the **balance** of any franchisee — the bonus screen funds every franchisee's escalations (F7) and must show the pool that pays; entries stay closed to them. |
| `GET /ledger?franchiseeId=&kind=` (staff) | unchanged `earnings.view` + `require_staff_principal` | same resolution |
| `GET /franchise/ledger/pool` | `FranchisePrincipal` + `require_feature("franchise.pool")` | own franchisee |
| `GET /franchise/ledger?page&limit&kind&sortBy&sortDir` | same | own franchisee, pool kinds only; `sortBy`/`sortDir` accepted and ignored (the order is the server's, as on `/ledger`) |
| `POST /franchise/ledger/{entryId}/reverse` | same | §4.10 |

```json
GET /franchise/ledger/pool
{ "success": true, "statusCode": 200, "message": "OK",
  "data": { "franchiseeId": "6f0c…", "franchiseeName": "SkyFix Services", "balancePaise": 10000,
            "penaltiesCollectedPaise": 50000, "cancellations": 1, "bonusesPaidPaise": 40000, "pickups": 1 },
  "errors": [] }
```

**Which pool pays an escalation bonus:** the completing technician's (§4.9), which Task 04's eligibility makes
the ticket's. `add_bonus_and_renotify` still does not check the balance (a negative pool is a documented state).

### 4.13 Summary

* **Ticket events:** none new (`penalty_reversed` from `core.penalty_reversal`, `actor_kind='staff'` for
  franchise admins too — `ACTOR_KINDS` unchanged).
* **Notifications:** no new kinds; `upi_change`, `redemption`, `technician_joined`, `technician_moved` carry
  `franchisee_id`.
* **Feature keys:** `franchise.technicians`, `franchise.payouts`, `franchise.pool` (Task 02 seeds them).
* **Error codes:** none new — `PINCODE_OUTSIDE_FRANCHISEE` (Task 04's), `TECHNICIAN_HAS_OPEN_JOBS`,
  `PENALTY_ALREADY_REVERSED`, `NO_PENDING_CHANGE`, `NOT_FOUND`.
* **Docs in the same commit:** `api/AGENTS.md` — "A UPI ID is added once…" (non-home reviewer), redemption payer,
  "Reversing a penalty" (two doors, `core.penalty_reversal`), the audience section (four readers,
  `franchisee_admin`, `notifications.franchisee_id`), "A payout is not pool money" (pool per franchisee), and a
  line on the `/franchise` twin routers. Root `AGENTS.md`'s UPI/redemption sentences: "for a home technician…; a
  franchisee's own admin otherwise".

---

## 5. Client changes

None — Task 07 (mobile: `"Franchisee Admin"` label) and Task 09 (portal, the twins above; `routeFor` rewrites
staff-style `to`). **Staff-console deltas this API enables** — built in **Task 09 §5.10** (the technician list/form
changes in Task 08), per the index owner: technician form *Type* field; list Franchisee/Type columns and
filters; edit actions hidden when `canManage` is false; `BonusSetupPage` passes the ticket's `franchiseeId` to
`GET /ledger/pool`; Penalty & Bonus and Redemptions get an Admin/NH franchisee selector (read-only when
`canAct` is false); ticket page shows *Reverse* only when `canReverse`. PROPOSED copy: "Type", "Freelancer",
"Employee", "Franchisee", "Managed by {franchisee}".

---

## 6. Unit tests (pytest, pure — X1)

`api/tests/unit/` — no database, no session.

**`test_audience.py`** — `core.audience.hears`
1. Staff AM with pincodes {500032}: unaddressed row 500032 → True; 500099 → False; pincode None → True.
2. Staff all-India: any unaddressed row → True.
3. `payers` row (no franchisee): payer NH → True; non-payer Admin → False; AM → False.
4. `payers` row with `franchisee_id=F`: franchisee admin of F → True; of G → False; facility operator of F → False.
5. `franchisee_admin` row (F): admin of F → True; of G → False; Admin, NH payer, AM → False.
6. Unaddressed row with `franchisee_id=F`: admin of F → True; of G → False; AM covering the pincode → True.
7. Rows with `franchisee_id=None` — unaddressed, `payers`, any pincode — franchisee admin → False (Task 02's
   company-wide leak stays closed).
8. `vendor` row: the named vendor → True; franchisee admin → False.
9. Unknown audience (`"zzz"`, and `"facility"` before Task 12) → False for every reader.
10. Franchise reader with `franchisee_id=None` → False for every row.
11. `billing` row: Admin → True; franchisee admin → False.

**`test_franchise_money.py`**
12. `may_see_money`: admin/NH → True for any; RH/AM → home True, other False; franchisee admin → own only;
    facility, vendor, technician → False.
13. `may_reverse`: same matrix; home's franchisee admin → home True, other False.
14. `pool_franchisee`: franchise → own (requested ignored); own None → None; staff requested None → home;
    requested known → it; unknown → None.
15. `redemption_audience`: home → `"payers"`; non-home → `"franchisee_admin"`.
16. `type_change_refusal`: same type with open jobs → None; different, 0 open → None; different, 2 open →
    (`"TECHNICIAN_HAS_OPEN_JOBS"`, message containing "2").

**`test_ledger_pool.py`** — `core.ledger.pool_arithmetic`
17. `{}` → all zeros. 18. penalty (50000,2), bonus (40000,1) → balance 10000, collected 50000, cancellations 2,
    pickups 1. 19. + reversal (20000,1) → collected 30000, cancellations 1, balance −10000.
20. A `payout` entry in the input changes nothing.

(The portal guard itself is Task 02's `require_franchise_principal`, tested there.)

---

## 7. Acceptance criteria

On **RelianceDB** (dev). Setup: company A with home H and external S (Task 03); S's admin Priya; A's AM Kiran
(state holding S's pincodes) and NH Nisha; H's franchisee admin Hari; company B with franchisee admin Bala;
Ravi = S technician (by Priya), Hema = H technician.

1. **Migration.** At `5d2a8c6e0b13`, `alembic upgrade head`; then `SELECT conname, pg_get_constraintdef(oid) FROM
   pg_constraint WHERE conname IN ('ck_notifications_audience','ck_notifications_franchisee_audience',
   'ck_upi_change_requests_reviewer_role','ck_ledger_entries_technician_type')` returns four rows with
   `franchisee_admin` in the first and third; `SELECT count(*) FROM ledger_entries WHERE technician_type IS NULL`
   = 0; the FK-coverage query (api/AGENTS.md rule 6) returns nothing; the round trip keeps every
   `ledger_entries.id`; `audit_tenancy` exits 0.
2. **Portal create.** Priya `POST /franchise/technicians` (S pincodes, no `regionId`, `technicianType:
   "employee"`) → 201; `SELECT franchisee_id, technician_type, region_id FROM technician_profiles WHERE id=:ravi`
   = (S, employee, South). Pincodes in two regions with no `regionId` → 422.
3. **Range.** Priya with a home pincode → 422 `PINCODE_OUTSIDE_FRANCHISEE` naming it; Kiran `POST /technicians`
   with 500032 → same.
4. **Franchise wall.** Bala, and an admin of a second franchisee, on `GET/PUT/DELETE
   /franchise/technicians/{ravi}`, `…/upi-change/approve`, `GET /franchise/redemptions/{ravi's}`,
   `POST /franchise/ledger/{ravi's penalty}/reverse` → **404** each.
5. **Staff read, no write.** Kiran `GET /technicians?pincode=500032` → Ravi with `canManage: false`,
   `upiId: null`; `PUT /technicians/{ravi}` → **403** "Managed by SkyFix Services". Nisha sees `upiId`,
   `canManage: false`, same 403. Kiran edits Hema → 200, `canManage: true`.
6. **Staff door refuses franchise roles.** Priya `GET /technicians` → 403 (no `technicians.view`; and
   `require_staff_principal`) even after Feature Access grants her `technicians.view`.
7. **Type guard.** Ravi holds an `Assigned` job; Priya `PUT /franchise/technicians/{ravi} {technicianType:
   "freelancer"}` → 409 `TECHNICIAN_HAS_OPEN_JOBS`; after it closes → 200.
8. **UPI reviewer.** Ravi requests a change → `SELECT reviewer_role FROM upi_change_requests WHERE
   technician_id=:ravi AND status='pending'` = `franchisee_admin`; `SELECT audience, franchisee_id, pincode, "to"
   FROM notifications WHERE kind='upi_change' ORDER BY created_at DESC LIMIT 1` = (`franchisee_admin`, S, NULL,
   `/technicians/<ravi>`); Priya's `GET /notifications` and unread count include it, Kiran's and Nisha's do not;
   the app's `GET /technicians/me/payout-account` shows `reviewerLabel: "Franchisee Admin"`;
   `GET /franchise/upi-changes?state=pending` lists it and `/count` = `{ "pending": 1 }`. Hema's request still
   reads `area_manager` with her pincode.
9. **Web push mirror.** `users_notified_by(company_id=A, pincode=None, audience='franchisee_admin',
   franchisee_id=S)` from a Python shell returns exactly Priya's user id; with `audience='payers',
   franchisee_id=H` it returns Nisha's (and any other payer's) and Hari's.
10. **Ledger stamping.** After Ravi cancels, a no-show is confirmed, a bonused job completes, a customer closes
    a job and a manager force-closes one: `SELECT kind, franchisee_id, technician_type FROM ledger_entries WHERE
    technician_id=:ravi` shows S and Ravi's type on every row.
11. **Pool per franchisee.** Priya `GET /franchise/ledger/pool` and Nisha `GET /ledger/pool?franchiseeId=S`
    agree with `SELECT kind, sum(amount_paise), count(*) FROM ledger_entries WHERE company_id=:A AND
    franchisee_id=:S AND kind IN ('penalty','bonus','reversal') GROUP BY kind`; Nisha's `GET /ledger/pool` (no
    param) = H's figures; Kiran `GET /ledger/pool?franchiseeId=S` → 200; Kiran `GET /ledger?franchiseeId=S` →
    403; a company-B franchisee id → 404.
12. **Reversal.** Kiran's `GET /tickets/{t}` omits Ravi's penalty; Kiran's Door 1 on it → 404. Priya Door 2 →
    200 with `kind: "reversal"`; `SELECT franchisee_id, technician_type FROM ledger_entries WHERE
    reverses_id=:p` = (S, the penalty's type); repeat → 409 `PENALTY_ALREADY_REVERSED`; Ravi receives the
    `penalty.reversed` push. Nisha reverses another S penalty through Door 1 → 200. Priya on a home penalty → 404.
13. **Redemption payer.** Ravi (freelancer) redeems → `SELECT franchisee_id FROM redemptions WHERE id=:r` = S;
    bell `audience='franchisee_admin', franchisee_id=S, "to"='/redemptions/<r>'`; `GET /redemptions/me` →
    `payerLabel: "Franchisee Admin"`. Nisha `POST /redemptions/{r}/claim` → 404; Nisha `GET
    /redemptions/{r}?franchiseeId=S` → 200, `canAct: false`. Priya `POST /franchise/redemptions/{r}/claim` → 200;
    Ravi confirms → settled. `GET /franchise/redemptions/count` before the claim = `{ "toPay": 1 }`.
14. **Home alongside.** Hema redeems → `audience='payers', franchisee_id=H`; Nisha and Hari both see it, Kiran
    does not; Hari claims via `/franchise/redemptions/{id}/claim` → 200.
15. **Options & pincodes.** Priya `GET /franchise/technician-options` → regions = those holding S's codes;
    subcategories all at `CERTIFY_DEPTH`. `GET /franchise/pincodes?search=5000` → only S's active codes.
16. **Tickets untouched.** Kiran reschedules, assigns (an S technician, per Task 04) and force-closes Ravi's S
    ticket in his territory → 200 each.
17. **Grep gates.** `grep -rn "national_head" api/app/core/coverage.py api/app/core/visibility.py
    api/app/features/notifications/service.py api/app/features/tickets/ws.py` reviewed (index §5.6);
    `pytest api/tests/unit` green.

---

## 8. Out of scope, traps and index notes

**Traps**

1. **Publish with Task 06.** Between them an employee would still be paid per job and could redeem; those rows
   are stamped `employee`, and Task 06's `credited()` would then drop them from the redeemable balance — real
   money silently withheld.
2. `require_staff_principal` must already refuse `FRANCHISE_ROLES` (Task 02 §4.1). Verify before relying on it
   for the staff doors here.
3. `require_min_rank` **refuses** franchise roles (rank 8–10) — never put a portal twin behind a staff floor.
4. Audience lives in four places (`_visible`, `users_notified_by`, ws `_Visibility`, `core.audience`); an
   audience one of them does not know reaches nobody. §7 #8, #9, #14 test all of them.
5. `pool()` now requires a franchisee; seed scripts (`app/scripts/seed/*`, `seed_play_review.py`) that call it
   or `ledger.entry()` must be checked too.
6. Do **not** filter `charged_this_month` by franchisee — the cap is the technician's month.
7. Keep Task 02's ws early return for franchise principals: `_Visibility` must not call
   `service._visible_pincodes` for them, and `hears` must never return True for a row whose `franchisee_id` is
   NULL — that is the company-wide leak Task 02 closed. Franchise ticket frames are Task 04's.
8. A twin route that forgets `FranchisePrincipal` and uses `CompanyPrincipal` is only as safe as the
   service's scoping; keep both.

**Out of scope:** franchise ticket visibility (Task 04), carve-out moves (Task 03), employee rules and statements
(Task 06), every screen (Tasks 07/09), franchisee↔company money (F11), an "all franchisees" pool total.

**Index additions / inconsistencies for the owner**

* `ledger_entries.technician_type` (§3.3) — not in index §3.2; needed by Task 06. In this migration.
* New shared helpers not in index §3.7: `core/franchise_money.py`,
  `core/audience.py`, `core/penalty_reversal.py`, `core.ledger.pool_arithmetic`.
* Index §3.7 says `features/franchise_portal/` holds the portal endpoints; the `/franchise/technicians*`,
  `/franchise/upi-changes*`, `/franchise/redemptions*`, `/franchise/ledger*` twins live as `franchise_router.py`
  inside their owning slices (rule 4) — same URLs as Task 09.
* Task 04's range-check helper has no index name (called `assert_pincodes_in_franchisee` here).
* Staff-console deltas for Tasks 05/06 — settled: Task 09 §5.10 (list/form: Task 08).
* **Owner questions — both SETTLED 2026-10-15:** (a) *(R3)* a non-home franchisee has no fallback, and Task 03 refuses
  deactivating its last active admin (`FRANCHISEE_LAST_ADMIN`); (b) *(R5)* refusing a type change while open jobs exist
  (`TECHNICIAN_HAS_OPEN_JOBS`) stays as built, as does `TECHNICIAN_HAS_BALANCE` (Task 06).

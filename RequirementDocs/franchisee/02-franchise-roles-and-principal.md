# Task 02 — Franchise roles, feature keys, the principal and the scope helpers

> Read [00-index.md](00-index.md) first; it wins over this document on any name. Then root `AGENTS.md`
> (hard rule 0) and `api/AGENTS.md` hard rules 1, 2, 4, 6 and 7 (rule 7 is the vendor precedent this task
> copies). **API only**, plus three type-level lines in the console (§5). Depends on Task 01
> (`memberships.franchisee_id`, `technician_profiles.franchisee_id`, `core/franchise.py`).

---

## 1. Goal and why

**Plain version.** A franchisee needs people who sign in: its **franchisee admin** (owns the franchisee's
technicians and their money) and its **facility staff** (handle spare parts). They use the same console as
company staff, but they act **for one franchisee**, the way a vendor login acts for one vendor. This task
gives the API everything it needs to recognise such a caller and keep them inside their franchisee:

1. three new roles, appended below every existing role;
2. eleven feature keys and who holds them by default;
3. `Principal.franchisee_id`, read from the membership on every request;
4. guards that say "this role family and no other" (rank cannot);
5. `core/franchise_scope.py`, the ONE place F7/F8 ("who manages which franchisee's technicians and money")
   is decided;
6. fail-closed behaviour for a franchise caller everywhere the code currently switches on staff role
   names, so nothing leaks before Tasks 04/05 open the doors deliberately;
7. `/auth/me` tells the console which franchisee the caller belongs to.

Nobody can hold these roles yet — logins are created in Task 03 (`app/core/franchise_logins.py`). This task
proves itself with a hand-made dev login (§7).

**Worked example.** *SkyFix Services* is a franchisee of *Acme*. Priya is SkyFix's franchisee admin
(`users.role = 'franchisee_admin'`, membership in Acme with `franchisee_id = SkyFix`). She signs in:

- `GET /auth/me` → `role: "franchisee_admin"`, `features: ["franchise.technicians", "franchise.payouts",
  …]`, `franchisee: {id, name: "SkyFix Services", code: "SKY", kind: "external", isHome: false}`.
- `managed_franchisee_ids(db, priya)` → `{SkyFix}`. `can_manage_technician(db, priya, ravi)` → True for
  SkyFix's Ravi, False for Acme (home)'s Suresh.
- Acme's Area Manager Kiran: `managed_franchisee_ids(db, kiran)` → `{Acme (home)}` — he still manages home
  technicians exactly as today (F8), but `can_manage_technician(db, kiran, ravi)` → False.
- Priya calls `GET /tickets/<id>` → **404** (franchise ticket visibility is Task 04; until then it fails
  closed). `POST /users {role: "facility_operator"}` from Acme's admin → **400** (franchise logins are not
  made on the Users screen).

---

## 2. Decisions implemented

- **F7** — split of duties (technicians and money for the franchisee admin; tickets stay with staff):
  `core/franchise_scope.py`.
- **F8** — home proxy: staff keep today's powers over the **home** franchisee; a home franchisee admin
  holds them alongside; non-home → own admins only, plus company Admin/NH for penalty reversal and
  read-only views.
- **F9** — Admin/NH create franchisees and franchisee-admin logins (here: `franchisees.manage`
  default holders; refusal in `/users`).
- **F10** — the restricted shell is chosen by role (here: the role vocabulary and `/auth/me`; the shell is
  Task 09).
- **F13** — franchise ticket visibility is by ownership (here: fail closed; Task 04 opens it).
- **P6** — franchisee admin may do everything a facility admin can; facility admin manages operators.
- **Index §3.3** roles and Python sets, **§3.4** feature keys, **§3.6** migration `5d2a8c6e0b13`,
  **§3.7** `deps` and `franchise_scope` symbols. **X1** pure tests. **X5** hard rules.

---

## 3. Schema

No tables or columns. Reference data only: `roles`, `features`, `role_feature_defaults`.

### 3.1 `api/app/models/role.py`

```python
FRANCHISEE_ADMIN = "franchisee_admin"
FACILITY_ADMIN = "facility_admin"
FACILITY_OPERATOR = "facility_operator"

ROLE_RANKS = {…existing…, FRANCHISEE_ADMIN: 8, FACILITY_ADMIN: 9, FACILITY_OPERATOR: 10}
ROLE_LABELS = {…existing…, FRANCHISEE_ADMIN: "Franchisee Admin", FACILITY_ADMIN: "Facility Admin",
               FACILITY_OPERATOR: "Facility Operator"}

#: Act FOR a franchisee rather than for the company. Like VENDOR_ROLES, a set because rank cannot say
#: "this family and no other" — test membership, never the number.
FRANCHISE_ROLES = frozenset({FRANCHISEE_ADMIN, FACILITY_ADMIN, FACILITY_OPERATOR})
#: Franchisee staff who work the spare-parts desk (P6). The franchisee admin may do all they can, but is
#: not one of them — guards that mean "anyone who works parts" use FRANCHISE_ROLES.
FACILITY_ROLES = frozenset({FACILITY_ADMIN, FACILITY_OPERATOR})
```

Update the module docstring ("8 fixed roles" → 11, a third family: franchise). Explain the append:
`roles.rank` is UNIQUE; 8–10 are free; appending below everyone means **every existing
`require_min_rank(...)` floor refuses franchise roles automatically** (fails closed), which is the property
we want for every staff-only screen (credits, settings, vendors, vendor credit, redemptions pay, force
close, reschedule …).

*Decision (writer):* `ROLES_WITHOUT_PROFILE_IMAGE` is **unchanged** — franchise logins are people (one per
person, like an Area Manager), not companies, so they keep an avatar. `ALL_INDIA_ROLES` (`core/scope.py`)
and `VENDOR_ROLES` are unchanged and must never contain a franchise role.

### 3.2 Why `ensure_below_rank` must NOT decide franchise authority over technicians

`ensure_below_rank(principal, target_role)` (`core/deps.py`) asks one company-wide question: is the target
role's rank strictly greater than mine?

- **franchisee_admin (8) → technician (5):** `5 <= 8` → **403 always**. Rank says a franchisee admin can
  never manage any technician, which is the opposite of F7.
- Renumbering would not help. Put franchise roles above technician and an Area Manager (4) would
  "outrank" every franchisee admin, and SkyFix's admin would "outrank" **every technician in the
  company**, Acme (home)'s and other franchisees' included. Authority here is **per franchisee**, a
  relationship between two rows, and rank is a property of one role.
- And the reverse hole: **AM (4) → franchisee_admin (8)** passes `ensure_below_rank`, so the Users screen
  would happily let an Area Manager mint a franchisee admin with no franchisee. Hence the explicit refusal
  in `create_user` (§4.6), exactly as for `VENDOR_ROLES`.

**What to use instead:** `core.franchise_scope.can_manage_technician(db, principal, tech)` — franchisee
equality for franchise principals, "home only" for staff — **ANDed** with whatever territory/rank checks the
endpoint already has (it never replaces `technician_scope`, `_load`, or an AM floor).

`ensure_below_rank` **is** right *inside* the franchise family, together with a same-franchisee check:
franchisee_admin (8) → facility_admin (9) / facility_operator (10) passes; facility_admin (9) →
facility_operator (10) passes; facility_admin → facility_admin refused — exactly P6. Task 12 uses it that
way, and must also require `target.franchisee_id == principal.franchisee_id`.

### 3.3 Migration `api/alembic/versions/5d2a8c6e0b13_franchise_roles_and_features.py`

`revision = "5d2a8c6e0b13"`, `down_revision = "3b7e1f0a9c41"` (index §3.6; re-point to the current head if
something landed between, and say so in the commit). Prose docstring with the WHY: the append (§3.1), the
rank argument (§3.2), why franchise keys are separate from `technicians.*`/`redemptions.pay` (F8: home keeps
the existing keys; a franchisee admin holding `technicians.view` would otherwise inherit staff screens'
semantics), and the downgrade refusal.

Feature rows — *Decision (writer):* labels, parents and sort orders are not in the index; these mirror the
`vendors.view`/`vendors.edit` pattern and put the franchise block after the vendor portal (95–97). Only
`franchisees.manage` gets a parent; other keys stay top-level so the Feature Access tree implies no coupling
that does not exist.

```python
import sqlalchemy as sa
from alembic import op

revision = "5d2a8c6e0b13"
down_revision = "3b7e1f0a9c41"
branch_labels = None
depends_on = None

ROLES = [
    ("franchisee_admin", "Franchisee Admin", 8),
    ("facility_admin", "Facility Admin", 9),
    ("facility_operator", "Facility Operator", 10),
]

# (key, label, parent_key, sort_order) — parents first (self-FK on parent_key).
FEATURES = [
    ("franchisees.view", "Franchisees", None, 64),
    ("franchisees.manage", "Manage Franchisees", "franchisees.view", 65),
    ("parts.catalogue", "Spare Parts Catalogue", None, 88),
    ("franchise.technicians", "Franchise Technicians", None, 100),
    ("franchise.payouts", "Franchise Payouts", None, 101),
    ("franchise.pool", "Franchise Penalty Pool", None, 102),
    ("franchise.settings", "Travel & Speed Settings", None, 103),
    ("franchise.statements", "Employee Statements", None, 104),
    ("franchise.tickets", "Franchise Tickets", None, 105),
    ("franchise.facility_users", "Facility Users", None, 106),
    ("parts.handle", "Handle Part Requests", None, 107),
]

# Exactly index §3.4.
DEFAULTS = {
    "franchisees.manage": ["admin", "national_head"],
    "franchisees.view": ["admin", "national_head", "regional_head", "area_manager"],
    "franchise.technicians": ["franchisee_admin"],
    "franchise.payouts": ["franchisee_admin"],
    "franchise.pool": ["franchisee_admin"],
    "franchise.settings": ["franchisee_admin"],
    "franchise.statements": ["franchisee_admin"],
    "franchise.tickets": ["franchisee_admin", "facility_admin", "facility_operator"],
    "franchise.facility_users": ["franchisee_admin", "facility_admin"],
    "parts.handle": ["franchisee_admin", "facility_admin", "facility_operator"],
    "parts.catalogue": ["admin", "national_head"],
    # Owner ruling 2026-10-15 (R4): `parts.handle` is NEVER seeded to a staff role (no Admin/NH parts fallback, home
    # included). Admin/NH create the HOME franchisee's facility users through the existing `franchisees.manage`
    # — no extra key is seeded here (Task 12 §4.8b).
}


def upgrade() -> None:
    bind = op.get_bind()
    for key, label, rank in ROLES:
        bind.execute(sa.text(
            "INSERT INTO roles (key, label, rank) SELECT CAST(:k AS varchar), CAST(:l AS varchar), "
            "CAST(:r AS integer) WHERE NOT EXISTS (SELECT 1 FROM roles WHERE key = :k)"),
            {"k": key, "l": label, "r": rank})
    for key, label, parent, sort in FEATURES:
        bind.execute(sa.text(
            "INSERT INTO features (key, label, parent_key, sort_order) "
            "SELECT CAST(:key AS varchar), CAST(:label AS varchar), CAST(:parent AS varchar), "
            "CAST(:sort AS integer) WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = :key)"),
            {"key": key, "label": label, "parent": parent, "sort": sort})
    for key, roles in DEFAULTS.items():
        for role in roles:
            bind.execute(sa.text(
                "INSERT INTO role_feature_defaults (role, feature_id, enabled) "
                "SELECT CAST(:role AS varchar), f.id, true FROM features f WHERE f.key = :key "
                "AND NOT EXISTS (SELECT 1 FROM role_feature_defaults d "
                "WHERE d.role = CAST(:role AS varchar) AND d.feature_id = f.id)"),
                {"role": role, "key": key})


def downgrade_blockers(holders: int) -> list[str]:
    """PURE. Unit-tested."""
    return [f"{holders} user(s) hold a franchise role"] if holders else []


def downgrade() -> None:
    bind = op.get_bind()
    role_keys = [k for k, _, _ in ROLES]
    feature_keys = [k for k, _, _, _ in FEATURES]
    holders = bind.scalar(sa.text("SELECT count(*) FROM users WHERE role = ANY(:r)"), {"r": role_keys})
    blockers = downgrade_blockers(holders)
    if blockers:  # users.role -> roles.key is RESTRICT anyway; say why in words first
        raise RuntimeError("Refusing to downgrade 5d2a8c6e0b13: " + "; ".join(blockers)
                           + ". Remove those logins first.")
    for table in ("company_role_features", "role_feature_defaults"):
        bind.execute(sa.text(f"DELETE FROM {table} WHERE role = ANY(:r)"), {"r": role_keys})
        bind.execute(sa.text(f"DELETE FROM {table} WHERE feature_id IN "
                             "(SELECT id FROM features WHERE key = ANY(:k))"), {"k": feature_keys})
    # Children before parents — parent_key is a self-FK.
    bind.execute(sa.text("DELETE FROM features WHERE key = ANY(:k) AND parent_key IS NOT NULL"),
                 {"k": feature_keys})
    bind.execute(sa.text("DELETE FROM features WHERE key = ANY(:k)"), {"k": feature_keys})
    bind.execute(sa.text("DELETE FROM roles WHERE key = ANY(:r)"), {"r": role_keys})
```

No `audit_tenancy` change (`roles`, `features`, `role_feature_defaults` are already `GLOBAL_TABLES`;
`company_role_features` is tenant data already linked). No `cleanup_db` change (all four tables are
already classified). Run `cleanup_db --check` anyway.

---

## 4. API / service changes

### 4.1 `api/app/core/deps.py`

**`Principal`** — add the field and two properties:

```python
#: The franchisee this caller acts FOR — set only for FRANCHISE_ROLES, None for everyone else.
#: Read from the membership `get_current_principal` already loads, like `vendor_id`; never a token claim.
franchisee_id: uuid.UUID | None = None

@property
def is_franchise(self) -> bool:
    """Acts for a franchisee — any of the three franchise roles. Tests the set, never rank."""
    return self.role in FRANCHISE_ROLES
```

**`get_current_principal`** — after `vendor_id = membership.vendor_id`:

```python
if user.role in FRANCHISE_ROLES:
    # Corrupt (no franchisee) and closed (removed / switched off) both refuse here, so EVERY endpoint,
    # /auth/me included, says why — the same reason the company-suspended check lives here.
    live = membership.franchisee_id is not None and await db.scalar(
        select(Franchisee.id).where(
            Franchisee.company_id == company_id, Franchisee.id == membership.franchisee_id,
            Franchisee.is_active.is_(True), Franchisee.deleted_at.is_(None)))
    if not live:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="This franchisee is no longer active")
    franchisee_id = membership.franchisee_id
```
and pass `franchisee_id=franchisee_id` to `Principal(...)`. One extra query, for franchise roles only.
*Decision (writer):* a `franchisee_id` on a **non-franchise** membership is ignored (stays None on the
principal) — it must never narrow or widen a staff principal.

**New guards** (index §3.7 names; sync, no DB — unit-testable):

```python
def require_franchise_principal(principal: CompanyPrincipal) -> Principal:
    """The franchisee's own admin — the F7 owner of technicians and money, and nobody else.

    Not a feature (Feature Access can hand any key to any role), not a rank floor (franchise roles rank
    below everyone, so a floor would admit the company). Use ALONGSIDE require_feature("franchise.*").
    Routes: /franchise/technicians, payouts, pool, settings, statements (Tasks 05/06/10/11)."""
    if principal.role != FRANCHISEE_ADMIN:
        raise HTTPException(403, detail="Only a franchisee admin can do this")
    if principal.franchisee_id is None:
        raise HTTPException(403, detail="This account is not linked to a franchisee")
    return principal

FranchisePrincipal = Annotated[Principal, Depends(require_franchise_principal)]


def require_facility_principal(principal: CompanyPrincipal) -> Principal:
    """Anyone who works for a franchisee: its admin or its facility staff (P6 — the admin may do
    everything a facility admin can). Routes: franchise tickets (Task 04), part requests and facility
    users (Task 12), each with its feature key."""
    if principal.role not in FRANCHISE_ROLES:
        raise HTTPException(403, detail="Not available on this account")
    if principal.franchisee_id is None:
        raise HTTPException(403, detail="This account is not linked to a franchisee")
    return principal

FacilityPrincipal = Annotated[Principal, Depends(require_facility_principal)]   # Decision (writer): alias
```

*Decision (writer):* the index fixes the names but not their meaning. Because `FRANCHISE_ROLES =
{franchisee_admin} ∪ FACILITY_ROLES`, a "facility principal" that also admitted the admin would equal a
"franchise principal" — two names for one set. So **`require_franchise_principal` = franchisee admin only**
(the money/technician wall that must survive a Feature Access toggle) and **`require_facility_principal` =
any franchise role**. `Principal.is_franchise` is the family test (all three), like `is_vendor`.

**`require_staff_principal`** — add `or principal.role in FRANCHISE_ROLES` to the refusal. It guards
global search, the masters writes, `tickets` NH-only import routes and the vendor screens; none is a
franchise screen. Update its docstring ("not a vendor, not a technician, not franchise staff").

`require_min_rank`, `require_vendor_principal`, `require_technician_principal`: unchanged (they already
refuse franchise roles). `ensure_below_rank`: unchanged — see §3.2.

### 4.2 New module `api/app/core/franchise_scope.py` (index §3.7) — F7/F8 in one place

Imports `sqlalchemy`, `app.models.*`, `app.core.franchise`; `Principal` only under `TYPE_CHECKING` (deps
imports core modules — the `core/scope.py` pattern).

```python
MANAGE = "manage"    # add / invite / edit / type / base location / UPI approval / pay / pool / settings
VIEW = "view"        # read-only technician and money views
REVERSE = "reverse"  # give a penalty back
PURPOSES = (MANAGE, VIEW, REVERSE)

STAFF_ALL_INDIA = frozenset({ADMIN, NATIONAL_HEAD})
STAFF_TERRITORY = frozenset({REGIONAL_HEAD, AREA_MANAGER})


def decide_managed_franchisees(*, role: str, principal_franchisee_id: uuid.UUID | None,
                               home_id: uuid.UUID | None, purpose: str = MANAGE
                               ) -> frozenset[uuid.UUID] | None:
    """PURE. Which franchisees' technicians/money this role reaches. None = every franchisee in the company.

    | role                         | MANAGE        | VIEW | REVERSE |
    | admin, national_head         | {home}        | None | None    |   F8: + reversal & read-only everywhere
    | regional_head, area_manager  | {home}        | None | {home}  |   VIEW still narrowed by territory
    | franchisee_admin             | {own}         | {own}| {own}   |   home's own admin included (F8)
    | facility_admin / _operator   | {}            | {}   | {}      |   they work parts, not people (F7)
    | technician, vendor*, other   | {}            | {}   | {}      |
    """
    if purpose not in PURPOSES:
        raise ValueError(f"unknown purpose {purpose!r}")
    if role == FRANCHISEE_ADMIN:
        return frozenset({principal_franchisee_id}) if principal_franchisee_id else frozenset()
    if role in STAFF_ALL_INDIA:
        return None if purpose in (VIEW, REVERSE) else frozenset({home_id})
    if role in STAFF_TERRITORY:
        return None if purpose == VIEW else frozenset({home_id})
    return frozenset()


def decide_can_manage(managed: frozenset[uuid.UUID] | None, tech_franchisee_id: uuid.UUID) -> bool:
    """PURE."""
    return managed is None or tech_franchisee_id in managed


async def managed_franchisee_ids(db, principal: "Principal", *, purpose: str = MANAGE
                                 ) -> set[uuid.UUID] | None:
    """Index §3.7 signature, plus a keyword-only `purpose` (Decision (writer): F8 gives Admin/NH
    reversal and read-only reach that MANAGE must not have; one function, three questions).
    Loads the home id only for staff roles."""
    if principal.company_id is None:
        return set()
    home_id = None
    if principal.role in STAFF_ALL_INDIA | STAFF_TERRITORY:
        home_id = await home_franchisee_id(db, principal.company_id)
    found = decide_managed_franchisees(role=principal.role,
                                       principal_franchisee_id=principal.franchisee_id,
                                       home_id=home_id, purpose=purpose)
    return None if found is None else set(found)


async def can_manage_technician(db, principal: "Principal", tech: TechnicianProfile, *,
                                purpose: str = MANAGE) -> bool:
    """The FRANCHISE wall, F7/F8. ANDed with — never instead of — the endpoint's existing checks
    (technician_scope territory, `_load`'s company filter, the AM floor). A tech from another company
    never reaches here: callers load it through a company-scoped loader first (404)."""
    if tech.company_id != principal.company_id:
        return False
    return decide_can_manage(await managed_franchisee_ids(db, principal, purpose=purpose),
                             tech.franchisee_id)
```

Task 02 only **defines** these and tests them. Wiring them into the technician, UPI, redemption, reversal
and pool endpoints is Task 05. When it does, a refusal for a technician the caller can *see* but not
*manage* is 403 (they already know it exists); one they cannot see is 404 via the scoped loader.

### 4.3 Visibility helpers — what a franchise principal gets in this task

*Decision (writer), against the brief's suggestion:* franchise principals see tickets by **ownership**
(`tickets.franchisee_id = principal.franchisee_id`, Task 04), **not** by `visible_pincodes` returning the
franchisee's pincodes. After a carve-out (F6) an assigned ticket keeps its old franchisee while its pincode
now belongs to the new one; geography would show SkyFix's admin a ticket whose technician and money are
Acme (home)'s and hide one that is theirs. Ownership is the rule that agrees with the ledger — the vendor
precedent (api/AGENTS.md hard rule 7: "by ownership for a vendor, by geography for staff").

| Place (file :: function) | Today for a franchise principal | Change in Task 02 |
|---|---|---|
| `core/scope.py :: visible_pincodes` | falls through to `return []` | Explicit first branch: `if principal.is_franchise: return []` with the ownership note above. Docstring: franchise principals are scoped by ownership in each slice, like vendors. |
| `features/tickets/service.py :: scoped` | `_apply_visibility(stmt, [])` → sees nothing | Add `if principal.is_franchise: return stmt.where(sql_false())` before the staff branch, with `# Task 04 (F13) replaces this with ownership`. A guessed ticket id → **404**. |
| `features/notifications/service.py :: _visible` | `visible_pincodes` `[]` → nothing | Explicit `if principal.is_franchise: return stmt.where(sql_false())` before the staff branch. Task 05 adds the `franchisee_admin` audience + `notifications.franchisee_id`; Task 12 adds `facility`. |
| `features/tickets/ws.py :: _authenticate` | builds `Principal` without the franchisee | Pass `franchisee_id=membership.franchisee_id if user.role in FRANCHISE_ROLES else None`. |
| `features/tickets/ws.py :: _Visibility` | **LEAKS**: `pincodes=set()`, `all_india=False`, but `hears_notification` returns True for every `pincode is None` (company-wide) row | Add slot `"franchise"` (default False). In `load`: `if principal.is_franchise: self.franchise = True; self._at = …; return`. `hears_notification` and `may_hear`: `if self.franchise: return False` first. Tasks 04/05 widen. |
| `core/visibility.py :: technician_scope` | no regions → only technicians they appointed | First branch: `if principal.is_franchise:` → franchisee admin: `stmt.where(TechnicianProfile.franchisee_id == principal.franchisee_id)`; facility roles: `stmt.where(sql_false())`. (F7: the admin's roster is exactly their franchisee — home admin sees home technicians.) |
| `features/technicians/service.py :: _visible_invites` | only invites they sent | Same branch on `TechnicianInvite.franchisee_id`. |
| `db/repository.py :: territory_scope` | "any other role sees only themselves" | Unchanged (correct: a franchise caller holding `users.view` by override sees only their own row). |
| `features/geo/router.py` `mine=true` (states, districts, pincodes) | empty | Unchanged. The franchise portal's pincode picker reads `franchisee_pincodes_subquery` through `/franchise/*` (Tasks 09/14). |
| `features/technicians/service.py :: resolve_region` / `check_pincodes_in_own_area` | region check fails closed (403/422); the pincode check returns early for non-AM | Unchanged now. Flag for Task 04/05: coverage for franchise-added technicians must be checked against the franchisee's range (`PINCODE_OUTSIDE_FRANCHISEE`), because `check_pincodes_in_own_area` does **not** cover them. |
| `features/tickets/service.py :: get_ticket` (`if not principal.is_vendor:` shows ledger money) | unreachable (scoped → 404) | Unchanged. Flag for Task 04: hide payout/penalties from facility roles. |
| `core/coverage.py :: payer_role, upi_reviewer, users_notified_by, nearest_manager_for, area_managers_covering` | staff vocabularies only → franchise roles never addressed | Unchanged (fail closed). Task 05 makes payer/UPI reviewer franchisee-aware and adds the audiences to `users_notified_by` **and** `_visible` **and** `ws.hears_notification` together. |
| `features/search/service.py :: _users_stmt` | lists franchise users under "Users" | Add `*FRANCHISE_ROLES` to the `User.role.not_in([...])` list (the Users screen will not list them, §4.6). Search itself is already closed to them by `require_staff_principal`. |
| `features/masters/service.py` `is_vendor` branches | n/a (no `masters.view`) | Unchanged. Task 12 decides what parts screens read. `onboarding/service.py :: _AnonPrincipal` — add `is_franchise = False` beside `is_vendor = False` so any future read of it does not AttributeError. |
| `features/vendors/service.py`, `vendor_users/service.py` email-reuse checks (`existing.role not in VENDOR_ROLES`) | refuse reusing a franchise login's email as a vendor | Unchanged (correct). |
| `features/companies/service.py :: create_company` (`existing.role != ADMIN`) | refuses | Unchanged. |
| `features/auth/service.py :: login, google_login, resettable_user` | admitted (password users) | Unchanged — franchise logins sign in with email+password or Google, and may reset. |
| `scripts/seed/tenant.py`, `seed_play_review.py` hand-built `Principal(...)` | n/a | Unchanged (`franchisee_id` defaults to None). |

### 4.4 RBAC — `api/app/features/rbac/service.py :: _check_manageable_role`

Feature Access edits a role's features **company-wide**. Two additions before `ensure_below_rank`:

```python
if principal.is_franchise:
    # A franchisee admin outranks facility roles (8 < 9, 10), so rank alone would let SkyFix's admin
    # re-shape what EVERY franchisee's facility staff can do.
    raise HTTPException(403, detail="Not available on this account")
if role in FRANCHISE_ROLES and principal.rank > ROLE_RANKS[NATIONAL_HEAD]:
    # F9: franchise roles are the Admin's and National Head's to shape, like the franchisees themselves.
    raise HTTPException(403, detail="National Head and above only")
```
`GET /roles` (`list_roles`) is unchanged: it returns the catalogue (now 10 rows excluding superadmin, ranks
1–10); "assignable" is a client filter (§5) and a server refusal (§4.6).

### 4.5 `/auth/me` — `api/app/features/auth/schemas.py` + `service.py :: get_me`

Contract fixed by the coordinator (console Tasks 08/09 depend on exactly these keys):

```python
class MeFranchiseeOut(AppModel):
    """The franchisee a franchise login acts for. Null for everyone else."""
    id: uuid.UUID
    name: str
    code: str
    kind: str        # 'internal' | 'external'
    isHome: bool

class MeResponse(AppModel):
    …existing…
    franchisee: MeFranchiseeOut | None = None
```

In `get_me`, after the vendor block:
```python
franchisee: MeFranchiseeOut | None = None
if principal.franchisee_id is not None:
    row = await session.scalar(select(Franchisee).where(
        Franchisee.company_id == principal.company_id, Franchisee.id == principal.franchisee_id,
        Franchisee.deleted_at.is_(None)))
    if row is not None:
        franchisee = MeFranchiseeOut(id=row.id, name=row.name, code=row.code, kind=row.kind,
                                     isHome=row.is_home)
```
and `scopeLabel=franchisee.name if franchisee else scope_label(principal.role, scope)`
(*Decision (writer):* `scope_label` would print "—" for them; the franchisee's name is their scope).
`role` and `features` are already returned. **Landing is client-side** (coordinator): franchisee admin →
the portal's technicians page, facility roles → the portal's tickets page (Task 09). `LoginResponse` is
unchanged — the console calls `/auth/me` after sign-in.

### 4.6 Users & roles — `api/app/features/users/service.py`

Extract a pure helper and use it in `create_user` (replacing the two inline `TECHNICIAN` / `VENDOR_ROLES`
refusals, same messages):

```python
def role_not_creatable_here(role: str) -> str | None:
    """PURE. Why /users cannot create this role, or None. Rank cannot express any of these — a vendor
    (6) and the franchise roles (8–10) rank below every staff role, so an Area Manager 'outranks' them."""
    if role == SUPERADMIN or role not in ROLE_RANKS:
        return "Invalid role"
    if role == TECHNICIAN:
        return "Onboard technicians from the Technicians screen"
    if role in VENDOR_ROLES:
        return "Vendor accounts are created with the vendor, on the Vendors screen"
    if role in FRANCHISE_ROLES:
        return "Franchise accounts are created on the Franchisees screen"
    return None
```
Franchise logins are created by Task 03's `app/core/franchise_logins.py` (franchisee admins, by Admin/NH)
and reused by Task 12 (facility users) — never here.

Also:
- `list_users`: add `*FRANCHISE_ROLES` to `User.role.not_in([TECHNICIAN, *VENDOR_ROLES])`.
- `_load_membership`: add `User.role.not_in(list(FRANCHISE_ROLES))` to its WHERE. Every get/update/
  reissue/delete goes through it, so an Admin guessing a franchise login's membership id gets **404**
  (the Users screen never lists them; their management lives on the franchisee screens).
  *Decision (writer):* stricter than vendors (whose rows are loadable by id) — deliberate, the vendor case
  is a pre-existing gap the reissue guard patches by hand.

### 4.7 Error codes and features

No new `AppError` codes in this task (the 403/400 bodies above are plain `HTTPException` details, as the
existing guards use). Feature keys and floors are §3.3; none is wired to a route yet except as noted.

---

## 5. Client changes (console — type level only)

No screen. Three small changes in `adminWeb/` so nothing offers or mis-types the new roles:

1. `adminWeb/src/types/api.ts` — extend `BackendRole` with `"franchisee_admin" | "facility_admin" |
   "facility_operator"`; add
   `export const FRANCHISE_ROLES = ["franchisee_admin", "facility_admin", "facility_operator"] as const satisfies readonly BackendRole[];`
   and `export interface MeFranchisee { id: string; name: string; code: string; kind: "internal" | "external"; isHome: boolean }`;
   add `franchisee: MeFranchisee | null` to `MeResponse`.
2. `adminWeb/src/hooks/useCompanyUsers.ts` — extract the filter in `useAssignableRoles` into an exported
   pure `assignableRoles(roles: RoleOption[], myRole: string): RoleOption[]` and add `...FRANCHISE_ROLES` to
   `NOT_INVITABLE_HERE` (update its comment: "need a franchisee on the membership — created on the
   Franchisees screen").
3. Nothing in `store/session.ts` yet: `roleFromBackend` already defaults unknown roles to the least
   privileged view role. `landingPath` gains its franchise branch in Task 09.

Mobile: none.

---

## 6. Unit tests (pure — X1)

`api/tests/unit/test_roles.py`
1. `ROLE_RANKS` has `franchisee_admin: 8, facility_admin: 9, facility_operator: 10`; all ranks unique.
2. `FRANCHISE_ROLES` / `FACILITY_ROLES` exact sets; `FACILITY_ROLES < FRANCHISE_ROLES`; neither intersects
   `VENDOR_ROLES`, `ALL_INDIA_ROLES` or `{TECHNICIAN}`; every franchise role has a `ROLE_LABELS` entry.
3. `ensure_below_rank` (construct `Principal(user=User(id=uuid4(), role=r), role=r, rank=ROLE_RANKS[r],
   is_superadmin=False, company_id=uuid4())`): franchisee_admin → technician raises 403; area_manager →
   franchisee_admin does **not** raise (the documented reason `create_user` refuses by name);
   franchisee_admin → facility_admin and facility_admin → facility_operator pass; facility_admin →
   facility_admin raises.

`api/tests/unit/test_franchise_guards.py`
4. `is_franchise` True for the three roles, False for every other role.
5. `require_franchise_principal`: franchisee_admin with franchisee → returns; with `franchisee_id=None` →
   403 "not linked"; facility_admin, facility_operator, admin, vendor, technician → 403.
6. `require_facility_principal`: all three franchise roles with a franchisee → return; any franchise role
   without → 403; admin / national_head / vendor / technician → 403.
7. `require_staff_principal`: refuses the three franchise roles (and still refuses vendor, vendor_user,
   technician); admits admin..area_manager.

`api/tests/unit/test_franchise_scope.py`
8. `decide_managed_franchisees` — the full table in §4.2 for all roles × three purposes (parametrised).
9. Home's own franchisee admin (`principal_franchisee_id == home_id`) → `{home}` for every purpose.
10. franchisee_admin with `principal_franchisee_id=None` → `frozenset()`; unknown purpose → `ValueError`.
11. `decide_can_manage(None, x)` True; `decide_can_manage({a}, a)` True; `({a}, b)` False;
    `(frozenset(), a)` False.

`api/tests/unit/test_franchise_visibility_sql.py`
12. `technician_scope(select(TechnicianProfile).join(Membership, …), franchisee_admin_principal, None,
    Scope())` compiled with the postgresql dialect contains `technician_profiles.franchisee_id` in WHERE;
    for a facility principal it compiles to a `false` predicate; for an admin the WHERE is unchanged.

`api/tests/unit/test_ticket_ws_franchise.py`
13. A `_Visibility` with `franchise = True` → `hears_notification(None, None)` False,
    `hears_notification("500032", None, "payers")` False, `may_hear(<TicketChanged any>)` False.
    (Build `TicketChanged` with its dataclass constructor; read `features/tickets/ws.py` for the fields.)

`api/tests/unit/test_users_role_refusal.py`
14. `role_not_creatable_here`: `superadmin`, `"nope"` → "Invalid role"; `technician`, `vendor`,
    `vendor_user` → their existing messages; each franchise role → the franchise message; `admin`,
    `national_head`, `regional_head`, `area_manager` → None.

`api/tests/unit/test_rbac_manageable.py`
15. `_check_manageable_role`: franchisee_admin principal → 403 for any role; regional_head principal →
    `facility_operator` 403; national_head principal → `facility_operator` passes; admin → `area_manager`
    still passes (unchanged behaviour).

`api/tests/unit/test_migration_5d2a8c6e0b13.py` (importlib)
16. `revision`/`down_revision`; `ROLES` ranks equal `ROLE_RANKS`; `DEFAULTS` equals the index §3.4 table
    written literally in the test; every `DEFAULTS` key is in `FEATURES`; every parent appears earlier in
    `FEATURES`; `downgrade_blockers(0) == []`, `downgrade_blockers(2)` names "2 user(s)".

`adminWeb/src/hooks/useCompanyUsers.test.ts` (vitest, Task 00 harness)
17. `assignableRoles(catalogue, "admin")` contains `national_head … area_manager` and none of
    `technician`, `vendor`, `vendor_user`, `franchisee_admin`, `facility_admin`, `facility_operator`.

---

## 7. Acceptance criteria

Dev (`RelianceDB`) only; the owner migrates production.

1. **Round trip:** **Given** dev at `3b7e1f0a9c41`, **when** `upgrade head` → `downgrade 3b7e1f0a9c41` →
   `upgrade head`, **then** all exit 0 and these return the same before and after the trip:
   `SELECT count(*), md5(string_agg(key||':'||rank, ',' ORDER BY key)) FROM roles;`
   `SELECT count(*), md5(string_agg(key, ',' ORDER BY key)) FROM features;`
   `SELECT count(*) FROM role_feature_defaults;` — and the pre-existing rows' ids are unchanged
   (`SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM role_feature_defaults WHERE role NOT IN
   ('franchisee_admin','facility_admin','facility_operator')`).
2. **Then:**
   ```sql
   SELECT key, label, rank FROM roles WHERE rank >= 8 ORDER BY rank;  -- the three rows, ranks 8/9/10
   SELECT f.key, string_agg(d.role, ',' ORDER BY d.role)
   FROM features f JOIN role_feature_defaults d ON d.feature_id = f.id AND d.enabled
   WHERE f.key LIKE 'franchise%' OR f.key LIKE 'parts.%'
   GROUP BY f.key ORDER BY f.key;                                     -- exactly index §3.4
   SELECT count(*) FROM role_feature_defaults d JOIN features f ON f.id = d.feature_id
   WHERE d.role IN ('franchisee_admin','facility_admin','facility_operator')
     AND f.key NOT LIKE 'franchise.%' AND f.key <> 'parts.handle';    -- 0: no staff key leaks to them
   SELECT count(*) FROM role_feature_defaults d JOIN features f ON f.id = d.feature_id
   WHERE f.key = 'parts.handle' AND d.enabled
     AND d.role NOT IN ('franchisee_admin','facility_admin','facility_operator');   -- 0: no staff role handles parts (owner ruling 2026-10-15, R4)
   ```
3. `python -m app.scripts.audit_tenancy` exits 0; `python -m app.scripts.cleanup_db --check` exits 0.
4. **A dev franchise login** (delete it afterwards). With the dev API up (one listener on :8000):
   ```powershell
   ./.venv/Scripts/python.exe -c "from app.core.security import hash_password; print(hash_password('Demo@12345'))"
   ```
   ```sql
   INSERT INTO users (email, password_hash, full_name, role, is_active)
   VALUES ('fa.test@example.com', '<hash>', 'FA Test', 'franchisee_admin', true) RETURNING id;
   INSERT INTO memberships (user_id, company_id, franchisee_id, is_active)
   VALUES ('<user id>', '<company id>', (SELECT id FROM franchisees WHERE company_id = '<company id>' AND is_home), true);
   ```
   **When** they `POST /auth/login` then `GET /auth/me`, **then** `role = "franchisee_admin"`, `features`
   = the six franchise keys + `franchise.tickets`, `franchise.facility_users`, `parts.handle`, and
   `franchisee = {id, name, code: "HOME", kind: "internal", isHome: true}`, `scopeLabel` = the home's name.
5. **404 not 403 (tenancy and the franchise wall):** as that login, **when** `GET /tickets/<any ticket id of
   the company>` and `GET /tickets/<a ticket id of another company>` → both **404**. `GET /tickets` → empty
   page. `GET /notifications` → empty. The ticket websocket connects and receives nothing (raise a
   company-wide notification on dev and watch).
6. **Fails closed on staff screens:** as that login, `GET /credits`, `GET /settings/rules`,
   `GET /vendors`, `GET /search?search=a` → **403**.
7. **Switched-off franchisee:** `UPDATE franchisees SET is_active = false WHERE id = <a NON-home test
   franchisee the login points at>` (the home cannot be switched off — `ck_franchisees_home_is_permanent`;
   create a throwaway non-home row for this step) → every call, including `/auth/me`, returns 403 "This
   franchisee is no longer active".
8. **Users screen:** as the company Admin, `POST /users {role: "franchisee_admin", …}` → 400 "Franchise
   accounts are created on the Franchisees screen"; same for `facility_admin`, `facility_operator`; as an
   Area Manager too. `GET /users` does not list the test login; `GET /users/<its membership id>` → 404.
9. **Feature Access:** as the Admin, `GET /role-features?role=facility_operator` → 200; as a Regional
   Head holding `features.manage` by override → 403; as the franchise login (granted `features.manage` by
   override for the test) → 403.
10. **Technician roster:** grant the test login `technicians.view` by override; `GET /technicians` returns
    exactly the home's technicians (all of them, today) and `GET /technicians/<id>` of another company's
    technician → 404. Remove the override.
11. **Nothing changed for staff:** as Admin, NH, RH, AM the Tickets, Technicians, Notifications and
    Feature Access screens show what they showed before (same counts).
12. `pytest` green (16 api cases) and `npm test` in `adminWeb/` green; `npm run lint && npm run typecheck`
    in `adminWeb/`.
13. Clean up: `DELETE FROM memberships WHERE user_id = '<id>'; DELETE FROM users WHERE id = '<id>';` and any
    throwaway franchisee.

---

## 8. Out of scope and traps

- **Out of scope:** creating franchisees and franchise logins (Task 03, `app/core/franchise_logins.py`);
  franchise ticket visibility (Task 04); wiring `can_manage_technician` into endpoints, payer/UPI reviewer,
  audiences, the per-franchisee pool and the notification kind `technician_moved` (Tasks 03/05); the
  `/franchise` shell and landing (Task 09); facility users and parts (Task 12).
- **Never use rank to decide franchise authority over technicians** (§3.2). Never put a franchise role in
  `ALL_INDIA_ROLES` or `VENDOR_ROLES`.
- **Feature grants are overridable per company** (api/AGENTS.md hard rule 2): every franchise endpoint
  carries its `require_feature("franchise.…")` **and** `FranchisePrincipal`/`FacilityPrincipal`, for the
  reason `require_vendor_principal` exists.
- **Fail closed, then open on purpose.** Every branch added in §4.3 returns nothing for a franchise caller;
  the later tasks replace a specific branch. Grep `national_head`, `ALL_INDIA_ROLES`, `VENDOR_ROLES`,
  `is_vendor` before declaring this done (index §5.6) — the table in §4.3 is the result of that grep on
  `dev @ 6763026`; re-run it on your base.
- **`_visible` / `users_notified_by` / `ws.hears_notification` must stay in agreement** (coverage.py
  docstring). This task changes `_visible` and `ws` the same way (nothing) and leaves `users_notified_by`
  naturally excluding franchise roles; keep them in step when Task 05 adds audiences.
- **The ws `_Visibility` company-wide leak** (§4.3) is the one place a franchise caller would otherwise
  hear something today — do not skip it.
- **Migration:** reference data is inserted idempotently (`WHERE NOT EXISTS`); `users.role → roles.key`
  is RESTRICT, so the downgrade refuses in words first; delete children features before parents.
  Hand-written migration, round trip tested on dev, **prod migrated by the owner** before the API is
  published (index §4 gate b). Delete any autogenerated drops of the hand-written `lower()`/partial
  indexes (`uq_companies_gst_lower`, `uq_users_email_lower`, `uq_franchisees_company_name_lower`, …) if you
  ever autogenerate — this migration should contain none.
- **Do not change counts in prose.** api/AGENTS.md deliberately names no feature/role counts ("measure, do
  not do arithmetic"); prose updates are Task 16.
- **Release order trap:** franchise logins become creatable in Task 03/08, but the portal they land in is
  Task 09. Do not publish Task 08's console screen before Task 09, or a new franchisee admin signs in to a
  staff shell where every query is empty or 403.

# Task 03 — Franchisee management API

> Read [00-index.md](00-index.md) first. It owns every name used here. This task assumes Task 01
> (`franchisees`, `franchisee_pincodes`, the new `*_franchisee_id` columns, `app/core/franchise.py`) and
> Task 02 (the three franchise roles, the feature keys, `Principal.franchisee_id` / `is_franchise`,
> `app/core/franchise_scope.py`) exist **exactly** as the index names them.
>
> Layer: **api only**. Depends on 02. Task 04 (routing) and Task 08 (the console screen) build on it.
> The wire contract below is the one **Task 08 §4.1** consumes; where this document and Task 08 differ,
> §8 lists the difference and which side moves.

---

## 1. Goal and why

**Plain version.** A company Admin or National Head needs one API to say *"SkyFix Services is a
franchisee, it owns pincodes 500030 to 500040, and Meena signs in for it"*. Saving those pincodes is not
just a list edit: technicians who already work there, and tickets nobody has taken yet, have to follow
the pincodes to their new owner — and whoever saves must see exactly what will move **before** it moves.

**Worked example.** *Acme Appliances* has only its home franchisee, **Acme Appliances** (the home franchisee, code `HOME`), which owns every
pincode (F4). Ravi covers `500031, 500032`; Sita covers `500032, 500050`; ticket `ACM-INST-0412`
(pincode `500033`, `Slot Pending`, nobody assigned) and `ACM-INST-0398` (pincode `500034`, `Assigned`
to Ravi) are open.

1. The National Head creates **SkyFix Services** (`external`) with a first login for
   `meena@skyfix.example` → 201; Meena is emailed a temporary password. SkyFix owns nothing yet.
2. The console sends `PUT /franchisees/{skyfix}/pincodes?dryRun=true` with
   `{"pincodeRanges": "500030 – 500040"}` and the API answers, writing nothing:

| What | Result |
|---|---|
| Pincodes | 11 numbers in the range, 9 exist and are active in the master → `resolvedCount: 9`, `unknownCount: 2`, `pincodeRanges: "500030-500040"` |
| Ravi | whole coverage inside → **moves** to SkyFix |
| Sita | `500032` inside, `500050` not → **trimmed**: loses `500032`, stays with Acme (home) |
| `ACM-INST-0412` | open, unassigned, pincode inside → **re-stamped** to SkyFix |
| `ACM-INST-0398` | assigned → **unchanged** (keeps Ravi and Acme (home), F6) |

3. The NH applies: the same body with `dryRun=false` writes all of that in **one transaction**, writes a
   `franchisee_changed` event on `ACM-INST-0412` and rings one `technician_moved` bell.
4. A month later the NH shrinks SkyFix to `500030-500035`: `500036-500040` go back to Acme (home) with the
   same rules run the other way.

A second admin applying `500038-500045` to *Acme Secunderabad* at the same moment is refused with 409
`FRANCHISEE_PINCODE_TAKEN` naming `500038-500040 — SkyFix Services`, whichever of the two commits second.

---

## 2. Decisions implemented

| Index ID | How |
|---|---|
| F1 | `kind` ∈ `internal`/`external`; the home cannot be deactivated, cannot become `external`, has no pincode ranges → 409 `FRANCHISEE_HOME_IMMUTABLE`. |
| F2 | `app/core/pincode_ranges.py` parses ranges text and expands it against **active** master codes; only those are stored. |
| F3 | A wanted code another franchisee owns → listed in the dry run, 409 `FRANCHISEE_PINCODE_TAKEN` on apply. `uq_franchisee_pincodes_company_pincode` is the race backstop. |
| F4 | Home holds no `franchisee_pincodes` rows; its count is "active master codes nobody else owns". |
| F6 | Carve-out on add **and** on remove, previewed by `dryRun=true`, applied atomically. |
| F7, F9 | Only company Admin / National Head manage franchisees and franchisee-admin logins; RH and AM read. |
| F10 | A franchisee-admin login is `users.role = 'franchisee_admin'` with `memberships.franchisee_id` set. |
| §3.3 | `ticket_events.kind = 'franchisee_changed'`; `notifications.kind = 'technician_moved'` (≤ 24 chars); error codes `FRANCHISEE_PINCODE_TAKEN`, `FRANCHISEE_HOME_IMMUTABLE`, `FRANCHISEE_HAS_TECHNICIANS`, **`FRANCHISEE_LAST_ADMIN`** (owner ruling 2026-10-15). |
| F8 (R3) | **Owner ruling 2026-10-15:** the last **active** franchisee admin of a **NON-home** franchisee cannot be deactivated or removed — 409 `FRANCHISEE_LAST_ADMIN`; home is exempt (company Admin/NH act for home). There is no company-Admin/NH fallback for a non-home franchisee's UPI changes or redemptions (Task 05), so this refusal is what guarantees somebody can always approve and pay. **Deactivating the whole franchisee (route 7) is unaffected** — it suspends its admins through `franchise_logins.set_active` directly, not through route 11. |
| §3.4 | `franchisees.manage` (Admin, NH), `franchisees.view` (Admin, NH, RH, AM). |
| §3.7, §6 | `app/features/franchisees/{router,service,schemas}.py`, prefix `/franchisees`; pure `parse_pincode_ranges` / `expand` / `compress`; the shared login helper `app/core/franchise_logins.py` (Task 12 reuses it for facility users). |

---

## 3. Schema

**No new table and no revision of this task's own** — tables and columns are Task 01's, roles and keys
Task 02's.

⚠ **Two vocabulary changes this task needs that §3.6 gives to no migration** (reported to the index owner):

| Change | Why |
|---|---|
| `ticket_events` CHECK `kind` gains `'franchisee_changed'`; `models/ticket_event.py` `EVENT_KINDS` and the `CheckConstraint` string (~line 237) gain it | The CHECK names every kind; the carve-out's event INSERT fails without it. |
| `notifications` CHECK `kind` gains `'technician_moved'`; `models/notification.py` `NOTIFICATION_KINDS` gains it (with a `#:` comment like its neighbours) | The CHECK is generated from `NOTIFICATION_KINDS`. `technician_moved` is 16 chars — fits `String(24)`; **no column change**. |

**Ruled by the index owner:** both are in Task 01's migration `3b7e1f0a9c41` (see Task 01 §3.3a); Task 05 does not touch `notifications.kind`. Nothing here waits on `7c4f2e9a1d58`. Per
§3.3, the rewritten `ticket_events` CHECK lists **every** earlier kind; later migrations (Tasks 11, 12)
must keep `franchisee_changed` in theirs. Bare constraint names in both directions (`name="kind"`, hard
rule 6). The downgrade refuses while any row uses either value (count and raise — the `f4b28d1a67c3`
shape).

```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname IN ('ck_ticket_events_kind', 'ck_notifications_kind');   -- both list the new value
```

---

## 4. API / service changes

### 4.1 Files

| File | New / edit | What |
|---|---|---|
| `api/app/core/pincode_ranges.py` | **new, pure** | Parser, expander, compressor. Imports only the stdlib — never `app.core.database` (Task 00 §4.1). |
| `api/app/core/carve_out.py` | **new, pure** | `plan_carve_out`, `diff_codes`, `find_clashes`, `clash_lines`, `ticket_moves`. Same rule. |
| `api/app/core/company_code.py` | edit | add pure `unique_code(base, taken, *, max_len=8)`. |
| `api/app/core/franchise_logins.py` | **new** | Shared franchise-login creation (index §6). §4.6. |
| `api/app/core/franchise.py` | edit | add `lock_routing(db, company_id, *, exclusive)`. §4.5. |
| `api/app/core/errors.py` | edit | `AppError` gains optional `errors: list[str] | None`; the `StarletteHTTPException` handler uses `getattr(exc, "errors", None) or [detail]`. Existing raises are byte-for-byte unchanged. |
| `api/app/features/franchisees/__init__.py` | new | empty |
| `api/app/features/franchisees/schemas.py` | new | §4.4 |
| `api/app/features/franchisees/service.py` | new | §4.5 |
| `api/app/features/franchisees/router.py` | new | §4.3, `APIRouter(prefix="/franchisees", tags=["franchisees"])` |
| `api/app/api/router.py` | edit | import and `include_router(franchisees_router)` right after `vendor_users_router`, comment: "Who runs the technicians, and which pincodes each one routes." |
| `api/app/features/users/service.py` | edit | §4.7 |
| `api/app/models/ticket_event.py`, `api/app/models/notification.py` | edit | §3 |
| `api/app/features/tickets/service.py` | edit | `_EVENT_TITLES["franchisee_changed"] = "Moved to another franchisee"` (**PROPOSED**). |

### 4.2 Pure helpers

#### `app/core/pincode_ranges.py`

```python
PINCODE_RE = re.compile(r"[1-9][0-9]{5}")          # fullmatch; ASCII digits only
DASHES = "-–"                                  # hyphen and en dash — exactly Task 08 §4.1
MAX_TEXT_CHARS = 20_000
MAX_TOKENS = 500                                    # Task 08's client checks the same number
MAX_RANGE_SPAN = 100_000                            # b - a + 1 for one entry
MAX_CODES = 10_000                                  # after expansion, per franchisee

class PincodeRangeError(ValueError):
    """`str(err)` is the sentence for the person; `.tokens` the offending entries."""
    def __init__(self, message: str, tokens: list[str] | None = None) -> None: ...

def parse_pincode_ranges(text: str | None) -> list[tuple[int, int]]: ...
def expand(ranges: list[tuple[int, int]], existing: set[str]) -> set[str]: ...
def span(ranges: list[tuple[int, int]]) -> int: ...            # Σ (b − a + 1) over merged ranges
def empty_ranges(ranges: list[tuple[int, int]], existing: set[str]) -> list[tuple[int, int]]: ...
def compress(codes: Iterable[str], *, universe: Iterable[str] | None = None) -> str: ...
def format_range(a: int, b: int) -> str: ...                    # "500001" or "500001-500099"
```

**Grammar of `parse_pincode_ranges`** — exactly Task 08 §4.1 (the console checks the same rules locally),
in this order:

1. `None` or whitespace-only → `[]` (a franchisee may own nothing; applying `""` hands everything back).
2. `len(text) > MAX_TEXT_CHARS` → `PincodeRangeError("That list is too long — at most 20,000 characters.")`.
3. `unicodedata.normalize("NFKC", text)` — full-width digits pasted from a sheet become ASCII.
4. Split into entries on `re.split(r"[,;\r\n]+", text)` — **commas, semicolons and line breaks only**;
   strip each entry; drop empties. A space is **not** a separator: `"500001 500002"` is one invalid entry.
5. More than `MAX_TOKENS` entries → `"Too many entries — at most 500. Use wider ranges."`.
6. Inside an entry, a dash (`-` or `–`) with optional spaces around it is a range separator:
   `re.fullmatch(r"([0-9]+)\s*[-–]\s*([0-9]+)", entry)`. So `500001 - 500099` and `500001–500099` are
   both ranges; an em dash, a minus sign or any other character makes the entry invalid.
7. Each entry: `PINCODE_RE.fullmatch` → `(n, n)`; else a range whose two halves both match `PINCODE_RE`
   and `a ≤ b` → `(a, b)`; else invalid (`50001`, `0500001`, `050001`, `abc`, `5000O1`, `500001-`,
   `-500001`, `500001--500002`, `500001-500002-500003`, `500001 500002`, `500001—500099`).
8. A range with `a > b` is **refused**, not flipped (Task 08's copy: *"{token} runs backwards — put the
   smaller pincode first."*) — reported in the same error as step 9.
9. Any invalid or backwards entries → **one** error naming them, de-duplicated, in input order, at most ten
   then `and N more`:
   `Not a pincode or range: "50001", "abc". Use six digits that do not start with 0 (500001), or two joined by a dash (500001-500099). "500099-500001" runs backwards — put the smaller pincode first.`
   (each half only when it has entries). `.tokens` holds every offending entry.
10. An entry with `b - a + 1 > MAX_RANGE_SPAN` → `500000-600000 spans more than 100,000 numbers — split it.`
11. Sort and **merge** overlapping, adjacent and repeated ranges (`(1,5),(6,9)` → `(1,9)`) — never an error.

**`expand`** — every code in `existing` (active master codes) inside any range; non-six-digit strings in
`existing` ignored. Sort once, `bisect` per range (19,496 codes × 500 ranges stays well under 50 ms).
More than `MAX_CODES` → `PincodeRangeError("Those ranges cover 12,345 pincodes — one franchisee may own at most 10,000.")`.

**`span`** — numbers covered by the merged ranges; `unknownCount = span − resolvedCount`.

**`empty_ranges`** — the ranges that matched no code, so the preview can say so.

**`compress(codes, universe=None)`** — sorted, de-duplicated, runs as `"a-b"` (a run of two included),
singles as `"a"`, joined by `", "`. Empty → `""`.
- No `universe`: a run is consecutive integers.
- With `universe` (active master codes): a run continues across numbers the master does not hold and
  breaks only at a master code **not** in `codes`. This is what reads the stored set back the way it was
  typed — `500001-500099` stored as the 61 codes that exist compresses to `500001-500099`, not 40
  fragments. Codes absent from `universe` are still printed.

#### `app/core/carve_out.py`

```python
@dataclass(frozen=True)
class CarvePlan:
    moved: frozenset[uuid.UUID]                      # whole coverage inside → change franchisee
    trimmed: Mapping[uuid.UUID, frozenset[str]]      # id → the codes they LOSE

def plan_carve_out(codes: AbstractSet[str],
                   coverage: Mapping[uuid.UUID, AbstractSet[str]]) -> CarvePlan: ...
def diff_codes(current: AbstractSet[str], wanted: AbstractSet[str]) -> tuple[set[str], set[str]]: ...
    # (added, removed)
def find_clashes(wanted: AbstractSet[str], owners: Mapping[str, uuid.UUID],
                 target_id: uuid.UUID) -> dict[str, uuid.UUID]: ...
    # wanted codes whose owner row names a franchisee other than target_id
def clash_lines(clashes: Mapping[str, str], *, limit: int = 50) -> list[str]: ...
    # code → OWNER NAME; ["500032 — SkyFix Services", …] sorted by code, at most `limit`
def clash_summary(clashes: Mapping[str, str], *, universe: Iterable[str] | None = None,
                  limit: int = 5) -> str: ...
    # one sentence: groups by owner, compresses each group, owners by name, "and N more franchisees"
def ticket_moves(rows: Iterable[tuple[uuid.UUID, str, uuid.UUID]],
                 owner_after: Mapping[str, uuid.UUID]) -> list[tuple[uuid.UUID, uuid.UUID, uuid.UUID]]: ...
    # rows = (ticket_id, pincode, current franchisee) → (ticket_id, from, to) where pincode ∈ owner_after
    # and current ≠ owner_after[pincode]
```

`plan_carve_out` — one function for both directions, "codes going to franchisee T":
- `coverage` is the **full** coverage of each candidate (technician or live invite) — candidates are those
  NOT already in T covering ≥ 1 code in `codes`.
- `inside = cov ∩ codes`; empty `inside` or empty `cov` → not in the plan.
- `inside == cov` → **moved**. This is also F6's "would be left with zero coverage" case, so "keep at
  least one" needs no separate branch.
- otherwise → **trimmed**, losing `inside`; what remains is non-empty by construction.

`clash_summary` example: `{"500038"…"500040": "SkyFix Services", "500120": "Acme Secunderabad"}` →
`500120 (Acme Secunderabad); 500038-500040 (SkyFix Services)`.

#### `app/core/company_code.py` — addition

```python
def unique_code(base: str, taken: AbstractSet[str], *, max_len: int = 8) -> str:
    """normalise(base)[:max_len] if free; else suffixes 2…99, truncating the base so the result never
    exceeds max_len ("SFS" → "SFS2" … "SFS10"; "ABCDEFGH" → "ABCDEFG2"). Case-insensitive.
    ValueError after 99 attempts."""
```

Franchisee code = `unique_code(derive(name), codes already used in this company)` unless the request
supplies one. **Decision (writer):** an explicit `code` is accepted on create only (2–8 letters/digits,
starting with a letter — `company_code.validate`'s rule at `max_len` 8), uppercased, 409 if taken, never
editable afterwards ("stamped once", §3.1). **`HOME` is reserved** for the home franchisee in every company
(Task 01's `HOME_CODE`): an explicit `code` normalising to `HOME` is refused with 422
`HOME is reserved for the home franchisee — choose another code.`, and the derived path always passes
`taken | {HOME_CODE}` so `unique_code` can never produce it (e.g. a franchisee named "Home Mart Express"
derives `HME`, but a hand-typed `home` is refused). If Task 01 already put a code helper in `core/franchise.py`,
call it instead.

### 4.3 Endpoints

Every route carries a feature key, `Depends(require_staff_principal)` and a rank floor. Floors already
refuse franchise roles (ranks 8–10 sit below every staff floor); if Task 02 did not make
`require_staff_principal` refuse `FRANCHISE_ROLES`, add `or principal.is_franchise` to its condition here.

```python
CanView   = Annotated[Principal, Depends(require_feature("franchisees.view"))]
CanManage = Annotated[Principal, Depends(require_feature("franchisees.manage"))]
IsStaff        = Depends(require_staff_principal)
AreaManagerUp  = Depends(require_min_rank(AREA_MANAGER))
NationalHeadUp = Depends(require_min_rank(NATIONAL_HEAD))
```

| # | Method · path | Guard | Body / query | `data` | `message` |
|---|---|---|---|---|---|
| 1 | `GET /franchisees` | View · AM+ | `page, limit, search, kind ∈ {internal, external}, status ∈ {active, inactive}` (absent = all), `sortBy ∈ {name, code, createdAt}` (default name), `sortDir` | `FranchiseeOut[]` paginated; **home first** | default |
| 2 | `GET /franchisees/options` | View · AM+ | — | `FranchiseeOptionOut[]`, active **and** inactive, home first then name | default |
| 3 | `GET /franchisees/{franchiseeId}` | View · AM+ | — | `FranchiseeOut` | default |
| 4 | `POST /franchisees` | Manage · NH+ | `FranchiseeCreateRequest` (no pincodes) | `FranchiseeCreatedOut`, **201** | `Franchisee created` |
| 5 | `PUT /franchisees/{franchiseeId}` | Manage · NH+ | `FranchiseeUpdateRequest` | `FranchiseeOut` | `Franchisee updated` |
| 6 | `PUT /franchisees/{franchiseeId}/pincodes` | Manage · NH+ | `{ "pincodeRanges": "…" }`, `?dryRun=bool` (default false) | `PincodeChangeOut` | `Preview — nothing was saved` / `Pincodes saved` |
| 7 | `POST /franchisees/{franchiseeId}/deactivate` | Manage · NH+ | — | `FranchiseeOut` | `Franchisee deactivated` |
| 8 | `POST /franchisees/{franchiseeId}/activate` | Manage · NH+ | — | `FranchiseeOut` | `Franchisee activated` |
| 9 | `GET /franchisees/{franchiseeId}/admins` | View · AM+ | — | `FranchiseeAdminOut[]`, active first then name | default |
| 10 | `POST /franchisees/{franchiseeId}/admins` | Manage · NH+ | `FranchiseeAdminIn` | `FranchiseeAdminCreatedOut`, **201** | by `emailStatus` (below) |
| 11 | `POST /franchisees/{franchiseeId}/admins/{membershipId}/deactivate` | Manage · NH+ | — | `FranchiseeAdminOut` | `Admin deactivated` |
| 12 | `POST /franchisees/{franchiseeId}/admins/{membershipId}/activate` | Manage · NH+ | — | `FranchiseeAdminOut` | `Admin activated` |
| 13 | `POST /franchisees/{franchiseeId}/admins/{membershipId}/reissue-password` | Manage · NH+ | — | `FranchiseeAdminCreatedOut` | by `emailStatus` (below) |

Messages by `emailStatus` (the `users/router.py` `_CREATED_MESSAGE` / `_REISSUED_MESSAGE` shape):
created — `sent`: `Franchisee admin added — the temporary password has been emailed`; `skipped`:
`Franchisee admin added — they sign in with the password they already use`; `failed`:
`Franchisee admin added, but the password email did not go out`. Reissued — `sent`:
`A new temporary password has been emailed`; `failed`: `Password reset, but the email did not go out`.

Declare `/options` above `/{franchiseeId}`. `dryRun: Annotated[bool, Query()] = False`.
**Decision (writer), adopting Task 08 §4.1:** the admin list is `franchisees.view` — an Area Manager who
needs to ring SkyFix's admin may read the list; only managing it needs `franchisees.manage`.

### 4.4 Schemas (`app/features/franchisees/schemas.py`)

Requests extend `BaseModel`; responses `app.core.schemas.AppModel`. Reuse `app.core.phone.Phone` /
`OptionalPhone`, `EmailStr`, `app.core.schemas.EmailOutcome`. `max_length`s follow Task 01's columns.

```python
FranchiseeKind = Literal["internal", "external"]           # = app.models.franchisee.KINDS

class FranchiseeAdminIn(BaseModel):
    fullName: str = Field(min_length=2, max_length=255)
    email: EmailStr
    phone: Phone                                            # mandatory for every console user

class FranchiseeCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)         # stripped; unique per company on lower()
    code: str | None = Field(default=None, max_length=8)
    kind: FranchiseeKind = "external"
    contactName: str = Field(min_length=2, max_length=255)
    contactPhone: Phone
    contactEmail: EmailStr | None = None
    admin: FranchiseeAdminIn | None = None                  # optional first login (Task 08 may omit it)

class FranchiseeUpdateRequest(BaseModel):                   # omit a field to leave it alone
    name: str | None = Field(default=None, min_length=2, max_length=120)
    kind: FranchiseeKind | None = None
    contactName: str | None = Field(default=None, min_length=2, max_length=255)
    contactPhone: OptionalPhone = None
    contactEmail: EmailStr | None = None                    # model_fields_set: explicit null clears it

class PincodesRequest(BaseModel):
    pincodeRanges: str = Field(default="", max_length=20_000)
```

```python
class FranchiseeOut(AppModel):
    id: uuid.UUID
    code: str
    name: str
    kind: FranchiseeKind
    isHome: bool
    contactName: str | None
    contactPhone: str | None
    contactEmail: str | None
    isActive: bool
    #: compress(owned, universe=active master codes). "" for the home (catch-all) and for none.
    pincodeRanges: str
    #: Non-home: its rows. Home: active master codes no other franchisee owns.
    pincodeCount: int
    technicianCount: int        # profiles whose membership is not removed (suspended included)
    openInviteCount: int        # technician_invites in LIVE_INVITE_STATUSES
    adminCount: int             # active franchisee_admin memberships
    createdAt: datetime

class FranchiseeOptionOut(AppModel):
    id: uuid.UUID; name: str; code: str; kind: FranchiseeKind; isHome: bool; isActive: bool

class RangeSetOut(AppModel):
    count: int
    ranges: str                 # compress(codes, universe=…)

class PincodeClashOut(AppModel):
    pincode: str; franchiseeId: uuid.UUID; franchiseeName: str

class MovedTechnicianOut(AppModel):
    id: uuid.UUID; code: str; name: str | None
    fromFranchiseeId: uuid.UUID; fromFranchiseeName: str
    toFranchiseeId: uuid.UUID; toFranchiseeName: str
    pincodeCount: int

class TrimmedTechnicianOut(AppModel):
    id: uuid.UUID; code: str; name: str | None
    fromFranchiseeId: uuid.UUID; fromFranchiseeName: str
    losing: list[str]           # sorted
    keepingCount: int

class RestampedTicketOut(AppModel):
    id: uuid.UUID; code: str; pincode: str; fromFranchiseeName: str

class RestampedTicketsOut(AppModel):
    count: int
    sample: list[RestampedTicketOut]          # at most 20, by code

class InviteChangeOut(AppModel):
    id: uuid.UUID; phone: str
    change: Literal["moved", "trimmed"]
    losing: list[str]                         # empty when moved

class PincodeChangeOut(AppModel):
    dryRun: bool
    franchiseeId: uuid.UUID
    pincodeRanges: str                        # normalised: what will be / was stored
    resolvedCount: int                        # codes that exist and are active
    unknownCount: int                         # span(ranges) − resolvedCount
    emptyRanges: list[str]                    # entries that matched no code
    added: RangeSetOut
    removed: RangeSetOut                      # handed back to home
    clashes: list[PincodeClashOut]            # at most 50, by code — dry run only; apply → 409
    clashCount: int
    movedTechnicians: list[MovedTechnicianOut]
    trimmedTechnicians: list[TrimmedTechnicianOut]
    invitesChanged: list[InviteChangeOut]
    restampedTickets: RestampedTicketsOut
    assignedTicketsKept: int                  # held tickets in those codes — informative

class FranchiseeAdminOut(AppModel):
    membershipId: uuid.UUID; userId: uuid.UUID
    fullName: str | None; email: str | None; phone: str | None
    isActive: bool              # membership.is_active AND user.is_active
    lastLoginAt: datetime | None
    createdAt: datetime
    #: owner ruling 2026-10-15 (R3): True when `blocks_last_admin(...)` would refuse deactivating this admin
    #: (non-home franchisee, this admin active, no other active admin). Lets the console disable the
    #: Deactivate action and say why, instead of offering a button that answers 409. Always False on home.
    isLastActiveAdmin: bool

class FranchiseeAdminCreatedOut(FranchiseeAdminOut, EmailOutcome): ...

class FranchiseeCreatedOut(FranchiseeOut):
    admin: FranchiseeAdminCreatedOut | None
```

**`lastLoginAt` — Decision (writer):** there is no `users.last_login_at`. It is
`MAX(refresh_tokens.created_at)` for that user, which a sign-in and every refresh write — so it is "last
active", not strictly "last sign-in", and null means never. The column is real data; Task 08's header
"Last sign-in" should read "Last active" (flagged).

**Envelope examples.** Dry run with a clash (200 — the preview lists clashes and the console blocks Apply):

```json
{
  "success": true, "statusCode": 200, "message": "Preview — nothing was saved",
  "timestamp": "2026-10-15T09:12:03.120Z", "errors": [],
  "data": {
    "dryRun": true, "franchiseeId": "5b1c…", "pincodeRanges": "500030-500040",
    "resolvedCount": 9, "unknownCount": 2, "emptyRanges": [],
    "added": {"count": 8, "ranges": "500030-500037"}, "removed": {"count": 0, "ranges": ""},
    "clashes": [{"pincode": "500038", "franchiseeId": "…", "franchiseeName": "Acme Secunderabad"}],
    "clashCount": 1,
    "movedTechnicians": [{"id": "…", "code": "ACM-TECH-0007", "name": "Ravi Kumar",
      "fromFranchiseeId": "…", "fromFranchiseeName": "Acme (home)",
      "toFranchiseeId": "5b1c…", "toFranchiseeName": "SkyFix Services", "pincodeCount": 2}],
    "trimmedTechnicians": [{"id": "…", "code": "ACM-TECH-0011", "name": "Sita Rao",
      "fromFranchiseeId": "…", "fromFranchiseeName": "Acme (home)", "losing": ["500032"], "keepingCount": 1}],
    "invitesChanged": [],
    "restampedTickets": {"count": 1, "sample": [{"id": "…", "code": "ACM-INST-0412",
      "pincode": "500033", "fromFranchiseeName": "Acme (home)"}]},
    "assignedTicketsKept": 1
  }
}
```

The plan in a preview with clashes is computed over `wanted − clashing codes`, so the console can show
what the rest would do; `added` likewise excludes them.

Apply with a clash (409):

```json
{
  "success": false, "statusCode": 409, "code": "FRANCHISEE_PINCODE_TAKEN",
  "message": "Already owned by another franchisee: 500038 (Acme Secunderabad). Remove them, or take them off that franchisee first.",
  "errors": ["500038 — Acme Secunderabad"],
  "timestamp": "…", "data": null
}
```

### 4.5 Service (`app/features/franchisees/service.py`)

Module docstring: company-scoped, 404-not-403, one transaction per write, the routing lock, and that it
builds `TicketEvent` itself because slices never import each other (as `jobs/service._event` does).

#### Existing helpers reused

| Need | Reuse |
|---|---|
| The company's home | `app.core.franchise.home_franchisee_id` (Task 01) |
| Logins | `app.core.franchise_logins` (§4.6, new) |
| Bell + realtime | `app.core.notifications.notify`; `app.core.realtime.publish_notification`, `publish_ticket_changed`, `publish_pool_changed`, `publish_technician_changed` |
| Session kill | `app.core.sessions.revoke_refresh_tokens` |
| Errors | `app.core.errors.AppError` (with the new `errors=`) |
| Envelope / list params | `app.core.schemas.envelope`, `paginated`, `ListParams`, `list_params`, `canonical_filter` |
| Vocabulary | `app.core.tickets.TERMINAL_STATUSES`; `app.models.technician.LIVE_INVITE_STATUSES`; `app.models.role.FRANCHISEE_ADMIN`, `FRANCHISE_ROLES` (Task 02) |

#### New helper in `app/core/franchise.py`

```python
async def lock_routing(db: AsyncSession, company_id: uuid.UUID, *, exclusive: bool) -> None:
    """Serialise changes to WHO OWNS a pincode against everything that READS ownership to route.

    Exclusive: this task's pincode writes (apply pincodes, deactivate).
    Shared:    Task 04's readers — intake stamping, technician/invite coverage checks, release re-stamp.
    pg_advisory_xact_lock[_shared](hashtextextended('franchise-routing:' || company_id, 0)),
    held to the end of the transaction. Deliberately a different key from core.credits.lock.
    """
```

**Why a lock as well as the UNIQUE:** the UNIQUE stops two franchisees owning one code; it does not stop
a ticket for `500033` being raised in the instant between the carve-out's re-stamp and its commit, which
would read the old owner and be stamped Acme (home) after SkyFix took the code. Task 04 takes the shared side
before reading ownership, waits for the carve-out, and reads the new owner.

#### Functions

```python
async def _load(db, company_id, franchisee_id) -> Franchisee
    # id, company_id, deleted_at IS NULL; else 404 "Franchisee not found". Inactive rows load.
async def list_franchisees(db, principal, params, *, kind, status) -> tuple[list[FranchiseeOut], int]
async def list_options(db, principal) -> list[FranchiseeOptionOut]
async def get_franchisee(db, principal, franchisee_id) -> FranchiseeOut
async def create_franchisee(db, principal, body) -> FranchiseeCreatedOut
async def update_franchisee(db, principal, franchisee_id, body) -> FranchiseeOut
async def set_pincodes(db, principal, franchisee_id, body, *, dry_run) -> PincodeChangeOut
async def deactivate(db, principal, franchisee_id) -> FranchiseeOut
async def activate(db, principal, franchisee_id) -> FranchiseeOut
async def list_admins(db, principal, franchisee_id) -> list[FranchiseeAdminOut]
async def add_admin(db, principal, franchisee_id, body) -> FranchiseeAdminCreatedOut
async def set_admin_active(db, principal, franchisee_id, membership_id, *, active) -> FranchiseeAdminOut
async def reissue_admin_password(db, principal, franchisee_id, membership_id) -> FranchiseeAdminCreatedOut

# internals
async def _hydrate(db, company_id, rows) -> list[FranchiseeOut]
async def _active_universe(db) -> list[str]                 # SELECT code FROM pincodes WHERE is_active, sorted
async def _owners(db, company_id) -> dict[str, uuid.UUID]    # every franchisee_pincodes row of the company
async def _plan(db, company_id, *, this, home_id, added, removed) -> _Plan
async def _apply(db, principal, plan, *, this, home_id) -> None
async def _assert_name_free(db, company_id, name, *, exclude_id=None) -> None
```

#### `list_franchisees` / `_hydrate`

- `select(Franchisee).where(company_id = principal.company_id, deleted_at IS NULL)`; `kind` and
  `status` through `canonical_filter` (an unknown value → empty page, never 422 — a stale bookmark).
- `search`: `lower(name) LIKE` or `lower(code) LIKE`.
- Order: `is_home DESC`, then the sort column, then `id`.
- Count with `select(func.count()).select_from(stmt.order_by(None).subquery())`.
- `_hydrate` per page, batched, no N+1:
  1. technicians: `SELECT tp.franchisee_id, count(*) FROM technician_profiles tp JOIN memberships m ON m.id = tp.membership_id WHERE tp.company_id = :c AND m.deleted_at IS NULL AND tp.franchisee_id = ANY(:ids) GROUP BY 1`;
  2. open invites: `technician_invites` `status IN LIVE_INVITE_STATUSES`, grouped;
  3. admins: memberships ⋈ users, `role = 'franchisee_admin'`, `memberships.is_active`, not deleted, grouped;
  4. owned codes of the non-home rows: one `SELECT franchisee_id, pincode FROM franchisee_pincodes WHERE company_id = :c AND franchisee_id = ANY(:ids)`;
  5. home count: `SELECT count(*) FROM pincodes p WHERE p.is_active AND NOT EXISTS (SELECT 1 FROM franchisee_pincodes fp WHERE fp.company_id = :c AND fp.pincode = p.code)`;
  6. `pincodeRanges` for non-home = `compress(owned, universe=_active_universe())`, the universe loaded
     **once per request** and only when the page holds a non-home row.

#### `create_franchisee` — one transaction, then mail

**Decision (writer), adopting Task 08:** create takes **no pincodes**. Pincodes are always
`PUT …/pincodes`, so there is one carve-out path to test and every dry run has a franchisee id to diff
against. A franchisee nobody gives pincodes owns nothing and is offered nothing — which is true.

1. `name = body.name.strip()`; `_assert_name_free` → 409 `A franchisee called {name} already exists`.
2. Code (§4.2).
3. Insert `Franchisee(company_id, name, code, kind, is_home=False, contact_*, is_active=True, created_by)`; `flush()` (hard rule 10).
4. **Task 10 hook** comment: `# Task 10: stamp franchisee_travel_rules for both technician types (TRAVEL_DEFAULTS).`
5. `body.admin` → `franchise_logins.create_login(db, company_id=…, franchisee_id=row.id, role=FRANCHISEE_ADMIN, …)` (all identity refusals happen here, before commit, so a refused email leaves no franchisee).
6. `commit()`; then `franchise_logins.mail_password(...)` for a new identity.
7. 201 `FranchiseeCreatedOut(admin=… | None)`.

#### `set_pincodes` — the carve-out (F6)

1. `row = _load(...)`. Home → `AppError(409, "FRANCHISEE_HOME_IMMUTABLE", "{name} is the home franchisee. It owns every pincode no other franchisee owns, so it has no ranges to edit.")`.
   Inactive → `HTTPException(409, "Activate {name} before giving it pincodes.")`.
2. `ranges = parse_pincode_ranges(body.pincodeRanges)`; `universe = _active_universe()`;
   `wanted = expand(ranges, set(universe))`. `PincodeRangeError` → `HTTPException(422, str(err))` (Task 08 §4.1: bad grammar is 422 naming the token).
3. **Apply only:** `await lock_routing(db, company_id, exclusive=True)` before reading owners. A dry run
   takes no lock — previews must never queue behind saves.
4. `owners = _owners()`; `current = {c for c, f in owners.items() if f == row.id}`;
   `clashes = find_clashes(wanted, owners, row.id)`.
   - Apply with clashes → `AppError(409, "FRANCHISEE_PINCODE_TAKEN", "Already owned by another franchisee: " + clash_summary(...) + ". Remove them, or take them off that franchisee first.", errors=clash_lines(...))`.
   - Dry run with clashes → continue with `wanted − clashes.keys()` and report them.
5. `added, removed = diff_codes(current, effective_wanted)`.
6. `plan = _plan(...)`.
7. Dry run → build `PincodeChangeOut(dryRun=True)`, `await db.rollback()` (ends the read transaction), return.
8. No-op (nothing added or removed) → return the out with zeros, write nothing.
9. `_apply(...)`; `commit()`; return `PincodeChangeOut(dryRun=False)`.

#### `_plan` — reads only

Two passes, each "codes going to T":

| Pass | Codes | Target T | Candidates |
|---|---|---|---|
| add | `added` | this franchisee | technicians / live invites with `franchisee_id <> this` covering ≥ 1 added code |
| remove | `removed` | home | technicians / live invites with `franchisee_id = this` covering ≥ 1 removed code |

```sql
-- technician candidates (swap the franchisee test for the remove pass)
SELECT DISTINCT tp.id FROM technician_profiles tp
JOIN memberships m ON m.id = tp.membership_id AND m.deleted_at IS NULL
JOIN technician_pincodes p ON p.technician_id = tp.id AND p.company_id = tp.company_id
WHERE tp.company_id = :c AND p.pincode = ANY(:codes) AND tp.franchisee_id <> :this;
-- their FULL coverage
SELECT technician_id, pincode FROM technician_pincodes WHERE company_id = :c AND technician_id = ANY(:ids);
```

Live invites the same over `technician_invites` (`status IN LIVE_INVITE_STATUSES`) and
`technician_invite_pincodes`. **Decision (writer):** invites follow the technicians' rules though F6 names
only technicians — an invite left at the old franchisee would make Task 04's registration check refuse
the person at the moment they finally register, a dead end they cannot fix.

Tickets:

```sql
SELECT t.id, t.code, t.pincode, t.franchisee_id FROM tickets t
WHERE t.company_id = :c AND t.deleted_at IS NULL AND t.technician_id IS NULL
  AND t.status IN ('New', 'Slot Pending', 'Escalated') AND t.pincode = ANY(:added_and_removed);
```

`owner_after = {c: this for c in added} | {c: home for c in removed}`; `ticket_moves(rows, owner_after)`.

⚠ **Decision (writer): `Escalated` with no technician is re-stamped too**, although F6 lists only `New`
and `Slot Pending`. Such a ticket waits in the escalation queue for a manager to assign somebody, and
after the carve-out only the new owner's technicians cover its pincode; stamped with the old franchisee,
Task 04's assign guard would find nobody. All three are "open and unassigned", which is what F6 means.
Reported to the index owner.

`assignedTicketsKept` = non-terminal tickets in those codes **with** a technician.

#### `_apply` — writes, in this order, in the caller's transaction

1. `DELETE FROM franchisee_pincodes WHERE company_id = :c AND franchisee_id = :this AND pincode = ANY(:removed)`.
2. Insert `added` with one `pg_insert(FranchiseePincode).values([...])`, then `flush()` inside
   `try/except IntegrityError` → `rollback()`, re-read `_owners()`, recompute, raise the same 409
   `FRANCHISEE_PINCODE_TAKEN` (if the re-read finds none: `Another change to these pincodes was saved at the same moment. Reload and try again.`).
   The global handler's code-less "That value is already taken" must never surface for this case.
3. Moved technicians: `UPDATE technician_profiles SET franchisee_id = :t, updated_by = :u WHERE company_id = :c AND id = ANY(:moved)` (one per target).
4. Trimmed technicians: per technician `DELETE FROM technician_pincodes WHERE company_id = :c AND technician_id = :id AND pincode = ANY(:losing)`.
5. Invites: steps 3–4 on `technician_invites.franchisee_id` and `technician_invite_pincodes`.
6. Tickets, one guarded UPDATE per target —
   `UPDATE tickets SET franchisee_id = :to WHERE company_id = :c AND id = ANY(:ids) AND technician_id IS NULL AND status IN ('New','Slot Pending','Escalated') RETURNING id, code, pincode, node_path_ids`.
   Only RETURNED rows get events and frames — a ticket accepted between the read and this write keeps its
   franchisee, which is exactly F6's "assigned keep theirs".
7. One `TicketEvent` per returned ticket, same transaction (§5.4):
   `kind="franchisee_changed", actor_kind="staff", actor_label=principal.user.full_name or "—",
   note=f"{from_name} → {to_name} · pincode {pincode} reassigned"` (**PROPOSED**),
   `from_status=None, to_status=None, created_by=principal.user_id`. `db.add_all`.
8. Bell when the pass moved or trimmed anybody — one row per such pass (≤ 2 per save):
   `notify(kind="technician_moved", title=…, detail=…, to=f"/franchisees/{target_id}", pincode=None)` +
   `publish_notification(..., pincode=None, notification_id=raised.id)`. **PROPOSED** copy —
   title `Pincodes reassigned to {TargetName}`; detail
   `{m} technician(s) moved · {t} lost pincodes · {k} open ticket(s) re-routed`.
   Company-wide (`pincode=None`) reaches every staff reader, the right audience while only staff exist.
   **Task 05 hook:** with `notifications.franchisee_id` and the `franchisee_admin` audience, Task 05 adds a
   row per affected non-home franchisee for its admins (Task 08's confirm copy promises they are told).
9. Realtime, inside the transaction (fires on commit):
   - `publish_technician_changed` per moved/trimmed technician, capped at 50;
   - `publish_pool_changed` once per distinct `(pincode, tuple(node_path_ids), franchisee)` for **both** the
     old and new franchisee of each re-stamped ticket (pass `franchisee_id=` once Task 04 has added it);
   - `publish_ticket_changed` per re-stamped ticket, capped at 25 (the importer's cap and reason).
10. No technician push. **Decision (writer):** a push needs a five-language `push_text.py` key whose copy is
    not signed off; the app's coverage list refreshes on the next profile read.

#### `update_franchisee`

`_load`; name → `_assert_name_free(exclude_id)`; home + `kind="external"` → 409
`FRANCHISEE_HOME_IMMUTABLE` ("The home franchisee is always internal."); contact fields via
`model_fields_set`; `updated_by`; commit. Renaming the home is allowed (F1 forbids delete and external only).

#### `deactivate` / `activate`

`deactivate`:
1. `_load`; home → 409 `FRANCHISEE_HOME_IMMUTABLE` ("… cannot be deactivated"). Already inactive → return as is.
2. Technicians (membership not removed) or live invites → `AppError(409, "FRANCHISEE_HAS_TECHNICIANS", "{name} still has {n} technician(s) and {i} pending invite(s). Clear its pincodes to hand them back to {home}, then deactivate it.")` (drop the zero half).
3. Open redemptions stamped with it (`redemptions.franchisee_id = :this AND confirmed_at IS NULL AND declined_at IS NULL`) → `HTTPException(409, "{name} has {n} redemption(s) still waiting to be paid or confirmed. Settle them first.")` — its admins are about to lose access and nobody else pays a non-home franchisee's technicians (F8).
4. `lock_routing(exclusive=True)`; release every owned code through the `_plan`/`_apply` path with
   wanted = ∅ (technicians are zero, so it re-stamps tickets only).
5. `is_active = False`; every franchise-role membership with `franchisee_id = this` →
   `franchise_logins.set_active(..., active=False)` (revokes sessions).
6. Commit.

`activate`: `_load`; `is_active = True`; does **not** re-enable admins (each via route 12) or restore
pincodes (they were released).

**Decision (writer): no DELETE for a franchisee.** It carries NOT NULL history (`ledger_entries`,
`redemptions`, `tickets`), and deactivation already stops it routing anything.

#### Admin routes (9–13)

Each first `_load`s the franchisee (404 across companies), then loads the membership through
`franchise_logins.login_base(company_id, franchisee_id, roles={FRANCHISEE_ADMIN})` — a membership of
**another** franchisee in the same company is 404, never 403.

- `add_admin`: franchisee inactive → 409 `Activate {name} first.`; `create_login`; commit; `mail_password`.
- `set_admin_active`: **(owner ruling 2026-10-15, R3)** when `active = False` and the franchisee is **not home**,
  first `SELECT … FROM franchisees … FOR UPDATE` on the franchisee row (two admins deactivated by two people at
  once would otherwise each see the other still active and both pass), then `n = active_admin_count(...)` and
  `if blocks_last_admin(is_home=f.is_home, target_is_active=<this admin's membership AND user active>,
  active_admin_count=n): raise AppError(409, "FRANCHISEE_LAST_ADMIN", ...)`. Otherwise `franchise_logins.set_active`;
  commit. Reactivating (`active = True`) is never refused. The refusal message (**PROPOSED**): *"{admin} is
  {franchisee}'s only active admin. Add another admin first — without one, nobody can approve its technicians'
  UPI changes or pay their redemptions."* The home franchisee is exempt: company Admin/NH act for it (F8).
- `reissue_admin_password`: `franchise_logins.reissue_password`; commit; `mail_password`.

~~Removing or deactivating the **last** admin is allowed.~~ **Reversed by the owner (2026-10-15, R3):** deactivating
the last active admin of a **non-home** franchisee is refused with 409 `FRANCHISEE_LAST_ADMIN`; the home
franchisee is exempt. (There is no admin DELETE route — "remove" and "deactivate" are the one route 11 — and
`/users/{id}` is 404 for franchise roles, §4.7, so no second door exists.) An admin who left the business is
handled by **adding the replacement first**, then deactivating. Facility users are Task 12.

### 4.6 `app/core/franchise_logins.py` — shared login creation

In core because Task 12's portal slice creates facility users the same way and slices may not import
each other (index §6). It **adds and flushes, never commits**; the caller commits, then mails.

```python
@dataclass(frozen=True)
class CreatedLogin:
    user: User
    membership: Membership
    temporary_password: str | None          # None = an existing identity was reused

def login_base(company_id: uuid.UUID, franchisee_id: uuid.UUID, *, roles: AbstractSet[str]) -> Select:
    """select(Membership, User) for live memberships of these roles in this franchisee.
    WHERE memberships.company_id, memberships.franchisee_id, memberships.deleted_at IS NULL,
    users.deleted_at IS NULL, users.role IN roles."""

async def create_login(db, *, company_id, franchisee_id, role: str, full_name: str,
                       email: str, phone: str, actor_id: uuid.UUID) -> CreatedLogin:
    """`role` must be in FRANCHISE_ROLES (ValueError otherwise — a programming error).
    Identity, by lower(email) among non-deleted users:
      * none → new User(email, password_hash=hash_password(tmp), full_name, phone, role,
        is_active=True, created_by=actor_id), flush;
      * exists with a DIFFERENT role → 409 "{email} already signs in as {Role}. An account cannot be
        both — use a different address." (users.role is immutable);
      * exists with this role AND a live membership in this company (any franchisee) → 409
        "{email} already has an account here";
      * exists with this role, member elsewhere only → reused, no password minted.
    Then Membership(user_id, company_id, franchisee_id, is_active=True, created_by=actor_id), flush."""

async def reissue_password(db, *, user: User, actor_id: uuid.UUID) -> str:
    """400 when the user has no email. Mints, hashes, sets updated_by, revoke_refresh_tokens."""

async def set_active(db, *, membership: Membership, user: User, active: bool,
                     actor_id: uuid.UUID) -> None:
    """membership.is_active = active; on False also revoke_refresh_tokens(user.id)."""

async def mail_password(db, *, company_id, user, temporary_password: str | None) -> dict[str, object]:
    """EmailOutcome fields. None → skipped. Else send_temporary_password(to, full_name,
    company_name=brand.company_name(...), role_label=ROLE_LABELS[user.role], ...);
    temporaryPassword returned ONLY when the send failed. Never raises. Call AFTER commit."""

def blocks_last_admin(*, is_home: bool, target_is_active: bool, active_admin_count: int) -> bool:
    """PURE — owner ruling 2026-10-15 (R3). True when deactivating THIS admin must be refused:
    the franchisee is not home, the target is currently active, and the franchisee has no
    OTHER active admin (`active_admin_count <= 1`, the target included in the count).
    Home → False always; an already-inactive target → False (nothing is being lost)."""

async def active_admin_count(db, *, company_id, franchisee_id) -> int:
    """Live (not deleted) franchisee_admin memberships of this franchisee with
    memberships.is_active AND users.is_active — the same `login_base` filter."""

async def last_active(db, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, datetime]:
    """MAX(refresh_tokens.created_at) per user — FranchiseeAdminOut.lastLoginAt."""
```

`mail_password` is the fourth copy of the `_mail_password` in `users`, `vendors`, `vendor_users`.
**Decision (writer):** those three stay as they are in this task; folding them onto this function is a
separate refactor touching three slices.

### 4.7 Users & roles never make or touch franchise accounts

**Decision (writer):** franchise roles are created only through `/franchisees/{id}/admins` (and Task 12's
facility endpoints) — the vendor precedent. A franchise account needs a `memberships.franchisee_id` that
`/users` has no field for, and rank cannot stop it: franchise roles rank 8–10, below every staff role, so
`ensure_below_rank` would let an Area Manager create, suspend or delete SkyFix's admin from a screen that
never says what SkyFix is. In `app/features/users/service.py` (verify first — Task 02 may have done it):

1. `create_user`: after the vendor refusal, `if body.role in FRANCHISE_ROLES: raise HTTPException(400, "Franchisee accounts are created on the Franchisees screen")`.
2. `list_users`: `User.role.not_in([TECHNICIAN, *VENDOR_ROLES, *FRANCHISE_ROLES])`.
3. `reissue_password`: the existing `if user.role == TECHNICIAN or user.role in VENDOR_ROLES` refusal
   (400 `This account does not sign in with a password here`) gains `or user.role in FRANCHISE_ROLES` —
   their reissue is route 13.
4. `_load_membership`: add `User.role.not_in(FRANCHISE_ROLES)` → `GET/PUT/DELETE /users/{id}` are 404 for
   them (belt and braces for 3, and it stops an edit or delete from Users & roles).

### 4.8 Errors

| Status · code | When |
|---|---|
| 422 (no code) | ranges unparseable / backwards / too long / too many entries / too many codes — names the entries |
| 404 | franchisee or admin membership outside this company / this franchisee |
| 409 `FRANCHISEE_PINCODE_TAKEN` | apply with a code another franchisee owns (pre-check or UNIQUE race); `errors[]` one line per code |
| 409 `FRANCHISEE_HOME_IMMUTABLE` | home: set pincodes, deactivate, kind → external |
| 409 `FRANCHISEE_HAS_TECHNICIANS` | deactivate with technicians or live invites |
| 409 `FRANCHISEE_LAST_ADMIN` | **(owner ruling 2026-10-15)** deactivating the only active admin of a non-home franchisee (route 11); never on home, never on route 7 |
| 409 (no code) | duplicate name / code, email identity clash, inactive franchisee, open redemptions |
| 403 | missing feature, below the floor, franchise / vendor / technician principal |

### 4.9 Transactions and events

| Operation | One transaction holding | Events / bells |
|---|---|---|
| create | franchisee (+ Task 10 travel rules) + optional admin login; email after commit | none |
| apply pincodes | routing lock + pincode rows + moves + trims + invites + re-stamps | `franchisee_changed` per re-stamped ticket; `technician_moved` per pass that moved/trimmed |
| deactivate | routing lock + release + re-stamps + admins suspended | `franchisee_changed` per re-stamped ticket |
| admin add / reissue | login rows; email after commit | none |
| dry run | read-only, no lock, rolled back | none |

---

## 5. Client changes

**None — Task 08** builds the screen against §4. The console Timeline already falls back to the `created`
icon for an unknown kind (`adminWeb/src/components/tickets/Timeline.tsx`, `EVENT[e.kind] ?? EVENT.created`),
and `components/notifications/kinds.ts` to `FALLBACK`, so `franchisee_changed` and `technician_moved` render
before Task 08 styles them.

**PROPOSED copy introduced here (X2):** timeline title `Moved to another franchisee`; event note
`{from} → {to} · pincode {code} reassigned`; bell title/detail (§4.5 `_apply` 8); every refusal sentence
in §4.2, §4.5, §4.6; the route messages in §4.3.

---

## 6. Unit tests (pure — no database, X1)

### `api/tests/unit/test_pincode_ranges.py`

`parse_pincode_ranges`:
1. `""`, `"   "`, `None` → `[]`.
2. `"500001"` → `[(500001, 500001)]`; `"500001-500099"` → `[(500001, 500099)]`.
3. `"500001 - 500099"`, `"500001–500099"` (U+2013), `"500001 – 500099"` → `[(500001, 500099)]`; the same with U+2014 or U+2212 → invalid.
4. Reversed `"500099-500001"` → raises; the message says it runs backwards; `.tokens == ["500099-500001"]`.
5. `"500001,500003;500005\n500007\r\n500009"` → five singles; `" 500001 ,\n 500002 "` → two (surrounding whitespace ignored); `"500001 500002"` → raises (a space is not a separator).
6. `"500001,,, 500002"` → merged `[(500001, 500002)]`.
7. Overlap `"500001-500010, 500005-500020"` → `[(500001, 500020)]`; adjacent `"500001-500005, 500006-500009"` → `[(500001, 500009)]`; duplicates collapse.
8. Full-width `"５００００１"` → `[(500001, 500001)]`; Devanagari `"५००००१"` → invalid.
9. Each invalid entry raises and is named: `"50001"`, `"5000001"`, `"050001"`, `"abc"`, `"5000O1"`, `"500001-"`, `"-500001"`, `"500001--500002"`, `"500001-500002-500003"`.
10. Several invalid → one error; `.tokens` all of them in input order, de-duplicated; message shows ten then `and N more`.
11. Valid mixed with invalid → raises (nothing partial).
12. Span: `"500000-599999"` passes; `"500000-600000"` raises naming it.
13. 500 entries pass, 501 raise; `MAX_TEXT_CHARS + 1` raises.

`expand` / `span` / `empty_ranges`:
14. Only codes present in `existing` returned; a single absent code → `set()`; disjoint ranges → union.
15. Junk in `existing` (`"ABC123"`, `"12345"`) ignored.
16. More than `MAX_CODES` → raises.
17. `span([(500001, 500099), (500120, 500120)]) == 100`.
18. `empty_ranges` returns exactly the ranges with no match.

`compress`:
19. `[]` → `""`; `["500003","500001","500002"]` → `"500001-500003"`; `["500001","500003"]` → `"500001, 500003"`; a pair → `"500001-500002"`; duplicates ignored.
20. Universe `{500001,500002,500004}`, codes the same → `"500001-500004"`.
21. Universe `{500001…500004}`, codes `{500001,500002,500004}` → `"500001-500002, 500004"`.
22. A code outside the universe is still printed.
23. Round trip over a fixed universe U: `expand(parse(compress(expand(r, U), universe=U)), U) == expand(r, U)` for a table of ranges.

### `api/tests/unit/test_carve_out.py`

1. Coverage entirely inside → moved. 2. Partly inside → trimmed with exactly the inside codes.
3. Disjoint → absent. 4. Empty coverage → absent. 5. Empty `codes` → empty plan.
6. Five mixed technicians → correct partition; `moved ∩ trimmed.keys() == ∅`.
7. Property over random inputs: every trimmed technician keeps ≥ 1 code.
8. `diff_codes`: added/removed/no-op; `wanted = ∅` → everything removed.
9. `find_clashes`: codes owned by the target → none; unowned → none; owned by another → included.
10. `clash_lines`: sorted by code, `"500032 — SkyFix Services"`, cut at `limit`.
11. `clash_summary`: grouped, compressed, owners by name, `and N more franchisees` past `limit`.
12. `ticket_moves`: moves a ticket whose owner differs; skips one already right; skips a pincode not in `owner_after`.

### `api/tests/unit/test_franchise_admins.py` — `blocks_last_admin` (owner ruling 2026-10-15, R3; pure, no database)

1. Non-home, target active, `active_admin_count = 1` → **True** (refuse).
2. Non-home, target active, count 2 → False; count 3 → False.
3. **Home**, target active, count 1 → False (home is exempt); home with count 0 → False.
4. Non-home, target **already inactive**, count 1 (somebody else is the one active admin) → False; count 0 → False.
5. Non-home, target active, count 0 (inconsistent input) → True (fail closed).
6. Table over `(is_home, target_is_active, count ∈ 0..3)` equals `not is_home and target_is_active and count <= 1`.

### `api/tests/unit/test_company_code.py` (extend if it exists)

`unique_code`: free base returned; `SFS` taken → `SFS2`; `SFS`…`SFS9` taken → `SFS10`; 8-char base
taken → `ABCDEFG2`; case-insensitive (`sfs` taken blocks `SFS`).

---

## 7. Acceptance criteria

Against **RelianceDB** (dev) with the local API (`cd api && ./.venv/Scripts/python.exe run.py`). Writes
only in **GreenTech Demo Services** (QA's "Testing Company" is read-only). Logins `admin.demo@`,
`nh.demo@`, `am.demo@`, `vendor.demo@seed.example.com`; password from
`grep -n '^PASSWORD' api/app/scripts/seed_demo.py`. Admin emails: only
`testing.srikanthjuturi@gmail.com` (ACS allowlist) or a `@seed.example.com` address (send fails →
`temporaryPassword` returned — also a valid outcome).

```bash
API=http://localhost:8000/api/v1
login() { curl -s $API/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"<PASSWORD>\"}" | jq -r .data.accessToken; }
NH=$(login nh.demo@seed.example.com); H="Authorization: Bearer $NH"
```

Find demo technicians and their codes:

```sql
SELECT tp.code, tp.id, tp.franchisee_id, array_agg(p.pincode ORDER BY p.pincode) AS codes
FROM technician_profiles tp JOIN companies c ON c.id = tp.company_id
JOIN technician_pincodes p ON p.technician_id = tp.id
WHERE c.name = 'GreenTech Demo Services' GROUP BY 1, 2, 3;
```

1. **Given** the demo company before any franchisee, **when** `GET /franchisees`, **then** one row, `isHome: true`, `pincodeRanges: ""`, `pincodeCount` = `SELECT count(*) FROM pincodes WHERE is_active`.
2. **Given** `POST /franchisees` with `admin` (seed address), **then** 201, `admin.emailStatus = "failed"`, `admin.temporaryPassword` non-null, and `SELECT u.role, m.franchisee_id FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = '<email>'` → `franchisee_admin`, the new id; signing in with the password succeeds.
3. **Given** the same email again on another franchisee of this company, **then** 409 `… already has an account here`, and no franchisee row was written (`SELECT count(*) FROM franchisees WHERE name = '<second name>'` = 0).
4. **Given** a staff email as `admin`, **then** 409 naming their role; nothing written.
5. **Given** `PUT /franchisees/{F}/pincodes?dryRun=true` with an en dash, spaces around a dash and line breaks, covering one technician wholly and one partly, **then** 200, `dryRun: true`, lists as in §1, and `franchisee_pincodes`, `technician_profiles.franchisee_id`, `technician_pincodes`, `tickets.franchisee_id` are all unchanged (compare row counts / values before and after).
6. **Given** `pincodeRanges: "50001, abc, 500099-500001, 500001"`, **then** 422 and the message names `"50001"`, `"abc"` and says `"500099-500001"` runs backwards.
7. **When** the same body is applied (`dryRun=false`), **then** the moved technician's `franchisee_id` is F; the trimmed one's `technician_pincodes` lack exactly `losing` and keep the rest; `SELECT count(*) FROM franchisee_pincodes WHERE franchisee_id = 'F'` = `resolvedCount`.
8. **Given** a `Slot Pending` unassigned ticket, an `Escalated` unassigned ticket and an `Assigned` ticket in those codes, **then** after apply the first two have `franchisee_id = F` and their latest `ticket_events` row is `franchisee_changed` / `staff` / `<Home> → <F> · pincode … reassigned`; the third is unchanged with no such event.
9. **Then** `SELECT kind, title FROM notifications WHERE kind = 'technician_moved' ORDER BY created_at DESC LIMIT 1` exists and the NH's `GET /notifications` lists it.
10. **Given** F owns code X, **when** `PUT /franchisees/{G}/pincodes?dryRun=true` including X, **then** 200 with `clashes[0].pincode = X`, `clashCount ≥ 1`; **when** applied, **then** 409 `"code": "FRANCHISEE_PINCODE_TAKEN"`, `errors` contains `"X — <F name>"`; `franchisee_pincodes` unchanged.
11. **Concurrency.** Two shells apply overlapping ranges to F and G at once (`curl … & curl … & wait`): exactly one 200, the other 409 `FRANCHISEE_PINCODE_TAKEN` (never 500, never the code-less "That value is already taken"); `SELECT pincode FROM franchisee_pincodes WHERE company_id = :c GROUP BY 1 HAVING count(*) > 1` is empty.
12. **Given** F reduced to a sub-range, **then** `removed.count` > 0, F's technicians covering only removed codes are in `movedTechnicians` with `toFranchiseeName` = home, and checks 7–8 hold in that direction.
13. **Given** the home id, **when** `PUT …/pincodes`, `POST …/deactivate`, `PUT` with `kind: "external"`, **then** each 409 `FRANCHISEE_HOME_IMMUTABLE`; `PUT` with a new `name` is 200.
14. **Given** F with a technician, **when** `POST …/deactivate`, **then** 409 `FRANCHISEE_HAS_TECHNICIANS` with the count; **after** applying `pincodeRanges: ""`, deactivate is 200, F has no `franchisee_pincodes` rows, its open unassigned tickets are back on home, and every F franchise membership has `is_active = false` (the admin's `POST /auth/refresh` now fails).
15. **Given** `POST /franchisees/{F}/admins/{m}/deactivate`, **then** that admin's refresh fails; `…/activate` lets them sign in again; `…/reissue-password` returns `emailStatus` and the old password stops working.
15a. **Last admin (owner ruling 2026-10-15, R3).** **Given** non-home F with exactly one active admin `m1`, **when** `POST /franchisees/{F}/admins/{m1}/deactivate`, **then** **409 `FRANCHISEE_LAST_ADMIN`** with the "Add another admin first" sentence, and `m1` is unchanged (can still sign in). **When** a second admin `m2` is added and `m1` is deactivated, **then** 200; **then** deactivating `m2` (now the only active one) → 409 again; reactivating `m1` → 200, and deactivating `m2` → 200. **Given** the home franchisee with one active admin, deactivating it → 200 (home exempt). **Given** non-home F's last admin and `POST /franchisees/{F}/deactivate` (after clearing its technicians, pincodes and redemptions), **then** 200 and every admin is suspended — franchisee deactivation is unaffected. Two simultaneous deactivations of F's two admins → exactly one 200 and one 409.
16. **Tenancy — another company.** With `SELECT f.id FROM franchisees f JOIN companies c ON c.id = f.company_id WHERE c.name <> 'GreenTech Demo Services' LIMIT 1`, every route taking `{franchiseeId}` (GET, PUT, pincodes dry run, deactivate, activate, admins list/add) answers **404**.
17. **Tenancy — another franchisee.** `POST /franchisees/{F}/admins/{G's admin membership}/deactivate` and `/reissue-password` → **404**; G's admin row unchanged.
18. **Franchise principal.** Signed in as F's admin (from 2), `GET /franchisees` and `GET /franchisees/{F}` → **403**: a franchise account cannot reach the management API, its own franchisee included.
19. **Given** the AM token, `GET /franchisees` and `GET /franchisees/{F}/admins` → 200; `POST /franchisees`, `PUT …/pincodes` → 403.
20. **Given** the NH token, `POST /users` with `"role": "franchisee_admin"` → 400 `Franchisee accounts are created on the Franchisees screen`; `GET /users` lists no franchise roles; `PUT /users/{F admin membership}` → 404.
21. **Lock.** With an apply paused after `lock_routing` (debugger), `SELECT mode, granted FROM pg_locks WHERE locktype = 'advisory'` shows one granted `ExclusiveLock`; a dry run from another shell returns immediately.
22. `python -m app.scripts.audit_tenancy` exits 0; `pytest api/tests/unit -q` green; `python -c "import app.main"` succeeds.

---

## 8. Out of scope and traps

- **Routing is Task 04** (stamping at intake, the five eligibility predicates, refusing coverage outside a
  franchisee). Until it lands, the Technicians screen can still give a technician a pincode outside their
  franchisee.
- **Money is Tasks 05/06.** A moved technician's ledger rows, redemptions and pending UPI change keep the
  franchisee they were written with (index §3.2, §6).
- **Hard rule 4.** Build `TicketEvent` here; never import `tickets.service.record_event`. Shared logic →
  `app/core/` (that is why `franchise_logins` is there).
- **Hard rule 10 — `autoflush=False`.** Flush after the franchisee and after the user before reading ids.
- **404, not 403** outside the company or the franchisee (hard rule 1); `membershipId` only via `login_base`.
- **Do not filter `_owners()` on `is_active`.** Expansion uses active codes (F2), but an owned row is
  never deleted when the master later switches its code off ("Nothing is ever deleted, only switched off").
- **No extra index** on `(company_id, pincode)` — `uq_franchisee_pincodes_company_pincode` covers it (hard rule 6).
- **Never lock for a dry run**; never make the tickets UPDATE unconditional (`technician_id IS NULL AND status IN …` is what keeps an accept that lands mid-carve-out assigned).
- **Every new `notifications.kind` ≤ 24 characters** (§3.3) — `technician_moved` is 16.
- **White-label:** no product name in any sentence; email copy names the tenant via `brand.company_name`.
- **The wire contract is Task 08 §4.1, matched exactly** (grammar, 422 for bad grammar, dry run 200 with
  clashes, apply 409, the `PincodeChangeOut` / `FranchiseeOut` / admin shapes, the admin routes). Purely
  additive fields Task 08 may ignore: `FranchiseeOptionOut.code`, `franchiseeId`, `emptyRanges`,
  `invitesChanged`, `assignedTicketsKept`, `toFranchisee*` on moved rows, `admin` on create. One
  presentational note for Task 08: `lastLoginAt` is "last active" (§4.4), so its column header should say so.
- **One refusal beyond Task 08's list:** deactivate also refuses (plain 409) while redemptions stamped with
  the franchisee are open — its admins are about to lose access and nobody else pays them (F8).

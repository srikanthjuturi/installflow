# Task 17 — Move a technician from one franchisee to another

> Layer: **api + adminWeb** · Depends on: **05, 06, 08 and 09** (and through them 01–04) · Migration:
> **`e8a2c5b7d913`** (`e8a2c5b7d913_technician_transfers.py`, `down_revision = "d6c3a9f1e874"`)
>
> Read `00-index.md` first. Every table, column, role, feature key, error code and helper name used here is the
> index's; what this task adds is listed in §8 "Index additions" for the owner of the index to fold in. Where a
> judgement call was needed it carries **Decision (writer)** and the reason.
>
> **Owner ruling 2026-10-16:** *"Yes, a transfer action."* A company **Admin or National Head** can move a
> technician from one franchisee to another, including home ⇄ external. Proposed as index ruling **R11**.
>
> **The migration revision above assumes the chain still ends at `d6c3a9f1e874` (Task 12, index §3.6).** If the
> chain moved, re-point `down_revision` to the current head and say so in the commit — never a branch.
> This task adds one table and no column to an existing table, so re-pointing changes one line.

---

## 1. Goal and why

### In plain words

After Tasks 01–09 a technician belongs to exactly one franchisee, and there is **no way to change that** short of
the pincode carve-out (Task 03), which moves people only as a side effect of redrawing a franchisee's map.
That is the wrong tool for the ordinary human cases:

* Ravi, an Acme freelancer, has moved across town into SkyFix's area and SkyFix wants him on its team.
* SkyFix ends its lease and its three best technicians go back to Acme.
* A technician was added to the wrong franchisee on day one.

The owner's answer is a **Transfer** action: one deliberate move, by a person who can defend it, written down.
It changes **who runs the technician from now on** and nothing about what already happened:

| Moves with the technician | Stays where it was earned |
|---|---|
| Who offers them jobs (the new franchisee's pool) | Every `ledger_entries` row they ever had — it keeps its `franchisee_id` |
| Who manages them (the new franchisee's admin, or home staff) | Every `redemptions` row — it keeps its `franchisee_id` |
| Who pays their next redemption and approves their next UPI change | Every ticket they ever worked — `tickets.franchisee_id` is not touched, not even a Closed one |
| Which pool their next penalty or bonus lands in | The old franchisee's pool balance and employee statements |

### Worked example

*Acme Appliances* has **Acme Appliances** (home), and **SkyFix Services** (external, owns 500030–500040, admin
Priya). **Ravi Kumar** (`TCH-4021`) is an Acme **freelancer**, covers **500031, 500032, 500045**, is certified for
Television and Audio, has a daily cap of 6, a base location from a pincode, and a UPI ID on file. Nisha is
Acme's National Head.

1. Ravi has moved to the east side of the city. Nisha opens his profile → **Move to another franchisee**,
   picks **SkyFix Services**, types *"Ravi moved east; SkyFix will run his area"*.
2. The dialog asks the API for a **preview** (`dryRun=true`) and shows, writing nothing:
   *Stays: 500031, 500032 · Taken off: 500045* (it is Acme's, not SkyFix's) — and, the first time Nisha tried,
   two red lines: *Ravi still has 1 open job* (`TECHNICIAN_HAS_OPEN_JOBS`) and *Ravi still has ₹1,240 waiting
   to be redeemed* (`TECHNICIAN_HAS_BALANCE`). **Move** stayed disabled until the job closed and Ravi redeemed,
   was paid, and confirmed it.
3. Nisha presses **Move Ravi Kumar**. In one transaction: `technician_profiles.franchisee_id` becomes SkyFix, 500045
   leaves his coverage, a `technician_transfers` row records *who, when, why, from, to, and exactly which
   pincodes stayed and went*, two bells ring, and a push tells Ravi.
4. From that commit: SkyFix's technicians' pool shows tickets stamped SkyFix and **Ravi sees them** — his old
   Acme pool is gone from his app. Acme's pool and SkyFix's pool are not affected by the move; only their
   *next* entries differ.
5. Ravi's next job closes: the `payout` is stamped SkyFix, lands in SkyFix's earnings, and Priya pays his next
   redemption. His **old** ₹500 cancellation penalty is still in Acme's pool, and Acme's staff can still give it
   back (the reversal copies the penalty's franchisee).
6. His monthly cancellation cap (₹5,000) is **his**, not a franchisee's, so it carries over: ₹500 charged under
   Acme earlier this month leaves ₹4,500 of room under SkyFix.
7. Ravi's profile shows one new line: *16-10-2026 · Acme Appliances → SkyFix Services · by Nisha Rao*.

On the day this ships nothing moves: no technician is transferred until somebody presses the button.

---

## 2. Decisions implemented

| ID | How |
|---|---|
| **F1, F4, F8** | Home is a franchisee like any other for a transfer, and it is the catch-all: "inside home's range" means *no other franchisee owns the code*. A transfer into or out of home needs no special case beyond that. |
| **F6** | The carve-out's *keep at least one pincode* rule, restated for a single person: coverage that would end empty is refused (422 `PINCODE_OUTSIDE_FRANCHISEE`), never silently emptied. |
| **F7, F8** | Technician management belongs to the franchisee — **but this action is deliberately the one exception.** It is guarded by `franchisees.manage` (Admin, NH), not by `can_manage_technician` (which for a non-home technician is a franchisee admin's alone). The same two roles already decide which technicians change franchisee through the pincode carve-out (Task 03). |
| **F12** | Pools stay correct because `ledger_entries.franchisee_id` is stamped at write time and never rewritten (§4.6). |
| **T1** | `technician_type` is **kept** (D3). It is not editable in the same call. |
| **R3** | A non-home franchisee must always have somebody to approve UPI changes and pay redemptions, so a transfer **into** a non-home franchisee with no active admin is refused (409 `FRANCHISEE_HAS_NO_ADMIN`, D8). |
| **R5** | Same refusals, same codes, as a type change: `TECHNICIAN_HAS_OPEN_JOBS`, `TECHNICIAN_HAS_BALANCE` (D2). |
| §3.2, §5.5 | The five eligibility places already read the technician's franchisee **live** (Task 04), so the move takes effect at commit with no cache to flush (§4.7). |
| §3.3 | `notifications.kind = 'technician_moved'` (16 chars, already in the CHECK from Task 01); error code `PINCODE_OUTSIDE_FRANCHISEE` (422); `TECHNICIAN_HAS_OPEN_JOBS`, `TECHNICIAN_HAS_BALANCE`; **new** `FRANCHISEE_HAS_NO_ADMIN` (409). |

### Decisions the writer made (judgement calls)

| ID | Decision | Why |
|---|---|---|
| **D1** | **Coverage: keep what is inside the target's range; the caller may instead send `pincodes`.** With no `pincodes`, coverage becomes *current ∩ target's range* (the rest is taken off and reported). If that is empty, refuse with 422 `PINCODE_OUTSIDE_FRANCHISEE` and say so. With `pincodes`, coverage becomes exactly that list, every code of which must lie in the target's range (same 422, naming the owners of the offending codes). | The owner's preferred shape. Refusing on any trim would make the common case (a technician who straddles two franchisees' areas) impossible to move; trimming silently and nothing else would strand the case where nothing is left. Sending replacement coverage in the same call also avoids a window in which the technician exists at the new franchisee with coverage nobody offered. |
| **D2** | **Blockers are exactly the type-change blockers**, applied to the *whole* freelancer-stream balance: `open_jobs > 0` → `TECHNICIAN_HAS_OPEN_JOBS`; `redeemable_balance > 0` **or** an open redemption → `TECHNICIAN_HAS_BALANCE`. | An open job would be accepted under one franchisee and paid under another. A redeemable balance or open redemption is owed *by the old franchisee's payer* (the redemption is stamped with it, F8) — after the move that person could no longer see it. Both are already how the app and console speak about a type change. |
| **D3** | **`technician_type` is kept and cannot be changed in the transfer call.** | A type change has its own guards and meaning (T1: frozen at accept). The transfer's guards (no open job, no redeemable money) already satisfy every guard of a type change, so the target's admin, or home staff, can change the type immediately afterwards with no further refusal possible. Combining them would double the preview matrix for no gain. |
| **D4** | **Kept as they are:** `technician_nodes` (certifications), `daily_job_cap`, `accepting_work`, `status`, base location (`base_*`), `upi_id` / `upi_name`, language, `push_tokens`, `appointed_by_*`, `onboarding_mode`, `registered_by`, `memberships` (`franchisee_id` is NULL for a technician, index §3.2, and `manager_id` is the staff hierarchy, not franchise ownership). Only `technician_profiles.franchisee_id` changes — plus coverage rows, and the region when the new coverage lies in one other region (D5). | The owner's list; nothing about *who the person is* changed. Memberships stay untouched so no session or token needs reissuing: a technician's franchisee is read from the profile, live. |
| **D5** | **Region follows coverage.** After the move all coverage must lie in **one region** (the existing rule, `check_pincodes_exist`). If that region differs from `region_id`, `region_id` and the membership's region are updated in the same transaction; coverage spanning two regions → 422 (code-less, names both). | A SkyFix area in another region than the technician's old one is a real case; refusing it would make the feature useless there, and asking the caller for a `regionId` is one more field to get wrong. |
| **D6** | **A pending UPI change moves with the technician** and is re-addressed: `reviewer_role` is re-resolved with Task 05's `upi_reviewer` and a fresh `upi_change` bell goes to the new reviewer. It is not withdrawn. | It is the technician's request, not the old franchisee's. Withdrawing it silently would lose it; leaving it addressed to the old franchisee's admins would strand it (they now get 404). |
| **D7** | **Negative balance is allowed, with a warning.** A technician who owes money (penalties > earnings) can move; the preview says so. | Consistent with the type-change rule (Task 06 §4.5: *"negative balance → allowed"*). **Open question for the owner:** the debt is an old-franchisee penalty that the **new** franchisee's payouts will then offset. See §8. |
| **D8** | **Target must be active, different, and (if not home) have at least one active admin.** Else 409 (code-less for the first two, `FRANCHISEE_HAS_NO_ADMIN` for the last). | A technician under a franchisee with no admin would have nobody to approve their UPI change or pay their redemption — the exact hole R3 closed. Home is exempt (company Admin/NH act for it). |
| **D9** | **The technician is told by a push** (`technician.moved`, `data={"type": "job"}` with **no ticket id**, the `penalty.reversed` shape). Installed builds refresh jobs, earnings and `me` on any `job` push and open the app on tap — no mobile change, no new ledger kind, no X4 problem. | The person whose pool, payer and pincodes just changed should not discover it from an empty list. Task 03 declined a push for the carve-out because its copy was unsigned; this is a deliberate action on one named person, so the copy is PROPOSED in §5.7 and **ships behind sign-off**. English first; four translations queued for native review. |
| **D10** | **Both franchisees' admins get a bell**, each the way that reaches them (§4.8): a non-home side → `audience='franchisee_admin'`, `franchisee_id=<that side>`; the home side → a company-wide row carrying `franchisee_id=<home>` (reaches every staff reader by territory rules and home's franchisee admins). | The owner asked for "both franchisees' admins". Home's admins are company staff (F8), so a franchisee-admin audience alone would miss them. |
| **D11** | **History is staff-only.** `GET /technicians/{id}/transfers` is `technicians.view` + `require_staff_principal`; the portal shows nothing new. | The reason text is the company's note about a franchisee; an external franchisee has no need to read how it was moved in or out. |
| **D12** | **No preview is forced server-side.** An API caller who omits `pincodes` can trim without having looked, exactly as Task 03's carve-out can. The console always previews first; the response and the audit row both list every trimmed pincode. | Follows the Task 03 precedent rather than inventing a second confirm protocol. The audit row is what makes a surprise recoverable. |
| **D13** | **`manager_id` is not touched.** | It is the staff hierarchy ("which manager owns this technician") and drives only staff visibility (`visibility.technician_scope`); franchise ownership is `franchisee_id`. Re-pointing it would make an Area Manager lose sight of somebody they may still need to assign an escalated job to. |
| **D14** | **Transfers are append-only.** No edit, no undo endpoint. To reverse a move, do another transfer. | A correction is a new entry (the ledger's rule); an undo would pretend nothing happened. |

---

## 3. Schema — migration `e8a2c5b7d913`

File `api/alembic/versions/e8a2c5b7d913_technician_transfers.py`, `revision = "e8a2c5b7d913"`,
`down_revision = "d6c3a9f1e874"`. Hand-written. CHECK names passed **bare** in both directions (the naming
convention prefixes `ck_<table>_`). One new table, nothing altered: `notifications.kind` already allows
`technician_moved` (Task 01) and `notifications.audience` already allows `franchisee_admin` (Task 05).

### 3.1 `technician_transfers` — the audit

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` (`IdMixin`) |
| `company_id` | UUID NOT NULL | FK → `companies.id` **CASCADE** |
| `technician_id` | UUID NOT NULL | composite FK `(company_id, technician_id)` → `technician_profiles (company_id, id)` **CASCADE** (history *about* a technician, the `upi_change_requests` shape; profiles are soft-removed, never deleted) |
| `from_franchisee_id` | UUID NOT NULL | composite FK `(company_id, from_franchisee_id)` → `franchisees (company_id, id)` **RESTRICT** (Task 01's shape; franchisees are never deleted) |
| `to_franchisee_id` | UUID NOT NULL | composite FK `(company_id, to_franchisee_id)` → `franchisees (company_id, id)` **RESTRICT** |
| `technician_type` | VARCHAR(16) NOT NULL | the type at transfer time (it does not change, D3, but a later statement should not have to infer it) |
| `reason` | VARCHAR(255) NOT NULL | what the person typed, stripped |
| `coverage_before` | JSONB NOT NULL | sorted array of 6-digit strings |
| `coverage_after` | JSONB NOT NULL | sorted array, never empty |
| `transferred_by_user_id` | UUID NOT NULL | **no FK**, like `claimed_by_user_id` (users are soft-deleted) |
| `transferred_by_label` | VARCHAR(120) NOT NULL | their name at the time, so the line reads on its own |
| `transferred_at` | TIMESTAMPTZ NOT NULL | `server_default now()` |
| `created_at`, `updated_at`, `created_by`, `updated_by` | `AuditMixin` | `updated_*` unused, as on `ticket_events` and `ledger_entries` |

Constraints and indexes (every FK covered — hard rule 6; a UNIQUE is not needed, the table is not a parent):

| Name | Definition |
|---|---|
| `ck_technician_transfers_different_franchisees` | `from_franchisee_id <> to_franchisee_id` |
| `ck_technician_transfers_reason_length` | `char_length(btrim(reason)) >= 5` |
| `ck_technician_transfers_technician_type` | `technician_type IN ('employee', 'freelancer')` |
| `ck_technician_transfers_coverage_shape` | `jsonb_typeof(coverage_before) = 'array' AND jsonb_typeof(coverage_after) = 'array' AND jsonb_array_length(coverage_after) > 0` |
| `ix_technician_transfers_company_technician` | `(company_id, technician_id, transferred_at)` — the profile's history, and the covering index for the technician FK |
| `ix_technician_transfers_company_from` | `(company_id, from_franchisee_id)` — covering index |
| `ix_technician_transfers_company_to` | `(company_id, to_franchisee_id)` — covering index |

### 3.2 The migration (near-code)

```python
"""Technician transfers — who moved a technician between franchisees, and why

A technician belongs to one franchisee. Moving them is a deliberate act with consequences (their pool, their
payer, their pincodes), so it is written down: who, when, why, from, to, and the exact pincodes before and after.
Append-only; a correction is another transfer.

Downgrade refuses while any row exists — dropping the table would lose the only record of why a technician is
where they are (the f3c9a2d71b58 / f4b28d1a67c3 shape).

Revision ID: e8a2c5b7d913
Revises: d6c3a9f1e874
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e8a2c5b7d913"
down_revision = "d6c3a9f1e874"      # re-point to the current head if the chain moved (never a branch)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "technician_transfers",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("technician_id", sa.Uuid(), nullable=False),
        sa.Column("from_franchisee_id", sa.Uuid(), nullable=False),
        sa.Column("to_franchisee_id", sa.Uuid(), nullable=False),
        sa.Column("technician_type", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=False),
        sa.Column("coverage_before", postgresql.JSONB(), nullable=False),
        sa.Column("coverage_after", postgresql.JSONB(), nullable=False),
        sa.Column("transferred_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("transferred_by_label", sa.String(length=120), nullable=False),
        sa.Column("transferred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint("from_franchisee_id <> to_franchisee_id", name="different_franchisees"),
        sa.CheckConstraint("char_length(btrim(reason)) >= 5", name="reason_length"),
        sa.CheckConstraint("technician_type IN ('employee', 'freelancer')", name="technician_type"),
        sa.CheckConstraint(
            "jsonb_typeof(coverage_before) = 'array' AND jsonb_typeof(coverage_after) = 'array' "
            "AND jsonb_array_length(coverage_after) > 0",
            name="coverage_shape",
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_technician_transfers_company_technician", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "from_franchisee_id"], ["franchisees.company_id", "franchisees.id"],
            name="fk_technician_transfers_company_from", ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "to_franchisee_id"], ["franchisees.company_id", "franchisees.id"],
            name="fk_technician_transfers_company_to", ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_technician_transfers_company_technician", "technician_transfers",
                    ["company_id", "technician_id", "transferred_at"])
    op.create_index("ix_technician_transfers_company_from", "technician_transfers",
                    ["company_id", "from_franchisee_id"])
    op.create_index("ix_technician_transfers_company_to", "technician_transfers",
                    ["company_id", "to_franchisee_id"])


def downgrade() -> None:
    n = op.get_bind().scalar(sa.text("SELECT count(*) FROM technician_transfers"))
    if n:
        raise RuntimeError(
            f"{n} technician transfer(s) are recorded. Dropping the table would lose who moved whom and why. "
            "Export them first, then delete the rows deliberately."
        )
    op.drop_index("ix_technician_transfers_company_to", table_name="technician_transfers")
    op.drop_index("ix_technician_transfers_company_from", table_name="technician_transfers")
    op.drop_index("ix_technician_transfers_company_technician", table_name="technician_transfers")
    op.drop_table("technician_transfers")
```

**Round trip (dev only):** `alembic upgrade head` → `alembic downgrade d6c3a9f1e874` → `alembic upgrade head`,
with `SELECT count(*) FROM technician_transfers` = 0 at the downgrade (and a second trip with one row, to see
the refusal). Production is migrated by the owner (X5), **before** the API that needs it is published.

### 3.3 Model and the scripts that classify tables

`api/app/models/technician_transfer.py` — `class TechnicianTransfer(Base, IdMixin, AuditMixin)`, mapping §3.1
exactly (`__table_args__` carries the CHECKs, indexes and three composite FKs); register it in
`app/db/base.py`. Module docstring: *append-only, a correction is another transfer, no SoftDeleteMixin*.

| File | Change |
|---|---|
| `api/app/scripts/audit_tenancy.py` | Append to `TENANT_LINKS`: `("technician_transfers", "technician_id", "technician_profiles")`, `("technician_transfers", "from_franchisee_id", "franchisees")`, `("technician_transfers", "to_franchisee_id", "franchisees")` — each with a one-line "what would leak" comment (*a history line naming another company's technician or franchisee*). Task 16 §5.5's count of 18 becomes 21. |
| `api/app/scripts/cleanup_db.py` | Add `"technician_transfers"` to `COMPANY_TABLES` (alphabetical, after `"technician_profiles"`); `python -m app.scripts.cleanup_db --check` must still pass. |
| `api/app/scripts/seed/verify.py` | New check: for every technician with a transfer, `technician_profiles.franchisee_id` = the `to_franchisee_id` of the newest row, and `coverage_after` of that row ⊇ current coverage's relevant codes (§7.20). |

---

## 4. API / service changes

### 4.1 Files

| File | New / edit | What |
|---|---|---|
| `api/app/core/technician_transfer.py` | **new, pure** | Blockers, warnings, the coverage plan, region rule, notice wording. Stdlib + `uuid` only — never `app.core.database` (Task 00 §4.1). §4.2. |
| `api/app/models/technician_transfer.py` | new | §3.3 |
| `api/app/features/technicians/transfer_service.py` | **new** | `transfer_technician`, `list_transfers`. Inside the technicians slice (it needs `_load`, `set_coverage`, `set_membership_region`, `_open_job_count`), so no slice imports another. |
| `api/app/features/technicians/schemas.py` | edit | §4.4 |
| `api/app/features/technicians/router.py` | edit | the two routes (§4.3), declared with the other `/{technician_id}/…` literals |
| `api/app/features/technicians/service.py` | edit | extract `_open_job_count(session, profile) -> int` from `_refuse_if_open_jobs` (Task 05 already does this; reuse it); `request_upi_change` loads the profile **FOR UPDATE** (§4.9 trap 4) |
| `api/app/core/ledger.py` | edit | `open_redemption_exists(db, *, company_id, technician_id) -> bool` beside Task 06's `redeemable_balance`: `redemptions` with `confirmed_at IS NULL AND declined_at IS NULL` (the `uq_redemptions_one_open` predicate) |
| `api/app/core/push_text.py` | edit | key `technician.moved` in `en/hi/te/kn/ta` (§5.7); the module's import-time `_check()` fails the build if a language or placeholder is missing |
| `api/app/features/tickets/service.py` | edit | none — no ticket is touched (§4.6) |
| `api/AGENTS.md` | edit | a "Moving a technician between franchisees" section (§8) |

### 4.2 Pure module `app/core/technician_transfer.py`

```python
CODE_OPEN_JOBS = "TECHNICIAN_HAS_OPEN_JOBS"
CODE_BALANCE = "TECHNICIAN_HAS_BALANCE"
CODE_NO_ADMIN = "FRANCHISEE_HAS_NO_ADMIN"
CODE_OUTSIDE = "PINCODE_OUTSIDE_FRANCHISEE"
NOTIFICATION_KIND = "technician_moved"      # 16 chars; notifications.kind is String(24)
MIN_REASON = 5
MAX_REASON = 255

@dataclass(frozen=True)
class Blocker:
    code: str | None            # None = a code-less 409 ("already works for…", "inactive")
    message: str
    open_jobs: int | None = None
    redeemable_paise: int | None = None
    redemption_code: str | None = None

@dataclass(frozen=True)
class CoveragePlan:
    source: Literal["kept", "supplied"]
    kept: tuple[str, ...]        # in current AND in final
    trimmed: tuple[str, ...]     # in current, not in final
    added: tuple[str, ...]       # in final, not in current
    final: tuple[str, ...]       # sorted, de-duplicated
    outside: tuple[str, ...]     # supplied codes the target does not own (sorted)
    nothing_left: bool           # final is empty
    @property
    def changed(self) -> bool: ...        # trimmed or added

def reason_problem(text: str | None) -> str | None:
    """None when fine. Strips; < 5 chars → 'Say why {…} is being moved (at least 5 characters)'-style sentence
    (the service formats the name in); > 255 → 'Keep the reason under 255 characters'."""

def plan_coverage(current: Iterable[str], routes: Mapping[str, UUID], target: UUID,
                  supplied: Sequence[str] | None) -> CoveragePlan:
    """supplied is None  → final = {c in current : routes[c] == target}; source 'kept'.
       supplied given     → final = sorted(set(supplied)); outside = {c in final : routes.get(c) != target};
                            source 'supplied'. A code missing from `routes` counts as outside (fail closed)."""

def single_region(regions: AbstractSet[UUID]) -> UUID | None:
    """Exactly one region → it; zero → None. More than one → ValueError (the service turns it into the 422)."""

def transfer_blockers(*, same_franchisee: bool, target_name: str, target_active: bool,
                      target_is_home: bool, target_active_admins: int,
                      technician_code: str, open_jobs: int, redeemable_paise: int,
                      open_redemption_code: str | None, plan: CoveragePlan) -> list[Blocker]:
    """Stable order: same franchisee → target inactive → target has no admin → open jobs → balance /
    open redemption → coverage (outside / nothing left). The service raises the FIRST on apply and returns ALL
    on a dry run."""

def transfer_warnings(*, technician_name: str, target_name: str, redeemable_paise: int,
                      pending_upi_change: bool, base_pincode_outside: bool,
                      base_pincode: str | None) -> list[str]:
    """Non-blocking things the person should read before pressing Move: a negative balance (owes money),
    a pending UPI change that travels, a base location set from a pincode outside the new area."""

def transfer_notices(*, technician_name: str, technician_code: str, from_name: str, to_name: str,
                     reason: str) -> tuple[tuple[str, str], tuple[str, str]]:
    """((joining_title, joining_detail), (leaving_title, leaving_detail)); titles ≤ 160, details ≤ 255
    (the reason is cut with an ellipsis), no product name."""
```

`plan_coverage` is the single-person sibling of Task 03's `plan_carve_out`: *keep what is inside, report what is
taken off, refuse an empty result*. `codes_outside` / `outside_message` from Task 04's
`app/core/franchise_routing.py` are reused for the sentence (§4.5 step 7), not re-implemented.

### 4.3 Endpoints

Both live in `features/technicians/router.py`. Staff doors only — each carries `require_staff_principal` (it
refuses franchise roles, Task 02), so a Feature Access override can never hand them to a franchise account.

| # | Method · path | Guard | Body / query | `data` | `message` |
|---|---|---|---|---|---|
| 1 | `POST /technicians/{technician_id}/transfer` | `require_feature("franchisees.manage")` · `require_min_rank(NATIONAL_HEAD)` · `require_staff_principal` | `TechnicianTransferRequest`, `?dryRun=bool` (default false) | `TechnicianTransferOut` | `Preview — nothing was saved` / `Technician moved` |
| 2 | `GET /technicians/{technician_id}/transfers` | `require_feature("technicians.view")` · `require_staff_principal` | — | `TechnicianTransferRowOut[]`, newest first | default |

* **Not** `_load_managed`: Admin/NH `MANAGE` is {home} only (Task 02's matrix), which would 403 every
  non-home technician. The authority here is `franchisees.manage` (§2, the F7/F8 row). The technician is loaded with
  the **ordinary** `_load` (staff visibility), so another company's technician — or one outside the caller's scope
  — is **404, never 403**. An Admin/NH is all-India, so in practice the scope never narrows them.
* Route 2 follows the same `_load` visibility, so an Area Manager reads the history of technicians in their scope.
  A franchise principal reaches neither (403 from `require_staff_principal`; it has no staff door at all).
* Declared after the literal `/invites…` routes and before `/{technician_id}` itself, the order the router already
  documents for its 422 trap.

### 4.4 Schemas (`features/technicians/schemas.py`)

```python
class TechnicianTransferRequest(BaseModel):
    franchiseeId: uuid.UUID
    reason: str | None = Field(default=None, max_length=255)   # required (>=5) unless dryRun
    pincodes: list[Annotated[str, StringConstraints(pattern=r"^[1-9][0-9]{5}$")]] | None = Field(
        default=None, max_length=500)                          # None = keep what is inside the range

class TransferCoverageOut(AppModel):
    source: Literal["kept", "supplied"]
    kept: list[str]; trimmed: list[str]; added: list[str]; after: list[str]
    keptCount: int; trimmedCount: int; addedCount: int
    regionBefore: str | None; regionAfter: str | None; regionChanged: bool

class TransferBlockerOut(AppModel):
    code: str | None
    message: str
    openJobs: int | None = None
    redeemablePaise: int | None = None
    redemptionCode: str | None = None

class TechnicianTransferRowOut(AppModel):
    id: uuid.UUID; at: datetime
    technicianId: uuid.UUID
    fromFranchiseeId: uuid.UUID; fromFranchiseeName: str
    toFranchiseeId: uuid.UUID;   toFranchiseeName: str
    technicianType: Literal["employee", "freelancer"]
    reason: str
    byUserId: uuid.UUID; byName: str
    kept: list[str]; trimmed: list[str]; added: list[str]      # derived from coverage_before / coverage_after

class TechnicianTransferOut(AppModel):
    dryRun: bool
    technicianId: uuid.UUID; technicianCode: str; technicianName: str
    technicianType: Literal["employee", "freelancer"]
    fromFranchiseeId: uuid.UUID; fromFranchiseeName: str; fromFranchiseeIsHome: bool
    toFranchiseeId: uuid.UUID;   toFranchiseeName: str;   toFranchiseeIsHome: bool
    coverage: TransferCoverageOut
    blockers: list[TransferBlockerOut]
    warnings: list[str]
    canTransfer: bool                         # no blockers
    transfer: TechnicianTransferRowOut | None # null on a dry run
```

Money in **paise** (`redeemablePaise`); the console formats it with `moneyPaise`.

**Dry run** (200 — blockers are *data* on a preview, exactly as Task 03 returns clashes with 200):

```json
POST /technicians/3f1a…/transfer?dryRun=true   {"franchiseeId": "5b1c…"}
{ "success": true, "statusCode": 200, "message": "Preview — nothing was saved", "errors": [],
  "data": {
    "dryRun": true, "technicianId": "3f1a…", "technicianCode": "TCH-4021", "technicianName": "Ravi Kumar",
    "technicianType": "freelancer",
    "fromFranchiseeId": "a901…", "fromFranchiseeName": "Acme Appliances", "fromFranchiseeIsHome": true,
    "toFranchiseeId": "5b1c…",   "toFranchiseeName": "SkyFix Services",   "toFranchiseeIsHome": false,
    "coverage": { "source": "kept", "kept": ["500031","500032"], "trimmed": ["500045"], "added": [],
                  "after": ["500031","500032"], "keptCount": 2, "trimmedCount": 1, "addedCount": 0,
                  "regionBefore": "South", "regionAfter": "South", "regionChanged": false },
    "blockers": [
      { "code": "TECHNICIAN_HAS_OPEN_JOBS", "message": "TCH-4021 still has 1 open job. Finish or reassign it first.",
        "openJobs": 1 },
      { "code": "TECHNICIAN_HAS_BALANCE", "message": "Ravi Kumar still has ₹1,240 waiting to be redeemed. …",
        "redeemablePaise": 124000 } ],
    "warnings": [], "canTransfer": false, "transfer": null } }
```

**Apply** with a blocker (409): `{"success": false, "statusCode": 409, "code": "TECHNICIAN_HAS_OPEN_JOBS",
"message": "TCH-4021 still has 1 open job. Finish or reassign it first.", "errors": ["…"], "data": null}`.
**Apply** success (200): the same shape with `dryRun: false`, `canTransfer: true`, `blockers: []`, and `transfer`
filled. **Nothing left** (422): `{"code": "PINCODE_OUTSIDE_FRANCHISEE", "message": "None of TCH-4021's pincodes is
inside SkyFix Services's area. Choose the pincodes SkyFix Services should serve."}`.

### 4.5 Service — `transfer_service.transfer_technician(session, principal, technician_id, body, *, dry_run)`

1. **Load.** `profile, membership, user = await _load(...)` (404 otherwise). `to = select(Franchisee)` by
   `(company_id = principal.company_id, id = body.franchiseeId, deleted_at IS NULL)` → else 404 *"Franchisee not
   found"* (another company's franchisee is a 404, never a 409 naming it). `from` likewise by
   `profile.franchisee_id`.
2. **Apply only:** `await lock_routing(session, company_id, exclusive=False)` (Task 03: shared — a carve-out in
   flight is waited for and then judged), then re-select the profile `FOR UPDATE` (the same lock
   `redemptions.service.request` takes, so a redemption cannot be requested between our balance check and our
   commit). A dry run takes **no** lock — previews never queue behind saves (Task 03).
3. **Facts**, all read after the lock on apply:
   * `open_jobs = await _open_job_count(session, profile)` — `tickets` with `technician_id = profile.id` and
     `status NOT IN TERMINAL_STATUSES` (`Assigned`, `In Progress`, `Awaiting Part`, `Escalated`, …).
   * `redeemable = await ledger.redeemable_balance(...)` (Task 06: freelancer-stream credits − every redemption
     not declined) and `open_code = (await open redemption's code) if open_redemption_exists`.
   * `admins = await franchise_logins.active_admin_count(..., franchisee_id=to.id)` (Task 03).
   * `current = SELECT pincode FROM technician_pincodes WHERE company_id = :c AND technician_id = :t`.
   * `routes = await franchisees_for_pincodes(session, company_id, current ∪ supplied)` (Task 01: owner row, else
     home).
4. **Plan** `plan = plan_coverage(current, routes, to.id, body.pincodes)`.
5. **Region.** Final codes → regions:
   `SELECT DISTINCT s.region_id FROM pincodes p JOIN states s ON … WHERE p.code = ANY(:final)`; `single_region(...)`.
   More than one → 422 *"Those pincodes are in more than one region (South, West). A technician works in one
   region — pick pincodes from one."* If it differs from `profile.region_id`, step 8 updates both.
6. **Blockers.** `blockers = transfer_blockers(...)`; `warnings = transfer_warnings(...)`. If a supplied code is
   outside, the sentence is `outside_message(to.name, outside, owner_names=<names of the owners>)` (Task 04, staff
   variant — an Admin/NH may be told who owns a code).
7. **Dry run:** build `TechnicianTransferOut(dryRun=True)`, `await session.rollback()`, return. **Apply:** `reason`
   must satisfy `reason_problem` (422 *"Say why {name} is being moved (at least 5 characters)"*); the **first**
   blocker is raised — code-less ones as `HTTPException(409, message)`, coded ones as `AppError(409, code, message)`
   (`PINCODE_OUTSIDE_FRANCHISEE` as 422, the status Tasks 04/05/09 fixed).
8. **Write, in this order, one transaction:**
   1. `profile.franchisee_id = to.id`; `profile.updated_by = principal.user_id`.
   2. If `plan.changed`: `set_coverage(session, profile=profile, pincodes=list(plan.final), actor_id=...)`
      (delete + insert; it flushes).
   3. If the region changed: `profile.region_id = region.id` and `set_membership_region(...)`.
   4. **Pending UPI change** (D6): if a `pending` `upi_change_requests` row exists →
      `role, pincode, fid = await coverage.upi_reviewer(...)` (Task 05, now reading the *new* franchisee) →
      `row.reviewer_role = role`; a fresh `upi_change` bell with that `audience` / `franchisee_id` / `pincode`
      (the same call `request_upi_change` makes), plus `publish_notification`.
   5. `TechnicianTransfer(...)` with `coverage_before = sorted(current)`, `coverage_after = list(plan.final)`,
      `transferred_by_user_id = principal.user_id`, `transferred_by_label = principal.user.full_name or "—"`,
      `technician_type = profile.technician_type`; `flush()` (hard rule 10).
   6. **Two bells** (§4.8) via `core.notifications.notify` + `publish_notification`.
   7. `publish_technician_changed` (the consoles' rosters refresh).
9. `commit()`. Then, after the commit (a push cannot be rolled back): `send_to_technician(..., message=
   PushText("technician.moved", franchisee=to.name), data={"type": "job"})`. A failed push never fails the move
   (`send_to_technician` already swallows delivery errors).
10. Return `TechnicianTransferOut(dryRun=False, transfer=<row>)`.

`list_transfers`: `_load` (404/scope), then `technician_transfers` for `(company_id, technician_id)` newest first,
franchisee names by one `IN` query, `kept/trimmed/added` derived from the two JSONB arrays.

### 4.6 What stays correct — and why nothing else is written

The whole feature rests on one invariant: **with zero open jobs, nothing but a reversal can write a ledger row
against the technician**, so no money can be half-written across the move.

| Thing | After the move | Why it is right |
|---|---|---|
| `ledger_entries` | Old rows keep `franchisee_id`; new rows are stamped by `core.ledger.entry`, which reads the technician's franchisee **inside the INSERT** (Task 01) | A payout/bonus/penalty/force-close all need an open job. A reversal copies the *reversed* row's franchisee, so an old penalty is given back **to the old pool** by whoever may reverse it there. |
| Old franchisee's pool | `balance = penalties + speed_penalties − reversals − bonuses − speed_rewards` over rows with *its* `franchisee_id` — unchanged | Nothing was rewritten. The move neither adds nor subtracts a rupee from any pool. |
| New franchisee's pool | Starts receiving the technician's next entries | Same stamping rule. |
| Monthly cancellation cap | Unchanged: `charged_this_month` is the **technician's** month across franchisees (Task 05 trap 6) | The cap is about the person (₹5,000/month). |
| `redemptions` | Old ones keep their `franchisee_id`; none can be open (D2); the next is stamped by `Redemption.franchisee_id = locked.franchisee_id` (Task 01) | The old payer settled everything before the move; the new one pays everything after. |
| Employee statements (Task 06) | Two statements for the month of the move, each from its own franchisee's rows; the old franchisee can still download the month (*"at least one ledger row with `franchisee_id = F`"*, Task 06 §4.9) | Salary is paid by whoever employed them when it was earned. |
| `tickets` | **No `UPDATE tickets` is issued.** A Closed ticket keeps its franchisee; there are no open ones (D2); the technician's job history (`/technicians/{id}/tickets`) is unchanged | The franchisee on a ticket is where the *work* was routed, not who the technician is. |
| `technician_invites` | Untouched | An invite is a pre-technician; this technician has long registered. |
| Pending UPI change | Re-addressed (D6) | §4.5 step 8.4. |
| `job_passes` (offers the technician passed) | Untouched | Harmless: a passed old-franchisee ticket never appears in their new pool anyway. |

### 4.7 Pool eligibility — the five places (index §5.5)

Task 04 made all five read the technician's franchisee **live**, so the commit *is* the cut-over:

| # | Place | Effect at commit |
|---|---|---|
| 1 | `jobs/service.pool_query` (`in_franchisee`, correlated subquery) | Ravi's `GET /jobs/pool` and `GET /jobs/{id}/offer` drop the old franchisee's tickets and show the new one's, on the next request. An offer he had open → 404 *Job not found* (the same outcome as losing a race). |
| 2 | `core/coverage.technicians_covering(franchisee_id=…)` | New tickets' pushes (`announce_pool_job`) and the escalation-bonus re-notify go to the new franchisee's technicians, Ravi included; no longer to the old. |
| 3 | The guarded UPDATE in `jobs/service.accept` (franchisee test inside the statement) | A stale accept of an old-franchisee ticket matches no row → 404 via `accept_miss_reason` → `"moved"`. |
| 4 | `tickets/service.assign_technician` / `_load_assignable_technician` | Assigning an old-franchisee ticket to him is refused 409 `TECHNICIAN_INELIGIBLE` *"TCH-4021 works for another franchisee…"*; a new-franchisee ticket can be assigned. |
| 5 | `jobs/ws.py` pool socket (`_Coverage.franchisee_id`, 60 s TTL) | Frames for the old franchisee's tickets may still ring his phone for up to 60 s. **Harmless by design** — the socket is a doorbell ("rings too often rather than too rarely") and the read behind it (place 1) already excludes them. The `technician.moved` push (D9) makes the app refetch at once. |

Realtime from the transaction: `publish_technician_changed` (consoles) — no per-ticket `PoolChanged`, because no
ticket changed and the technician's new offers will announce themselves the usual way.

### 4.8 Notifications

Two rows, written in the move's transaction with `core.notifications.notify` (`kind="technician_moved"`) and
published with `publish_notification(..., notification_id=raised.id, audience=…, franchisee_id=…)`
(Task 05 §4.8 carries `franchisee_id` on the row and in the relay payload):

| Side | `audience` / `franchisee_id` / `pincode` | `to` | Title · detail (PROPOSED) | Who hears (Task 05 `audience.hears`) |
|---|---|---|---|---|
| **Joining** (target) | non-home: `franchisee_admin` / target / NULL — **home:** NULL / home / NULL | `/technicians/{id}` | **{name} joined {to}** · {code} · from {from} · {reason} | non-home → that franchisee's admins only. Home → every staff reader (company-wide) **and** home's franchisee admins. |
| **Leaving** (source) | non-home: `franchisee_admin` / source / NULL — **home:** NULL / home / NULL | `/technicians` (the list: the technician is now a 404 to the old admin) | **{name} moved to {to}** · {code} · from {from} · {reason} | same rule, source side |

When the source or target is home, the company-wide row is written **once** even if both sides are home-adjacent
(never both sides home — a transfer is between two different franchisees). `title ≤ 160`, `detail ≤ 255`
(`transfer_notices` cuts the reason with `…`). The console rewrites staff-style `to` for a portal reader
(Task 09 §4.5/§5.8).

**Push** (D9): one, to the technician, after the commit.

### 4.9 Errors and transactions

| Status · code | When |
|---|---|
| 404 | technician not found / outside scope / another company's; franchisee not found / another company's / deleted |
| 403 | below NH, no `franchisees.manage`, or a franchise / vendor / technician principal |
| 422 (code-less) | reason missing or under 5 characters on apply; coverage spanning two regions |
| 422 `PINCODE_OUTSIDE_FRANCHISEE` | supplied pincodes the target does not own (names them and their owners); or no pincode of the technician's is inside the target's area and none supplied |
| 409 `TECHNICIAN_HAS_OPEN_JOBS` | one or more non-terminal tickets assigned to them |
| 409 `TECHNICIAN_HAS_BALANCE` | redeemable balance > 0, or a redemption neither confirmed nor declined |
| 409 `FRANCHISEE_HAS_NO_ADMIN` | **new** — target is not home and has no active franchisee admin |
| 409 (code-less) | target is the technician's current franchisee; target is inactive |

Transaction: §4.5 steps 2–9 are **one** commit; the only thing outside it is the push. A dry run reads, rolls back,
and writes nothing, takes no lock.

**Traps in the service (carry into the commit message):**

1. **Order of locks**: routing (shared) → profile row. Task 03's carve-out takes routing (exclusive) → profile
   updates; same order, no deadlock.
2. **A race this does not close, on purpose.** `jobs/service.accept` does not lock the profile row, so an accept
   that lands in the instant between our open-job count and our commit leaves the technician holding a job whose
   ticket is stamped the **old** franchisee. That is exactly the state a carve-out already leaves (F6: *assigned
   jobs keep their franchisee*), the job completes normally, and its money is stamped to the technician's
   franchisee **at write time** (the new one). It is a one-job, one-minute window that needs a human pressing Move
   at the moment a technician takes a job; it is documented, not locked.
3. `memberships` are not touched (D4, D13) — no token or session needs reissuing.
4. `request_upi_change` must take the profile `FOR UPDATE` (one-line edit in §4.1): otherwise a request computed
   against the old franchisee could commit just after step 8.4 and be addressed to people who now get 404.

---

## 5. Client changes — adminWeb (staff console)

Mobile: **none.** The app needs no change (D9: a `job`-type push is handled by installed builds; no new ledger
kind, status or field, so index X4 is untouched).

### 5.1 Where it lives

| File | New / edit | What |
|---|---|---|
| `adminWeb/src/pages/technicians/TechnicianProfilePage.tsx` | edit | A **Move to another franchisee** button beside *Edit details* / *Remove*, shown when `useFeatureAccess().has("franchisees.manage")` — **not** gated on `tech.canManage` (that is the point of the action; an Admin/NH opening a SkyFix technician sees Task 08's *Run by SkyFix…* notice **and** this button). Mounts the dialog once `tech` has arrived. Below the stats, a `TechTransferHistory` card. |
| `adminWeb/src/components/technicians/TransferTechnicianDialog.tsx` | **new** | The dialog (§5.2). |
| `adminWeb/src/components/technicians/transferPlan.ts` | **new, pure** | The logic the dialog renders (§5.5): `reasonProblem`, `coverageSummary`, `blockerLines`, `canConfirm`, `targetOptions`, `historyLine`. No React. |
| `adminWeb/src/components/technicians/TechTransferHistory.tsx` | new | The history line(s) (§5.3). |
| `adminWeb/src/services/technicians.ts` | edit | `previewTransfer(id, body)`, `transferTechnician(id, body)`, `getTransfers(id)`; types `TechnicianTransfer`, `TechnicianTransferResult` in `types/api.ts`. |
| `adminWeb/src/hooks/useTechnicians.ts` | edit | `useTransferPreview(id, body, {enabled})` (a `useQuery` keyed on `[technicianKeys.detail(id), "transfer", body]`, `enabled` only once a franchisee is picked, debounced with `useDebouncedValue`), `useTransferTechnician()` (mutation; on success invalidates the technician detail, the list, the transfers key, and `franchisees` counts), `useTechnicianTransfers(id)`. |
| `adminWeb/src/lib/errorCodes.ts` | edit | `TECHNICIAN_HAS_OPEN_JOBS`, `TECHNICIAN_HAS_BALANCE`, `FRANCHISEE_HAS_NO_ADMIN` (mirroring the server), so the apply error maps to the right place in the dialog rather than a toast. |

`useFranchiseeOptions({ enabled: has("franchisees.view") })` (Task 08) feeds the select; it already returns active
**and** inactive franchisees, home first.

### 5.2 The dialog — `TransferTechnicianDialog`

A wide `Dialog`. Opens idle; the preview runs as soon as a franchisee is chosen (and again when a pincode is
changed). **Move** is disabled until the preview has returned with `canTransfer` **and** the reason passes
`reasonProblem`.

| State | What the person sees |
|---|---|
| **Idle** | Intro, the "keeps" line, *Move to* select (current franchisee excluded; inactive ones disabled with *(inactive)*), reason box. No coverage block. **Move** disabled. |
| **Checking** | *Checking what would change…* with the skeleton (`aria-busy`). |
| **Preview, clear** | A green `pill-ok` *Nothing is in the way…*; the coverage block: **Stays (n)** chips, **Taken off (n)** chips (struck through, warn colour) with a hint, **Added (n)** when custom; a `Choose different pincodes instead` disclosure that swaps in Task 08's `CoverageFields` (limited to the target's area) and re-previews; any non-blocking **warnings** as `pill-warn`. **Move** enabled once the reason is ≥ 5. |
| **Blocked: open jobs** | A red `pill-err` *{name} still has {n} open job(s). Finish or reassign them first.* **Move** disabled. |
| **Blocked: balance** | *{name} still has {amount} waiting to be redeemed. Let them redeem it and be paid, then move them.* — or, for an open redemption, *… has a redemption ({code}) that has not been settled. Settle it first.* **Move** disabled. Both can show at once, jobs first. |
| **Blocked: nothing inside the range** | *None of {name}'s pincodes is inside {to}'s area. Choose the pincodes {to} should serve.* — the *Choose different pincodes* panel opens itself. |
| **Blocked: target has no admin** | *{to} has no active admin yet. Add one first…* with a link to the franchisee. |
| **Applying** | **Move** shows a spinner, *Moving…*; the form is read-only. |
| **Apply error** | A race the preview could not see (someone took a job in the meantime): the server's message in a `pill-err` above the footer; the preview re-runs. |
| **Success** | Dialog closes; toast *{name} now works for {to}*; the profile shows the new franchisee and a new history line. |

Accessibility: errors are `role="alert"`; **Move** is a real `<button disabled>`; the select is the existing
`Select`/`Combobox` (a combobox when the company has more than ten franchisees, per Task 08's convention).

### 5.3 Transfer history on the profile

`TechTransferHistory` sits under `TechOnboardingCard`: a card **Transfer history** (*Every time this technician
changed franchisee*). One line per row, newest first:
`16-10-2026 · Acme Appliances → SkyFix Services · by Nisha Rao`, with the reason in quotes and
*2 pincodes stayed · 1 taken off (500045)* beneath. Empty: *Never moved. Works for {franchisee} since
{joined date}.* (Joined date = the profile's `createdAt`.) Loading and error states: a skeleton and
`ErrorState` with *Retry* (hard rule 5 of the console).

### 5.4 Who sees the action

| Viewer | Sees *Move to another franchisee* | Sees history |
|---|---|---|
| Admin, National Head | yes — on any technician, home or not | yes |
| Regional Head, Area Manager | no (`franchisees.manage` is Admin/NH) | yes, for technicians in their scope |
| Franchisee admin (portal) | no — the portal has no such action | no |
| Facility staff, vendor | no | no |

### 5.5 Pure logic — `transferPlan.ts` and its vitest cases

```ts
export const MIN_REASON = 5;
export function reasonProblem(text: string): string | null;                 // trims; mirrors the server
export function coverageSummary(p: { keptCount: number; trimmedCount: number; addedCount: number }): string;
    // "2 stay · 1 taken off", "2 stay · 1 taken off · 1 added", "All 3 stay"
export function blockerLines(blockers: TransferBlocker[]): string[];        // server order kept; messages as sent
export function canConfirm(preview: TransferResult | undefined, reason: string, busy: boolean): boolean;
export function targetOptions(opts: FranchiseeOption[], currentId: string):
    { value: string; label: string; disabled: boolean }[];                  // current excluded; home first; "(inactive)" disabled
export function historyLine(row: TechnicianTransfer): { head: string; detail: string };
```

`adminWeb/src/components/technicians/transferPlan.test.ts` (vitest, no DOM):

1. `reasonProblem`: `""`, `"   "`, `"abcd"` → a message; `"abcde"`, `"  abcde  "` → `null`; 256 chars → a message.
2. `coverageSummary`: kept 3/0/0 → `"All 3 stay"`; 2/1/0 → `"2 stay · 1 taken off"`; 0/0/2 → `"0 stay · 2 added"`.
3. `blockerLines` keeps the server's order (jobs before balance) and does not reword it.
4. `canConfirm`: `false` for no preview; `false` while `blockers.length > 0`; `false` with a 4-character reason;
   `false` while `busy`; `true` for a clean preview and a 5-character reason.
5. `targetOptions`: excludes the current franchisee; home sorts first; an inactive one is `disabled` and its label
   ends `(inactive)`.
6. `historyLine`: a row with trimmed codes → detail names them; with none → *"All 3 pincodes stayed"*.

`TransferTechnicianDialog.test.tsx` (vitest + Testing Library): **Move** is disabled with no franchisee; after a clean
preview and a 5-character reason it is enabled; a preview with `TECHNICIAN_HAS_OPEN_JOBS` renders that sentence and
keeps it disabled; a trimmed code renders in the *Taken off* group; submitting calls the mutation with
`{ franchiseeId, reason }` and **no** `pincodes` key unless the person chose some.
`TechnicianProfilePage` test: the button is absent without `franchisees.manage`, present with it, and present on a
technician whose `canManage` is `false`.

### 5.6 Mock

`RequirementDocs/FranchiseeMockScreens/17-technician-transfer.html` shows the profile with the new action, the
dialog in every state of §5.2, and the history line. (The coordinator adds it to `index.html`.)

### 5.7 PROPOSED copy (needs owner sign-off — index X2, §7). `{company}` is `useBrand().name`; no product name.

| Where | String |
|---|---|
| Profile button | Move to another franchisee |
| Dialog title | Move {name} to another franchisee |
| Intro | {name} works for {from} today. After the move they are offered {to}'s jobs instead, and {to} manages and pays them. |
| Keeps line | They keep their categories, daily limit, base location, UPI details, language and sign-in. Jobs and money already earned stay with {from}. |
| *Move to* label · placeholder | Move to · Choose a franchisee |
| Option suffixes | (home) · (inactive) |
| Reason label · placeholder · hint | Why is {name} moving? · e.g. Moved to the east side of the city, which {to} now covers · Kept on their record. At least 5 characters. |
| Coverage heading | Where they will work |
| Coverage groups | Stays ({n}) · Taken off ({n}) · Added ({n}) |
| Taken-off hint | Outside {to}'s area, so these come off their coverage. |
| Custom link | Choose different pincodes instead · Use their current pincodes again |
| Region line | They will work in {region}. (shown only when it changes) |
| Checking | Checking what would change… |
| Clear banner | Nothing is in the way. {name} can move now. |
| Blocked: jobs | {name} still has {n} open job(s). Finish or reassign them first. |
| Blocked: balance | {name} still has {amount} waiting to be redeemed. Let them redeem it and be paid, then move them. |
| Blocked: redemption | {name} has a redemption ({code}) that has not been settled. Settle it first. |
| Blocked: nothing left | None of {name}'s pincodes is inside {to}'s area. Choose the pincodes {to} should serve. |
| Blocked: outside (custom) | Not in {to}'s area: {codes}. Pick pincodes {to} owns. |
| Blocked: no admin | {to} has no active admin yet. Add one first, or nobody can approve {name}'s UPI changes or pay their redemptions. |
| Blocked: same / inactive | {name} already works for {to}. · Activate {to} before moving technicians to it. |
| Warning: owes | {name} owes {amount} from earlier penalties. It stays in their balance and comes off their next payouts, which {to} will pay. |
| Warning: UPI change | A UPI change is waiting. It moves with them, and {to}'s reviewer is asked. |
| Warning: base | Their base location was set from pincode {code}, outside {to}'s area. It is kept as it is. |
| Buttons | Cancel · Move {name} · Moving… |
| Toast | {name} now works for {to} |
| History card | Transfer history · Every time this technician changed franchisee |
| History line | {date} · {from} → {to} · by {who} |
| History detail | “{reason}” · {k} pincodes stayed · {t} taken off ({codes}) |
| History empty | Never moved. Works for {franchisee} since {date}. |
| Bell (joining) | {name} joined {to} · {code} · from {from} · {reason} |
| Bell (leaving) | {name} moved to {to} · {code} · from {from} · {reason} |
| API messages | Preview — nothing was saved · Technician moved · every refusal sentence in §4.2/§4.5/§4.9 |
| Push `technician.moved` (en) | **You now work with {franchisee}** — Your jobs, pay and pincodes now come from {franchisee}. Open the app to refresh. (hi/te/kn/ta follow `src/i18n/README.md` and are queued for native review) |

---

## 6. Unit tests (pytest, pure — X1; no database)

`api/tests/unit/test_technician_transfer.py` — `app.core.technician_transfer`. `H`, `S`, `T` are three UUIDs.

`plan_coverage`
1. current `{500031, 500032}`, routes all → S, target S, supplied `None` → kept both, trimmed none, `changed` False.
2. current `{500031, 500045}`, routes 500031→S, 500045→H, target S → kept `(500031,)`, trimmed `(500045,)`, source `"kept"`.
3. current all → H, target S, supplied `None` → `nothing_left` True, `final == ()`, trimmed = every code.
4. supplied `["500033", "500031"]`, routes both → S → `final == ("500031","500033")` sorted, added `("500033",)`, source `"supplied"`.
5. supplied includes `500045` (→ H), target S → `outside == ("500045",)` and `nothing_left` False.
6. supplied `[]` → `nothing_left` True.
7. supplied with duplicates and unsorted input → de-duplicated, sorted.
8. a supplied code absent from `routes` → counted as outside (fail closed).
9. supplied equal to current → `changed` False.
10. Target H (home) with routes giving H for unowned codes → the same function, no special case.

`single_region`
11. one id → it; empty set → `None`; two ids → `ValueError`.

`transfer_blockers`
12. all clear → `[]`.
13. `same_franchisee` → one blocker, `code is None`.
14. target inactive → code-less blocker naming the target.
15. non-home, `target_active_admins == 0` → `FRANCHISEE_HAS_NO_ADMIN`; **home** with 0 admins → none.
16. `open_jobs=1` → `TECHNICIAN_HAS_OPEN_JOBS`, `open_jobs == 1`, message singular; `open_jobs=3` → plural.
17. `redeemable_paise=124000` → `TECHNICIAN_HAS_BALANCE`, message contains `₹1,240`.
18. `redeemable_paise=0`, `open_redemption_code="RGT-RDM-0007"` → `TECHNICIAN_HAS_BALANCE` naming the code.
19. `redeemable_paise=-50000` (owes) → **no** blocker.
20. open jobs and balance together → both, jobs first (stable order).
21. plan with `outside` → `PINCODE_OUTSIDE_FRANCHISEE` last; plan with `nothing_left` → the "none of … is inside" sentence.

`transfer_warnings`
22. `redeemable_paise=-50000` → one warning containing `₹500`; `0` / positive → none.
23. `pending_upi_change` → a warning; `base_pincode_outside` → a warning naming the pincode.

`reason_problem`
24. `None`, `""`, `"abcd"`, 4 chars with spaces → message; `"abcde"`, `"  abcde "` → `None`; 256 chars → message.

`transfer_notices`
25. returns two pairs; titles ≤ 160 and details ≤ 255 for a 255-character reason (cut with `…`); no pair contains the string `"Reliance"`.
26. `NOTIFICATION_KIND == "technician_moved"` and `len(...) <= 24`.

`api/tests/unit/test_push_text.py` (extend if it exists): `technician.moved` renders in all five languages with
its `{franchisee}` placeholder (the module's own `_check()` already enforces this at import).

---

## 7. Acceptance criteria

Against **RelianceDB** (dev) with the local API. Writes only in **GreenTech Demo Services** (QA's "Testing
Company" is read-only). Setup: company A = GreenTech Demo Services with home **H** and external **S** owning
`500030-500040` with an active admin **Priya** (Task 03); **Nisha** (NH), **Kiran** (AM, a state holding S's codes);
**Ravi** = an H freelancer covering `500031, 500032, 500045`, certified Television + Audio, `daily_job_cap` 6,
a UPI ID, a base location, no open job, redeemable balance 0; company B has a franchisee and a technician.

```bash
API=http://localhost:8000/api/v1
login() { curl -s $API/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"<PASSWORD>\"}" | jq -r .data.accessToken; }
NH=$(login nh.demo@seed.example.com); H1="Authorization: Bearer $NH"
curl -s -X POST "$API/technicians/$RAVI/transfer?dryRun=true" -H "$H1" -H 'content-type: application/json' \
  -d "{\"franchiseeId\":\"$S\"}" | jq
```

1. **Migration.** **Given** dev at `d6c3a9f1e874`, **when** `alembic upgrade head`, **then**
   `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'technician_transfers'::regclass`
   lists the four CHECKs, the three composite FKs and the primary key; the FK-coverage query (`api/AGENTS.md`
   rule 6) returns nothing for the table; `python -m app.scripts.audit_tenancy` exits 0;
   `python -m app.scripts.cleanup_db --check` exits 0. **When** `downgrade d6c3a9f1e874` then `upgrade head`,
   **then** it succeeds with 0 rows; with one row inserted the downgrade raises *"1 technician transfer(s) are
   recorded…"*.
2. **Dry run changes nothing.** **When** the call above runs, **then** 200, `dryRun: true`, `coverage.kept = ["500031","500032"]`,
   `coverage.trimmed = ["500045"]`, `blockers = []`, `canTransfer: true`, `transfer: null`; and before/after counts
   are equal for `SELECT franchisee_id FROM technician_profiles WHERE id=:r`, `SELECT count(*) FROM technician_pincodes WHERE technician_id=:r`,
   `SELECT count(*) FROM technician_transfers`, and `SELECT count(*) FROM notifications WHERE kind='technician_moved'`.
3. **Apply.** **When** the same body plus `"reason":"Ravi moved east; SkyFix will run his area"` is POSTed without
   `dryRun`, **then** 200, `message: "Technician moved"`, `transfer.byName` = Nisha; and
   `SELECT franchisee_id FROM technician_profiles WHERE id=:r` = S;
   `SELECT array_agg(pincode ORDER BY pincode) FROM technician_pincodes WHERE technician_id=:r` = `{500031,500032}`;
   `SELECT from_franchisee_id, to_franchisee_id, coverage_before, coverage_after, reason, transferred_by_user_id FROM technician_transfers WHERE technician_id=:r`
   = (H, S, `["500031","500032","500045"]`, `["500031","500032"]`, the reason, Nisha's user id).
4. **What did not move.** **Then** `technician_nodes` count, `daily_job_cap`, `accepting_work`, `status`,
   `base_latitude/longitude/pincode/source`, `upi_id`, `upi_name`, `technician_type`, `appointed_by_*`
   are unchanged (compare a before/after `SELECT md5(row(...)::text)`); `SELECT md5(m::text) FROM memberships m WHERE id=:ravi_membership`
   is unchanged unless the region changed; `SELECT count(*) FROM tickets WHERE technician_id=:r AND franchisee_id <> :H` = 0;
   `SELECT count(*) FROM ledger_entries WHERE technician_id=:r AND franchisee_id <> :H` = 0;
   `SELECT count(*) FROM redemptions WHERE technician_id=:r AND franchisee_id <> :H` = 0; and the md5 of
   `SELECT id::text || franchisee_id::text FROM tickets WHERE technician_id=:r ORDER BY id` is identical before and after.
5. **Open job.** **Given** Ravi holds an `Assigned` ticket, **when** the dry run runs, **then** 200 with a blocker
   `TECHNICIAN_HAS_OPEN_JOBS`, `openJobs: 1`, `canTransfer: false`; **when** applied, **then** 409 with
   `"code": "TECHNICIAN_HAS_OPEN_JOBS"`, and nothing is written (profile franchisee still H, no new
   `technician_transfers` row, no new `technician_moved` bell). **When** the ticket is closed, **then** the apply is 200.
6. **Balance and open redemption.** **Given** a `payout` of ₹1,240 unredeemed, **then** the dry run lists
   `TECHNICIAN_HAS_BALANCE` with `redeemablePaise: 124000` and the apply is 409 with that code. **Given** Ravi
   redeems it (`POST /redemptions/me`), **then** the apply is still 409 `TECHNICIAN_HAS_BALANCE`, now naming the
   redemption code, in states `to_pay` **and** `awaiting` (claimed, not confirmed). **When** the payer claims and Ravi
   confirms (`confirmed_at IS NOT NULL`), **then** the apply is 200. **Given** a *declined* redemption, **then** it
   does not block.
7. **Negative balance moves, with a warning.** **Given** a ₹500 penalty and no payout (balance −50000), **then**
   the dry run has `blockers: []` and a `warnings` entry containing `₹500`; the apply is 200.
8. **Nothing left.** **Given** Ravi covers only `500045` and the body has no `pincodes`, **then** the dry run shows
   `coverage.after = []`, a blocker `PINCODE_OUTSIDE_FRANCHISEE`, and the apply is **422** `PINCODE_OUTSIDE_FRANCHISEE`
   with the "None of … is inside …" sentence; `technician_pincodes` unchanged. **When** the body adds
   `"pincodes":["500033"]`, **then** 200 and `coverage_after = ["500033"]`, `coverage.added = ["500033"]`,
   `coverage.trimmed = ["500045"]`.
9. **Supplied coverage outside the range.** `"pincodes":["500033","500001"]` → 422 `PINCODE_OUTSIDE_FRANCHISEE`
   naming `500001` and its owner (the staff variant of the sentence); nothing written.
10. **Region.** **Given** the target's only codes are in another region than Ravi's and `pincodes` names them,
    **then** 200, `coverage.regionChanged: true`, and `SELECT region_id FROM technician_profiles WHERE id=:r` is that
    region; **given** `pincodes` spanning two regions, **then** 422 naming both, nothing written.
11. **Back to home.** **Given** Ravi at S covering `500031, 500032, 500060` (500060 is home's), **when** Nisha moves him
    to H with no `pincodes`, **then** 200, kept = codes **no franchisee owns** (`500060`), trimmed = `500031, 500032`
    (S owns them). **Given** he covered only S's codes, **then** 422 as in 8.
12. **Pool cut-over.** **Given** a `New` ticket **T** for `500032` stamped S and a `New` ticket **U** for `500045`
    stamped H, both in Ravi's categories: **before** the move Ravi's `GET /jobs/pool` lists **U** and not T;
    **after** it lists **T** and not U (he no longer covers 500045); `POST /jobs/{U}/accept` as Ravi → 404;
    `SELECT … technicians_covering` for T includes Ravi; `POST /tickets/{U}/assign` of Ravi by Kiran →
    409 `TECHNICIAN_INELIGIBLE` ("works for another franchisee"); assigning T to Ravi → 200.
13. **Money lands where it should.** **Given** Ravi closes a job for T, **then**
    `SELECT kind, franchisee_id FROM ledger_entries WHERE technician_id=:r ORDER BY created_at DESC LIMIT 1` =
    (`payout`, S); `GET /franchise/ledger/pool` (Priya) changes by that job only and `GET /ledger/pool` (H) does not;
    **given** an old H penalty on Ravi, Nisha reverses it from the ticket page → the `reversal` row has
    `franchisee_id = H`, and H's pool moves, S's does not.
14. **Payer.** **When** Ravi redeems after the move, **then** `SELECT franchisee_id FROM redemptions WHERE id=:r2` = S; the
    bell is `audience='franchisee_admin', franchisee_id=S`; `GET /redemptions/me` → `payerLabel: "Franchisee Admin"`;
    Priya's `GET /franchise/redemptions/count` = `{ "toPay": 1 }`; Nisha's `POST /redemptions/{id}/claim` → 404.
15. **Cap carries.** **Given** ₹500 of penalties this IST month under H and another ₹300 under S,
    `SELECT sum(amount_paise) FROM ledger_entries WHERE technician_id=:r AND kind='penalty' AND created_at >= :month_start`
    = 80000 and the cancellation preview's remaining room = cap − 80000 (the cap is the technician's).
16. **Employee statement.** **Given** Ravi is an employee with `bonus` rows under H and S in the month, **then**
    `GET /franchise/statements/{ravi}?month=…` as Priya lists only S rows; `GET /ledger/statements/{ravi}?month=…`
    as Nisha lists only H rows; the old franchisee can still download the month (Task 06's second clause).
17. **Pending UPI change.** **Given** Ravi has a `pending` change with `reviewer_role='area_manager'`, **when**
    moved to S, **then** `SELECT reviewer_role FROM upi_change_requests WHERE technician_id=:r AND status='pending'`
    = `franchisee_admin`; a new `upi_change` bell exists with `audience='franchisee_admin', franchisee_id=S`;
    Priya's `GET /franchise/upi-changes?state=pending` lists it; Kiran's bell list does not.
18. **Bells and push.** **Then** `SELECT audience, franchisee_id, pincode, title FROM notifications WHERE kind='technician_moved' ORDER BY created_at DESC LIMIT 2`
    shows the joining row (`franchisee_admin`, S, NULL, "Ravi Kumar joined …") and the leaving row (`NULL`, H, NULL,
    "Ravi Kumar moved to …"); Priya's `GET /notifications` includes the first and not the second; Nisha and Kiran's
    include the second and not the first; Hari (H's franchisee admin, if any) includes the second; **a second
    franchisee's admin** includes neither. The server log shows one `technician.moved` push to Ravi's device(s) with
    `data.type = "job"` and no `ticketId`.
19. **Authorization and tenancy.** Kiran (AM) → **403**; Priya (franchise admin) → **403**; a vendor user → **403**;
    Nisha with company B's technician id → **404**; with company B's franchisee id → **404**; with a random uuid → **404**;
    for company A's technician with a *deleted* franchisee → **404**. `GET /technicians/{id}/transfers` as Kiran for a
    technician in scope → 200, for one out of scope → 404, as Priya → 403.
20. **Validation.** `reason` of 4 characters → 422; missing `reason` on apply → 422 but **200** on `dryRun`;
    target = current franchisee → 409 (code-less); target inactive → 409 *"Activate … first"*; target a **new
    non-home franchisee with no admin** → 409 `FRANCHISEE_HAS_NO_ADMIN`; the same target when it is **home** → 200.
21. **History.** After 3 and 11, `GET /technicians/{ravi}/transfers` returns two rows newest first, with
    `fromFranchiseeName`, `toFranchiseeName`, `byName`, `reason`, `kept/trimmed/added`; the profile page renders the
    line (§5.3). `seed/verify.py`'s new check passes.
22. **Concurrency.** `curl … & curl … & wait` of the same apply twice → exactly one 200, the other 409 (code-less,
    *"already works for…"*), one `technician_transfers` row. Ravi's `POST /redemptions/me` fired at the same moment as
    a transfer: either the redemption is created and the transfer answers 409 `TECHNICIAN_HAS_BALANCE`, or the
    transfer commits and the redemption is stamped S —
    `SELECT count(*) FROM redemptions r JOIN technician_profiles tp ON tp.id=r.technician_id WHERE r.franchisee_id <> tp.franchisee_id AND r.confirmed_at IS NULL AND r.declined_at IS NULL`
    is 0.
23. **Console.** In the browser (`npm run dev`, `:5173` → local `:8000`): Nisha sees the button on Ravi's profile; an
    Area Manager does not; the dialog shows each state of §5.2 with the data above; **Move** is disabled until the
    reason has 5 characters and the preview is clear; after Move the profile's franchisee reads *SkyFix Services*, the
    history card shows the line, and the technician list reflects the new Franchisee column without a reload
    (the mutation invalidates the list).
24. **Gates.** `pytest api/tests/unit -q` green; `npm run lint && npm run typecheck && npm test` green in `adminWeb/`;
    `python -c "import app.main"` succeeds; `python -m app.scripts.audit_tenancy` exits 0.

---

## 8. Out of scope, traps and index notes

**Dependencies (all must be on the branch):** Task 01 (`franchisee_id` columns, `home_franchisee_id`,
`franchisees_for_pincodes`), 02 (`franchisees.manage`, `require_staff_principal`, `Principal.is_franchise`), 03
(`lock_routing`, `franchise_logins.active_admin_count`), 04 (`codes_outside` / `outside_message`, the five
eligibility places), **05** (`upi_reviewer` three-tuple, `_open_job_count`, `audience.hears`,
`notifications.franchisee_id`, the franchise portal's reads of technician/ledger/redemption), **06**
(`core.ledger.redeemable_balance`, the freelancer stream, statements), **08** (`useFranchiseeOptions`,
`TechnicianProfilePage`'s `canManage` notice, `TechProfileHeader`'s Franchisee fact) and **09** (the portal that
the moved technician now appears in). Task 12 only fixes the migration's position in the chain.

**Release gate.** Ship as its own small release, **R9 — Technician transfer (Task 17)**, after R8 (so the chain is
exactly as written). It is additive (one new table), so the rollback is *redeploy R8's API; schema stays* — the
downgrade refuses once a row exists. Order: owner migrates `RelianceProdDB` to `e8a2c5b7d913` → publish the API →
deploy the console (`web-prod-deploy.yml`; the console's button gets a 404 from an API that predates the route, so
**API first**). Gate (c): PROPOSED copy §5.7 signed off, including the push text and its four translations queued for
native review. It does not depend on R4's Play gate: no ledger kind, status or response field the app parses is added.
It *could* ride R3 by re-pointing `down_revision` to `7c4f2e9a1d58` and re-pointing Task 12's migration onto it —
not recommended.

**Out of scope:** changing `technician_type` in the same call (D3); bulk transfer; a technician-initiated request to
move; undo (D14); moving *invites*; any franchisee↔company money (F11); moving a technician's **open** jobs with
them (refused instead, D2); a portal screen for the transfer or its history; re-validating a base location against
the new range (kept as is, a warning is shown).

**Traps**

1. **Do not use `_load_managed`** on the transfer route — it 403s every non-home technician for an Admin/NH.
   The authority is `franchisees.manage` (§2). The corollary: `require_staff_principal` must already refuse
   `FRANCHISE_ROLES` (Task 02 §4.1) — verify it, do not assume.
2. **Do not write `UPDATE tickets`, `UPDATE ledger_entries` or `UPDATE redemptions`.** "History stays where it
   was earned" is the whole design; the §7.4 md5 checks are the proof, and a later "helpful" re-stamp would
   silently restate a closed job and a pool.
3. **Coverage must stay non-empty** (`ck_technician_transfers_coverage_shape` and the 422). A technician with zero
   coverage is matched by nothing and vanishes silently — the exact failure Task 04 refuses.
4. **The push has no `ticketId`** (the `penalty.reversed` precedent): a tap opens the app; an id would route to a
   job screen that 404s. Never add one.
5. **Never reuse `payer_role(company)` for the moved technician's next redemption** — Task 05 already passes the
   profile's `franchisee_id`; the transfer relies on that being read live.
6. **`franchisee_audience` CHECK** (`audience = 'franchisee_admin'` needs a `franchisee_id`): both bells set it.
7. **Every new `notifications.kind` ≤ 24 characters** — `technician_moved` is 16 and already allowed; this task adds none.
8. **White-label:** no product name in any sentence; the push and bells name the franchisee and the technician only.
9. The documented accept race (§4.9 trap 2) — one job can end up with the old franchisee stamped on its ticket.

**Index additions / changes for the coordinator to fold in** (this task edits no shared file):

* `00-index.md` §4 task row **17** (`17-technician-transfer.md`, *Move a technician between franchisees*, api + web, depends on **05, 06, 08, 09**).
* §3.1 new table **`technician_transfers`** (Task 17): `id, company_id, technician_id, from_franchisee_id, to_franchisee_id, technician_type, reason, coverage_before, coverage_after, transferred_by_user_id, transferred_by_label, transferred_at` + audit.
* §3.3 error code **`FRANCHISEE_HAS_NO_ADMIN`** (409, Task 17); note that `TECHNICIAN_HAS_OPEN_JOBS` / `TECHNICIAN_HAS_BALANCE` / `PINCODE_OUTSIDE_FRANCHISEE` are reused; `notifications.kind` `technician_moved` is also written by Task 17; push key `technician.moved`.
* §3.6 migration row **7**: `e8a2c5b7d913` · `e8a2c5b7d913_technician_transfers.py` · `d6c3a9f1e874` · Task 17.
* §3.7 helpers: `app/core/technician_transfer.py` (pure), `app/models/technician_transfer.py`, `core.ledger.open_redemption_exists`, `features/technicians/transfer_service.py`.
* §6c **R11** — *Transfer action: Admin/NH may move a technician between franchisees (home ⇄ external); same refusals as a type change; history stays; audited* (2026-10-16).
* §7 checklist: *17 Technician transfer dialog and push*.
* `16-rollout-and-docs.md`: release **R9**, the §3.1 chain row, §3.4 read-only verification (`SELECT count(*) FROM technician_transfers`), §5.5 TENANT_LINKS 18 → 21, §5.3 `cleanup_db` classification, `AGENTS.md` updates (root: one sentence under the franchisee section; `api/AGENTS.md`: "Moving a technician between franchisees"), and a rollback row (*Yes, additive; downgrade refuses once a row exists*).
* `FranchiseeMockScreens/index.html`: a tile for `17-technician-transfer.html`.

**Open for the owner**

1. **A technician who owes money (negative balance) can move** (D7). The debt is an old-franchisee penalty already
   collected into the **old** pool; the **new** franchisee's payouts will then offset it, so the new franchisee
   effectively pays down a debt the old one was credited with. Allowed and warned, consistent with the type-change
   rule. If that is not wanted: refuse `redeemable_balance < 0` as `TECHNICIAN_HAS_BALANCE` — one line in
   `transfer_blockers`, one test.
2. **Trimming without a preview is possible for an API caller** (D12). Console callers always preview.
3. **The 60-second socket window** (§4.7 #5) is accepted; closing it would need a per-technician realtime frame.

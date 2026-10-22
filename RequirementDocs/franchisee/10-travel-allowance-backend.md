# Task 10 — Travel allowance (backend)

> Layer: **api** · Depends on: **07** (and through it 01–06) · Migration: **`9e1b5d3c7a26`**
> (`down_revision = "7c4f2e9a1d58"`) · Release gate: **X4 as amended by index §6a** — Task 07 live on
> the Play production track AND ≥ 90 % of active technicians on that build before this API is published.
>
> Read [`00-index.md`](00-index.md) first. Every name below (tables, columns, ledger kind, feature keys,
> helpers, error codes) is the index's. Where this document had to add a name the index does not have, it
> says so and marks it **Decision (writer)**.

---

## 1. Goal and why

A technician who drives a long way to a job is paid for the distance. The rules belong to the
**franchisee** that runs the technician (TA3), differ for **employees and freelancers** (TA4), and are
**frozen when the job is accepted** (TA5) so that nothing moved later — the technician's base, the
franchisee's rates — rewrites what an accepted job was worth. The money is paid **when the customer
confirms the closure** (TA6), as a new ledger kind `travel`, which is **not** pool money.

What this task builds:

1. A **base location** on every technician (where they start from), set by the technician or by whoever
   manages them.
2. **Travel rules** per franchisee × technician type, stamped when a franchisee is created.
3. **`tickets.accept_snapshot`** — written on accept and on manager-assign, cleared on release.
4. The **`travel` ledger row** on customer closure, an optional one on force-closure, and travel in every
   reader of a technician's own money (Earnings, redemption balance).

### Worked example (plain words first)

Ravi is a SkyFix freelancer. His base is the centre of pincode 500049. A customer in 500032 raised a
ticket; the ticket has no map point (it was typed), so the customer point is 500032's pincode centre.

| Step | Value |
|---|---|
| Straight line, base → customer (`core.coordinates.metres_between`) | 27,000 m = **27.0 km** |
| × road factor 130 % (SkyFix's freelancer rule) | 27.0 × 1.30 = **35.1 km** (one way, TA1) |
| − free distance 20 km | 15.1 km beyond the free distance |
| ÷ step 2 km, partial steps dropped (TA3) | 15.1 / 2 = 7.55 → **7 steps** |
| × ₹10 per step (1,000 paise) | **₹70** (7,000 paise) |
| Cap: `max_paise_per_job` ₹300 | min(₹300, ₹70) = **₹70** |

Ravi accepts at 11:00. The snapshot freezes all of the above. At 14:00 he moves his base to 500001 — the
job still pays ₹70. At 18:00 SkyFix raises the rate to ₹15/step — the job still pays ₹70. The customer
confirms the next morning: the ledger gains a `payout` row (the product's price) **and** a `travel` row of
7,000 paise, both carrying `franchisee_id = SkyFix`.

Had the job been 120 km away: 120 × 1.3 = 156 km → 136 km beyond free → 68 steps → ₹680 → **capped at
₹300**.

Had Ravi never set a base: the job is still accepted (TA8), the snapshot says
`reason: "no_base_location"`, the amount is ₹0 and no `travel` row is written at closure. A manager
force-closing that job may still pay travel up to the frozen cap (TA6), because the cap is recorded even
when the distance could not be measured.

---

## 2. Decisions

Owner decisions this task implements: **TA1–TA8, G1, G2, T1 (type frozen at accept), T3 (employees get
travel), F7/F8 (who edits), F12 (travel is not pool money), X1, X4, X5.** They are not repeated here.

Judgement calls made while writing this document:

| # | Decision (writer) | Why |
|---|---|---|
| W1 | **The arithmetic is done in integer tenths of a kilometre.** `road_km` rounds half-up to 0.1 km; `travel_amount_paise` converts the km it is given back to integer tenths before subtracting and dividing. | The snapshot stores `km` to one decimal and the technician sees it. If the amount were computed from unrounded metres, a job shown as "22.0 km" with free 20 / step 2 could pay 0 steps (21,960 m), and nobody could reproduce the figure from what is on screen. Integer tenths also remove float drift (`26.000000000000004 − 20`). |
| W2 | **`max_paise_per_job = 0` means ₹0, literally** (TA3's `min(max, …)`), so the PUT **refuses** `paisePerStep > 0` with `maxPaisePerJob = 0` (422). | TA4 makes `0/0` the "off" state. A franchisee admin who types a rate and forgets the cap would otherwise get a silent ₹0 on every job. Refusing at the form is cheaper than a support call. Turning it off = rate 0. |
| W3 | **The snapshot is built BEFORE the guarded UPDATE and written BY it** (`.values(..., accept_snapshot=snap)`), not by a second UPDATE afterwards. | One statement: the snapshot exists if and only if this technician won. A loser of the first-accept race wrote nothing. The reads it needs (one rule row, at most one pincode centre) are cheap. |
| W4 | **No travel estimate on the pool offer (`JobOfferOut`) — SETTLED by the owner 2026-10-15 (R10): travel is shown only AFTER accept.** | (a) `JobOfferOut` is the masked shape and "carries as little as it can" (`features/jobs/schemas.py`); a distance to 0.1 km from the technician's own base, when the ticket has a map point, is a ring around the customer's door. (b) The figure on the offer could differ from the frozen one if the base or rules change between viewing and accepting, and this codebase already treats "the figure shown is the figure paid" as a rule (`BALANCE_CHANGED` on redemptions). (c) `pool_query` is one of the five eligibility places and feeds `jobs/ws.py`; adding a pincode join to the hottest query and to the socket frame is a cost to take only for a feature the owner asked for. The computation itself is cheap (one batched pincode lookup per page + haversine per row), so *(settled — not to be built)*: a `travelEstimatePaise` on the offer was the alternative and the owner has ruled it out. Listed in §8. |
| W5 | **Force-close: `travelPaise` omitted = pay nothing**, exactly like `technicianPayoutPaise` and `vendorChargePaise`. The **console** pre-fills the frozen amount (Task 13) from the ticket detail's `travel.forceCloseDefaultPaise`. | `ForceCloseRequest`'s own doctrine: "a body that never mentioned this field came from a client that has never heard of it, and inventing [money] from silence is the one mistake here that takes somebody's money." The brief's "default = snapshot amount" is honoured as the **form's** default, not the schema's. Cap = frozen `maxPaisePerJob` (TA6), silently clamped like the other two. |
| W6 | **One `travel` row per ticket, structurally**: partial unique index `uq_ledger_entries_one_travel ON (company_id, ticket_id) WHERE kind = 'travel'`. | Both writers run on a transition into a TERMINAL status, so a second row is already unreachable — but the payout relies on that argument alone and this one costs nothing to make structural. A violation surfaces as the 409 `core/errors.py` already maps `IntegrityError` to. |
| W7 | **Base coordinates are COPIED onto the technician at set time**, even when the source is a pincode. | The base is then self-contained (one both-or-neither CHECK, no join at accept), and a pincode-master edit cannot silently move every base. Consequence in §8: a future pincode-centre correction must re-copy `base_source = 'pincode'` rows. |
| W8 | **Who may use which source.** Technician: `pincode`, `gps`, `map`. Manager / franchisee admin: `pincode`, `map`, `manual`. | A manager's GPS fix is the manager's location, not the technician's home. `manual` is coordinates typed into the console (a pasted lat/long), which a phone never sends. |
| W9 | **A pincode base must lie inside the technician's franchisee range** for everybody — technician and manager alike (TA7 says it for the technician; applying it to managers keeps one rule). Outside the range → use a map pin. | The rule exists so the base is not a free-text claim; a manager setting a pin is a deliberate act and stays available. |
| W10 | **Unknown, inactive, or another franchisee's pincode → 422 `PINCODE_OUTSIDE_FRANCHISEE`** — the same status Task 04 gives the same code, so one code has one status (index §6b, reconciled). In range but no coordinates → 400 **`PINCODE_HAS_NO_LOCATION`** (a NEW error code — in index §3.3). | All three outside cases have one remedy (drop a pin), so one code. The no-coordinates case needs its own because the remedy is the same but the reason shown is different, and G2's 301 pincodes without points are real. |
| W11 | **`BASE_OUTSIDE_INDIA` is a 400 `AppError`, not a pydantic 422.** The schema takes globe bounds (`core.coordinates.Latitude`), the service checks `INDIA_LAT/INDIA_LON`. | The app translates errors by `code` (`mobileapp/src/i18n/errorText.ts`); a 422 has no code. The DB CHECK still states the India box as the backstop. |
| W12 | **No base-location history table.** `base_set_at` and `base_set_by_user_id` say who last moved it. | Hard rule 8 is satisfied either way, but a history nobody reads yet is a table to argue about later; the frozen `basePoint` in each `accept_snapshot` already records what every PAID job used, which is the history that matters for money. See the abuse note in §8. |
| W13 | **Ticket detail never carries the base point's coordinates** — only its `source` and the distances. | A technician's home is personal data, and F7 says company staff may not edit a non-home franchisee's technicians. The per-job figure is ticket data (staff already see `technicianPayoutPaise` on every ticket, and must, to force-close), and since **owner ruling 2026-10-15 (R8)** staff (Area Manager and above) see the travel AMOUNT **and** Task 11's speed outcome/amount on any ticket in their scope, non-home included — but where the technician sleeps is not needed to close a ticket, so the coordinates stay hidden from them on non-home tickets. Coordinates are served only by the technician-management endpoints, which are franchise-scoped. |
| W14 | **Rules table unique is `(company_id, franchisee_id, technician_type)`**, not the index's `(franchisee_id, technician_type)`. | Equivalent uniqueness (franchisee ids are globally unique) and it doubles as the covering index the composite FK `(company_id, franchisee_id)` needs (hard rule: every FK has a covering index, columns in order). |
| W15 | **Rule values are whole numbers**: km fields and the percentage are `SMALLINT`, paise `INTEGER`. | TA3/TA4 speak only in whole km; a 2.5 km step is not a thing anybody asked for. Changing it later is a type widening, not a data migration. |
| W16 | **When both points are missing, the reason is `no_base_location`.** | It is the one a person can fix (the technician sets a base). `no_customer_point` is a data gap nobody on the job can act on. |
| W17 | **Travel is paid to the CURRENT holder only if the snapshot names them.** `travel_of(snap).technician_id != row.technician_id` → no row, and a warning is logged. | Every path that changes the holder re-stamps or clears (§4.3), so a mismatch means a path was missed. Paying a frozen figure to a different person would be wrong both ways; logging makes the missed path findable. |
| W18 | **Earnings FOLDS travel into `earnedPaise`** and adds a breakdown field `travelPaise` (index §6a). `net = earned + bonuses − penalties` keeps its shape, with `earned = payout + travel`. | Index §6a (owner/coordinator ruling): an installed build that has never heard of `travelPaise` still sees three tiles that add up to the hero `net`. New builds (Task 15) can show "of which travel". The cost — an employee's "earned" tile is then their travel, since T2 gives them no payout — is accepted; Task 07/15 may label it for employees. |

---

## 3. Schema

### 3.0 Prerequisite check — do `pincodes.latitude` / `longitude` exist on the MODEL?

G1: the columns exist in RelianceDB at revision `f9c2d8a3e17b` (the owner's branch, Task 00). On `dev` @
`6763026` that migration file is **not in the repo** and `app/models/territory.py → Pincode` has **no**
`latitude` / `longitude` attributes. Before writing any code:

```bash
cd api
./.venv/Scripts/python.exe -m alembic history | grep f9c2d8a3e17b      # the file is present?
./.venv/Scripts/python.exe -m alembic current                          # DB is at or after it?
grep -n "latitude\|longitude" app/models/territory.py                  # the model knows them?
```

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'pincodes' AND column_name IN ('latitude', 'longitude');
-- expect two rows, nullable. Note data_type (double precision vs numeric).
SELECT count(*) FILTER (WHERE latitude IS NOT NULL) AS with_point, count(*) AS total FROM pincodes;
-- expect ≈ 19,195 / 19,496 (G1)
```

If the model lacks them, add them to `Pincode` **matching the database type exactly** — `Float` for
`double precision`, `Numeric(9, 6)` for `numeric(9,6)`; never a migration in this task (the columns already
exist, and `f9c2d8a3e17b` owns them):

```python
#: The pincode's centre, from the owner's coordinate load (f9c2d8a3e17b). Null for
#: ~300 codes. Trust the data (G2): a missing point is 0 km, never a district guess.
latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
```

Then `alembic check` must report no diff on `pincodes` (if it wants to add or alter them, the type does
not match — fix the model, not the DB). If the DB's type is `numeric`, `core.accept_snapshot` converts to
`float` on read.

### 3.1 Model changes

**`app/models/technician.py → TechnicianProfile`** — six columns, after `upi_name` (audit mixins still
sort last):

```python
# ── where this technician starts from (Task 10, TA7) ─────────────────────
#: Copied onto the profile at set time, even for a pincode base (W7), so the
#: point is self-contained and a pincode-master edit never moves anybody.
#: Both or neither, inside India — the same box as `tickets` (models/ticket.py).
base_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
base_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
#: Which pincode's centre this is, when source = 'pincode'. Null otherwise.
base_pincode: Mapped[str | None] = mapped_column(
    String(6), ForeignKey("pincodes.code", ondelete="RESTRICT"), nullable=True
)
#: pincode | gps | map | manual — see W8 for who may send which.
base_source: Mapped[str | None] = mapped_column(String(8), nullable=True)
base_set_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
base_set_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
    Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
)
```

Add to `__table_args__` (bare names — the convention prefixes `ck_technician_profiles_`):

```python
CheckConstraint(
    "(base_latitude IS NULL) = (base_longitude IS NULL) "
    "AND (base_latitude IS NULL OR (base_latitude BETWEEN 6 AND 38 "
    "AND base_longitude BETWEEN 68 AND 98))",
    name="base_coordinates_both_or_neither",
),
CheckConstraint(
    "base_source IS NULL OR base_source IN ('pincode', 'gps', 'map', 'manual')",
    name="base_source",
),
# A point, its source and its time arrive together or not at all.
CheckConstraint(
    "(base_latitude IS NULL) = (base_source IS NULL) "
    "AND (base_source IS NULL) = (base_set_at IS NULL)",
    name="base_complete",
),
# The pincode is recorded exactly when it is the source.
CheckConstraint(
    "(base_pincode IS NOT NULL) = (base_source IS NOT DISTINCT FROM 'pincode')",
    name="base_pincode_iff_source",
),
Index("ix_technician_profiles_base_pincode", "base_pincode"),
Index("ix_technician_profiles_base_set_by", "base_set_by_user_id"),
```

**`app/models/franchisee.py`** (Task 01's module) — a third class. Constraint bounds come from
`core.travel.TRAVEL_LIMITS`, the `models/company_rules.py` ↔ `core.rules.LIMITS` shape, so the CHECKs, the
pydantic bounds and the tests read one table:

```python
class FranchiseeTravelRule(Base, IdMixin, AuditMixin):
    """What one franchisee pays one technician type for travel (TA3).

    Exactly two rows per franchisee — freelancer and employee — stamped at
    creation from `core.travel.TRAVEL_DEFAULTS` (TA4) and edited on the
    franchise portal's Travel settings. No soft delete: the rows live and die
    with the franchisee. Read ONCE per job, at accept, into
    `tickets.accept_snapshot.travel`; nothing downstream joins this table.
    """

    __tablename__ = "franchisee_travel_rules"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    technician_type: Mapped[str] = mapped_column(String(16), nullable=False)
    free_km: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    step_km: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    paise_per_step: Mapped[int] = mapped_column(Integer, nullable=False)
    road_factor_pct: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    max_paise_per_job: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["company_id", "franchisee_id"],
            ["franchisees.company_id", "franchisees.id"],
            name="fk_franchisee_travel_rules_company_franchisee",
            ondelete="CASCADE",
        ),
        # The no-duplicate rule AND the covering index for the FK above (W14).
        UniqueConstraint(
            "company_id", "franchisee_id", "technician_type",
            name="uq_franchisee_travel_rules_company_franchisee_type",
        ),
        CheckConstraint("technician_type IN ('employee', 'freelancer')", name="technician_type"),
        CheckConstraint("free_km BETWEEN 0 AND 500", name="free_km"),
        CheckConstraint("step_km BETWEEN 1 AND 50", name="step_km"),
        CheckConstraint("paise_per_step BETWEEN 0 AND 1000000", name="paise_per_step"),
        CheckConstraint("road_factor_pct BETWEEN 100 AND 300", name="road_factor_pct"),
        CheckConstraint("max_paise_per_job BETWEEN 0 AND 10000000", name="max_paise_per_job"),
    )
```

Proposed limits, and why each:

| Column | Range | Reason |
|---|---|---|
| `free_km` | 0 – 500 | 0 = pay from the first km; 500 km is beyond any one-way service trip — a typo guard. |
| `step_km` | 1 – 50 | 0 would divide by zero; above 50 km a "step" is a flat fee nobody asked for. |
| `paise_per_step` | 0 – 1,000,000 (₹10,000) | 0 = off (TA4). Ceiling is a typo guard well above any per-km rate. |
| `road_factor_pct` | 100 – 300 | Below 100 % the road would be shorter than the straight line; 300 % covers hill and river detours. |
| `max_paise_per_job` | 0 – 10,000,000 (₹1,00,000) | 0 = off (W2). The ceiling matches the UPI per-transaction limit — one job's travel can never be more than a redemption can pay. |

Register the class in `app/models/__init__.py`.

**`app/models/ticket.py → Ticket`** — after `rules_snapshot`:

```python
#: What depended on the TECHNICIAN when they took this job — their franchisee,
#: their type, and the travel allowance from their base (index §3.5). Task 11
#: adds `speed`. Written by the guarded UPDATE in `jobs.service.accept` and
#: `tickets.service.assign_technician`; set back to NULL by every path that
#: clears `technician_id`, so a re-accept re-stamps (TA5).
#:
#: ⚠ `none_as_null=True` is load-bearing — see `models/product_node_rules.py`.
#: Without it, `.values(accept_snapshot=None)` writes the JSON value `null`,
#: `accept_snapshot IS NULL` is then false, and every verify query lies.
#:
#: Read it through `core.accept_snapshot.travel_of` / `speed_of`, never with a
#: bare subscript: tickets accepted before Task 10 have NULL here.
accept_snapshot: Mapped[dict | None] = mapped_column(
    JSONB(none_as_null=True), nullable=True
)
```

**`app/models/ledger.py`**:

```python
LEDGER_KINDS = ("penalty", "bonus", "payout", "reversal", "travel")
# POOL_KINDS unchanged — `travel` is NOT pool money (F12, index §3.3).
```

and in `__table_args__`: the `kind` CHECK lists `'travel'`, plus

```python
# One travel credit per ticket (W6). Both writers settle a terminal transition,
# so a second row is unreachable by argument — this makes it unreachable by
# construction, as `uq_ledger_entries_reverses` does for reversals.
Index(
    "uq_ledger_entries_one_travel",
    "company_id", "ticket_id",
    unique=True,
    postgresql_where=text("kind = 'travel'"),
),
```

Update the module docstring's paragraph on kinds: `travel` is the company (through the technician's
franchisee) paying for distance, from outside the pool, like `payout`.

### 3.2 Migration `9e1b5d3c7a26_travel_allowance.py`

Hand-written. Defaults are **copied in as literals** (no migration in this repo imports `app.*`). If Task 05's
`7c4f2e9a1d58` is not the head when this lands, re-point `down_revision` to the head and say so in the
commit (index §3.6).

```python
"""Travel allowance: a base for every technician, rules per franchisee,
a snapshot per accepted job, and the `travel` ledger kind.

Revision ID: 9e1b5d3c7a26
Revises: 7c4f2e9a1d58
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "9e1b5d3c7a26"
down_revision: Union[str, Sequence[str], None] = "7c4f2e9a1d58"
branch_labels = None
depends_on = None

_LEDGER_KINDS_OLD = "kind IN ('penalty', 'bonus', 'payout', 'reversal')"
_LEDGER_KINDS_NEW = "kind IN ('penalty', 'bonus', 'payout', 'reversal', 'travel')"

#: `app.core.travel.TRAVEL_DEFAULTS` on the day this shipped (TA4):
#: (free_km, step_km, paise_per_step, road_factor_pct, max_paise_per_job).
#: A copy, not an import — a migration must keep meaning what it meant.
_DEFAULTS = {
    "freelancer": (20, 1, 0, 130, 0),
    "employee": (30, 1, 0, 130, 0),
}


def _drop_ledger_kind_check() -> None:
    """Drop the `kind` CHECK on ledger_entries by whatever it is called.

    The `e8b2f47c19d3` helper, verbatim: matched on `'penalty'` because
    `reversal_points_back` mentions `kind` too.
    """
    op.execute(
        """
        DO $$
        DECLARE target text;
        BEGIN
          SELECT conname INTO target
            FROM pg_constraint
           WHERE conrelid = 'ledger_entries'::regclass
             AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%''penalty''%';
          IF target IS NOT NULL THEN
            EXECUTE format('ALTER TABLE ledger_entries DROP CONSTRAINT %I', target);
          END IF;
        END $$;
        """
    )


def upgrade() -> None:
    # ── 1. technician_profiles: the base ─────────────────────────────────────
    op.add_column("technician_profiles", sa.Column("base_latitude", sa.Float(), nullable=True))
    op.add_column("technician_profiles", sa.Column("base_longitude", sa.Float(), nullable=True))
    op.add_column("technician_profiles", sa.Column("base_pincode", sa.String(6), nullable=True))
    op.add_column("technician_profiles", sa.Column("base_source", sa.String(8), nullable=True))
    op.add_column(
        "technician_profiles",
        sa.Column("base_set_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "technician_profiles", sa.Column("base_set_by_user_id", sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        "fk_technician_profiles_base_pincode_pincodes",
        "technician_profiles", "pincodes", ["base_pincode"], ["code"], ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_technician_profiles_base_set_by_user_id_users",
        "technician_profiles", "users", ["base_set_by_user_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_technician_profiles_base_pincode", "technician_profiles", ["base_pincode"])
    op.create_index(
        "ix_technician_profiles_base_set_by", "technician_profiles", ["base_set_by_user_id"]
    )
    op.create_check_constraint(
        "base_coordinates_both_or_neither", "technician_profiles",
        "(base_latitude IS NULL) = (base_longitude IS NULL) "
        "AND (base_latitude IS NULL OR (base_latitude BETWEEN 6 AND 38 "
        "AND base_longitude BETWEEN 68 AND 98))",
    )
    op.create_check_constraint(
        "base_source", "technician_profiles",
        "base_source IS NULL OR base_source IN ('pincode', 'gps', 'map', 'manual')",
    )
    op.create_check_constraint(
        "base_complete", "technician_profiles",
        "(base_latitude IS NULL) = (base_source IS NULL) "
        "AND (base_source IS NULL) = (base_set_at IS NULL)",
    )
    op.create_check_constraint(
        "base_pincode_iff_source", "technician_profiles",
        "(base_pincode IS NOT NULL) = (base_source IS NOT DISTINCT FROM 'pincode')",
    )

    # ── 2. franchisee_travel_rules ───────────────────────────────────────────
    op.create_table(
        "franchisee_travel_rules",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("franchisee_id", sa.Uuid(), nullable=False),
        sa.Column("technician_type", sa.String(16), nullable=False),
        sa.Column("free_km", sa.SmallInteger(), nullable=False),
        sa.Column("step_km", sa.SmallInteger(), nullable=False),
        sa.Column("paise_per_step", sa.Integer(), nullable=False),
        sa.Column("road_factor_pct", sa.SmallInteger(), nullable=False),
        sa.Column("max_paise_per_job", sa.Integer(), nullable=False),
        # audit columns LAST, exactly as IdMixin/AuditMixin declare them
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_franchisee_travel_rules"),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], ondelete="CASCADE",
            name="fk_franchisee_travel_rules_company_id_companies",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
            ondelete="CASCADE", name="fk_franchisee_travel_rules_company_franchisee",
        ),
        sa.UniqueConstraint(
            "company_id", "franchisee_id", "technician_type",
            name="uq_franchisee_travel_rules_company_franchisee_type",
        ),
        sa.CheckConstraint("technician_type IN ('employee', 'freelancer')",
                           name="ck_franchisee_travel_rules_technician_type"),
        sa.CheckConstraint("free_km BETWEEN 0 AND 500", name="ck_franchisee_travel_rules_free_km"),
        sa.CheckConstraint("step_km BETWEEN 1 AND 50", name="ck_franchisee_travel_rules_step_km"),
        sa.CheckConstraint("paise_per_step BETWEEN 0 AND 1000000",
                           name="ck_franchisee_travel_rules_paise_per_step"),
        sa.CheckConstraint("road_factor_pct BETWEEN 100 AND 300",
                           name="ck_franchisee_travel_rules_road_factor_pct"),
        sa.CheckConstraint("max_paise_per_job BETWEEN 0 AND 10000000",
                           name="ck_franchisee_travel_rules_max_paise_per_job"),
    )
    # ⚠ Copy the exact audit-column definitions (server defaults, types) from the
    # newest create_table in this directory (Task 01's franchisees), and resolve
    # whether `sa.CheckConstraint(name=...)` inside create_table needs the full
    # name or the bare one by checking how Task 01 wrote it — hard rule 6 warns
    # that the convention is applied in both directions. Then `alembic check`.

    # ── 3. backfill: two rows per existing franchisee (TA4) ──────────────────
    bind = op.get_bind()
    for ttype, (free_km, step_km, pps, pct, max_paise) in _DEFAULTS.items():
        bind.execute(
            sa.text(
                """
                INSERT INTO franchisee_travel_rules
                  (id, company_id, franchisee_id, technician_type, free_km, step_km,
                   paise_per_step, road_factor_pct, max_paise_per_job)
                SELECT gen_random_uuid(), f.company_id, f.id, :ttype, :free_km, :step_km,
                       :pps, :pct, :max_paise
                FROM franchisees f
                ON CONFLICT ON CONSTRAINT uq_franchisee_travel_rules_company_franchisee_type
                DO NOTHING
                """
            ),
            {"ttype": ttype, "free_km": free_km, "step_km": step_km,
             "pps": pps, "pct": pct, "max_paise": max_paise},
        )
    # Soft-deleted franchisees included on purpose: two rows per franchisee is
    # then an invariant verify.py can state without a WHERE.

    # ── 4. tickets.accept_snapshot ───────────────────────────────────────────
    op.add_column(
        "tickets",
        sa.Column("accept_snapshot", postgresql.JSONB(none_as_null=True), nullable=True),
    )
    # No backfill. A ticket accepted before today has no snapshot, which reads
    # as "nothing to pay" (index §3.5) — and the TA4 defaults are ₹0 anyway.

    # ── 5. ledger kind ───────────────────────────────────────────────────────
    _drop_ledger_kind_check()
    op.create_check_constraint("kind", "ledger_entries", _LEDGER_KINDS_NEW)
    op.create_index(
        "uq_ledger_entries_one_travel", "ledger_entries", ["company_id", "ticket_id"],
        unique=True, postgresql_where=sa.text("kind = 'travel'"),
    )


def downgrade() -> None:
    bind = op.get_bind()

    # Refuse rather than delete money — the e8b2f47c19d3 / f4b28d1a67c3 shape.
    paid = bind.execute(
        sa.text("SELECT count(*) FROM ledger_entries WHERE kind = 'travel'")
    ).scalar()
    if paid:
        raise RuntimeError(
            f"{paid} travel allowance(s) have been credited. Downgrading would "
            "delete them and silently take that money back from technicians. "
            "Decide what should happen to it first."
        )

    op.drop_index("uq_ledger_entries_one_travel", table_name="ledger_entries")
    _drop_ledger_kind_check()
    op.create_check_constraint("kind", "ledger_entries", _LEDGER_KINDS_OLD)

    op.drop_column("tickets", "accept_snapshot")
    op.drop_table("franchisee_travel_rules")

    for name in ("base_pincode_iff_source", "base_complete", "base_source",
                 "base_coordinates_both_or_neither"):
        op.drop_constraint(name, "technician_profiles", type_="check")   # bare name
    op.drop_index("ix_technician_profiles_base_set_by", table_name="technician_profiles")
    op.drop_index("ix_technician_profiles_base_pincode", table_name="technician_profiles")
    op.drop_constraint("fk_technician_profiles_base_set_by_user_id_users",
                       "technician_profiles", type_="foreignkey")
    op.drop_constraint("fk_technician_profiles_base_pincode_pincodes",
                       "technician_profiles", type_="foreignkey")
    for col in ("base_set_by_user_id", "base_set_at", "base_source",
                "base_pincode", "base_longitude", "base_latitude"):
        op.drop_column("technician_profiles", col)
```

Decision (writer): the downgrade refuses only on **money** (`travel` rows). Base locations, rules and
snapshots are dropped — a person can re-enter a base; nobody can re-create a payment's history.

⚠ After writing it, delete any autogenerated drops of `uq_companies_gst_lower`, `uq_companies_slug_lower`,
`uq_users_email_lower` and the other functional/partial indexes hard rule 6 lists — and note that
`uq_ledger_entries_one_travel` is itself a partial index: declare it on the model with
`postgresql_where` (as `uq_ledger_entries_reverses` is) so autogenerate sees it rather than proposing to
drop it.

### 3.3 Tenancy audit

`api/app/scripts/audit_tenancy.py → TENANT_LINKS` gains:

```python
("franchisee_travel_rules", "franchisee_id", "franchisees"),
```

No entry for `technician_profiles.base_pincode` (→ `pincodes`, global) or `base_set_by_user_id` (→ `users`,
global) — both are links into global tables, the same as `technician_profiles.region_id`. Run
`python -m app.scripts.audit_tenancy` after the migration; exit 0 is an acceptance criterion.

`api/app/scripts/cleanup_db.py → COMPANY_TABLES` gains `"franchisee_travel_rules"` **in this task** — the
script refuses to run while any model table is unclassified (Tasks 11 and 12 do the same for theirs). Run
`python -m app.scripts.cleanup_db --check`.

---

## 4. API and service

### 4.1 Pure core — `app/core/travel.py` (index §3.7, PURE, no db)

```python
"""Travel allowance — the arithmetic and nothing else.

PURE: no database, no I/O, no clock. Everything that needs a session lives in
`core.travel_rules` (rules) and `core.accept_snapshot` (stamping), so this file
is unit-tested in full under `api/tests/unit/test_travel.py`.

Distance is one way, base → customer, straight line × a road factor (TA1).
Partial steps are dropped (TA3). Done in integer TENTHS of a km (W1): the km a
technician is shown is exactly the km they are paid for.
"""

import math
from dataclasses import dataclass

from app.core.coordinates import metres_between

#: Inclusive bounds — the model CHECKs, the pydantic Fields and the tests read
#: this one table (the `core.rules.LIMITS` shape).
TRAVEL_LIMITS: dict[str, tuple[int, int]] = {
    "free_km": (0, 500),
    "step_km": (1, 50),
    "paise_per_step": (0, 1_000_000),
    "road_factor_pct": (100, 300),
    "max_paise_per_job": (0, 10_000_000),
}

REASON_NO_BASE = "no_base_location"
REASON_NO_CUSTOMER = "no_customer_point"


@dataclass(frozen=True)
class TravelRule:
    free_km: int
    step_km: int
    paise_per_step: int
    road_factor_pct: int
    max_paise_per_job: int


#: TA4. Stamped onto every new franchisee (two rows) by `core.travel_rules`.
#: ₹0 per step and ₹0 max: OFF until a franchisee admin configures it.
TRAVEL_DEFAULTS: dict[str, TravelRule] = {
    "freelancer": TravelRule(free_km=20, step_km=1, paise_per_step=0,
                             road_factor_pct=130, max_paise_per_job=0),
    "employee": TravelRule(free_km=30, step_km=1, paise_per_step=0,
                           road_factor_pct=130, max_paise_per_job=0),
}


@dataclass(frozen=True)
class Point:
    lat: float
    lng: float
    #: base: pincode | gps | map | manual · customer: ticket | pincode
    source: str


def _tenths(km: float) -> int:
    """Half-up to integer tenths of a km. 26.000000000000004 → 260."""
    return math.floor(km * 10 + 0.5)


def road_km(straight_m: float, road_factor_pct: int) -> float:
    """Straight metres × factor, as km rounded half-up to 0.1."""
    if straight_m < 0 or road_factor_pct < 1:
        raise ValueError("distance and factor must be positive")
    return math.floor(straight_m * road_factor_pct / 10_000 + 0.5) / 10


def travel_amount_paise(
    km: float, free_km: int, step_km: int, paise_per_step: int, max_paise: int
) -> int:
    """TA3: min(max, floor(max(0, km − free) / step) × rate). Never negative."""
    if km < 0 or free_km < 0 or step_km < 1 or paise_per_step < 0 or max_paise < 0:
        raise ValueError("travel inputs out of range")
    beyond = max(0, _tenths(km) - free_km * 10)
    steps = beyond // (step_km * 10)
    return min(max_paise, steps * paise_per_step)


def compute_travel(base: Point | None, customer: Point | None, rule: TravelRule) -> dict:
    """The `travel` block of `accept_snapshot` (index §3.5), exactly its keys.

    A missing point is 0 km with a reason (TA2, TA8) — never a guess, and never
    a refusal: the job is still accepted. The RATES are recorded even then, so a
    force-closure can still pay up to the frozen cap.
    """
    reason = REASON_NO_BASE if base is None else (
        REASON_NO_CUSTOMER if customer is None else None
    )
    if reason is None:
        straight_m = metres_between(base.lat, base.lng, customer.lat, customer.lng)
        straight_km = math.floor(straight_m / 100 + 0.5) / 10
        km = road_km(straight_m, rule.road_factor_pct)
    else:
        straight_km = km = 0.0
    return {
        "basePoint": _point(base),
        "customerPoint": _point(customer),
        "straightKm": straight_km,
        "roadFactorPct": rule.road_factor_pct,
        "km": km,
        "freeKm": rule.free_km,
        "stepKm": rule.step_km,
        "paisePerStep": rule.paise_per_step,
        "maxPaisePerJob": rule.max_paise_per_job,
        "amountPaise": travel_amount_paise(
            km, rule.free_km, rule.step_km, rule.paise_per_step, rule.max_paise_per_job
        ),
        "reason": reason,
    }


def _point(p: Point | None) -> dict | None:
    return None if p is None else {"lat": p.lat, "lng": p.lng, "source": p.source}
```

### 4.2 Rules store — `app/core/travel_rules.py` (new, DB)

Decision (writer): a new core module rather than more symbols in `core/franchise.py`, so Task 01's module
keeps one subject. Shared by the franchise portal, the settings slice and accept — slices never import each
other (hard rule 4).

| Symbol | What |
|---|---|
| `async stamp_travel_rules(db, *, company_id, franchisee_id, by_user=None) -> None` | INSERT the two `TRAVEL_DEFAULTS` rows, `ON CONFLICT … DO NOTHING`. Flushes, does **not** commit (the `load_rules` contract — the caller owns the transaction). |
| `async load_travel_rule(db, *, company_id, franchisee_id, technician_type) -> TravelRule` | The row as a `TravelRule`. **Self-heals** a missing row by stamping both, then re-reads — `rules.load_rules`'s shape, so a franchisee created by old code between migration and publish still accepts jobs. |
| `async get_travel_rules(db, *, company_id, franchisee_id) -> TravelRulesOut` | Both types, for the GET endpoints. |
| `async put_travel_rules(db, *, company_id, franchisee_id, body, by_user) -> TravelRulesOut` | Writes both rows in one transaction; validates W2. |

**The creation hook (TA4 "stamped on franchisee creation").** Two call sites, both in the same transaction as
the franchisee INSERT, right after its flush:

1. `app/core/franchise.py → create_home_franchisee(db, company)` (Task 01) — so every new company's home
   franchisee gets its rows inside `create_company`'s transaction.
2. Task 03's franchisee create in `app/features/franchisees/service.py` (the function that INSERTs into
   `franchisees`, whatever Task 03 named it — grep `Franchisee(` there).

```python
franchisee = Franchisee(...)
db.add(franchisee)
await db.flush()
await stamp_travel_rules(
    db, company_id=franchisee.company_id, franchisee_id=franchisee.id, by_user=principal.user_id
)
```

Existing franchisees are covered by the migration's backfill; anything missed is covered by the self-heal.

Schemas (in `app/core/travel_rules.py`, since three slices return them — the `core.schemas` precedent):

```python
class TravelRuleIO(AppModel):
    freeKm: int = Field(ge=0, le=500)
    stepKm: int = Field(ge=1, le=50)
    paisePerStep: int = Field(ge=0, le=1_000_000)
    roadFactorPct: int = Field(ge=100, le=300)
    maxPaisePerJob: int = Field(ge=0, le=10_000_000)

    @model_validator(mode="after")
    def _a_rate_needs_a_cap(self):          # W2
        if self.paisePerStep > 0 and self.maxPaisePerJob == 0:
            raise ValueError(
                "Set a maximum per job — with a ₹0 maximum the allowance is always ₹0."
            )
        return self

class TravelRulesOut(AppModel):            # also the PUT body (TravelRulesIn = same shape)
    freelancer: TravelRuleIO
    employee: TravelRuleIO
```

Bounds written as literals in `Field` must equal `TRAVEL_LIMITS` — a unit test asserts it (§6).

### 4.3 Stamping — `app/core/accept_snapshot.py` (index §3.7)

Separated into a pure half (tested with fakes) and a thin loader:

```python
# ── pure ─────────────────────────────────────────────────────────────────────
def customer_point(ticket_lat, ticket_lng, pincode_lat, pincode_lng) -> Point | None:
    """TA2: the ticket's own map point, else its pincode's centre, else None."""

def base_point(technician) -> Point | None:
    """Duck-typed on base_latitude / base_longitude / base_source. None when unset."""

def assemble(*, now, technician_id, franchisee_id, technician_type, travel: dict) -> dict:
    """The whole snapshot, index §3.5 keys; `speed` is None until Task 11.
    acceptedAt is UTC ISO-8601 with a trailing 'Z'."""

@dataclass(frozen=True)
class TravelView:
    technician_id: str | None
    amount_paise: int          # ≥ 0; 0 for anything unreadable
    max_paise_per_job: int     # ≥ 0
    km: float
    straight_km: float
    reason: str | None
    base_source: str | None
    customer_source: str | None
    raw: dict                  # the block as stored, for TicketTravelOut

def travel_of(snapshot: dict | None) -> TravelView | None:
    """None for a NULL snapshot, a non-dict, or a missing/non-dict `travel`.
    Non-int or negative money (bools included) reads as 0 — never raises."""

def speed_of(snapshot: dict | None) -> dict | None:
    """Placeholder: the `speed` dict or None, never raises. Task 11 (already
    written) replaces it with a typed `SpeedTerms | None` reader and fills
    `snapshot["speed"]` inside `build_accept_snapshot`. Task 10 keeps the
    `speed` key present and None, exactly as index §3.5, so that extension is
    a one-function change."""

def technician_type_of(snapshot: dict | None, fallback: str) -> str:
    """The type frozen at accept (T1), else `fallback` (the live type)."""

def closure_travel_paise(snapshot, *, technician_id) -> int:
    """What customer closure pays: the frozen amount, iff the snapshot names
    this technician (W17); else 0."""

def force_close_travel_paise(snapshot, *, technician_id, requested: int | None) -> int:
    """W5: None → 0; else min(requested, frozen maxPaisePerJob); 0 when the
    snapshot is missing or names somebody else."""

# ── thin loader ──────────────────────────────────────────────────────────────
async def build_accept_snapshot(db, ticket, technician, now) -> dict:
    rule = await load_travel_rule(
        db, company_id=ticket.company_id,
        franchisee_id=technician.franchisee_id,        # Task 01 column
        technician_type=technician.technician_type,    # Task 01 column
    )
    pin_lat = pin_lng = None
    if ticket.latitude is None:                         # only then is the pincode needed
        pin_lat, pin_lng = (await db.execute(
            select(Pincode.latitude, Pincode.longitude).where(Pincode.code == ticket.pincode)
        )).one_or_none() or (None, None)
    travel = compute_travel(
        base_point(technician),
        customer_point(ticket.latitude, ticket.longitude, _f(pin_lat), _f(pin_lng)),
        rule,
    )
    return assemble(now=now, technician_id=technician.id,
                    franchisee_id=technician.franchisee_id,
                    technician_type=technician.technician_type, travel=travel)
```

(`_f` converts a `Decimal` to `float` when the DB column is `numeric` — §3.0.)

Decision (writer): the franchisee and its rule are the **technician's** (`profile.franchisee_id`). Task 04's
eligibility makes it equal the ticket's franchisee at accept; recording the technician's is what TA3 means
("settings per franchisee × technician type" — the technician's franchisee pays).

**Where it is written** — always inside the guarded UPDATE's `.values(...)` (W3):

| Path | File / function | Change |
|---|---|---|
| Technician accepts | `app/features/jobs/service.py → accept` | After the `NO_WINDOW_LEFT` guard and before `was = offered.status`: `now = _now(); snap = await build_accept_snapshot(db, offered, profile, now)`. The guarded `update(Ticket)` gets `.values(technician_id=profile.id, status="Assigned", accept_snapshot=snap)`. A loser's rowcount is 0 and nothing of theirs is written. |
| Manager assigns / re-assigns | `app/features/tickets/service.py → assign_technician` | After `_load_assignable_technician` and the same-technician no-op return: build for `profile`, add `accept_snapshot=snap` to the guarded `.values(...)`. A re-assign REPLACES the previous holder's snapshot. The same-technician no-op keeps the old snapshot (nothing was re-accepted). |

**Where it is cleared** — every path that sets `technician_id = NULL`. Verified by
`grep -rn "technician_id=None" api/app` on `dev` @ `6763026`: exactly two.

| Path | File / function | Change |
|---|---|---|
| Technician cancels (release) | `jobs/service.py → cancel` (the `update(Ticket)…values(technician_id=None, status=back_to)`) | add `accept_snapshot=None`; after it, `row.accept_snapshot = None` beside `row.technician_id = None`. |
| No-show confirmed | `tickets/service.py → record_no_show` (`values(technician_id=None, status="Escalated")`) | same. |

Checked and needing **no** change: `core/escalation.escalate` (only tickets with `technician_id IS NULL`),
`core/reschedule.move_slot` (keeps the holder, customer point unchanged), `add_bonus_and_renotify` (no
holder), `submit_proof` / `complete` (holder unchanged), `record_feedback` "not done" → `Escalated` WITH the
technician (snapshot kept; a later re-assign replaces it), `force_close_ticket` (keeps the technician),
`technicians.service._refuse_if_open_jobs` (deletion is refused while jobs are open, so it never orphans a
snapshot). **Rule for later tasks:** any new path that clears or changes `technician_id` must clear or
re-stamp `accept_snapshot` in the same statement — Task 12's `Awaiting Part` does not change the holder.

**Task 06 hand-over (T1).** Task 06 ships before this task and can only read the LIVE
`technician_profiles.technician_type` when it skips an employee's payout. Its one gate is
`core.employment.job_technician_type(db, *, company_id, technician_id)`, which has no ticket to read a
snapshot from. This task adds a keyword `snapshot: dict | None = None` to it and makes its body return
`technician_type_of(snapshot, fallback=<live type>)`; the three callers (`feedback_service.record_feedback`,
`force_close_ticket`, `tickets.service._hydrate`) pass `snapshot=row.accept_snapshot` (reconciled with Task
06 §4.1). A type change therefore affects only jobs accepted after it (T1). Old tickets (NULL snapshot) keep
Task 06's live-type behaviour.

### 4.4 Paying

**Customer closure — `app/features/tickets/feedback_service.py → record_feedback`.** Inside
`if confirmed and row.technician_id is not None:`, right after the payout row (which Task 06 may have made
conditional on type — travel is NOT, T3):

```python
travel_paise = closure_travel_paise(row.accept_snapshot, technician_id=row.technician_id)
if travel_paise > 0:
    view = travel_of(row.accept_snapshot)
    db.add(
        ledger_entry(
            company_id=row.company_id,
            technician_id=row.technician_id,
            ticket_id=row.id,
            kind="travel",
            amount_paise=travel_paise,
            reason=travel_reason(km=view.km),
            franchisee_id=payer_franchisee_id,   # the SAME value Task 01 computes for the payout row
        )
    )
elif travel_of(row.accept_snapshot) is not None and travel_of(...).technician_id != str(row.technician_id):
    log.warning("travel snapshot names %s but %s closed ticket %s", ...)   # W17
```

- `franchisee_id` = the technician's franchisee **at write time** (index §3.2, §6) — reuse the variable Task 01
  introduced for the payout row beside it; do not look it up twice.
- **Idempotency.** The guarded UPDATE (`status = 'Awaiting Customer' AND customer_confirmed_at IS NULL`) is
  the burn: only the request that changed the row reaches this code, and `Closed` is terminal. Confirmed by
  reading the function: a second POST gets 409 "This link has already been used". W6's partial unique index
  makes a second `travel` row impossible regardless.
- `amount_paise > 0` CHECK: zero writes **no row**, as everywhere in this ledger.

**`app/core/ledger.py`**:

```python
def travel_reason(*, km: float | None, force_closed: bool = False) -> str:
    """What a travel row says, decided when it was paid (the `payout_reason` rule)."""
    if force_closed:
        return "Travel allowance · set at force-closure"
    return f"Travel allowance · {km:.1f} km"[:160]
```

and `credited()` adds the new kind (the redemption balance reads this — §4.6), **keeping Task 06's
`LedgerEntry.technician_type == 'freelancer'` stream filter** (an employee's travel goes on their statement,
never into a UPI redemption):

```python
return (totals.get("payout", 0) + totals.get("travel", 0)
        + totals.get("bonus", 0) - totals.get("penalty", 0))
```

Update its docstring: "payouts + travel + bonuses − penalties". `pool()` is untouched — it already filters
`POOL_KINDS`, which does not contain `travel`. `features/ledger` likewise (still `POOL_KINDS`). Confirm both
by reading, and say so in the commit.

**Force-close — `app/features/tickets/schemas.py → ForceCloseRequest`** gains:

```python
#: Travel allowance to credit, in paise (TA6). The console pre-fills the
#: amount frozen at accept (`TicketDetailOut.travel.forceCloseDefaultPaise`);
#: the manager may change it. Capped at the frozen `maxPaisePerJob`, silently,
#: like the two fields above. `0` and omitted both write NO row (W5) — a body
#: that never mentioned this field came from a client that never heard of it.
#: Ignored when the ticket has no technician or no snapshot for them.
travelPaise: int | None = Field(default=None, ge=0)
```

**`tickets/service.py → force_close_ticket`**, after the payout block, same transaction:

```python
travel_paise = force_close_travel_paise(
    row.accept_snapshot, technician_id=technician_id, requested=body.travelPaise
)
if technician_id is not None and travel_paise > 0:
    db.add(ledger_entry(..., kind="travel", amount_paise=travel_paise,
                        reason=travel_reason(km=None, force_closed=True),
                        franchisee_id=payer_franchisee_id, by_user=principal.user_id))
```

Decision (writer): the force-close reason does not quote km — the amount is the manager's, so a km figure
beside it would imply an arithmetic that did not happen. The frozen km is still on the ticket's snapshot.

**Exposing the default — `GET /tickets/{id}` → `TicketDetailOut.travel`.** In `get_ticket`, inside the
money block — `if not principal.is_vendor and principal.role not in FACILITY_ROLES:` after Task 04 (a vendor
is not party to a technician's money, as with `technicianCreditedPaise`; facility staff handle parts, not pay):

```python
class TicketTravelOut(AppModel):
    """The travel allowance frozen when this job was accepted. Company staff
    (Area Manager and above, a non-home franchisee's ticket included — owner ruling
    2026-10-15, R8, so travel and Task 11's speed block behave identically) and the
    franchisee admin only; never a vendor or facility staff (Task 04's money
    block). Never the base's coordinates (W13)."""
    technicianId: uuid.UUID
    acceptedAt: datetime.datetime
    technicianType: str
    baseSource: str | None          # pincode | gps | map | manual | null (no base)
    customerSource: str | None      # ticket | pincode | null
    straightKm: float
    roadFactorPct: int
    km: float
    freeKm: int
    stepKm: int
    paisePerStep: int
    maxPaisePerJob: int
    amountPaise: int
    reason: str | None              # null | no_base_location | no_customer_point
    #: The `travel` ledger row's amount, or null if none (open job, ₹0, or a
    #: force-closure that paid nothing). Never 0 — the `technicianCreditedPaise` rule.
    creditedPaise: int | None
    #: What the force-close form pre-fills and caps at (TA6, W5).
    forceCloseDefaultPaise: int     # = amountPaise
    forceCloseMaxPaise: int         # = maxPaisePerJob

class TicketDetailOut(TicketOut):
    ...
    #: Null when no technician holds the job, or it was accepted before Task 10.
    travel: TicketTravelOut | None = None
```

Built from `travel_of(row.accept_snapshot)` only when it names the current `row.technician_id`; plus one
`select(LedgerEntry.amount_paise).where(company_id, ticket_id, kind == 'travel')`. The franchisee admin (F13,
Task 04's read-only ticket detail) receives the same block — it is their money; facility staff get `null`.

### 4.5 The app's job payload

`app/features/jobs/schemas.py`:

```python
class JobTravelOut(AppModel):
    """The travel allowance this job pays, frozen when it was accepted."""
    km: float
    amountPaise: int
    #: null | no_base_location | no_customer_point — the app says why it is ₹0.
    reason: str | None

class JobOut(JobOfferOut):
    ...
    #: Null for a job accepted before travel allowances existed. Not on
    #: JobOfferOut — see W4.
    travel: JobTravelOut | None = None
```

`jobs/service.py → _job_out` adds
`travel=_job_travel(t)` where `_job_travel` reads `travel_of(t.accept_snapshot)` and returns `None` unless it
names `t.technician_id`. `JobOfferOut`, `_offer_out`, `pool_query` and `jobs/ws.py` do **not** change (W4).
Unknown fields are ignored by installed APKs, so this field is safe before Task 15 renders it.

### 4.6 Earnings and the redemption balance

`app/features/earnings/schemas.py → EarningsSummaryOut` gains (W18, index §6a):

```python
#: Travel allowances credited in the period — `travel` entries, written at
#: closure. Employees get these too (T3). A BREAKDOWN of `earnedPaise`, which
#: already includes it — never add the two together.
travelPaise: int = 0
```

and the `earnedPaise` comment becomes "What the jobs paid — `payout` + `travel` entries".

`earnings/service.py → summary`:

```python
travel = totals.get("travel", 0)
earned = totals.get("payout", 0) + travel        # FOLDED (index §6a): old tiles still add up
...
netPaise=earned + bonuses - penalties,           # unchanged shape
earnedPaise=earned,
travelPaise=travel,
```

`earnings/service.py → _title` — an **explicit branch**, placed before the penalty fall-through. Today any
kind that is not `payout` or `bonus` falls through to "Late cancellation penalty", so without this a travel
credit would be titled as a penalty:

```python
if kind == "travel":
    return "Travel allowance"      # a FIXED string: the app maps titles to t() keys
# Task 11 adds speed_reward → "Speed reward", speed_penalty → "Speed penalty" here.
```

Decision (writer): also make the fall-through explicit — `if kind == "penalty": …band titles…` and, for any
other kind, return `reason` rather than a penalty title — so the next new kind can never be mislabelled as a
charge. The two penalty titles are unchanged.

`TransactionOut.kind` docstring: `payout | travel | bonus | penalty`; `travel` is a credit. `ticketId`
openable logic is unchanged (a travel row is always for a job the technician still holds).

Redemptions: no code change in `features/redemptions` — `credited()` (§4.4) is its source, and it shares
`shown_to_technician()` with Earnings, so the two still cannot disagree. Task 06's employee refusal
(`EMPLOYEE_CANNOT_REDEEM`) is untouched; an employee's travel reaches their monthly statement instead — Task
06's statement must include `kind = 'travel'` (check whether it filters kinds; if it lists by name, add it).

`app/scripts/seed/verify.py`:

- `_earnings_match_the_ledger`: `earned = payout + travel`; `expected_net = earned + bonuses − penalties`; also
  assert `figures.earnedPaise == payout + travel` and `figures.travelPaise == travel`.
- New `_travel_matches_the_snapshot`: every `Closed` ticket whose `travel_of(snapshot).amount_paise > 0` and
  names its holder has exactly one `travel` row of that amount; no `travel` row exceeds its ticket's frozen
  `maxPaisePerJob`; no ticket has a `travel` row while its snapshot is NULL.
- New `_every_franchisee_has_travel_rules`: exactly two rows per franchisee, one per type.

### 4.7 Base location API

Shared logic in **`app/core/base_location.py`** (new — used by the technicians slice's staff router and its
`/franchise` twin router (Task 05's `franchise_router.py`), and by the session payload that
`auth/otp_service` builds):

```python
TECHNICIAN_SOURCES = ("pincode", "gps", "map")      # W8
MANAGER_SOURCES = ("pincode", "map", "manual")

class BaseLocationIn(AppModel):
    """Exactly one of: a pincode, or a point with its source."""
    pincode: Pincode | None = None                  # ^[0-9]{6}$
    latitude: Latitude = None                       # GLOBE bounds — India is checked in
    longitude: Longitude = None                     # the service, so it can carry a code (W11)
    source: Literal["gps", "map", "manual"] | None = None
    # model_validator: pincode XOR (latitude AND longitude AND source); else 422

class BaseLocationOut(AppModel):
    latitude: float
    longitude: float
    pincode: str | None
    source: str                                     # pincode | gps | map | manual
    setAt: datetime.datetime
    #: True when the technician set it themselves.
    setBySelf: bool
    #: Owner ruling 2026-10-15 (R9): who set it, SHOWN to the franchisee admin and home managers so a
    #: self-set base is visible, not hidden. Null when the user was since deleted (FK SET NULL).
    setByName: str | None            # the user's full name (the technician's own name when setBySelf)
    setByRole: str | None            # role label: "Technician" | "Franchisee Admin" | "Area Manager" ...

def check_in_india(lat: float, lng: float) -> None:          # pure → BASE_OUTSIDE_INDIA
def check_source_allowed(body, allowed: tuple[str, ...]) -> None   # pure → 422

async def resolve_base(db, *, company_id, franchisee_id, body, allowed) -> BaseFix:
    """pincode → must be in `franchisee_pincodes_subquery(company_id, franchisee_id,
    is_home=…)` (Task 01; home = active master codes nobody else owns) AND active,
    else 422 PINCODE_OUTSIDE_FRANCHISEE; must have a centre, else 400
    PINCODE_HAS_NO_LOCATION. point → check_in_india."""

def apply_base(profile, fix, *, by_user_id, now) -> None:   # writes the six columns
def base_out(profile, *, technician_user_id, set_by_name=None, set_by_role=None) -> BaseLocationOut | None
    # R9 (owner ruling 2026-10-15): the callers that may show it load the setter's name/role label in one lookup
    # on `base_set_by_user_id` (users + memberships role); setBySelf = (base_set_by_user_id == technician_user_id).
```

Error codes and PROPOSED English `detail` (server copy; the app translates by `code` — Task 14 adds keys to
`errorText.ts`):

| Status | Code | PROPOSED detail |
|---|---|---|
| 422 | `PINCODE_OUTSIDE_FRANCHISEE` | "That pincode is outside your service area. Drop a pin on the map or use your current location instead." |
| 400 | `PINCODE_HAS_NO_LOCATION` *(new — add to index §3.3)* | "We don't have a map location for that pincode yet. Drop a pin on the map or use your current location instead." |
| 400 | `BASE_OUTSIDE_INDIA` | "That location is outside India. Check the pin and try again." |
| 422 | — | "Send a pincode, or a location with its source — not both." |
| 422 | — | "Set a maximum per job — with a ₹0 maximum the allowance is always ₹0." (rules PUT, W2) |

Endpoints:

| Method & path | Who | Guard | Notes |
|---|---|---|---|
| `GET /technicians/me/base-location` | the technician | `require_technician_principal` (no feature key — the `/me` precedent in `technicians/router.py`) | `data` is `BaseLocationOut` or `null`. |
| `PUT /technicians/me/base-location` | the technician | same | Sources `pincode`/`gps`/`map`. Range = `profile.franchisee_id`. Returns `BaseLocationOut`. Decision (writer): PUT only, no POST — it replaces. No DELETE: a base can be moved, not removed. |
| `PUT /technicians/{technician_id}/base-location` | staff, **home franchisee** (F8) | `require_feature("technicians.edit")` + `require_staff_principal`; load via Task 05's `_load_managed` (the territory-scoped `_load`, then `can_manage_technician`) — outside the territory or company → **404**; visible but non-home → **403** "Managed by {franchisee}" (index §6b, reconciled) | Sources `pincode`/`map`/`manual`. |
| `PUT /franchise/technicians/{technician_id}/base-location` | franchisee admin | `require_feature("franchise.technicians")` + `require_franchise_principal`; technician must be in `managed_franchisee_ids` — else **404** | In `app/features/technicians/franchise_router.py` beside Task 05's other `/franchise/technicians*` twins (index §3.7). Same sources as staff. |

Exposed on existing payloads:

- `TechnicianOut` (list rows and detail): `baseSource: str | None`, `baseSetAt: datetime | None`, and — **owner ruling
  2026-10-15 (R9)** — `baseSetBySelf: bool | None` (null = no base): enough for a "no base" badge and for the
  **source chip** (*Pincode / GPS / Map / Set by admin*, where `manual` reads *Set by admin*) on every technician row;
  **no coordinates in lists**. The chip is shown on the franchisee admin's list and on home managers' list.
- `TechnicianDetailOut` and the franchise portal's technician detail (Task 05/09): `baseLocation: BaseLocationOut | None` —
  **non-null only for callers who can manage that technician** (the franchisee admin of its franchisee; home managers
  holding `technicians.edit` on a home technician) and `null` for a staff caller merely viewing a non-home technician
  (W13: coordinates are not theirs to see), who still gets the three list fields above. **Self-set bases need no approval
  and no cooldown (R9): the source and who set it are shown, the franchisee admin may correct it at any time
  (`PUT /franchise/technicians/{id}/base-location`), and a correction never touches an `accept_snapshot`.**
- `TechnicianSessionOut` (`GET /technicians/me` and the sign-in response via `auth/otp_service`'s lazy
  import): `baseLocation: BaseLocationOut | None` — Task 14's Home card shows "set your base" until it is set.

**Onboarding — no field on the register body (reconciled, index §6b).** `SelfRegisterRequest` is **not**
changed. Task 14's onboarding step runs after `POST /onboarding/invites/{token}/register` has created the
account and signed the technician in, and saves through `PUT /technicians/me/base-location` like Profile
does — so a refused pincode is a line under that box, never a refusal of the whole registration.

**Pincode centres on the wire (reconciled, index §6b).** The console's *Use centre* (Task 13) moves its pin
before saving, so it needs the point a pincode base will be copied from. `app/features/geo/schemas.py →
PincodeOut` and Task 05's duplicate `FranchisePincodeOut` (`GET /franchise/pincodes`) both gain
`latitude: float | None` and `longitude: float | None`, read from `Pincode.latitude/longitude` (§3.0; null
for the ~300 codes without a point). Read-only and additive — every existing client ignores them.

Not added: a base on the manager's direct-create form (`TechnicianCreateRequest`). The console sets it with
the PUT above after creating (Task 13). Decision (writer).

### 4.8 Travel rules API

| Method & path | Who | Guard | Franchisee |
|---|---|---|---|
| `GET /franchise/settings/travel` | franchisee admin | `require_feature("franchise.settings")` + `require_franchise_principal` | `principal.franchisee_id` (never a path id) |
| `PUT /franchise/settings/travel` | franchisee admin | same | same |
| `GET /settings/travel` | staff, home franchisee (F8) | `require_any_feature("settings.view", "jobs.assign")` — the `ReadRules` guard `GET /settings/rules` uses | `home_franchisee_id(db, principal.company_id)` (Task 01) |
| `PUT /settings/travel` | staff, home franchisee (F8) | `require_feature("settings.edit")` + `require_staff_principal` + `dependencies=HeadRoute` (`require_min_rank(NATIONAL_HEAD)`, already defined in `settings/router.py`) | same |
| `GET /franchisees/{franchisee_id}/travel-rules` | staff, read-only, any franchisee | `require_feature("franchisees.view")` + Task 03's scoped franchisee loader (404 across companies) | path id, company-scoped |

Decision (writer): the PUT carries the **National-Head floor** as well as `settings.edit`. It is money, the
payment-account routes in the same router already pair `settings.edit`-style keys with `HeadRoute`, and Task
11's W15 guards the home speed matrix with `settings.edit` + NH floor — two money settings on one franchisee
must share one guard. (Task 11 says Rules Config carries that floor; on `dev` @ `6763026`, `PUT /settings/rules`
has `settings.edit` only — `HeadRoute` is on the payment-account routes. The pair chosen here stands either way.)

Bodies: `TravelRulesOut` for every GET; `TravelRulesIn` (same shape, both types required) for both PUTs;
PUT returns the saved `TravelRulesOut`, message "Travel settings saved". Decision (writer): the staff
endpoint lives in the **settings** slice beside Rules Config (`/settings/travel`) with no franchisee id in
the path — the home franchisee is implied, so there is no id to guess. A home franchisee's own franchisee
admins (F8) edit the same two rows through `/franchise/settings/travel`.

A rule change affects **only jobs accepted after it** (TA5) — say so in the PUT's docstring; Task 13 shows it
under the form.

---

## 5. Client

**None in this task.** The contracts above are consumed by:

- **Task 13 (console):** Travel settings form (`/franchise/settings/travel`, `/settings/travel`), base-location
  map pin (Leaflet + OSM) on the technician detail, the force-close field pre-filled from
  `travel.forceCloseDefaultPaise` and capped at `travel.forceCloseMaxPaise`, the travel panel on ticket detail.
- **Task 14 (mobile):** base-location step at onboarding, Profile → Base location, Home card until set
  (`TechnicianSessionOut.baseLocation`), error translations for the three codes in §4.7.
- **Task 15 (mobile):** `JobOut.travel` on the job screen, `EarningsSummaryOut.travelPaise` (shown as part
  of earned, never added to it), the "Travel allowance" ledger title.
- **Console ledger labels (index §6a):** the console renders an unknown kind as NaN, so its label/format for
  `travel` ships no later than this API (Task 13, or split into Task 07's window).
- **Task 07 (mobile, BEFORE this ships):** must render `kind = 'travel'` safely and map the title
  "Travel allowance" in `mobileapp/src/i18n/serverLabels.ts` (`server.ledgerTitle.travelAllowance`).
  If Task 07's doc does not list that title, it is a gap to raise before publishing this task.

---

## 6. Unit tests (pytest, PURE — no database; index X1)

Under `api/tests/unit/` (the harness is Task 00). Fakes are `types.SimpleNamespace`. Run
`pytest api/tests/unit -q`; green is part of the commit.

### `test_travel.py`

| # | Case | Expect |
|---|---|---|
| 1 | Worked example: `road_km(27_000, 130)` | `35.1` |
| 2 | `travel_amount_paise(35.1, 20, 2, 1000, 30000)` | `7000` (7 steps) |
| 3 | Index §3.5 example: `road_km(21_600, 130)` → 28.08 → | `28.1`; amount with 20/2/1000/30000 = `4000` |
| 4 | Exactly at free km: `(20.0, 20, 1, 1000, ∞)` | `0` |
| 5 | Just under one step past free: `(20.9, 20, 1, 1000, 10**7)` | `0` (partial dropped) |
| 6 | Exactly one step: `(21.0, 20, 1, 1000, 10**7)` | `1000` |
| 7 | Exact multiple of step: `(24.0, 20, 2, 1000, 10**7)` | `2000` |
| 8 | Partial step dropped: `(25.9, 20, 2, 1000, 10**7)` | `2000` |
| 9 | Step larger than the distance past free: `(25.0, 20, 10, 1000, 10**7)` | `0` |
| 10 | Below free: `(5.0, 20, 1, 1000, 10**7)` | `0` (never negative) |
| 11 | Zero km | `0` |
| 12 | Cap binds: `(120*1.3=156.0, 20, 2, 1000, 30000)` | `30000` |
| 13 | Cap exactly equal to the computed amount | that amount |
| 14 | Rate 0 (TA4 default) with any distance | `0` |
| 15 | Max 0 (TA4 default) with a rate | `0` |
| 16 | Float drift: `travel_amount_paise(26.000000000000004, 20, 2, 1000, 10**7)` and `25.999999999999996` | both `3000` |
| 17 | Free 0: `(0.9, 0, 1, 1000, 10**7)` → `0`; `(1.0, 0, 1, 1000, 10**7)` → `1000` | |
| 18 | `road_km` half-up: `road_km(10_050, 100)` | `10.1` |
| 19 | Factor 100: `road_km(12_345, 100)` | `12.3` (≡ straight) |
| 20 | Factor 300: `road_km(10_000, 300)` | `30.0` |
| 21 | Invalid: `step_km=0`, negative km, negative rate, negative max, `road_km(-1, 130)` | `ValueError` |
| 22 | `TRAVEL_DEFAULTS`: keys == `TECHNICIAN_TYPES` (Task 01 constant); freelancer free 20, employee free 30; both step 1, factor 130, rate 0, max 0 | |
| 23 | Every default lies inside `TRAVEL_LIMITS` | |
| 24 | `TravelRuleIO` Field bounds == `TRAVEL_LIMITS` (introspect `model_fields[…].metadata`) | |
| 25 | `TravelRuleIO`: rate > 0 with max 0 → `ValidationError`; rate 0 with max 0 → valid | |
| 26 | `compute_travel(None, customer, rule)` | `reason="no_base_location"`, `km=0.0`, `straightKm=0.0`, `amountPaise=0`, `basePoint=None`, rates recorded |
| 27 | `compute_travel(base, None, rule)` | `reason="no_customer_point"`, `customerPoint=None`, `basePoint` present |
| 28 | Both None | `reason="no_base_location"` (W16) |
| 29 | Same point | `km=0.0`, `reason=None`, `amountPaise=0` |
| 30 | One degree of latitude: `(17.0,78.0)`→`(18.0,78.0)`, factor 130 | `straightKm=111.2`, `km=144.6` |
| 31 | Key set of the result == index §3.5 `travel` keys exactly | |
| 32 | Point sources are carried through (`"pincode"`, `"ticket"`) | |

### `test_accept_snapshot.py`

| # | Case | Expect |
|---|---|---|
| 1 | `customer_point(17.4, 78.4, 17.0, 78.0)` | source `"ticket"`, ticket coordinates |
| 2 | `customer_point(None, None, 17.0, 78.0)` | source `"pincode"` |
| 3 | `customer_point(None, None, None, None)` | `None` |
| 4 | Half a ticket point `customer_point(17.4, None, 17.0, 78.0)` (cannot exist by CHECK; defensive) | falls through to `"pincode"` |
| 5 | `base_point` of a fake with coordinates + `base_source="map"` | `Point(..., "map")` |
| 6 | `base_point` of a fake with no base | `None` |
| 7 | `assemble(...)` top-level keys == `acceptedAt, technicianId, franchiseeId, technicianType, travel, speed`; `speed is None`; ids are strings; `acceptedAt` ends in `Z` and parses back to the given UTC instant | |
| 8 | `travel_of(None)`, `travel_of({})`, `travel_of({"travel": None})`, `travel_of("x")`, `travel_of({"travel": []})` | `None`, no raise |
| 9 | `travel_of` with `amountPaise` missing / `"7000"` / `-5` / `True` / `7000.0` | `0`, `0`, `0`, `0`, `0` (only a real int counts) |
| 10 | `travel_of` of a full snapshot | every field read; `raw` is the block |
| 11 | `speed_of(None)`, `speed_of({})`, `speed_of({"speed": None})` | `None` |
| 12 | `technician_type_of(None, "freelancer")` → fallback; `({"technicianType": "employee"}, "freelancer")` → `"employee"`; unknown value `"boss"` → fallback | |
| 13 | `closure_travel_paise(snap, technician_id=same)` | frozen amount |
| 14 | `closure_travel_paise(snap, technician_id=other)` | `0` (W17) |
| 15 | `closure_travel_paise(None, …)` | `0` |
| 16 | `force_close_travel_paise(snap, requested=None)` | `0` (W5) |
| 17 | `force_close_travel_paise(snap, requested=5000)` with max 30000 | `5000` |
| 18 | `force_close_travel_paise(snap, requested=99999)` with max 30000 | `30000` |
| 19 | `requested=0` | `0` |
| 20 | Snapshot with `reason="no_base_location"`, amount 0, max 30000, `requested=10000` | `10000` (cap still applies, TA6) |
| 21 | Snapshot max 0, `requested=10000` | `0` |
| 22 | NULL snapshot, `requested=10000` | `0` |
| 23 | Wrong technician, `requested=10000` | `0` |

### `test_base_location.py`

| # | Case | Expect |
|---|---|---|
| 1 | `check_in_india` at the corners `(6.0, 68.0)`, `(38.0, 98.0)` | passes |
| 2 | `(5.99, 78)`, `(38.01, 78)`, `(17, 67.99)`, `(17, 98.01)`, `(0, 0)` | `BASE_OUTSIDE_INDIA` |
| 3 | `BaseLocationIn`: pincode only → valid; lat+lng+source → valid; pincode+lat → 422; lat without lng → 422; lat+lng without source → 422; nothing → 422; pincode `"05000"` → 422 | |
| 4 | `check_source_allowed`: technician `manual` → refused; manager `gps` → refused; technician `gps`/`map`, manager `map`/`manual` → allowed | |
| 5 | `travel_reason(km=35.1)` == `"Travel allowance · 35.1 km"`; `travel_reason(km=None, force_closed=True)`; both ≤ 160 chars | |
| 6 | Earnings `_title("travel", anything)` == `"Travel allowance"`, and never a penalty title; `_title("penalty", "Cancel …")` and the no-show band title unchanged; an unknown kind returns its `reason` (pure function, importable without a db) | |

---

## 7. Acceptance criteria

Run against **RelianceDB (dev)** with the API on `:8000` (check for an orphaned listener first — root
`AGENTS.md`). `<…>` are placeholders. "SkyFix" = a non-home franchisee from Task 03; "Home" = the company's
home franchisee.

**Migration and schema**

1. **Given** dev at `7c4f2e9a1d58`, **when** `alembic upgrade head`, `downgrade 7c4f2e9a1d58`, `upgrade head`
   run, **then** all three exit 0, and the ids of `franchisees` and of `ledger_entries` before and after are
   identical (hard rule 6 — compare ids, not just exit codes).
2. **Given** the upgrade, **then** every franchisee has exactly two rules with the TA4 defaults:
   ```sql
   SELECT f.id, count(r.*), bool_and(r.paise_per_step = 0 AND r.max_paise_per_job = 0 AND r.step_km = 1
          AND r.road_factor_pct = 130),
          max(r.free_km) FILTER (WHERE r.technician_type='employee'),
          max(r.free_km) FILTER (WHERE r.technician_type='freelancer')
   FROM franchisees f LEFT JOIN franchisee_travel_rules r
     ON r.company_id = f.company_id AND r.franchisee_id = f.id
   GROUP BY f.id HAVING count(r.*) <> 2;          -- expect 0 rows
   ```
   and the defaults are 30 / 20.
3. **Given** a travel row exists, **when** downgrading, **then** it raises naming the count and changes
   nothing.
4. `alembic check` reports no drift for `technician_profiles`, `franchisee_travel_rules`, `tickets`,
   `ledger_entries`, `pincodes` (functional-index false positives from hard rule 6 excepted).
5. `python -m app.scripts.audit_tenancy` exits 0 and lists `franchisee_travel_rules.franchisee_id`.
6. The FK-coverage query in hard rule 6 returns no row for the new FKs.
7. **When** a row is inserted by hand with `base_latitude = 0, base_longitude = 0, base_source = 'gps',
   base_set_at = now()`, **then** `ck_technician_profiles_base_coordinates_both_or_neither` refuses it; with a
   latitude and no source, `base_complete` refuses it; `source = 'pincode'` with no `base_pincode`,
   `base_pincode_iff_source` refuses it.
8. **When** a `ledger_entries` row with `kind = 'travel'` is inserted twice for one ticket, **then** the second
   fails on `uq_ledger_entries_one_travel`.

**Creation hook**

9. **Given** a superadmin creates a company, **then** its home franchisee has two rule rows in the same
   transaction. **Given** an Admin creates SkyFix (Task 03), **then** SkyFix has two. **Given** one row is
   deleted by hand, **when** a SkyFix freelancer accepts a job, **then** the accept succeeds and both rows
   exist again (self-heal).

**Base location**

10. **Given** a Home freelancer, **when** `PUT /technicians/me/base-location {"pincode":"<home code with a
    point>"}`, **then** 200 and:
    ```sql
    SELECT tp.base_source, tp.base_pincode, tp.base_latitude = p.latitude, tp.base_set_by_user_id = m.user_id
    FROM technician_profiles tp JOIN memberships m ON m.id = tp.membership_id
    JOIN pincodes p ON p.code = tp.base_pincode WHERE tp.id = '<tech>';
    -- pincode | <code> | t | t
    ```
11. **Given** a Home technician, **when** the pincode is one SkyFix owns, **then** 422
    `PINCODE_OUTSIDE_FRANCHISEE`; same for an unknown code and an inactive code; nothing is written.
12. **Given** a pincode inside the range whose `latitude IS NULL`
    (`SELECT code FROM pincodes WHERE latitude IS NULL AND is_active LIMIT 1`), **then** 400
    `PINCODE_HAS_NO_LOCATION`.
13. **When** `{"latitude": 51.5, "longitude": -0.12, "source": "gps"}`, **then** 400 `BASE_OUTSIDE_INDIA`;
    `{"latitude": 95, …}` → 422 (globe bounds); `{"source": "manual", …}` from the technician → 422.
14. **Given** SkyFix's franchisee admin, **when** `PUT /franchise/technicians/<Home technician id>/base-location`,
    **then** 404; **with** another company's technician id, 404; **with** a SkyFix technician and
    `{"latitude":17.44,"longitude":78.35,"source":"map"}`, 200 and `base_source = 'map'`, `base_pincode IS NULL`.
15. **Given** an Area Manager covering the technician's state, **when** `PUT /technicians/<SkyFix
    technician>/base-location`, **then** 403 "Managed by SkyFix Services" (F8; he can see the row); for a Home
    technician in his states, 200; outside his states, 404 (existing `_load` scoping).
16. `GET /technicians/me` and the OTP sign-in response carry `baseLocation` (null before, the object after);
    `GET /technicians/<id>` carries `baseLocation`; `GET /technicians` rows carry `baseSource`/`baseSetAt`/`baseSetBySelf` and
    **no** coordinates.
16a. **Self-set base is visible (owner ruling 2026-10-15, R9).** **Given** Ravi sets his base through
    `PUT /technicians/me/base-location` with `{"latitude":17.44,"longitude":78.35,"source":"gps"}`, **then** SkyFix's franchisee
    admin's `GET /franchise/technicians/<Ravi>` returns `baseLocation.source = "gps"`, `setBySelf = true`,
    `setByName = "Ravi ..."`, `setByRole = "Technician"`, and the list row has `baseSource = "gps"`, `baseSetBySelf = true`.
    **When** the franchisee admin corrects it (`source: "map"`), **then** `setBySelf = false`, `setByName` is the admin's
    name, `setByRole = "Franchisee Admin"`; a `manual` source reads as *Set by admin* in the chip; a job accepted
    **before** the correction keeps its original `accept_snapshot.travel.basePoint` byte-for-byte. There is **no** approval
    state, no cooldown (two PUTs one second apart both succeed), and an Area Manager viewing SkyFix's technician gets
    `baseLocation = null` but the list's `baseSource`.
17. `GET /geo/pincodes?search=500049` and `GET /franchise/pincodes?search=…` rows carry `latitude` /
    `longitude` equal to `pincodes.latitude/longitude` (null for a code without a point);
    `POST /onboarding/invites/{token}/register` is unchanged (no `baseLocation` field).

**Travel rules**

18. **Given** SkyFix's admin, **when** `PUT /franchise/settings/travel` with freelancer
    `{freeKm:20, stepKm:2, paisePerStep:1000, roadFactorPct:130, maxPaisePerJob:30000}` and employee
    `{freeKm:30, stepKm:1, paisePerStep:500, roadFactorPct:130, maxPaisePerJob:20000}`, **then** 200 and the
    two SkyFix rows hold exactly those values; Home's rows are unchanged.
19. `stepKm: 0`, `roadFactorPct: 99`, `freeKm: 501`, `paisePerStep: 1000001`, `maxPaisePerJob: 10000001` → 422
    each; `paisePerStep: 1000, maxPaisePerJob: 0` → 422 with the W2 message.
20. **Given** an Admin or National Head, `PUT /settings/travel` edits **Home's** rows only; **given** a
    Regional Head or Area Manager (even one granted `settings.edit` on Feature Access), 403; `GET /franchisees/<SkyFix>/travel-rules` returns SkyFix's rows; with another
    company's franchisee id, 404. A facility operator calling `/franchise/settings/travel` → 403.

**Snapshot on accept / assign**

21. **Given** SkyFix's rules from 18, Ravi (SkyFix freelancer) with a base, and a SkyFix ticket with no
    `latitude` whose pincode has a point 27.0 km straight from his base, **when** Ravi accepts, **then**:
    ```sql
    SELECT accept_snapshot->>'technicianId', accept_snapshot->>'franchiseeId',
           accept_snapshot->>'technicianType',
           accept_snapshot->'travel'->'customerPoint'->>'source',
           (accept_snapshot->'travel'->>'km')::numeric,
           (accept_snapshot->'travel'->>'amountPaise')::int,
           accept_snapshot->'travel'->>'reason', accept_snapshot->'speed'
    FROM tickets WHERE id = '<ticket>';
    -- <ravi> | <skyfix> | freelancer | pincode | 35.1 | 7000 | NULL | null
    ```
    (Use a real pair of pincodes and compute the expected km with `metres_between` first; 27.0 km is the
    illustrative figure.)
22. **Given** a technician with no base, **when** they accept, **then** 200 (TA8) and `reason =
    'no_base_location'`, `amountPaise = 0`, `maxPaisePerJob` = the rule's.
23. **Given** a ticket with its own map point, `customerPoint.source = 'ticket'`; **given** a ticket with no
    point whose pincode has none, `reason = 'no_customer_point'`, `km = 0`.
24. **Given** two technicians accepting the same job at once, **then** one wins and `technicianId` in the
    snapshot is the winner's (loser's request wrote nothing).
25. **Given** a manager assigns technician A via `POST /tickets/<id>/assign`, **then** the snapshot names A;
    **when** re-assigned to B, it names B with B's base and B's type's rule; **when** re-assigned to B again,
    `acceptedAt` does not change (no-op).
26. **Given** an accepted job, **when** the technician cancels, **then**
    `SELECT accept_snapshot IS NULL, jsonb_typeof(accept_snapshot) FROM tickets WHERE id='<t>'` returns
    `true | NULL` (SQL NULL, **not** JSON `null`); **when** another technician accepts, a fresh snapshot
    names them. Same for `POST /tickets/<id>/no-show`.
27. **Given** an accepted job, **when** the technician moves their base and SkyFix raises its rate, **then**
    the ticket's snapshot is byte-for-byte unchanged (`SELECT md5(accept_snapshot::text)` before/after).

**Paying**

28. **Given** the job from 21 is completed and the customer confirms, **then**:
    ```sql
    SELECT kind, amount_paise, franchisee_id, reason FROM ledger_entries
    WHERE ticket_id = '<ticket>' ORDER BY kind;
    -- payout | <price> | <skyfix> | ...
    -- travel | 7000    | <skyfix> | Travel allowance · 35.1 km
    ```
29. **Given** a job whose snapshot amount is 0 (rates off, or `no_base_location`), **when** confirmed, **then**
    there is a payout row and **no** travel row.
30. **Given** an **employee** (Task 06) job with a travel amount, **when** confirmed, **then** a travel row and
    no payout row. **Given** a technician whose type changed from freelancer to employee AFTER accepting,
    **then** the payout follows the frozen type (`freelancer` → paid) — T1 via `technician_type_of`.
31. **When** the customer's link is POSTed a second time, **then** 409 and still exactly one travel row.
32. **Force-close**, ticket with snapshot amount 7000 and max 30000:
    - `GET /tickets/<id>` → `travel.forceCloseDefaultPaise = 7000`, `travel.forceCloseMaxPaise = 30000`,
      `creditedPaise = null`, and the JSON contains no `basePoint` / no base coordinates;
    - `travelPaise` omitted → no travel row; `0` → none; `5000` → one row of 5000 with reason
      "Travel allowance · set at force-closure"; `99999` → one row of 30000;
    - on a ticket with a NULL snapshot (accepted before deploy) `travelPaise: 5000` → no row;
    - on a ticket with no technician → no row.
    After closure, `GET /tickets/<id>` → `travel.creditedPaise` = the row's amount.
33. **Given** a vendor principal, `GET /tickets/<id>` → `travel` is null/absent.
34. **Given** a SkyFix franchisee admin (F13 read-only detail), `travel` is present for SkyFix tickets; another
    franchisee's ticket id → 404.

**App and money readers**

35. `GET /jobs/<id>` and `GET /jobs/mine` for the holder → `travel: {km: 35.1, amountPaise: 7000, reason: null}`;
    `GET /jobs/pool` rows and the pool socket frame carry **no** travel field.
36. `GET /earnings/summary` over a window containing 28 → `travelPaise = 7000`,
    `earnedPaise = <payout> + 7000` (folded, index §6a) and `netPaise = earnedPaise + bonusesPaise −
    penaltiesPaise` (the three old tiles still add up); `GET /earnings/transactions` has a row
    `kind = 'travel'`, `title = 'Travel allowance'` — **not** "Late cancellation penalty".
37. **Given** Ravi (freelancer) with payout P and travel 7000, **when** he opens Redeem, **then** the offered
    amount is P + 7000 (minus anything reserved), and requesting it does not 409 `BALANCE_CHANGED`.
38. `core.ledger.pool` / `GET /ledger` (and Task 05's per-franchisee pool) are unchanged by a travel row —
    the balance before and after 28 is identical.
39. `python -m app.scripts.seed.verify` passes, including the new travel and rules checks.
40. `pytest api/tests/unit -q` is green.

**Release**

41. **X4 gate (index §6a):** a build containing Task 07 is **live on the Play production track** (not just
    submitted) **AND ≥ 90 % of active technicians are on that build** (Play Console → versions statistics)
    before this API is published — an installed APK that predates it crashes on an unknown ledger kind
    (`KIND_STYLE[kind].bg`) in the Earnings list. The console's label/format for `travel` must ship no later
    than this API (index §6a; pulled into Task 13 or Task 07's window). Belt-and-braces only, not a
    substitute: the TA4 defaults are ₹0, so no travel row exists until some franchisee configures a rate.
42. **Prod order:** the owner runs `9e1b5d3c7a26` on **RelianceProdDB** (after `7c4f2e9a1d58`), then the API
    is published (index release gate b). The implementing agent does not touch RelianceProdDB; it may offer
    to verify with read-only SQL afterwards (criteria 2, 5).

---

## 8. Out of scope, and traps

**Out of scope**

- Real road distance (OSRM, Google Directions). TA1 is straight line × factor; no outbound call is added —
  root `AGENTS.md`: the API does not call Google.
- Return-trip pay, per-category travel rules, travel for jobs that were cancelled (TA6: nothing).
- A travel **estimate on the pool offer** — W4, **ruled out by the owner 2026-10-15 (R10)**: travel appears only after accept.
- A base-location history table (W12), and a pincode-centre correction screen (G2's "possible later task").
- Console UI (Task 13), mobile UI (Tasks 14, 15), mobile translations of the new title and error codes.
- Speed allowance — Task 11 extends `accept_snapshot.speed`, `LEDGER_KINDS` and the kind CHECK again.

**Traps**

1. **JSON `null` is not SQL NULL.** Without `JSONB(none_as_null=True)` on `accept_snapshot`,
   `.values(accept_snapshot=None)` stores `'null'::jsonb`, `IS NULL` is false, and criterion 26 and every
   verify check silently lie. The migration's column type must say it too.
2. **`pincodes.latitude/longitude` may be missing from the model** (§3.0). The DB has them; `dev` does not
   declare them. Match the DB type — and if it is `numeric`, convert `Decimal` → `float` before
   `metres_between`.
3. **Every path that clears `technician_id` must clear the snapshot** in the same statement. Today there are
   two (cancel, no-show). Task 12, and any future "unassign", must add it — otherwise a re-accept would be
   blocked by nothing but a stale snapshot would name the old technician, and W17 would pay nobody.
4. **The kind CHECK is widened by matching `'penalty'`** (the `e8b2f47c19d3` helper). Task 11 adds
   `speed_penalty`, which still matches; do not "simplify" the match to `'%kind%'` — `reversal_points_back`
   mentions `kind` too.
5. **`travelPaise` is a breakdown of `earnedPaise`, not a fourth term.** Folding (index §6a) is what keeps an
   old build's tiles summing to `net`; any client or verify check that adds `travelPaise` to `earnedPaise`
   counts travel twice.
6. **A second customer confirmation is impossible today, independently of this task.** After a customer
   says "not done", `customer_confirmed_at` is set and `complete` never clears it, so after a manager
   re-assigns and the work is finished again, `record_feedback`'s guard refuses the second answer and the job
   can only be force-closed — where travel is the manager's number, not the snapshot's. Pre-existing; not
   fixed here; worth a ticket.
7. **Base abuse - SETTLED by the owner 2026-10-15 (R9): no approval flow, no cooldown.** A technician can still move
   their base far away, accept a far job, and move it back: the snapshot freezes the far base. The answer is
   **visibility, not friction**: `base_source`, `base_set_at` and `base_set_by_user_id` are exposed as the source chip
   and the "set by" line (`BaseLocationOut.setByName` / `setByRole` / `setBySelf`, the list's `baseSetBySelf`) to the
   franchisee admin and home managers, the cap (`maxPaisePerJob`) bounds any one job, the franchisee admin can correct a
   base at any time, and the frozen `basePoint.source` on every paid job keeps the money record honest. The UPI-change
   approval pattern is deliberately **not** reused here.
8. **Bases copied from a pincode do not follow a later correction of that pincode's centre** (W7). A
   correction screen must also run
   `UPDATE technician_profiles SET base_latitude=…, base_longitude=… WHERE base_source='pincode' AND base_pincode=:code`
   — and must never touch an existing `accept_snapshot`.
9. **F7 tension - SETTLED by the owner 2026-10-15 (R8).** Company staff may force-close any ticket (F7) and the form
   shows the travel figure (TA6). The owner ruled that staff (Area Manager and above) see **both** the travel amount and
   Task 11's speed outcome/amount on any ticket in their scope, **non-home franchisees' tickets included**, so the two
   behave identically; facility staff and vendors see neither. Still withheld from staff on non-home tickets: the
   technician's base-location **coordinates** (W13) and the franchisee's pool. The travel block is one `if` in `get_ticket`
   (`not principal.is_vendor and principal.role not in FACILITY_ROLES`), the same `if` Task 11's speed block uses.
10. **Task 06 ships first and reads the live type.** §4.3's hand-over switches it to the frozen type. Forgetting
    it means a freelancer converted to employee mid-job loses that job's payout, against T1.
11. **`ledger.entry()` signature.** Task 01 adds `franchisee_id` to it; every new `travel` call must pass the
    technician's franchisee at write time (index §3.2), reusing the value the payout row beside it computed.
12. **Do not filter readers by `POOL_KINDS` to "exclude" travel from a technician's own money** — Earnings and
    `credited()` read kinds by name. `travel` must be added to them explicitly (§4.4, §4.6); it reaches the pool
    readers by NOT being in `POOL_KINDS`.
13. **Tickets accepted before deploy have a NULL snapshot** and never pay travel, even after rates are
    configured. That is the index's rule (§3.5), not a bug; say it in the release note.
14. **`cleanup_db`** classifies `franchisee_travel_rules` in this task (§3.3); it cascades from `companies` and
    `franchisees`. Task 16 only re-checks the keep-list.
15. **Index inconsistencies found while writing** (fix the index, per its own instruction):
    - §3.3 has no error code for an in-range pincode without coordinates → add `PINCODE_HAS_NO_LOCATION` (W10).
    - §3.1 says unique `(franchisee_id, technician_type)`; this task uses `(company_id, franchisee_id,
      technician_type)` for FK coverage (W14) — same rule.
    - T1 freezes the type in `accept_snapshot`, written by Task 10, but Task 06 (employees: no payout) is
      ordered before Task 10 — see trap 10.
    - Task 11's W15 says Rules Config is guarded by `settings.edit` + National-Head floor; on `dev` only the
      payment-account routes carry `HeadRoute`. This task adopts the pair for `PUT /settings/travel` so both
      home money settings share one guard (§4.8).
    - §3.7 names `build_accept_snapshot / travel_of / speed_of` only; this task adds `technician_type_of`,
      `closure_travel_paise`, `force_close_travel_paise`, `core/travel_rules.py` and `core/base_location.py`.

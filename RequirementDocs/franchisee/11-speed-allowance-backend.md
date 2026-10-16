# Task 11 — Speed allowance (backend)

> Layer: **api** · Depends on: **10** (`accept_snapshot`, `travel`, migration `9e1b5d3c7a26`) · Migration:
> **`b4a8e2f6c903_speed_allowance.py`** (down_revision `9e1b5d3c7a26`) · Followed by: **12** (`d6c3a9f1e874`)
>
> Read [00-index.md](00-index.md) first. Decisions **S1–S6**, **F7/F8/F12**, **P3**, **X1/X4/X5**, names **§3.1–3.7**
> are binding here. Every judgement this document makes on its own is marked **Decision (writer):**.

---

## 1. Goal and why

A franchisee wants its technicians to finish fast. It sets, per **technician type × category (or product)**, a
time inside which a job earns a **reward**, and a time after which it costs a **penalty**. In between, nothing
happens. The money moves through the franchisee's penalty pool exactly like a cancellation penalty and an
escalation bonus do today — slow technicians fund fast ones.

> **Worked example.** *SkyFix Services* sets, for **freelancers** on **Washing Machine**:
> finish within **12 h → ₹200 reward**; take more than **24 h → ₹150 penalty**.
>
> Ravi (freelancer, SkyFix) accepts a washing-machine install on **Mon 10:30**, for the customer's slot **Mon
> 11:00–13:00**. Accepting stamps the rule on the ticket (`accept_snapshot.speed`): 12 h / 24 h / ₹200 / ₹150.
> **The clock starts at the LATER of the accept and the slot start — here Mon 11:00 (owner ruling 2026-10-15).**
> He starts, finds the drum bearing is cracked and
> raises a part request at **Mon 15:00** — the job moves to `Awaiting Part`. The facility issues the part at
> **Mon 18:00** and the job is `In Progress` again. He presses Complete on **Tue 13:00**.
>
> - Elapsed, clock start → completed: Mon 11:00 → Tue 13:00 = **26 h**.
> - Minus time in `Awaiting Part`: 15:00 → 18:00 = **3 h**.
> - **Working hours = 23 h.** 23 > 12 (no reward) and 23 ≤ 24 (no penalty) → **nothing**.
>
> The customer confirms on Tue 14:10. In that one transaction the ticket closes, Ravi's payout (and Task 10's
> travel) is written, and a `speed_settled` ticket event records *"Finished in 23.0 working hours (26.0 h since
> accepted, 3.0 h waiting for parts) · between 12 h and 24 h — no speed reward or penalty"*. No speed ledger row.
>
> **Why the slot matters (owner ruling 2026-10-15).** Had Ravi accepted on **Mon 11:00** a job whose slot is
> **Thu 10:00–12:00**, and completed it **Thu 13:00**, the clock would start **Thu 10:00**, not Monday: working
> hours = **3 h** — a technician is never charged for the days between taking a job and the day the customer
> chose.
>
> Had he completed at **Mon 23:00** (12 h elapsed, 3 h waiting → 9 h): a **₹200 `speed_reward`** row against
> SkyFix's pool. At **Tue 14:00** (27 h elapsed − 3 h waiting = 24 h exactly): **nothing** — 24.0 is not *more
> than* 24. At **Tue 14:01**: a **₹150 `speed_penalty`**, reduced or skipped if Ravi's monthly cap is already used.

Why this shape:

- **Frozen at accept (S5).** A franchise admin editing the matrix on Tuesday must never restate a job Ravi took
  on Monday — the `rules_snapshot` / price-stamping principle, applied to a term that depends on the technician.
- **Measured from events, not columns (S3).** `ticket_events` is where a ticket's history lives (root
  `AGENTS.md`); the clock is a fold over those rows (plus the one fact events cannot carry in machine form: the
  ticket's slot start, §4.4), so it can be recomputed and audited at any time.
- **Paid on customer closure only (S5).** The same moment the payout is paid, for the same reason: the customer
  saying the work is done is the only thing that settles it.

---

## 2. Decisions

From the index (binding, restated for the implementer):

| # | Rule |
|---|---|
| S1 | Matrix rows: franchisee × technician type × (node **or** model) → `reward_within_hours`, `penalty_after_hours`, `reward_paise`, `penalty_paise`. |
| S2 | Resolution: the ticket's **model** row; else the **deepest** node row on `tickets.node_path_ids`; else none. Keyed on the **snapshot's** franchisee and technician type. |
| S3 | **(owner ruling 2026-10-15, R1)** Clock: from the **LATER of** the latest `assigned` event (accept) **and the confirmed slot's start** → the `completed` event, **minus `Awaiting Part`**. With no slot, from the accept. A reschedule does not reset it, but it **moves the slot, so the slot in force at completion is the one used**. A slot start later than completion → 0 h (clamped). |
| S4 | `≤ reward_within_hours` → reward; `> penalty_after_hours` → penalty; between → nothing. |
| S5 | Frozen at accept, measured at completion, written on **customer closure**. **Force-close: no speed money** *(settled by the owner 2026-10-15, R7)*. |
| S6 | Both are pool kinds. `speed_penalty` counts against `cancel_penalty_cap_paise` and is reversible like a penalty. |

Writer's decisions (each argued where it is applied):

| # | Decision (writer) |
|---|---|
| W1 | **An empty matrix means OFF.** No rows are stamped when a franchisee is created (unlike travel's two rows): there is no honest default reward, and an empty matrix is also what keeps the X4 gate safe — nothing is written until somebody configures a row. |
| W2 | **A row may hold 0 for either amount, or both.** `reward 0 / penalty 0` on a model is the way to switch speed **off** for one product beneath a category that has a rule. Zero produces no ledger row (`amount_paise > 0` CHECK), but the event still records the measurement. |
| W3 | **Limits:** hours are whole numbers **1–720** (30 days); amounts are **whole rupees, 0–₹10,000** (`0..1_000_000` paise, multiple of 100), the same typo-guard idea as `rules.LIMITS`. |
| W4 | **Clock boundaries are compared on exact seconds**, never on a rounded figure. Display rounds to one decimal; `speed_outcome` sees the unrounded value. 12 h 0 min 1 s is *not* ≤ 12. |
| W5 | **The latest `completed` event, and the latest `assigned` before it** (by `seq`). A customer-refused job that is re-assigned and completed again is measured from its re-assignment (or its slot, if later — W17). A completion with no `assigned` before it is "not measurable" → no money. |
| W6 | **`Awaiting Part` intervals are read off `from_status` / `to_status`, whatever the event `kind`.** Task 12 may record the move as `part_requested` or as `status_changed`; matching on the status columns works for both and subtracts nothing before Task 12 exists. Intervals before the latest `assigned` belong to a previous holder and are clipped away. |
| W7 | **A speed reward is paid even if the pool is low or negative** — exactly as an escalation bonus is today (`jobs.service.complete` writes the `bonus` row with no balance check; `LedgerPoolOut.balancePaise` documents negative as "a real state worth seeing"). |
| W8 | **Monthly cap:** the speed penalty is charged `min(penalty, cap remaining)`, under the same technician-profile row lock the cancel path takes. Remaining 0 → **no row**, and the `speed_settled` event says so. Cancellation penalties then see speed penalties already charged, because `charged_this_month` counts both kinds. |
| W9 | **One speed row per ticket, structurally:** partial unique `uq_ledger_entries_speed_once` on `(company_id, ticket_id) WHERE kind IN ('speed_reward','speed_penalty')`. |
| W10 | **Earnings fold speed into the existing tiles:** `speed_reward` into `bonusesPaise`, `speed_penalty` into `penaltiesPaise`; two additive breakdown fields for Task 15. `net = earned + bonuses − penalties` keeps holding on every installed APK without a new tile. |
| W11 | **Pool output folds the same way:** `penaltiesCollectedPaise` includes standing speed penalties, `bonusesPaidPaise` includes speed rewards, so the console's printed `collected − bonuses = balance` survives; breakdown fields added. `cancellations` keeps counting cancellation/no-show penalties only. |
| W12 | **A new event kind `speed_settled`**, `actor_kind = 'system'`, written in the closure transaction whenever a frozen rule was measured. Its note carries **no rupee amounts** (a vendor reads every timeline — the event is also **hidden from vendor principals** — and the amounts live in the `speed` block of the ticket detail, which staff and the franchisee admin may read, R8).  ⚠ This adds to index §3.3 — see §8. |
| W13 | **The technician sees the terms after accepting** — `JobOut.speed` (thresholds, amounts, clock start) from the snapshot. Not on the pool offer (`JobOfferOut`): the snapshot does not exist yet and resolving per offer would add a query per pool row. Task 15 owns the display. |
| W14 | **Shared code lives in `app/core/`** (api hard rule 4): `speed.py` (pure, index §3.7), plus `speed_rules.py` (matrix CRUD + resolution query) and `speed_settle.py` (DB clock loader + closure writer). Two slices call them: `franchise_portal` and `franchisees`. |
| W15 | **Staff edit only the HOME franchisee's matrix** (F8), with `settings.edit` + National-Head floor — the pair Task 10 put on `PUT /settings/travel` (on `dev`, `PUT /settings/rules` itself carries `settings.edit` only), so two money settings on one franchisee share one guard. Non-home: read-only for Admin/NH, 404 for everyone else. |
| W16 | **A franchise principal gets a price-free catalogue read** for the matrix picker. `masters.get_tree` carries `technicianPayoutPaise` / `vendorPricePaise`; a franchisee admin is not a party to the vendor's price. If Task 09 or 12 already exposes such a read for franchise principals, reuse it. |

| W17 | **(owner ruling 2026-10-15, R1) The clock start is `max(accepted_at, slot_start)`; the slot is read from the TICKET, not from events.** *Why the ticket column:* `ticket_events` carries a slot only as a human label (`"Thu 10:00–12:00"` in `note`), never as an instant, and `tickets.slot_start` is already overwritten by every reschedule, so it **is** "the slot in force". *Why that is the slot in force at completion:* both reschedule doors refuse `Awaiting Customer` and later, so nothing can move the slot between the `completed` event and the customer's closure, which is when the clock is read. `speed_settle.settle_speed` and `tickets.service.get_ticket` pass `ticket.slot_start` into the pure `clock_from_events` as **data**. No `slot` key is added to `accept_snapshot` (index §3.5): the slot is not frozen at accept — a reschedule legitimately moves it — and the snapshot's `acceptedAt` stays the accept half. A ticket with no slot (`slot_start IS NULL`) starts at the accept; a manager-assigned job accepted after its slot started starts at the accept; a slot starting after completion yields **0 h** (a technician who finished early is "within" every reward). Wait intervals before the clock start are clipped away by the existing clip-to-window rule. |

---

## 3. Schema — migration `b4a8e2f6c903_speed_allowance.py`

`down_revision = "9e1b5d3c7a26"`. If Task 10 has not landed, re-point to the current head and say so in the
commit (index §3.6). Hand-written; constraints declared on the model too (api hard rule 6).

### 3.1 Model — `app/models/franchisee_speed_rule.py`

```python
"""A franchisee's speed matrix — reward fast work, charge slow work (Task 11, S1).

One row per (franchisee, technician type, node) or (franchisee, technician type, model).
No soft delete: a configuration row is not a record of something that happened
(`product_node_rules`' reasoning); deleting a row restores inheritance. What a job
was actually promised lives on `tickets.accept_snapshot.speed`, never here.
"""

SPEED_HOURS = (1, 720)                 # whole hours
SPEED_PAISE = (0, 1_000_000)           # whole rupees, ₹0–₹10,000

class FranchiseeSpeedRule(Base, IdMixin, AuditMixin):
    __tablename__ = "franchisee_speed_rules"

    company_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    technician_type: Mapped[str] = mapped_column(String(16), nullable=False)
    node_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    model_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    reward_within_hours: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    penalty_after_hours: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    reward_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    penalty_paise: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        CheckConstraint("technician_type IN ('employee', 'freelancer')", name="technician_type"),
        CheckConstraint("(node_id IS NULL) <> (model_id IS NULL)", name="one_target"),
        CheckConstraint("reward_within_hours BETWEEN 1 AND 720", name="reward_within_hours"),
        CheckConstraint("penalty_after_hours BETWEEN 1 AND 720", name="penalty_after_hours"),
        CheckConstraint("penalty_after_hours >= reward_within_hours", name="penalty_not_before_reward"),
        CheckConstraint("reward_paise BETWEEN 0 AND 1000000 AND reward_paise % 100 = 0", name="reward_paise"),
        CheckConstraint("penalty_paise BETWEEN 0 AND 1000000 AND penalty_paise % 100 = 0", name="penalty_paise"),
        ForeignKeyConstraint(["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
                             name="fk_franchisee_speed_rules_company_franchisee", ondelete="CASCADE"),
        ForeignKeyConstraint(["company_id", "node_id"], ["product_nodes.company_id", "product_nodes.id"],
                             name="fk_franchisee_speed_rules_company_node", ondelete="CASCADE"),
        ForeignKeyConstraint(["company_id", "model_id"], ["product_models.company_id", "product_models.id"],
                             name="fk_franchisee_speed_rules_company_model", ondelete="CASCADE"),
        # Covering index for the franchisee FK AND the resolution query (§4.2).
        Index("ix_franchisee_speed_rules_company_franchisee", "company_id", "franchisee_id", "technician_type"),
        # Covering indexes for the node and model FKs — the partial uniques below start
        # with franchisee_id, so they do not cover (company_id, node_id).
        Index("ix_franchisee_speed_rules_company_node", "company_id", "node_id"),
        Index("ix_franchisee_speed_rules_company_model", "company_id", "model_id"),
    )
```

The two partial uniques are hand-written in the migration (`op.execute` / `postgresql_where`) — SQLAlchemy's
`Index(..., postgresql_where=...)` is fine here, but list them in the model's `__table_args__` too so
autogenerate does not propose dropping them (api AGENTS.md "Three things the autogenerated diff gets wrong"):

```python
        Index("uq_franchisee_speed_rules_node", "company_id", "franchisee_id", "technician_type", "node_id",
              unique=True, postgresql_where=text("node_id IS NOT NULL")),
        Index("uq_franchisee_speed_rules_model", "company_id", "franchisee_id", "technician_type", "model_id",
              unique=True, postgresql_where=text("model_id IS NOT NULL")),
```

Not partial on `deleted_at` because the table has no soft delete. Re-export from `app/models/__init__.py`.

### 3.2 Ledger changes — `app/models/ledger.py`

```python
LEDGER_KINDS = ("penalty", "bonus", "payout", "reversal", "travel", "speed_reward", "speed_penalty")
POOL_KINDS = ("penalty", "bonus", "reversal", "speed_reward", "speed_penalty")   # travel is NOT pool money
#: What a `reversal` may name. Enforced in the service (a CHECK cannot see another row).
#: MOVED here from Task 05's `core/penalty_reversal.py` (which now imports it) — one tuple,
#: one home, beside the kinds it names.
REVERSIBLE_KINDS = ("penalty", "speed_penalty")
#: The kinds that count against `cancel_penalty_cap_paise` (S6).
CAPPED_KINDS = REVERSIBLE_KINDS
#: The two Task 11 kinds — at most one per ticket.
SPEED_KINDS = ("speed_reward", "speed_penalty")
```

- `kind` CHECK widened to the seven values. `String(16)` holds `speed_penalty` (13).
- **`reversal_points_back` is unchanged** — `(kind = 'reversal') = (reverses_id IS NOT NULL)` says nothing about
  the target's kind, so a reversal of a `speed_penalty` already satisfies it.
- **`uq_ledger_entries_reverses` is unchanged** — partial unique `(company_id, reverses_id) WHERE reverses_id IS
  NOT NULL` already gives "at most one reversal per reversible row", whatever its kind. What must change is the
  service's target lookup (§4.6), which today filters `kind == "penalty"`.
- New: `uq_ledger_entries_speed_once` (W9). Not an FK, so no covering-index question.

### 3.3 Ticket events — `app/models/ticket_event.py`

Append `"speed_settled"` to `EVENT_KINDS` with a comment (W12) and to the `kind` CHECK.

### 3.4 Migration (near-code)

```python
"""Speed allowance — a franchisee's speed matrix, two pool kinds, one event kind.

Revision ID: b4a8e2f6c903
Revises: 9e1b5d3c7a26
"""
revision = "b4a8e2f6c903"
down_revision = "9e1b5d3c7a26"

#: As they stand at 9e1b5d3c7a26 — spelled out, never imported (a migration describes the
#: database it was written against). Copy from the model at that revision: includes
#: 'penalty_reversed' and 'franchisee_changed' (widened by Task 01's 3b7e1f0a9c41; Tasks
#: 05 and 10 do not touch this CHECK).
_EVENTS = "'created', 'slot_requested', …, 'penalty_reversed', 'franchisee_changed'"
_LEDGER_OLD = "kind IN ('penalty', 'bonus', 'payout', 'reversal', 'travel')"
_LEDGER_NEW = ("kind IN ('penalty', 'bonus', 'payout', 'reversal', 'travel', "
               "'speed_reward', 'speed_penalty')")


def _drop_ledger_kind_check() -> None:
    # Same DO-block as e8b2f47c19d3: resolve the name from pg_constraint, matched on
    # '%''penalty''%' (NOT '%kind%' — reversal_points_back mentions kind too).
    ...


def upgrade() -> None:
    op.create_table(
        "franchisee_speed_rules",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("franchisee_id", sa.Uuid(), nullable=False),
        sa.Column("technician_type", sa.String(16), nullable=False),
        sa.Column("node_id", sa.Uuid(), nullable=True),
        sa.Column("model_id", sa.Uuid(), nullable=True),
        sa.Column("reward_within_hours", sa.SmallInteger(), nullable=False),
        sa.Column("penalty_after_hours", sa.SmallInteger(), nullable=False),
        sa.Column("reward_paise", sa.Integer(), nullable=False),
        sa.Column("penalty_paise", sa.Integer(), nullable=False),
        # audit columns LAST (hard rule 6)
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_franchisee_speed_rules")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE",
                                name=op.f("fk_franchisee_speed_rules_company_id_companies")),
        sa.ForeignKeyConstraint(["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
                                name="fk_franchisee_speed_rules_company_franchisee", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["company_id", "node_id"], ["product_nodes.company_id", "product_nodes.id"],
                                name="fk_franchisee_speed_rules_company_node", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["company_id", "model_id"], ["product_models.company_id", "product_models.id"],
                                name="fk_franchisee_speed_rules_company_model", ondelete="CASCADE"),
        # CHECKs by FULL name inside create_table (op.f), bare name everywhere else — hard rule 6.
        sa.CheckConstraint("technician_type IN ('employee', 'freelancer')",
                           name=op.f("ck_franchisee_speed_rules_technician_type")),
        sa.CheckConstraint("(node_id IS NULL) <> (model_id IS NULL)",
                           name=op.f("ck_franchisee_speed_rules_one_target")),
        sa.CheckConstraint("reward_within_hours BETWEEN 1 AND 720",
                           name=op.f("ck_franchisee_speed_rules_reward_within_hours")),
        sa.CheckConstraint("penalty_after_hours BETWEEN 1 AND 720",
                           name=op.f("ck_franchisee_speed_rules_penalty_after_hours")),
        sa.CheckConstraint("penalty_after_hours >= reward_within_hours",
                           name=op.f("ck_franchisee_speed_rules_penalty_not_before_reward")),
        sa.CheckConstraint("reward_paise BETWEEN 0 AND 1000000 AND reward_paise % 100 = 0",
                           name=op.f("ck_franchisee_speed_rules_reward_paise")),
        sa.CheckConstraint("penalty_paise BETWEEN 0 AND 1000000 AND penalty_paise % 100 = 0",
                           name=op.f("ck_franchisee_speed_rules_penalty_paise")),
    )
    op.create_index("ix_franchisee_speed_rules_company_franchisee", "franchisee_speed_rules",
                    ["company_id", "franchisee_id", "technician_type"])
    op.create_index("ix_franchisee_speed_rules_company_node", "franchisee_speed_rules", ["company_id", "node_id"])
    op.create_index("ix_franchisee_speed_rules_company_model", "franchisee_speed_rules", ["company_id", "model_id"])
    op.create_index("uq_franchisee_speed_rules_node", "franchisee_speed_rules",
                    ["company_id", "franchisee_id", "technician_type", "node_id"], unique=True,
                    postgresql_where=sa.text("node_id IS NOT NULL"))
    op.create_index("uq_franchisee_speed_rules_model", "franchisee_speed_rules",
                    ["company_id", "franchisee_id", "technician_type", "model_id"], unique=True,
                    postgresql_where=sa.text("model_id IS NOT NULL"))

    # ── ledger_entries ──
    _drop_ledger_kind_check()
    op.create_check_constraint("kind", "ledger_entries", _LEDGER_NEW)
    op.create_index("uq_ledger_entries_speed_once", "ledger_entries", ["company_id", "ticket_id"], unique=True,
                    postgresql_where=sa.text("kind IN ('speed_reward', 'speed_penalty')"))

    # ── ticket_events ──
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", f"kind IN ({_EVENTS}, 'speed_settled')")


def downgrade() -> None:
    bind = op.get_bind()
    # Refuse rather than delete money (the e8b2f47c19d3 shape). A deleted speed_penalty
    # silently refunds; a deleted speed_reward silently claws back.
    money = bind.execute(sa.text(
        "SELECT count(*) FROM ledger_entries e WHERE e.kind IN ('speed_reward','speed_penalty') "
        "OR (e.kind = 'reversal' AND EXISTS (SELECT 1 FROM ledger_entries p "
        "    WHERE p.company_id = e.company_id AND p.id = e.reverses_id AND p.kind = 'speed_penalty'))"
    )).scalar()
    if money:
        raise RuntimeError(f"{money} speed ledger row(s) exist (rewards, penalties or their reversals). "
                           "Downgrading would delete them and silently move technicians' money.")
    op.execute("DELETE FROM ticket_events WHERE kind = 'speed_settled'")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", f"kind IN ({_EVENTS})")
    op.drop_index("uq_ledger_entries_speed_once", table_name="ledger_entries")
    _drop_ledger_kind_check()
    op.create_check_constraint("kind", "ledger_entries", _LEDGER_OLD)
    # The matrix is configuration, not money — it goes with the table. Print the count first
    # so a round trip on dev can compare ids out with ids in (hard rule 6's lesson).
    op.drop_table("franchisee_speed_rules")   # drops its indexes and FKs with it
```

The `accept_snapshot` column already exists (Task 10); **no schema change** is needed for the `speed` block.

### 3.5 Tenancy and cleanup

- `app/scripts/audit_tenancy.py` → `TENANT_LINKS` gains:
  ```python
  # A speed rule naming another company's franchisee, category or product would let one
  # tenant's matrix price another's jobs.
  ("franchisee_speed_rules", "franchisee_id", "franchisees"),
  ("franchisee_speed_rules", "node_id", "product_nodes"),
  ("franchisee_speed_rules", "model_id", "product_models"),
  ```
- `app/scripts/cleanup_db.py` → add `"franchisee_speed_rules"` to `COMPANY_TABLES` **in this task**: the script
  refuses to run while any table is unclassified, so leaving it to Task 16 breaks cleanup in between.

---

## 4. API and services

### 4.1 `app/core/speed.py` — PURE (index §3.7)

No database, no SQLAlchemy, no clock. Everything here is unit-tested (§6).

```python
AWAITING_PART = "Awaiting Part"   # a literal, not imported: works before Task 12 adds the status

@dataclass(frozen=True)
class SpeedTerms:                 # what accept_snapshot.speed holds, typed
    rule_id: uuid.UUID | None
    matched_on: Literal["model", "node"]
    matched_id: uuid.UUID
    reward_within_hours: int
    penalty_after_hours: int
    reward_paise: int
    penalty_paise: int

@dataclass(frozen=True)
class EventFact:                  # one ticket_events row, reduced to what the clock reads
    seq: int
    kind: str
    at: datetime.datetime         # tz-aware
    from_status: str | None
    to_status: str | None

@dataclass(frozen=True)
class SpeedClock:
    assigned_at: datetime.datetime            # the accept (latest `assigned` before `completed`)
    slot_start: datetime.datetime | None      # the slot in force at completion (R1); None = no slot
    clock_start: datetime.datetime            # max(assigned_at, slot_start) — what the hours run from
    completed_at: datetime.datetime
    part_wait_intervals: tuple[tuple[datetime.datetime, datetime.datetime | None], ...]
    elapsed_hours: float
    part_wait_hours: float
    working_hours: float

def clock_start(assigned_at, slot_start) -> datetime.datetime:
    """R1 (owner ruling 2026-10-15). The LATER of the accept and the slot's start;
    the accept alone when there is no slot (`slot_start is None`). Naive datetimes →
    ValueError. Pure and total — the one place the rule lives."""

def working_hours(clock_start, completed_at, part_wait_intervals) -> float:
    """Hours from clock_start to completed_at minus the UNION of part-wait intervals,
    each clipped to [clock_start, completed_at]. An interval with end None runs to
    completed_at. Overlaps are merged, order does not matter, intervals outside the
    window — including every interval that ended BEFORE the clock start (R1: the
    days a technician waited for the slot are nobody's wait) — contribute nothing.
    completed_at <= clock_start → 0.0 (the clamp: a slot that begins after the
    technician finished). Naive datetimes → ValueError (every stored instant is UTC,
    hard rule 11). Exact: seconds / 3600. (The first parameter was `assigned_at`
    before R1; callers pass `clock_start(assigned_at, slot_start)`.)"""

def clock_from_events(events: Sequence[EventFact], slot_start: datetime.datetime | None = None) -> SpeedClock | None:
    """S3/W5/W6/W17. Take the LATEST `completed` (by seq) and the latest `assigned` with a
    smaller seq; None if either is missing. `slot_start` is the ticket's slot in force
    at completion (None = no slot) — data, not an event: the clock starts at
    `clock_start(assigned_at, slot_start)`. Between the start and `completed` (by seq), an event with
    to_status == AWAITING_PART opens an interval and one with from_status == AWAITING_PART
    closes the open one (a close with nothing open is ignored; an open with nothing
    closing it stays open-ended). `rescheduled`, `released` before the latest assigned,
    and anything after `completed` are irrelevant by construction — a reschedule
    matters only through the `slot_start` it left on the ticket."""

def speed_outcome(duration_h: float, rule: SpeedTerms) -> tuple[Literal["reward", "penalty"] | None, int]:
    """S4. duration_h <= reward_within_hours → ("reward", reward_paise);
    duration_h > penalty_after_hours → ("penalty", penalty_paise); else (None, 0).
    A zero amount is returned as-is — the caller writes no row for 0 (W2)."""

def resolve_speed_rule(candidates, *, model_id, node_path_ids):
    """S2, pure half. `candidates` are rule rows already filtered to (franchisee, type) and
    to model_id == model_id OR node_id IN node_path_ids. Model row wins; else the node row
    whose node_id sits LATEST in node_path_ids (root first, so latest = deepest); else None.
    Returns (row, "model" | "node") or None."""
```

Also pure, in `app/core/ledger.py` beside `cap_remaining`:

```python
def capped_charge(amount_paise: int, remaining: int | None) -> int:
    """What is actually charged: all of it when uncapped (None), else min(amount, remaining)."""
```

(`jobs.service._band_for` and `tickets.service.record_no_show` already inline `band if remaining is None else
min(band, remaining)`; switch them to `capped_charge` in this task so the three charges share one line.)

### 4.2 `app/core/speed_rules.py` — the matrix (DB)

```python
async def candidate_rules(db, *, company_id, franchisee_id, technician_type, model_id, node_path_ids)
    -> list[FranchiseeSpeedRule]
    # SELECT … WHERE company_id = :c AND franchisee_id = :f AND technician_type = :t
    #   AND (model_id = :m OR node_id = ANY(:path))
    # served by ix_franchisee_speed_rules_company_franchisee.

async def resolve_terms(db, *, company_id, franchisee_id, technician_type, model_id, node_path_ids)
    -> SpeedTerms | None          # candidate_rules + speed.resolve_speed_rule

async def list_rules(db, *, company_id, franchisee_id, technician_type=None) -> list[SpeedRuleOut]
async def upsert_rule(db, *, company_id, franchisee_id, body: SpeedRuleIn, by_user) -> SpeedRuleOut
async def delete_rule(db, *, company_id, franchisee_id, rule_id) -> None       # 404 when not this franchisee's
async def effective_rule(db, *, company_id, franchisee_id, technician_type, model_id=None, node_id=None)
    -> SpeedEffectiveOut
async def catalogue(db, *, company_id) -> SpeedCatalogueOut                    # W16, price-free
```

**Upsert** is `INSERT … ON CONFLICT (company_id, franchisee_id, technician_type, node_id) WHERE node_id IS NOT
NULL DO UPDATE` (model twin likewise) — Postgres accepts a partial unique as the arbiter when the `WHERE` is
repeated (`postgresql_where` on `on_conflict_do_update`). That makes a double-click two writes of one row rather
than a 409.

**Validation**, all before the write:

| Field | Rule | Failure |
|---|---|---|
| `technicianType` | `Literal["employee","freelancer"]` (`TECHNICIAN_TYPES`, Task 01) | 422 |
| `nodeId` / `modelId` | exactly one present | 422 "Pick a category or a product, not both" |
| `nodeId` | `product_nodes` row with `company_id = principal's` and `deleted_at IS NULL` (any depth, root included; inactive allowed) | **404** "Category not found" — a guessed id never says it exists |
| `modelId` | `product_models` row in the company, `deleted_at IS NULL`, **`approval_status = 'approved'`** (`core.product_tree.APPROVED`) | 404 when not found; 422 "Only an approved product can carry a speed rule" when pending/rejected |
| hours | ints 1–720, `penaltyAfterHours ≥ rewardWithinHours` | 422 naming both figures |
| amounts | ints 0–1,000,000, multiple of 100 | 422 |

The CHECKs repeat every rule; `app/core/errors.py` already turns an `IntegrityError` into a 409 rather than a 500.

**List (`SpeedRuleOut`)**, ordered by technician type, then target path (root-first names), models after their node:

```python
class SpeedRuleOut(AppModel):
    id: uuid.UUID
    technicianType: str
    targetKind: Literal["node", "model"]
    targetId: uuid.UUID
    targetName: str                    # node or model name, "—" if gone
    targetPath: list[str]              # root-first names; for a model, its node's path + node name
    targetActive: bool                 # false when the node/model is soft-deleted or inactive
    rewardWithinHours: int
    penaltyAfterHours: int
    rewardPaise: int
    penaltyPaise: int
    # Inheritance hints, computed in Python over this franchisee's rows (a few dozen at most):
    overridesRuleId: uuid.UUID | None  # the nearest shallower node row of the same type this row beats
    overridesName: str | None          # e.g. "Electronics"
    overriddenBy: int                  # deeper node rows + model rows of the same type beneath this node
    updatedAt: datetime.datetime
```

Resolution ignores soft-deletion on purpose: a rule matters for tickets already raised against a node that was
later removed. `targetActive` lets the console grey such rows.

**Effective (`GET …/effective`)** answers "what would a job for this product pay?" for the console's preview —
the same `resolve_speed_rule`, so the preview and the stamp can never disagree:

```python
class SpeedEffectiveOut(AppModel):
    rule: SpeedRuleOut | None          # null = no speed rule applies
    matchedOn: Literal["model", "node"] | None
```

### 4.3 Stamping at accept — extend `app/core/accept_snapshot.py` (Task 10)

Task 10 writes `snapshot["speed"] = None`. Replace it with:

```python
terms = await speed_rules.resolve_terms(
    db, company_id=ticket.company_id,
    franchisee_id=technician.franchisee_id,      # the payer and matrix owner (index §3.2)
    technician_type=technician.technician_type,  # frozen per T1
    model_id=ticket.model_id, node_path_ids=ticket.node_path_ids,
)
snapshot["speed"] = None if terms is None else {
    "ruleId": str(terms.rule_id), "matchedOn": terms.matched_on, "matchedId": str(terms.matched_id),
    "rewardWithinHours": terms.reward_within_hours, "penaltyAfterHours": terms.penalty_after_hours,
    "rewardPaise": terms.reward_paise, "penaltyPaise": terms.penalty_paise,
}
```

Keys exactly as index §3.5. Because `build_accept_snapshot` is the one stamper, every path that writes it —
`jobs.service.accept`, `tickets.service.assign_technician`, and a re-accept after release — gets speed for free
(TA5's re-stamp covers S2 too).

`speed_of(snapshot) -> SpeedTerms | None` (index §3.7): `None` when the snapshot is NULL, `speed` is absent or
null, or any key is missing/ill-typed — never a `KeyError` (the `snapshot_value` rule).

### 4.4 The clock loader — `app/core/speed_settle.py`

```python
async def load_clock(db, *, company_id, ticket_id,
                     slot_start: datetime.datetime | None) -> SpeedClock | None:
    # `slot_start` is `ticket.slot_start` — the caller already holds the row (R1, W17).
    rows = await db.execute(
        select(TicketEvent.seq, TicketEvent.kind, TicketEvent.created_at,
               TicketEvent.from_status, TicketEvent.to_status)
        .where(
            TicketEvent.company_id == company_id,
            TicketEvent.ticket_id == ticket_id,
            or_(TicketEvent.kind.in_(("assigned", "completed")),
                TicketEvent.from_status == AWAITING_PART,
                TicketEvent.to_status == AWAITING_PART),
        )
        .order_by(TicketEvent.seq)
    )
    return clock_from_events([EventFact(*r) for r in rows], slot_start)
```

One read on `ix_ticket_events_company_ticket (company_id, ticket_id, seq)`, then the pure fold. **Owner ruling
2026-10-15 (R1):** the slot start is not read here — the closure and the ticket page both hold the `Ticket` row, and
its `slot_start` is the slot in force at completion (W17), so no extra query is added.

It mirrors `tickets/feedback_service.refresh_technician_stats`' two event rules — **latest `assigned`, ordered by
`seq` not `created_at`** (two events in one transaction share `now()`; `seq` is assigned at INSERT) — but as one
read plus a pure function rather than correlated subqueries, so the whole rule is unit-testable. The `at` is the
event's `created_at`, the transaction's start: the accept's and the completion's own moments.

### 4.5 Paying on customer closure — `tickets/feedback_service.record_feedback`

Inside `if confirmed and row.technician_id is not None:`, **after** the payout (and Task 10's travel) are added,
**before** `await db.commit()`:

```python
await settle_speed(db, row, now=now)
```

`speed_settle.settle_speed(db, ticket, *, now) -> SpeedSettlement | None`:

1. `terms = speed_of(ticket.accept_snapshot)`. None → return None (no rule, or a ticket accepted before Task
   10/11 — "nothing to pay"). Also return None, with a `logger.warning`, if the snapshot's `technicianId` is not
   `ticket.technician_id` (a stale stamp must never pay the wrong person).
2. `clock = await load_clock(db, company_id=…, ticket_id=…, slot_start=ticket.slot_start)`. None (no `completed`, or no
   `assigned` before it) → return None; nothing was measured, so nothing is said. (R1: the clock starts at the later
   of the accept and `ticket.slot_start`.)
3. `outcome, amount = speed_outcome(clock.working_hours, terms)`.
4. Load the technician's profile (company-scoped) and **lock it**: `await db.refresh(profile,
   with_for_update=True)` — the cancel path's lock, so a speed penalty and a cancellation against the same cap
   cannot interleave (W8).
5. Reward: if `amount > 0`, add `ledger_entry(kind="speed_reward", amount_paise=amount, reason=…)`. **No pool
   balance check** (W7).
6. Penalty: `already = charged_this_month(...)` (now counting both capped kinds, §4.7);
   `remaining = cap_remaining(cap_paise=(await load_rules(db, company_id)).cancel_penalty_cap_paise,
   already_charged=already)`; `charge = capped_charge(amount, remaining)`. If `charge > 0`, add
   `ledger_entry(kind="speed_penalty", amount_paise=charge, reason=…)`.
7. Every row: `company_id`, `technician_id = ticket.technician_id`, `ticket_id`, **`franchisee_id =
   profile.franchisee_id`** (the technician's franchisee at write time — index §3.2), `created_by = None` (no
   principal on this route, as the payout).
8. Add `record_event(ticket, "speed_settled", actor_kind="system", note=…)` — the event is written whenever a rule
   was measured, including "nothing" and "cap swallowed it".

All in the closure's transaction: a speed row that survived a rolled-back closure would pay for unconfirmed work.
The guarded UPDATE (`customer_confirmed_at IS NULL`) already makes the closure once-only; W9's unique is the
structural backstop.

**Force-close (S5):** `tickets.service.force_close_ticket` does **not** call `settle_speed`. Nothing to add there —
state it in a comment beside its payout so nobody "fixes" the asymmetry.

**Ledger `reason` strings** (≤ 160 chars; PROPOSED copy, server English):

| Case | `reason` |
|---|---|
| reward | `Speed reward · finished in 9.0 h (within 12 h)` |
| penalty | `Speed penalty · took 30.5 h (over 24 h)` |
| penalty, partly capped | `Speed penalty · took 30.5 h (over 24 h) · capped at the monthly limit` |

**`speed_settled` note** (PROPOSED; no rupee amounts, W12):

| Case | note |
|---|---|
| between | `Finished in 23.0 working hours (26.0 h since the clock started, 3.0 h waiting for parts) · between 12 h and 24 h — no speed reward or penalty` |
| reward paid | `Finished in 9.0 working hours · within 12 h — speed reward paid` |
| reward 0 | `Finished in 9.0 working hours · within 12 h — this rule pays no reward` |
| penalty charged | `Took 30.5 working hours · over 24 h — speed penalty charged` |
| penalty partly | `Took 30.5 working hours · over 24 h — speed penalty partly charged: monthly cap` |
| penalty none (cap) | `Took 30.5 working hours · over 24 h — speed penalty not charged: monthly cap already reached` |
| penalty 0 | `Took 30.5 working hours · over 24 h — this rule charges no penalty` |

The parenthesis with elapsed/waiting appears only when `part_wait_hours > 0`. When the slot started after the accept (the usual pool case, R1) every note is followed by ` · counted from the slot start, Thu 10:00` (IST label, `when_label`'s style) so a reader can tell a clock that began at the slot from one that began at the accept; when the accept was later, ` · counted from the accept`; no suffix when there was no slot. A completion before the slot start reads `Finished in 0.0 working hours · counted from the slot start …`. `_EVENT_TITLES["speed_settled"] =
"Speed allowance measured"`. In `tickets.service._timeline`, pass the principal and drop `speed_settled` for
`principal.is_vendor` (a vendor is not a party to a technician's incentives).

### 4.6 Reversal — `penalty_reversed` accepts `speed_penalty`

Task 05 moved the reversal body into `app/core/penalty_reversal.py` (`reverse`, with `REVERSIBLE_KINDS =
("penalty",)`) behind two doors — the ticket page (`POST /tickets/{id}/penalties/{entryId}/reverse`) and the
portal Pool screen (`POST /franchise/ledger/{entryId}/reverse`) — and decided who may reverse (F7/F8,
`core.franchise_money.may_reverse`). This task:

- Target lookup: `LedgerEntry.kind.in_(REVERSIBLE_KINDS)`. Nothing else changes — same full-amount rule, same
  `uq_ledger_entries_reverses` race guard, same 409 `PENALTY_ALREADY_REVERSED`, same profile lock, same
  `penalty_reversed` event, same push (`PushText("penalty.reversed", …)`, `data={"type": "job"}`). The
  reversal row's `franchisee_id` is the **reversed row's** `franchisee_id` (the money returns to the pool that
  took it).
- Event note: `₹150 speed penalty to Ravi reversed · <reason>` for a speed penalty (the existing wording for a
  cancellation penalty is unchanged). This event already carries amounts today; leave that as Task 05 has it.
- `tickets.service._penalties` (the ticket page's penalties list) selects `kind.in_(REVERSIBLE_KINDS)`, and
  `TicketPenaltyOut` gains `kind: str = "penalty"` so the console can label "Speed penalty" (Task 13).
- `features/ledger.service.list_entries`: `penalty_ids = {e.id for e in rows if e.kind in REVERSIBLE_KINDS}`, so
  `reversed` tags speed penalties too.
- `not_reversed()` needs no change — it is correlated on `reverses_id`, kind-agnostic.

### 4.7 The money readers — `app/core/ledger.py`

| Reader | Change |
|---|---|
| `charged_this_month` | `LedgerEntry.kind.in_(CAPPED_KINDS)` instead of `== "penalty"`. Rename the docstring to "penalties of either kind". Effect: a cancellation preview (`jobs.service._band_for`) and `record_no_show` now see speed penalties already charged this month (S6). |
| `credited` | `payout + bonus + speed_reward − penalty − speed_penalty` (plus whatever Task 10 added for `travel`). `shown_to_technician()` is unchanged: it already drops `reversal` rows and any reversed row, speed penalties included. |
| `pool` (per franchisee after Task 05) | One grouped query over `POOL_KINDS`, plus a reversal split by the **target's** kind (LEFT JOIN an alias on `reverses_id`, group by target kind). Then: `cancel_net = penalty − reversals_of_penalty`; `speed_pen_net = speed_penalty − reversals_of_speed_penalty`; `collected = cancel_net + speed_pen_net`; `paid = bonus + speed_reward`; `balancePaise = collected − paid` (F12). |
| `pool` output (`LedgerPoolOut`) | W11: `penaltiesCollectedPaise = collected`, `bonusesPaidPaise = paid`, `cancellations` = standing cancellation/no-show penalties (count of `penalty` − reversals of `penalty`), `pickups` unchanged. **Added:** `speedPenaltyPaise`, `speedPenalties` (standing count), `speedRewardPaise`, `speedRewards` (count). Additive fields; `collected − bonuses = balance` still holds. |

Why fold (W10/W11): the console's pool card and every installed APK's earnings card print a sum line that must
add up. Folding keeps it true on every client already deployed; the breakdown fields let Task 13/15 show the
split without anyone's arithmetic breaking in between.

### 4.8 Earnings — `features/earnings`

- `summary`: `bonuses = bonus + speed_reward`, `penalties = penalty + speed_penalty`; `net` formula unchanged
  (plus Task 10's travel as Task 10 decided). `EarningsSummaryOut` gains `speedRewardPaise: int = 0` and
  `speedPenaltyPaise: int = 0` — subsets of the two tiles, for Task 15.
- `_title`: `speed_reward → "Speed reward"`, `speed_penalty → "Speed penalty"` (exact strings — Task 07 §4.3.1
  already maps them in `mobileapp/src/i18n/serverLabels.ts` and signs the copy off). Put these two branches **before** the band-label fallthrough, or a speed penalty is titled "Late
  cancellation penalty".
- `transactions`: unchanged — it already lists every kind `shown_to_technician()` allows.
- Task 06's employee statement lists these rows like any other; confirm it reads kinds generically, not by name.

### 4.9 Console ledger — `features/ledger`

- `_entries_query` keeps `kind.in_(POOL_KINDS)`; the new kinds are now inside it.
- `?kind=` accepts `speed_reward` and `speed_penalty` (lower-cased, unknown → empty page, as today). Update the
  router docstring and `LedgerEntryOut.kind`'s comment.
- Client values for Task 13: `adminWeb/src/pages/ledger/LedgerPage.tsx` `KINDS`, `components/ledger/LedgerTable.tsx`
  `KIND_CHIP` / `KIND_LABEL` / `POOL_SIGN` (`speed_reward: -1`, `speed_penalty: +1`) and the filter options,
  `types/index.ts` `LedgerEntry["kind"]`. ⚠ `POOL_SIGN[unknown]` is `undefined` → `NaN` on screen; see §8.

### 4.10 Rules API

**Franchise portal** — `app/features/franchise_portal/` (prefix `/franchise`, Task 05's slice). Principal:
`FranchisePrincipal` + `require_feature("franchise.settings")` (franchisee_admin by default). The franchisee is
**`principal.franchisee_id`, never a path or body field** (the vendor-pinning rule, api AGENTS.md rule 7).

| Method & path | Body / query | Returns |
|---|---|---|
| `GET /franchise/settings/speed` | `?technicianType=` optional | `list[SpeedRuleOut]` |
| `PUT /franchise/settings/speed` | `SpeedRuleIn` (upsert on the natural key) | `SpeedRuleOut`, message "Speed rule saved" |
| `DELETE /franchise/settings/speed/{rule_id}` | — | `{deleted: true}`, message "Speed rule removed"; **404** for another franchisee's or company's id |
| `GET /franchise/settings/speed/effective` | `?technicianType=&modelId=` or `&nodeId=` | `SpeedEffectiveOut` |
| `GET /franchise/settings/speed/catalogue` | — | `SpeedCatalogueOut` — price-free (W16), below |

```python
class SpeedRuleIn(AppModel):
    technicianType: Literal["employee", "freelancer"]
    nodeId: uuid.UUID | None = None
    modelId: uuid.UUID | None = None
    rewardWithinHours: int = Field(ge=1, le=720)
    penaltyAfterHours: int = Field(ge=1, le=720)
    rewardPaise: int = Field(ge=0, le=1_000_000, multiple_of=100)
    penaltyPaise: int = Field(ge=0, le=1_000_000, multiple_of=100)
    # model_validator: exactly one target; penaltyAfterHours >= rewardWithinHours
```

```python
class SpeedCatalogueNodeOut(AppModel):
    id: uuid.UUID
    parentId: uuid.UUID | None
    name: str
    depth: int
    isLeaf: bool
    isActive: bool

class SpeedCatalogueModelOut(AppModel):        # approved, non-deleted models only
    id: uuid.UUID
    nodeId: uuid.UUID
    name: str
    brandName: str

class SpeedCatalogueOut(AppModel):             # (reconciled — Task 13 reads exactly these two keys)
    nodes: list[SpeedCatalogueNodeOut]         # this company's non-deleted nodes, any depth
    models: list[SpeedCatalogueModelOut]
```

No `*Paise` field and no technician count anywhere in it.

Paise on the wire, matching the snapshot and the ledger; the console converts (Task 13).

**Staff twin** — `app/features/franchisees/` (Task 03's slice, prefix `/franchisees`), the same four reads/writes
under `/franchisees/{franchisee_id}/speed-rules[...]` plus `/catalogue` is not needed (staff have `masters`).
`franchisee_id` is loaded company-scoped (404 across companies), then (W15):

| Caller | Home franchisee | Non-home franchisee |
|---|---|---|
| GET (list, effective) | `franchisees.view` | `franchisees.view` **and** rank ≥ National Head; otherwise **404** |
| PUT / DELETE | `settings.edit` + `require_min_rank(NATIONAL_HEAD)` | **403** "Only <name>'s own admins change its speed rules" (the caller can already see the franchisee, so 403 leaks nothing) |

Both routers call `app/core/speed_rules.py`; neither imports the other (hard rule 4). Register nothing new in
`app/api/router.py` — both slices are already included by Tasks 03/05.

### 4.11 Ticket detail — the `speed` block

`TicketDetailOut.speed: TicketSpeedOut | None = None`, built in `tickets.service.get_ticket` from
`speed_of(row.accept_snapshot)`, `load_clock`, and the ticket's speed ledger row (plus its reversal):

```python
class TicketSpeedOut(AppModel):
    matchedOn: Literal["model", "node"]
    matchedName: str                     # current name of the node/model, "—" if gone
    rewardWithinHours: int
    penaltyAfterHours: int
    rewardPaise: int
    penaltyPaise: int
    clockStartedAt: datetime.datetime | None   # R1: max(latest `assigned`, ticket.slot_start) — what the hours run from
    acceptedAt: datetime.datetime | None       # the latest `assigned` (the accept half)
    slotStart: datetime.datetime | None        # the slot in force (null = none); the other half
    completedAt: datetime.datetime | None      # null until the technician completes
    elapsedHours: float | None
    partWaitHours: float | None
    workingHours: float | None
    #: pending        — not completed yet, or completed and awaiting the customer
    #: reward/penalty/none — measured and the ticket is Closed
    #: force_closed   — S5: measured but never paid
    outcome: Literal["pending", "reward", "penalty", "none", "force_closed"]
    ledgerEntryId: uuid.UUID | None
    paidPaise: int | None                # what the ledger row says; null when no row
    capped: bool                         # penalty and paidPaise < penaltyPaise (incl. no row)
    reversed: bool
```

Null when no rule was frozen (or the ticket predates Tasks 10/11). Re-derived on read from append-only events and
the frozen terms, so it agrees with what was written by construction — no second copy is stored.

**Who sees it (owner ruling 2026-10-15, R8 — travel and speed behave identically):**
**company staff — Area Manager and above — on any ticket in their scope, a non-home franchisee's included**; the
franchisee admin of the ticket's own franchisee. **Not** a vendor; **not** facility staff (`FACILITY_ROLES`); not
another franchisee's admin (404 on the ticket itself). It used to be gated by Task 05's
`core.franchise_money.may_see_money(...)`, which hid it from an AM on a non-home ticket; **that gate is removed
for this block** — the speed outcome and amount are *ticket data* the staff who reschedule and force-close the
ticket may read, exactly as the frozen travel amount is (Task 10 W13). `may_see_money` keeps gating the *ledger*
(penalties list, pool, UPI), where F7's "cannot see SkyFix's money" still holds. What stays hidden from staff on a
non-home ticket is unchanged: the technician's base-location **coordinates** (Task 10 W13) and the franchisee's
**pool** (Task 05). Task 04 has no separate franchise ticket-detail builder; `get_ticket` serves both: the block
is built when `not principal.is_vendor and principal.role not in FACILITY_ROLES`, and a franchise caller's
franchisee equals the ticket's by Task 04's scoping.

### 4.12 `JobOut` — what the technician sees

`JobOut.speed: JobSpeedOut | None = None` (W13), set in `jobs.service._job_out` from `speed_of(t.accept_snapshot)`
when the snapshot's `technicianId` is this technician:

```python
class JobSpeedOut(AppModel):
    rewardWithinHours: int
    penaltyAfterHours: int
    rewardPaise: int
    penaltyPaise: int
    clockStartedAt: datetime.datetime    # R1: max(snapshot acceptedAt, the job's slot start) — display only;
                                         # computed from the row (both halves are on it), so no query
    clockFromSlot: bool                  # True when the slot start is the later half (the usual case) — lets
                                         # the app say "counted from the slot start" (Task 15)
```

No query (it is all on the row — `accept_snapshot.acceptedAt` and `slot_start`), so the list endpoints stay one read. `clockStartedAt` is live: a reschedule moves it with the slot, and the event-derived `SpeedClock` at closure is authoritative. Additive field: installed builds ignore it.
Not on `JobOfferOut`. The result after closure reaches the technician as the Earnings row.

### 4.13 Seed checks — `app/scripts/seed/verify.py`

- `_earnings_match_the_ledger`: `expected_net = payout + bonus + speed_reward − penalty − speed_penalty` (+ travel
  per Task 10), excluding reversed rows as the screen does.
- `_nobody_passed_the_monthly_cap`: `kind IN ('penalty','speed_penalty')` and not reversed.
- New `_speed_rows_are_honest`: every `speed_*` row's ticket is `Closed`, has `accept_snapshot->'speed'` not null,
  and at most one such row exists per ticket; no `speed_*` row on a `Force-Closed` ticket.

---

## 5. Client

None in this task. Console matrix screen, ledger labels and the ticket's speed panel: **Task 13**. Mobile job card
and earnings labels: **Task 15** (after Task 07 knows the kinds).

---

## 6. Unit tests — `api/tests/unit/test_speed.py`

Pure pytest, **no database** (X1). Helpers: `T = lambda s: datetime.fromisoformat(s).replace(tzinfo=IST)` and a
`terms(12, 24, 20000, 15000)` factory.

**`speed_outcome`**
1. 12.0 h → `("reward", 20000)`; 0.0 h → reward.
2. 12.0 h + 1 s (`12 + 1/3600`) → `(None, 0)`.
3. 24.0 h → `(None, 0)`; 24 h + 1 s → `("penalty", 15000)`.
4. Equal thresholds 12/12: 12.0 → reward; 12 h + 1 s → penalty (no neutral band).
5. Zero amounts: reward 0 at 5 h → `("reward", 0)`; penalty 0 at 30 h → `("penalty", 0)`; both 0 → outcome
   named, amount 0.

**`working_hours`**
6. The worked example: Mon 11:00 → Tue 13:00 with `[(Mon 15:00, Mon 18:00)]` → **23.0**; with none → 26.0.
7. Overlapping `[(13:00,16:00),(15:00,18:00)]` inside 11:00→23:00 → 12 − 5 = 7.0.
8. The same intervals **unsorted** → same answer.
9. Nested `[(13:00,18:00),(14:00,15:00)]` → subtracts 5.
10. Open-ended `[(Tue 10:00, None)]` with completed Tue 13:00 → subtracts 3.
11. Entirely before `assigned_at`, entirely after `completed_at` → subtracts 0.
12. Straddling either edge → clipped (e.g. `(Mon 09:00, Mon 12:00)` subtracts 1).
13. An interval covering the whole window → 0.0; zero-length interval → subtracts 0.
14. `completed_at < assigned_at` → 0.0.
15. Naive datetime → `ValueError`.
16. Exactness: assigned 00:00:00, completed 12:00:00 → `== 12.0` (not ≈).

**`clock_from_events`**
17. `assigned(1) … completed(5)` → that pair.
18. Reassign resets: `assigned(1), released(2), assigned(3), completed(6)` → starts at seq 3.
19. Reschedule does not reset: `assigned(1), rescheduled(2), completed(4)` → starts at 1.
20. Re-completion: `assigned(1), completed(3), reopened(4), assigned(5), completed(8)` → 5 → 8.
21. No `completed` → None; `completed` with no earlier `assigned` → None (force-close-like / legacy).
22. Awaiting Part via `status_changed` rows: `to_status="Awaiting Part"` at seq 3, `from_status="Awaiting Part"` at
    seq 4 → one interval.
23. Same via `kind="part_requested"` with `to_status="Awaiting Part"` → same interval (W6).
24. Two waits → two intervals; an exit with no open entry → ignored; an entry with no exit → open-ended.
25. Awaiting Part before the latest `assigned` (previous holder) → not subtracted.
26. No Awaiting Part events at all (before Task 12) → `part_wait_hours == 0.0`.

**Owner ruling 2026-10-15 (R1) — the clock start** (`clock_start`, `working_hours`, `clock_from_events(events, slot_start)`)
36. **Slot after accept:** accepted Mon 11:00, slot start Thu 10:00, completed Thu 13:00, no waits → `clock_start` =
    Thu 10:00 and `working_hours == 3.0` (the owner's example).
37. **Slot before accept:** slot start Mon 09:00, accepted Mon 11:00, completed Mon 15:00 → clock start Mon 11:00,
    4.0 h.
38. **No slot:** `slot_start=None` → clock start = accepted, `working_hours` equals today's figure (case 6's 26.0 / 23.0).
39. **Slot equal to accept** → that instant; no difference either way.
40. **Reschedule moves the slot:** events `assigned(1), rescheduled(2), completed(5)` with the ticket's `slot_start`
    now Fri 10:00 (it was Thu) → the clock starts Fri 10:00 — the slot in force at completion, not the first one.
41. **Slot later than completion → 0 h clamp:** accepted Mon 11:00, slot Thu 10:00, completed Wed 09:00 →
    `working_hours == 0.0` (never negative) and `speed_outcome(0.0, terms)` is a reward (0 ≤ `reward_within_hours`).
42. **Wait intervals before the clock start are ignored:** accepted Mon 11:00, slot Thu 10:00, a wait Mon 15:00 →
    Mon 18:00 (before the slot), completed Thu 13:00 → 3.0 (nothing subtracted); a wait Thu 11:00 → 12:00 → 2.0;
    a wait straddling the start (Wed 20:00 → Thu 11:00) subtracts only the hour after Thu 10:00.
43. **Re-assignment after a customer refusal with an old slot:** `assigned(1), completed(3), assigned(5), completed(8)`,
    slot start before event 5's time → starts at event 5's accept; slot after it → starts at the slot.
44. `clock_start` with a naive datetime → `ValueError`; `clock_from_events` with `slot_start` given and no
    `completed` → `None`.

**`resolve_speed_rule`**
27. Model row + root node row + leaf node row → model wins.
28. Root and leaf node rows only → leaf (latest in `node_path_ids`) wins.
29. A node row whose node is not on the path (should not be passed, but if it is) → ignored.
30. A model row for another model → ignored; nothing left → None.

**`capped_charge` / `cap_remaining`**
31. `cap_remaining(cap_paise=0, …)` → None → `capped_charge(15000, None) == 15000`.
32. Cap 500000, already 490000 → remaining 10000 → charge 10000 (partial).
33. Already ≥ cap → remaining 0 → charge 0 (no row).
34. Remaining ≥ amount → full amount.

**`speed_of`** (`app/core/accept_snapshot.py`, pure)
35. `None`, `{}`, `{"speed": None}`, a speed dict missing `penaltyPaise` → all `None`; a full dict → `SpeedTerms`.

Run: `pytest api/tests/unit` green before the commit (index §5.9).

---

## 7. Acceptance criteria

Against **RelianceDB** (dev). Use a company with a home franchisee `H` and a non-home franchisee `S` (SkyFix),
freelancer Ravi in `S`, a washing-machine leaf node `WM` with an approved model `M`. Backdating is done by
updating `ticket_events.created_at` on the test ticket only, before the customer confirms.

1. **Migration round trip.** Given the dev DB at `9e1b5d3c7a26` with two speed rules seeded after `upgrade head`,
   when `python -m alembic downgrade 9e1b5d3c7a26` then `upgrade head`, then all three commands exit 0, and
   `SELECT conname FROM pg_constraint WHERE conrelid='ledger_entries'::regclass AND contype='c'` shows one `kind`
   CHECK containing `'speed_penalty'`. Given any `speed_reward` row exists, when downgrading, then it raises and
   names the count.
2. **Constraints.** Each of these fails with a constraint error:
   `INSERT INTO franchisee_speed_rules (company_id, franchisee_id, technician_type, node_id, model_id, …)` with
   both ids / with neither / with `penalty_after_hours = 11, reward_within_hours = 12` / with hours `0` or `721` /
   with `reward_paise = 12345` / a second row for the same `(S, freelancer, WM)` / a `node_id` from another
   company (composite FK).
3. **Indexes.** The api AGENTS.md "FK not covered" query returns no `franchisee_speed_rules` row.
4. **Tenancy.** `python -m app.scripts.audit_tenancy` exits 0 and lists the three new links;
   `python -m app.scripts.cleanup_db --check` passes.
5. **Resolution & stamping.** Given rules `(S, freelancer, Electronics)` 48/72 and `(S, freelancer, WM)` 12/24,
   when Ravi accepts a ticket for `M`, then
   `SELECT accept_snapshot->'speed' FROM tickets WHERE id = :t` has `"matchedOn": "node"`, `"rewardWithinHours":
   12`. Given a `(S, freelancer, model M)` row 6/48 also exists, a new accept stamps `"matchedOn": "model"`. Given
   the row is for `employee` only, Ravi's accept stamps `"speed": null`.
6. **Frozen.** Given the stamp above, when the WM rule is changed to 10/20, then the ticket's snapshot still reads
   12/24 and its closure is judged on 12/24.
7. **Worked example — nothing.** Given assigned Mon 10:30 with `tickets.slot_start` Mon 11:00 (so the clock starts at 11:00, R1), `Awaiting Part` Mon 15:00→18:00 (inserted as two
   `status_changed` events, or real Task 12 events), completed Tue 13:00, when the customer confirms via `POST
   /feedback/{token}`, then `SELECT kind FROM ledger_entries WHERE ticket_id = :t` returns `payout` (and Task 10's
   `travel` if configured) and **no** `speed_%` row, and the latest `ticket_events` row of kind `speed_settled`
   has a note starting `Finished in 23.0 working hours`.
8. **Reward.** Given completion 9 h after acceptance, then one row `kind = 'speed_reward', amount_paise = 20000,
   franchisee_id = <S>` exists, and S's pool (Task 05's per-franchisee pool read) shows `balancePaise`
   lower by 20000 even when it goes negative.
9. **Boundaries.** Exactly 12 h 00 m 00 s working → reward; exactly 24 h 00 m 00 s → no row.
10. **Penalty and cap.** Given the cap is ₹5,000 and Ravi has ₹4,900 of cancellation penalties this IST month,
    when a 30 h job closes, then `amount_paise = 10000` with reason ending `capped at the monthly limit`. Given he
    has ₹5,000 already, then no `speed_penalty` row and the event note ends `monthly cap already reached`.
11. **Cap is shared.** Given a ₹150 speed penalty this month and a ₹5,000 cap with ₹4,800 of other penalties, when
    Ravi opens `GET /jobs/{id}/cancellation` on a job whose band is ₹300, then `amountPaise = 5000` (₹50 left).
12. **Force-close.** Given a 30 h job force-closed by a manager, then no `speed_%` row and no `speed_settled`
    event; the ticket's `speed.outcome = "force_closed"`.
13. **Old tickets.** Given a ticket accepted before Task 10 (`accept_snapshot IS NULL`), when it closes, then no
    speed row, no event, no error.
14. **Reversal.** Given a `speed_penalty` row `P`, when the authorised reverser (per Task 05) calls the reversal
    endpoint with `entryId = P`, then a `reversal` row with `reverses_id = P` and `franchisee_id = P.franchisee_id`
    exists; a second call → 409 `PENALTY_ALREADY_REVERSED`; `charged_this_month` no longer counts it; Ravi's
    `GET /earnings/summary` no longer subtracts it; the pool's `speedPenaltyPaise` drops by its amount.
15. **Pool arithmetic.** For S:
    ```sql
    SELECT SUM(CASE WHEN kind IN ('penalty','speed_penalty') THEN amount_paise
                    WHEN kind IN ('bonus','speed_reward','reversal') THEN -amount_paise END)
    FROM ledger_entries WHERE company_id = :c AND franchisee_id = :s
      AND kind IN ('penalty','bonus','reversal','speed_reward','speed_penalty');
    ```
    equals the pool's `balancePaise`, and `penaltiesCollectedPaise − bonusesPaidPaise = balancePaise`.
16. **Earnings.** Given one payout ₹500, one speed reward ₹200, one speed penalty ₹150 in the window, then
    `bonusesPaise` includes 20000, `penaltiesPaise` includes 15000, `speedRewardPaise = 20000`,
    `speedPenaltyPaise = 15000`,
    `netPaise = earned + bonuses − penalties`; transactions titled "Speed reward" / "Speed penalty". `POST
    /redemptions` offers `credited` including both.
17. **Ledger list.** `GET /ledger?kind=speed_reward` (staff, home) and the franchise pool list return only that
    kind; a `speed_penalty` that was reversed carries `reversed: true`.
18. **Rules API — franchise.** As S's franchisee admin: `PUT /franchise/settings/speed` creates; repeating it
    updates the same `id`; `GET` lists it with `targetPath`, `overridesName = "Electronics"`; `GET …/effective?
    technicianType=freelancer&modelId=M` returns the WM row. A rule id belonging to H → **404** on DELETE; a
    `nodeId` from another company → **404**; a pending model → **422**; `penaltyAfterHours < rewardWithinHours` →
    **422**; a facility operator → **403** (no `franchise.settings`); a franchise admin of another franchisee
    cannot see S's rows (its list is its own; S's ids → 404). `…/catalogue` contains no `Paise` field.
19. **Rules API — staff.** National Head: `PUT /franchisees/{H}/speed-rules` → 200; `PUT /franchisees/{S}/speed-
    rules` → 403; `GET /franchisees/{S}/speed-rules` → 200. Area Manager: `GET /franchisees/{S}/speed-rules` →
    **404**; `PUT` on H → 403 (rank floor). Another company's franchisee id → **404**.
20. **Ticket detail.** `GET /tickets/{id}` as NH shows `speed` with `workingHours: 23.0, outcome: "none"`; as a
    vendor and as a facility operator `speed` is null and no `speed_settled` appears in the vendor's `timeline`;
    as an AM on S's ticket `speed` is **present** (owner ruling 2026-10-15, R8 — the same as the travel block); as S's franchisee admin (Task 04's read-only detail) it is present; as a facility admin it is null.
21. **JobOut.** After accept, `GET /jobs/{id}` as Ravi has `speed.rewardWithinHours = 12`; `GET /jobs/pool/{id}`
    (offer) has no `speed` field.
22a. **Slot-based clock (owner ruling 2026-10-15, R1).** Given a ticket accepted (`assigned` event backdated) Mon 11:00
    whose `slot_start` is Thu 10:00, completed Thu 13:00, when the customer confirms, then the `speed_settled`
    note starts `Finished in 3.0 working hours` and ends `counted from the slot start, Thu 10:00`; with a rule
    12/24 a `speed_reward` row exists. Given the same ticket rescheduled to Fri 10:00 before completion (and
    completed Fri 13:00), then the note says 3.0 h from Fri 10:00. Given `slot_start` Fri 10:00 but completion
    Thu 09:00 (backdated), then 0.0 working hours and a reward. Given a ticket with no slot, then the clock is the
    accept (as the unchanged worked example).
22. **Before Task 12.** With no `Awaiting Part` events anywhere, `partWaitHours = 0.0` on every speed block.
23. **Seed verify.** `python -m app.scripts.seed.verify` (or the project's verify entry) reports no problems on a
    freshly seeded dev DB.
24. **Unit tests.** `pytest api/tests/unit` green; `test_speed.py` holds every case in §6.
25. **X4 gate.** Given the production track on Play is **not yet** the Task 07 build, then this API is **not**
    published to production, and `SELECT count(*) FROM franchisee_speed_rules` on `RelianceProdDB` is 0. Only once
    Task 07 is live (installed builds tolerate `speed_reward`/`speed_penalty`) is the API published — and the owner
    has run `b4a8e2f6c903` on `RelianceProdDB` first (X5, release gate b).

---

## 8. Out of scope, traps and index notes

**Out of scope:** console screens (Task 13) and mobile display (Task 15); notifications or pushes for a speed
result (the closure push already refreshes Earnings); speed on force-close (S5 — **settled by the owner 2026-10-15, R7**: none, see index §6c); a speed rule on the pool offer; any franchisee↔company settlement (F11).

**Traps**

- **Settled 2026-10-15 (R1): the clock starts at the LATER of the accept and the slot start.** The earlier
  concern — a job accepted Monday for a Thursday slot drawing the penalty whatever the technician does — is
  gone: the pool offers `New` jobs whose slot is days away and `Slot Pending` jobs with no slot, and neither
  burns the technician's clock now. Two things to remember: the slot is read from `tickets.slot_start`
  (W17), so **any future path that edits the slot of a completed ticket would silently move a measurement**
  (none exists: both reschedule doors refuse `Awaiting Customer` onward); and a slot that begins *after*
  completion is a 0 h clamp — a reward, by S4, not an error.
- **Time waiting for a revisit counts.** P3 returns the job to `In Progress` as soon as every part request is
  settled; the gap until the technician comes back (often next day, via reschedule) is not `Awaiting Part`.
- **`ledger_entries.kind` is matched by name in more places than §4.7 lists.** Grep `"penalty"`, `"bonus"`,
  `POOL_KINDS` and `totals.get(` across `api/app` before declaring done: `core/ledger.py`,
  `features/earnings/service.py`, `features/ledger/service.py`, `features/tickets/service.py` (`_penalties`,
  `reverse_penalty`), `scripts/seed/verify.py`, and Task 05/06's per-franchisee pool and statement code.
- **Console `POOL_SIGN[kind]` is `undefined` for an unknown kind → `NaN`** on the Penalty & Bonus screen. Ship the
  ledger-label part of Task 13 (or a minimal patch to `LedgerTable.tsx`) **no later than** this API. The timeline
  is safe (`EVENT[e.kind] ?? EVENT.created`).
- **Lock order.** `settle_speed` locks the technician profile inside the customer's closure transaction, after
  the guarded UPDATE on `tickets`. The cancel path locks the profile and then updates `tickets`. They touch
  different tickets (a closed ticket cannot be cancelled), so no deadlock cycle — but do not add a second ticket
  write after the profile lock here.
- **`refresh_technician_stats` commits on its own** after the closure commit; `settle_speed` must be before the
  closure's `await db.commit()`, never after.
- **Task 12's migration** (`d6c3a9f1e874`) widens `ticket_events.kind` again: its "before" list must include
  `'speed_settled'`. If Task 12 lands first, this migration's `_EVENTS` must include Task 12's `part_*` kinds.
- **Do not read `accept_snapshot["speed"][…]`** anywhere — always `speed_of()`.
- **The monthly cap is the company's** (`company_rules.cancel_penalty_cap_paise`, company-only key) even though the
  matrix is the franchisee's. That is S6 as written.

**Index inconsistencies / additions for the index owner**

1. **§3.3 lists no ticket-event kind for Task 11**; this task adds `speed_settled` (W12). Add it to §3.3.
2. **§3.7 names only the pure `app/core/speed.py`**; the matrix CRUD/resolution query and the DB clock loader need
   homes outside it — `app/core/speed_rules.py` and `app/core/speed_settle.py` (W14) — and `speed.py` gains
   `clock_from_events`, `resolve_speed_rule`, `SpeedTerms`, `EventFact`, `SpeedClock`; `core/ledger.py` gains
   `capped_charge`; `models/ledger.py` gains `REVERSIBLE_KINDS`, `CAPPED_KINDS`, `SPEED_KINDS`.
3. **Which event records the `Awaiting Part` move is unspecified** (this task's brief says `status_changed`; §3.3
   gives Task 12 `part_requested`…). W6 reads the status columns so either works; Task 12 must set
   `from_status`/`to_status` on whichever event moves the status.
4. **§3.1's partial uniques omit `company_id`**; they are written here with it as the leading column (tenancy
   convention), which is equivalent since `franchisee_id` is company-unique.
5. **F12's balance formula** is implemented with speed figures folded into the existing pool fields (W11) plus
   breakdown fields; Task 09/13's pool card should print the breakdown, not a second balance.
6. **§3.4 has no speed-specific feature key for staff**; W15 reuses `franchisees.view` / `settings.edit` — align
   with whatever Task 10 chose for the home travel rules.

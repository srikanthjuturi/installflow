# Task 01 — Franchisee schema, home franchisee and the backfill

> Read [00-index.md](00-index.md) first; it wins over this document on any name. Then root `AGENTS.md`
> (hard rule 0) and `api/AGENTS.md` hard rules 1, 6, 8 and "Database cleanup". This task is **API only**
> and **changes nothing anybody can see**: it adds two tables and seven columns, gives every company its
> home franchisee, and stamps every existing row with it. Depends on Task 00 (migration `f9c2d8a3e17b`
> must be in the repo — this migration chains after it).

---

## 1. Goal and why

**Plain version.** Later tasks route tickets, technicians and money to a *franchisee*. Before any of that
can work, every row that a franchisee will own has to *say* which franchisee owns it — and on the day this
ships there is only one possible answer per company: its **home franchisee**, the internal franchisee that
is the company itself running technicians directly. So this task:

1. creates the `franchisees` and `franchisee_pincodes` tables;
2. creates one home franchisee for every company that exists (and, from now on, for every company the
   superadmin creates);
3. adds `franchisee_id` to technicians, invites, tickets, ledger entries and redemptions, fills it with the
   home franchisee, then makes it NOT NULL;
4. adds `technician_type` (every existing technician becomes a `freelancer`);
5. adds a nullable `memberships.franchisee_id` for the franchise logins Task 02 introduces;
6. teaches every code path that INSERTs one of those rows to fill the new column, so nothing fails the new
   NOT NULL.

**Worked example.** Before: *Acme Appliances Pvt Ltd* has 12 technicians, 340 tickets, 95 ledger rows and
2 redemptions. After `alembic upgrade head`:

| Table | Row | `franchisee_id` |
|---|---|---|
| `franchisees` | `Acme Appliances Pvt Ltd`, code `HOME`, `internal`, `is_home = true` | — |
| `technician_profiles` | all 12 | Acme's home · `technician_type = 'freelancer'` |
| `tickets` | all 340 | Acme's home |
| `ledger_entries` | all 95 | Acme's home |
| `redemptions` | both | Acme's home |
| `memberships` | all | `NULL` |
| `franchisee_pincodes` | none | — (the home owns "everything nobody else owns", F4) |

A ticket raised for Acme five minutes later is stamped by `franchisee_for_pincode` — which, with no
`franchisee_pincodes` rows yet, answers *home*. A payout written when that ticket closes copies the
technician's franchisee. Every screen, every number, every push reads exactly as it did yesterday.

---

## 2. Decisions implemented

- **F1** — two kinds, exactly one home per company, internal, permanent (`ck_franchisees_home_is_internal`,
  `ck_franchisees_home_is_permanent`, `uq_franchisees_one_home`).
- **F2 / F3** — the shape of `franchisee_pincodes` and its no-overlap UNIQUE (`uq_franchisee_pincodes_company_pincode`).
  The range parser and the 409 are Task 03.
- **F4** — the home stores no `franchisee_pincodes` rows; `franchisee_for_pincode` falls back to it.
- **F5** — the migration and backfill, all technicians `freelancer`, nothing visible changes.
- **F11 / F12** — every technician rupee (`ledger_entries`, `redemptions`) carries `franchisee_id`.
- **T1** — `technician_type` column, default `freelancer`.
- **§3.2 / §6** — `ledger_entries.franchisee_id` and `redemptions.franchisee_id` = the **technician's**
  franchisee at write time. One refinement, see §4.6: a `reversal` copies the franchisee of the penalty it
  reverses.
- **X1, X5** — pure unit tests only; tenancy, covering indexes, partial uniques, hand-written migration,
  round trip on dev, prod migrated by the owner.

---

## 3. Schema

### 3.1 New model module `api/app/models/franchisee.py`

```python
"""Franchisees — who runs a company's technicians, and the pincodes each one owns.

Every company has ONE home franchisee (internal, created with the company, never deleted or made
external) and any number of others. The home owns every pincode no other franchisee owns, which is why it
holds no `franchisee_pincodes` rows: "everything else" is not a list anybody should have to keep in step
with a 19,496-row master. See 00-index.md F1–F4.
"""

import uuid

from sqlalchemy import (Boolean, CheckConstraint, ForeignKey, ForeignKeyConstraint, Index, String,
                        UniqueConstraint, Uuid, text)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin, SoftDeleteMixin

KIND_INTERNAL = "internal"
KIND_EXTERNAL = "external"
KINDS = (KIND_INTERNAL, KIND_EXTERNAL)

#: The home franchisee's code. One per company, so unique per company by construction, and it reserves
#: the string: Task 03 can never mint HOME for another franchisee (uq_franchisees_company_code says so).
HOME_CODE = "HOME"

MAX_NAME = 255  # companies.name is 255, so the home's copy of it never truncates
MAX_CODE = 8


class Franchisee(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "franchisees"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(MAX_NAME), nullable=False)
    #: Stamped once, never recomputed — the `companies.code` rule (core/company_code.py).
    code: Mapped[str] = mapped_column(String(MAX_CODE), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    is_home: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)   # E.164 (core/phone.py)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))

    __table_args__ = (
        CheckConstraint("kind IN ('internal', 'external')", name="kind"),
        CheckConstraint("code ~ '^[A-Z0-9]{2,8}$'", name="code"),
        # F1: the home is internal …
        CheckConstraint("NOT is_home OR kind = 'internal'", name="home_is_internal"),
        # … and can be neither switched off nor removed. The backstop for FRANCHISEE_HOME_IMMUTABLE.
        CheckConstraint("NOT is_home OR (is_active AND deleted_at IS NULL)", name="home_is_permanent"),
        # FK target for every composite (company_id, franchisee_id). TOTAL — a partial index cannot be one.
        UniqueConstraint("company_id", "id", name="uq_franchisees_company_id_id"),
        Index("uq_franchisees_one_home", "company_id", unique=True,
              postgresql_where=text("is_home AND deleted_at IS NULL")),
        # Partial: a removed franchisee frees its code (api/AGENTS.md hard rule 6).
        Index("uq_franchisees_company_code", "company_id", "code", unique=True,
              postgresql_where=text("deleted_at IS NULL")),
        # NB uq_franchisees_company_name_lower ON (company_id, lower(name)) WHERE deleted_at IS NULL is
        # hand-written in 3b7e1f0a9c41 — Index() cannot say lower() with a WHERE, and autogenerate will keep
        # offering to drop it. Delete that drop.
    )


class FranchiseePincode(Base, IdMixin, AuditMixin):
    """One pincode a NON-home franchisee owns. Never holds rows for the home (F4).

    No SoftDeleteMixin: removing a code from a franchisee hands it back to the home, and the honest
    record of that is the row going away (Task 03 writes the event). The UNIQUE is therefore TOTAL.
    Invariant Task 03 must keep: a soft-deleted franchisee holds NO rows here (deleted in the same
    transaction), so nothing reading this table has to join `franchisees.deleted_at`.
    """

    __tablename__ = "franchisee_pincodes"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)  # COMPOSITE FK below
    #: RESTRICT: a pincode is switched off, never deleted (api/AGENTS.md, Geography).
    pincode: Mapped[str] = mapped_column(
        String(6), ForeignKey("pincodes.code", ondelete="RESTRICT"), nullable=False
    )

    __table_args__ = (
        # F3, no overlap: one owner per pincode per company. Spelled in full — `uq` takes the name verbatim.
        UniqueConstraint("company_id", "pincode", name="uq_franchisee_pincodes_company_pincode"),
        ForeignKeyConstraint(
            ["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
            name="fk_franchisee_pincodes_company_franchisee", ondelete="CASCADE",
        ),
        # Covers the composite FK, and is "the codes this franchisee owns".
        Index("ix_franchisee_pincodes_company_franchisee", "company_id", "franchisee_id"),
        # Covers the pincodes FK (the UNIQUE above leads with company_id, so it does not).
        Index("ix_franchisee_pincodes_pincode", "pincode"),
    )
```

Register both in `api/app/models/__init__.py` (import + `__all__`).

### 3.2 Changes to existing models

All new columns sit before the audit columns in the model (the mixins sort last automatically). In the
database `add_column` appends them at the physical end — Postgres has no reorder; that is accepted for
every incremental migration (api/AGENTS.md hard rule 6).

**`api/app/models/membership.py` — `Membership`**

```python
#: The franchisee this membership acts for — set for the three franchise roles (Task 02), NULL for
#: everyone else. COMPOSITE FK, so a login can never name another company's franchisee.
franchisee_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
# __table_args__ additions:
ForeignKeyConstraint(["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
                     name="fk_memberships_company_franchisee", ondelete="RESTRICT"),
Index("ix_memberships_company_franchisee", "company_id", "franchisee_id"),
```
RESTRICT for the reason `fk_memberships_company_vendor` gives: removing a franchisee must not silently
delete the accounts that acted for it. No CHECK ties it to the role — `role` lives on `users`, not here;
Task 02/03 enforce it in the service.

**`api/app/models/technician.py`**

```python
# module constants (index §3.7)
TYPE_EMPLOYEE = "employee"
TYPE_FREELANCER = "freelancer"
TECHNICIAN_TYPES = (TYPE_EMPLOYEE, TYPE_FREELANCER)
```

`TechnicianInvite` — copied to the profile at registration:
```python
franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
technician_type: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'freelancer'"))
# __table_args__:
CheckConstraint("technician_type IN ('employee', 'freelancer')", name="technician_type"),
ForeignKeyConstraint(["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
                     name="fk_technician_invites_company_franchisee", ondelete="RESTRICT"),
Index("ix_technician_invites_company_franchisee", "company_id", "franchisee_id"),
```
*Decision (writer):* `technician_invites.franchisee_id` is **NOT NULL** (the index does not say). It is
copied into a NOT NULL profile column at registration, so a null here would surface as a failed
self-registration — the worst moment to discover it.

`TechnicianProfile`:
```python
franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
technician_type: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'freelancer'"))
# __table_args__:
CheckConstraint("technician_type IN ('employee', 'freelancer')", name="technician_type"),
ForeignKeyConstraint(["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
                     name="fk_technician_profiles_company_franchisee", ondelete="RESTRICT"),
Index("ix_technician_profiles_company_franchisee", "company_id", "franchisee_id"),
```

**`api/app/models/ticket.py` — `Ticket`**
```python
#: Who runs the technicians for this job — stamped at intake from the pincode (core.franchise), moved
#: only by a carve-out while the ticket is unassigned (F6, Task 03). Assigned work keeps it.
franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
# __table_args__:
ForeignKeyConstraint(["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
                     name="fk_tickets_company_franchisee", ondelete="RESTRICT"),
Index("ix_tickets_company_franchisee", "company_id", "franchisee_id"),
```

**`api/app/models/ledger.py` — `LedgerEntry`**
```python
#: Whose pool / whose money (F11, F12). The technician's franchisee at write time; a reversal copies the
#: penalty's. Never updated — a technician moving franchisee later does not move money already written.
franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
# __table_args__:
ForeignKeyConstraint(["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
                     name="fk_ledger_entries_company_franchisee", ondelete="RESTRICT"),
# Covering index for that FK AND the per-franchisee pool / ledger list (F12), newest first.
Index("ix_ledger_entries_company_franchisee", "company_id", "franchisee_id", "created_at"),
```

**`api/app/models/redemption.py` — `Redemption`**
```python
#: The technician's franchisee when they asked — who pays (Task 05). Frozen like the amount.
franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
# __table_args__:
ForeignKeyConstraint(["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
                     name="fk_redemptions_company_franchisee", ondelete="RESTRICT"),
Index("ix_redemptions_company_franchisee", "company_id", "franchisee_id", "created_at"),
```

RESTRICT everywhere except `franchisee_pincodes` (CASCADE with its franchisee): franchisees are
soft-deleted, so these only ever fire on a hard delete — i.e. `cleanup_db`, which deletes children first.

### 3.3 Migration `api/alembic/versions/3b7e1f0a9c41_every_company_has_franchisees.py`

- `revision = "3b7e1f0a9c41"`, `down_revision = "f9c2d8a3e17b"` (index §3.6). **Before writing it:** confirm
  `f9c2d8a3e17b_*.py` exists in `api/alembic/versions/` and `python -m alembic heads` prints exactly one
  head. If Task 00 has not landed, stop — do not chain onto `ea2fb2654b95`. If another task has landed in
  between, re-point `down_revision` to the current head and say so in the commit (index §3.6).
- Prose docstring saying WHY (house style — see `a4d8e61f2c07_a_vendor_has_brands.py`), including: the
  home-franchisee naming/code decisions (§3.4), that `updated_at` is deliberately not touched by the
  backfill, the downgrade refusal, and the "migrate prod then publish promptly" note (§8).

```python
import sqlalchemy as sa
from alembic import op

revision = "3b7e1f0a9c41"
down_revision = "f9c2d8a3e17b"
branch_labels = None
depends_on = None

#: Stamped with the company's home and NOT NULL afterwards.
_STAMPED = ("technician_profiles", "technician_invites", "tickets", "ledger_entries", "redemptions")

#: table -> (covering index name, columns). One composite FK each, named fk_<table>_company_franchisee.
_LINKS = {
    "memberships": ("ix_memberships_company_franchisee", ["company_id", "franchisee_id"]),
    "technician_profiles": ("ix_technician_profiles_company_franchisee", ["company_id", "franchisee_id"]),
    "technician_invites": ("ix_technician_invites_company_franchisee", ["company_id", "franchisee_id"]),
    "tickets": ("ix_tickets_company_franchisee", ["company_id", "franchisee_id"]),
    "ledger_entries": ("ix_ledger_entries_company_franchisee", ["company_id", "franchisee_id", "created_at"]),
    "redemptions": ("ix_redemptions_company_franchisee", ["company_id", "franchisee_id", "created_at"]),
}
_TYPED = ("technician_profiles", "technician_invites")


def _audit_columns(*, soft_delete: bool) -> list[sa.Column]:
    cols = [
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
    ]
    if soft_delete:
        cols.append(sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    return cols


def upgrade() -> None:
    # ── 1. franchisees ────────────────────────────────────────────────────────
    op.create_table(
        "franchisees",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(8), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("is_home", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("contact_name", sa.String(255), nullable=True),
        sa.Column("contact_phone", sa.String(20), nullable=True),
        sa.Column("contact_email", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        *_audit_columns(soft_delete=True),
        sa.CheckConstraint("kind IN ('internal', 'external')", name=op.f("ck_franchisees_kind")),
        sa.CheckConstraint("code ~ '^[A-Z0-9]{2,8}$'", name=op.f("ck_franchisees_code")),
        sa.CheckConstraint("NOT is_home OR kind = 'internal'", name=op.f("ck_franchisees_home_is_internal")),
        sa.CheckConstraint("NOT is_home OR (is_active AND deleted_at IS NULL)",
                           name=op.f("ck_franchisees_home_is_permanent")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"],
                                name=op.f("fk_franchisees_company_id_companies"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_franchisees")),
        # Its company_id prefix also covers the companies FK.
        sa.UniqueConstraint("company_id", "id", name="uq_franchisees_company_id_id"),
    )
    op.create_index("uq_franchisees_one_home", "franchisees", ["company_id"], unique=True,
                    postgresql_where=sa.text("is_home AND deleted_at IS NULL"))
    op.create_index("uq_franchisees_company_code", "franchisees", ["company_id", "code"], unique=True,
                    postgresql_where=sa.text("deleted_at IS NULL"))
    op.execute("CREATE UNIQUE INDEX uq_franchisees_company_name_lower "
               "ON franchisees (company_id, lower(name)) WHERE deleted_at IS NULL")

    # ── 2. franchisee_pincodes ────────────────────────────────────────────────
    op.create_table(
        "franchisee_pincodes",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("franchisee_id", sa.Uuid(), nullable=False),
        sa.Column("pincode", sa.String(6), nullable=False),
        *_audit_columns(soft_delete=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"],
                                name=op.f("fk_franchisee_pincodes_company_id_companies"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
                                name="fk_franchisee_pincodes_company_franchisee", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["pincode"], ["pincodes.code"],
                                name=op.f("fk_franchisee_pincodes_pincode_pincodes"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_franchisee_pincodes")),
        sa.UniqueConstraint("company_id", "pincode", name="uq_franchisee_pincodes_company_pincode"),
    )
    op.create_index("ix_franchisee_pincodes_company_franchisee", "franchisee_pincodes",
                    ["company_id", "franchisee_id"])
    op.create_index("ix_franchisee_pincodes_pincode", "franchisee_pincodes", ["pincode"])

    # ── 3. one home per company — EVERY company, soft-deleted and suspended included, because their
    #       tickets and technicians still need a NOT NULL value. Same values as
    #       core.franchise.home_franchisee_fields(), which create_company uses from now on.
    op.execute(
        """
        INSERT INTO franchisees (company_id, name, code, kind, is_home, is_active, created_by)
        SELECT c.id, c.name, 'HOME', 'internal', true, true, c.created_by
        FROM companies c
        """
    )

    # ── 4. the columns, nullable first ────────────────────────────────────────
    for table in _LINKS:
        op.add_column(table, sa.Column("franchisee_id", sa.Uuid(), nullable=True))
    for table in _TYPED:
        # F5: every technician is a freelancer. The server default fills every existing row.
        op.add_column(table, sa.Column("technician_type", sa.String(16),
                                       server_default=sa.text("'freelancer'"), nullable=False))
        op.create_check_constraint("technician_type", table,
                                   "technician_type IN ('employee', 'freelancer')")  # BARE name

    # ── 5. stamp, then tighten. updated_at / updated_by are NOT touched: this is not an edit anybody made,
    #       and ledger_entries is "never edited".
    for table in _STAMPED:
        op.execute(
            f"""
            UPDATE {table} x SET franchisee_id = f.id
            FROM franchisees f
            WHERE f.company_id = x.company_id AND f.is_home
            """
        )
        op.alter_column(table, "franchisee_id", nullable=False)

    # ── 6. FKs and covering indexes AFTER the bulk UPDATE (cheaper than maintaining them through it).
    for table, (index, columns) in _LINKS.items():
        op.create_foreign_key(f"fk_{table}_company_franchisee", table, "franchisees",
                              ["company_id", "franchisee_id"], ["company_id", "id"], ondelete="RESTRICT")
        op.create_index(index, table, columns)


def downgrade_blockers(counts: dict[str, int]) -> list[str]:
    """PURE — the sentences that stop a downgrade. Unit-tested (§6)."""
    messages = {
        "other_franchisees": "franchisee(s) other than the home were created",
        "franchisee_pincodes": "pincode assignment(s) exist",
        "franchise_memberships": "login(s) act for a franchisee",
        "employees": "technician(s) or invite(s) are typed 'employee'",
    }
    return [f"{counts[k]} {text}" for k, text in messages.items() if counts.get(k)]


def downgrade() -> None:
    bind = op.get_bind()
    counts = {
        "other_franchisees": bind.scalar(sa.text("SELECT count(*) FROM franchisees WHERE NOT is_home")),
        "franchisee_pincodes": bind.scalar(sa.text("SELECT count(*) FROM franchisee_pincodes")),
        "franchise_memberships": bind.scalar(
            sa.text("SELECT count(*) FROM memberships WHERE franchisee_id IS NOT NULL")),
        "employees": bind.scalar(sa.text(
            "SELECT (SELECT count(*) FROM technician_profiles WHERE technician_type <> 'freelancer')"
            " + (SELECT count(*) FROM technician_invites WHERE technician_type <> 'freelancer')")),
    }
    blockers = downgrade_blockers(counts)
    if blockers:
        raise RuntimeError("Refusing to downgrade 3b7e1f0a9c41 — it would lose data: "
                           + "; ".join(blockers) + ". Remove them by hand first.")

    for table, (index, _columns) in reversed(list(_LINKS.items())):
        op.drop_index(index, table_name=table)
        op.drop_constraint(f"fk_{table}_company_franchisee", table, type_="foreignkey")
        op.drop_column(table, "franchisee_id")
    for table in _TYPED:
        op.drop_constraint("technician_type", table, type_="check")      # BARE name, both directions
        op.drop_column(table, "technician_type")
    op.drop_index("ix_franchisee_pincodes_pincode", table_name="franchisee_pincodes")
    op.drop_index("ix_franchisee_pincodes_company_franchisee", table_name="franchisee_pincodes")
    op.drop_table("franchisee_pincodes")
    op.execute("DROP INDEX IF EXISTS uq_franchisees_company_name_lower")
    op.drop_index("uq_franchisees_company_code", table_name="franchisees")
    op.drop_index("uq_franchisees_one_home", table_name="franchisees")
    op.drop_table("franchisees")
```

Notes for the implementer:
- `downgrade_blockers` lives in the migration so the refusal text is unit-testable without a database
  (load the file with `importlib.util.spec_from_file_location`; `alembic.op` imports fine outside a context).
- If you autogenerate first: delete every proposed drop of `uq_companies_gst_lower`,
  `uq_companies_slug_lower`, `uq_users_email_lower`, the other hand-written `lower()`/partial indexes,
  and — new — `uq_franchisees_company_name_lower`. Delete a drop-and-recreate pair of the same index too.
- FK/index identifiers are all < 63 characters (longest: `fk_technician_profiles_company_franchisee`, 41).

#### 3.3a Two vocabulary widenings that ride in THIS migration (added by the index owner after Task 03)

Task 03's carve-out writes a `ticket_events` row of kind `franchisee_changed` and a `notifications` row of
kind `technician_moved`. Both columns are CHECK-constrained, and §3.6 of the index gives these values to no
other migration, so **`3b7e1f0a9c41` widens both** (Task 05 does not touch `notifications.kind`). That
keeps Tasks 01–03 publishable as one release (index gate b2).

| Change | Model edit |
|---|---|
| `ck_ticket_events_kind` gains `'franchisee_changed'` | `app/models/ticket_event.py` — append to `EVENT_KINDS` and to the `CheckConstraint` string (~line 237) |
| `ck_notifications_kind` gains `'technician_moved'` (16 chars, fits `String(24)`) | `app/models/notification.py` — append to `NOTIFICATION_KINDS` with a `#:` comment like its neighbours |

In the migration, at the **end** of `upgrade()`:

```python
# Spell both vocabularies out here (never import them from the models — a later model edit would
# silently rewrite history). OLD_* = exactly what is in the CHECK at f9c2d8a3e17b; NEW_* = OLD_* + one value.
op.drop_constraint("kind", "ticket_events", type_="check")          # bare name; convention adds ck_ticket_events_
op.create_check_constraint("kind", "ticket_events", _in("kind", NEW_EVENT_KINDS))
op.drop_constraint("kind", "notifications", type_="check")
op.create_check_constraint("kind", "notifications", _in("kind", NEW_NOTIFICATION_KINDS))
```

At the **start** of `downgrade()`, add to `downgrade_blockers`'s input the counts
`SELECT count(*) FROM ticket_events WHERE kind = 'franchisee_changed'` and
`SELECT count(*) FROM notifications WHERE kind = 'technician_moved'` (both refuse when non-zero), then
restore the `OLD_*` CHECKs. Confirm the current constraint names first with
`SELECT conname FROM pg_constraint WHERE conname IN ('ck_ticket_events_kind','ck_notifications_kind')` —
if either is named differently on RelianceDB, use the real name.

Every later migration that rewrites either CHECK (Tasks 11 and 12) must list these two values.

### 3.4 Home-franchisee naming and code — the judgement calls

- *Decision (writer):* **name = the company's name, verbatim** (e.g. `RELIANCEGREENTECH PRIVATE LIMITED`).
  Reason: the home *is* the company running technicians itself; root AGENTS.md rule 6 forbids inventing
  copy, and "Acme Home" would put a word into data nobody signed off. The console's "Home" badge (Task 08)
  comes from `is_home`, not from the name. The name is editable later (Task 03); it does **not** follow
  a company rename (`companies.service.update_company` is unchanged) — two records, two names.
- *Decision (writer):* **code = `HOME`** for every home. Reason: stamped once and never recomputed (the
  `companies.code` rule); unique per company because there is one home per company; and it *reserves* the
  string — `uq_franchisees_company_code` makes Task 03 unable to mint `HOME` for any other franchisee,
  whatever its name derives to (a name like "Home Office Maintenance Engineers" would).

### 3.5 Tenancy audit — `api/app/scripts/audit_tenancy.py`

Append to `TENANT_LINKS` (each with a one-line "what would leak" comment, in the file's style):

```python
# Who owns a pincode. One pointing at another company's franchisee would route one tenant's tickets to
# a second tenant's technicians.
("franchisee_pincodes", "franchisee_id", "franchisees"),
# A franchise login. Proves the LINK; whether one franchisee can read another's rows inside a company is
# an application invariant (core.franchise_scope, Task 02) this script cannot see.
("memberships", "franchisee_id", "franchisees"),
("technician_profiles", "franchisee_id", "franchisees"),
("technician_invites", "franchisee_id", "franchisees"),
("tickets", "franchisee_id", "franchisees"),
# Money. A payout or penalty booked to another company's franchisee would put one tenant's money in a
# second tenant's pool.
("ledger_entries", "franchisee_id", "franchisees"),
("redemptions", "franchisee_id", "franchisees"),
```

`GLOBAL_TABLES`: **no additions** — both new tables carry `company_id`. `franchisee_pincodes.pincode →
pincodes.code` is a plain FK to a global master and is correctly NOT a tenant link (as with
`technician_invite_pincodes`). `KNOWN_FUNCTIONS`: no additions (no stored function).

### 3.6 Database cleanup — `api/app/scripts/cleanup_db.py`

Add `"franchisees"` and `"franchisee_pincodes"` to `COMPANY_TABLES`. Nothing else: `delete_order` derives
children-before-parents from the live FKs (tickets/memberships/… before `franchisees`), the dangling-FK
refusal covers the seven new FKs automatically, and `MONEY_SUMS` is unchanged (no new money column).
Run `python -m app.scripts.cleanup_db --check`.

---

## 4. API / service changes

### 4.1 New module `api/app/core/franchise.py` (index §3.7)

Core, not a slice, because companies, technicians, onboarding, tickets, redemptions and (Task 02+) the
scope helpers all need it — api hard rule 4. Imports only `sqlalchemy` and `app.models.*` (no `deps`, no
`database`), so the two pure functions are unit-testable.

```python
"""Which franchisee owns what — the one place that answers it."""

import uuid
from collections.abc import Iterable, Mapping

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import Company
from app.models.franchisee import HOME_CODE, KIND_INTERNAL, MAX_NAME, Franchisee, FranchiseePincode
from app.models.territory import Pincode


def home_franchisee_fields(company_name: str) -> dict:
    """PURE. The column values of a company's home franchisee — the migration's INSERT says the same."""
    return {"name": company_name[:MAX_NAME], "code": HOME_CODE, "kind": KIND_INTERNAL,
            "is_home": True, "is_active": True}


def route_pincodes(pincodes: Iterable[str], owned: Mapping[str, uuid.UUID],
                   home_id: uuid.UUID) -> dict[str, uuid.UUID]:
    """PURE. Each pincode's franchisee: its owner row, else the home (F4)."""
    return {p: owned.get(p, home_id) for p in set(pincodes)}


async def create_home_franchisee(db: AsyncSession, company: Company) -> Franchisee:
    """Write the company's home. Flushes, never commits — the caller owns the transaction, exactly as
    `rules.load_rules` and `credits.grant_free` do inside `create_company`."""
    row = Franchisee(company_id=company.id, created_by=company.created_by,
                     **home_franchisee_fields(company.name))
    db.add(row)
    await db.flush()
    return row


async def home_franchisee_id(db: AsyncSession, company_id: uuid.UUID) -> uuid.UUID:
    """The company's home. Self-heals like `rules.load_rules`: a company created by the OLD code between
    the production migration and the publish has none (§8), and its first ticket must not 500 for that.
    Concurrent repairs collide on uq_franchisees_one_home -> errors.py 409, and the retry finds the row."""
    found = await db.scalar(select(Franchisee.id).where(
        Franchisee.company_id == company_id, Franchisee.is_home.is_(True),
        Franchisee.deleted_at.is_(None)))
    if found is not None:
        return found
    company = await db.scalar(select(Company).where(Company.id == company_id))
    if company is None:
        raise LookupError(f"company {company_id} does not exist")
    return (await create_home_franchisee(db, company)).id


async def franchisee_for_pincode(db: AsyncSession, company_id: uuid.UUID, pincode: str) -> uuid.UUID:
    """The owner of this pincode in this company, else the home. One indexed probe
    (uq_franchisee_pincodes_company_pincode) plus, on a miss, the home lookup."""
    owner = await db.scalar(
        select(FranchiseePincode.franchisee_id)
        .join(Franchisee, (Franchisee.company_id == FranchiseePincode.company_id)
                          & (Franchisee.id == FranchiseePincode.franchisee_id))
        .where(FranchiseePincode.company_id == company_id, FranchiseePincode.pincode == pincode,
               Franchisee.deleted_at.is_(None)))
    return owner if owner is not None else await home_franchisee_id(db, company_id)


async def franchisees_for_pincodes(db: AsyncSession, company_id: uuid.UUID,
                                   pincodes: Iterable[str]) -> dict[str, uuid.UUID]:
    """`franchisee_for_pincode` for a whole sheet in TWO queries, for the bulk importer (which exists to
    avoid per-row queries). *Decision (writer):* an extra helper beyond index §3.7."""
    wanted = set(pincodes)
    if not wanted:
        return {}
    rows = await db.execute(
        select(FranchiseePincode.pincode, FranchiseePincode.franchisee_id)
        .join(Franchisee, (Franchisee.company_id == FranchiseePincode.company_id)
                          & (Franchisee.id == FranchiseePincode.franchisee_id))
        .where(FranchiseePincode.company_id == company_id, FranchiseePincode.pincode.in_(wanted),
               Franchisee.deleted_at.is_(None)))
    return route_pincodes(wanted, dict(rows.all()), await home_franchisee_id(db, company_id))


def franchisee_pincodes_subquery(company_id: uuid.UUID, franchisee_id: uuid.UUID, *,
                                 is_home: bool) -> Select:
    """SQL, never a list: the codes a franchisee owns.

    Non-home: its own rows. Home: every ACTIVE master code that no franchisee in this company owns (F4) —
    thousands of codes, which is why this is a subquery for Postgres to filter with, never materialised
    (the `core.scope.pincodes_in_states` rule). `NOT IN` is safe: `franchisee_pincodes.pincode` is NOT
    NULL, so the NULL trap cannot fire.

    For PICKING and RANGE checks (Tasks 03, 04, 14). Ticket and technician VISIBILITY go by the stamped
    `franchisee_id` column, never by this (see Task 02 §4) — after a carve-out an assigned ticket keeps
    its franchisee while its pincode now belongs to another.
    """
    if not is_home:
        return select(FranchiseePincode.pincode).where(
            FranchiseePincode.company_id == company_id, FranchiseePincode.franchisee_id == franchisee_id)
    claimed = select(FranchiseePincode.pincode).where(FranchiseePincode.company_id == company_id)
    return select(Pincode.code).where(Pincode.is_active.is_(True), Pincode.code.not_in(claimed))
```

### 4.2 `api/app/features/companies/service.py` — `create_company`

After `await grant_free(session, company.id, by_user=principal.user_id)` (and before the admin user is
resolved), add:

```python
# The home franchisee, in the same transaction for the same reason as the rules and the gift: a company
# that exists without one is a company whose first technician or ticket has nothing to be stamped with.
await create_home_franchisee(session, company)
```
Import `from app.core.franchise import create_home_franchisee`. `update_company`, `set_status`,
`delete_company` are unchanged (the home is never deleted or suspended on its own; it goes with the
company in `cleanup_db` via CASCADE/delete order).

### 4.3 Technicians — `api/app/features/technicians/service.py`

- **`create_technician`** (the `if profile is None:` branch that builds `TechnicianProfile(...)`): add
  `franchisee_id=await home_franchisee_id(session, principal.company_id)` and
  `technician_type=TYPE_FREELANCER`. Staff-added technicians belong to the home (F8) — choosing another
  franchisee or type from the request is Task 05.
  The **re-add branch** (`else:` — a removed technician brought back) does **not** touch
  `franchisee_id`/`technician_type`: the profile keeps what it had. Task 05 decides re-assignment.
- **`create_invite`** (`TechnicianInvite(...)`): add the same two values.

### 4.4 Onboarding — `api/app/features/onboarding/service.py` — `register`

In the `TechnicianProfile(...)` built from the invite, copy both:
`franchisee_id=invite.franchisee_id, technician_type=invite.technician_type`. Copied, not joined — the
invite records what was offered (the comment already there says the same about coverage).

### 4.5 Tickets — two INSERT sites (three intake channels: Manual and API share `create_ticket`, Excel is the importer)

- **`api/app/features/tickets/service.py` — `create_ticket`**: in `Ticket(...)` add
  `franchisee_id=await franchisee_for_pincode(db, principal.company_id, body.pincode)`. Compute it after
  `_assert_pincode_known` (the code is known to exist by then).
- **`api/app/features/tickets/import_service.py` — `_commit`**: once, before the `for code, row in
  zip(codes, ready)` loop:
  ```python
  routes = await franchisees_for_pincodes(db, principal.company_id, {r.body.pincode for r in ready})
  ```
  and in each `Ticket(...)`: `franchisee_id=routes[body.pincode]`.

This makes intake correct from day one, including after Task 03 starts writing `franchisee_pincodes`.
Task 04 ("stamp at intake") therefore only has to verify these two sites and add its eligibility work.

### 4.6 Ledger — `api/app/core/ledger.py` — `entry`

`entry()` is sync, takes no session, and has **six** callers: `jobs/service.complete` (bonus),
`jobs/service.cancel` (penalty), `tickets/feedback_service.record_feedback` (payout),
`tickets/service.record_no_show` (penalty), `tickets/service.reverse_penalty` (reversal),
`tickets/service.force_close_ticket` (payout). Rather than make all six load the technician:

```python
def entry(*, company_id, technician_id, ticket_id, kind, amount_paise, reason,
          by_user=None, reverses_id=None, franchisee_id: uuid.UUID | None = None) -> LedgerEntry:
    """… `franchisee_id` defaults to the technician's franchisee AT WRITE TIME, read inside the INSERT
    itself (an embedded scalar subquery), so it cannot drift from the row it describes and no caller has
    to load the profile. Pass it only to override — `reverse_penalty` does."""
    return LedgerEntry(
        company_id=company_id, technician_id=technician_id, ticket_id=ticket_id, kind=kind,
        amount_paise=amount_paise, reason=reason, created_by=by_user, reverses_id=reverses_id,
        franchisee_id=franchisee_id if franchisee_id is not None else (
            select(TechnicianProfile.franchisee_id)
            .where(TechnicianProfile.company_id == company_id, TechnicianProfile.id == technician_id)
            .scalar_subquery()),
    )
```
*Decision (writer):* the embedded subquery (SQLAlchemy "SQL expression assigned to a mapped attribute",
evaluated in the INSERT). Trap: after the flush the attribute is **expired**; reading
`entry.franchisee_id` in async code without `await db.refresh(row, ["franchisee_id"])` raises
`MissingGreenlet`. No current caller reads it.

*Decision (writer), refines index §3.2:* **`reverse_penalty` passes `franchisee_id=penalty.franchisee_id`.**
A reversal gives money back out of the pool that collected the penalty (F12). If the technician moved
franchisee in between, "technician's franchisee at write time" would debit the new franchisee's pool for
a penalty the old one banked. Every other kind uses the default.

### 4.7 Redemptions — `api/app/features/redemptions/service.py` — `request`

In `Redemption(...)` add `franchisee_id=locked.franchisee_id` (the profile row already locked with
`FOR UPDATE`).

### 4.8 Complete list of INSERT sites (grep-verified)

`grep -rnE "TechnicianProfile\(|\bTicket\(|LedgerEntry\(|\bRedemption\(|TechnicianInvite\(|INSERT INTO (technician_profiles|tickets|ledger_entries|redemptions|technician_invites)" api/app`
finds exactly these, all covered above:

| Table | Site | Fix |
|---|---|---|
| `technician_profiles` | `technicians/service.py::create_technician` | §4.3 |
| `technician_profiles` | `onboarding/service.py::register` | §4.4 |
| `technician_invites` | `technicians/service.py::create_invite` | §4.3 |
| `tickets` | `tickets/service.py::create_ticket` | §4.5 |
| `tickets` | `tickets/import_service.py::_commit` | §4.5 |
| `ledger_entries` | `core/ledger.py::entry` (6 callers) | §4.6 |
| `redemptions` | `redemptions/service.py::request` | §4.7 |

**Seed scripts need no code change** — every one drives the services above
(`api/app/scripts/seed/tenant.py` → `create_company`, `create_technician`; `seed/lifecycle.py` →
`create_ticket`, `jobs_service`, `record_feedback`, `force_close_ticket`; `seed_play_review.py` →
`create_company`, `create_technician`, `create_ticket`, `record_feedback`; `seed_demo.py` →
`redemptions_service.request`; `bootstrap.py` writes only the superadmin `User`; `seed/backdate.py` only
UPDATEs timestamps). Re-run grep after your change; if a new site appeared since, cover it. Seeds that
construct `Principal(...)` by hand (`seed/tenant.py`, `seed_play_review.py`) are unaffected here.

### 4.9 `api/app/scripts/seed/verify.py` — three new checks (X1: database behaviour is proven here)

Add to the tuple in `run()`:

- `_company_has_one_home` — exactly one `franchisees` row with `is_home AND deleted_at IS NULL` for
  `company_id`, and **zero** `franchisee_pincodes` rows on it (F4).
- `_open_unassigned_tickets_route_by_pincode` — for this company's tickets with `status IN ('New',
  'Slot Pending') AND technician_id IS NULL AND deleted_at IS NULL`, the stamped `franchisee_id` equals
  `franchisees_for_pincodes(...)[pincode]`. Two paths that must agree; it stays true after Task 03 because
  F6 re-stamps exactly this set.
- `_technicians_on_live_franchisees` — no technician profile (live membership) points at a franchisee
  that is deleted or inactive.

No endpoint, schema (Pydantic) or error code changes in this task. No feature key.

---

## 5. Client changes

None — later tasks (Task 07 mobile, Tasks 08/09 console). No API response changes shape.

---

## 6. Unit tests (pure — X1)

The Task 00 harness (`api/pytest.ini`, `api/tests/unit/conftest.py`) must be present. Import app modules at
**module top** (collection time), not inside tests.

`api/tests/unit/test_franchise_core.py`
1. `home_franchisee_fields("Acme Appliances Pvt Ltd")` → name unchanged, code `"HOME"`, kind `"internal"`,
   `is_home` and `is_active` True.
2. A 300-character name is cut to 255; the result still matches the code CHECK regex `^[A-Z0-9]{2,8}$`
   for the code.
3. `route_pincodes(["500032","500001"], {"500032": A}, H)` → `{"500032": A, "500001": H}`.
4. Duplicates collapse; empty input → `{}`; an owned code not asked for is not returned.
5. `franchisee_pincodes_subquery(c, f, is_home=False)` compiled with
   `sqlalchemy.dialects.postgresql.dialect()` selects `franchisee_pincodes.pincode` filtered on both ids;
   `is_home=True` selects `pincodes.code` with `is_active` and `NOT IN`.

`api/tests/unit/test_franchisee_models.py` (reads `Base.metadata` after `import app.models`)
6. `KINDS == ("internal", "external")`, `TECHNICIAN_TYPES == ("employee", "freelancer")`, `HOME_CODE == "HOME"`.
7. Each value of `KINDS` / `TECHNICIAN_TYPES` appears in the text of the CheckConstraint whose name ends
   with `kind` on `franchisees` / `technician_type` on `technician_profiles` **and** `technician_invites`.
8. For each of the seven `(child, column, "franchisees")` links: `metadata.tables[child]` has a
   `ForeignKeyConstraint` whose local columns are exactly `["company_id", column]` and whose target table is
   `franchisees`.
9. Covering index: for each FK on `franchisees`, `franchisee_pincodes` and the six new
   `fk_*_company_franchisee`, some `Index` or `UniqueConstraint` on the child has the FK columns as a
   leading prefix (the pure mirror of api/AGENTS.md's FK-coverage SQL).
10. `franchisee_id` is `nullable=False` on `technician_profiles`, `technician_invites`, `tickets`,
    `ledger_entries`, `redemptions`, and `nullable=True` on `memberships`.
11. `uq_franchisees_one_home` is a unique Index with a `postgresql_where`; `uq_franchisees_company_id_id`
    is a plain (total) UniqueConstraint.

`api/tests/unit/test_franchise_tenancy_lists.py`
12. `audit_tenancy.TENANT_LINKS` contains all seven new tuples; `"franchisees"` and
    `"franchisee_pincodes"` are not in `GLOBAL_TABLES`.
13. `cleanup_db.classification_problems(set(Base.metadata.tables), source="the models") == []` — the
    `--check` gate, now enforced in CI.

`api/tests/unit/test_ledger_entry.py`
14. `entry(..., franchisee_id=None)` → `row.franchisee_id` is a SQLAlchemy `ScalarSelect` (the embedded
    subquery), and compiling it references `technician_profiles.franchisee_id`.
15. `entry(..., franchisee_id=X)` → `row.franchisee_id == X`.

`api/tests/unit/test_migration_3b7e1f0a9c41.py` (load the file with `importlib.util`)
16. `revision == "3b7e1f0a9c41"`, `down_revision == "f9c2d8a3e17b"`.
17. `downgrade_blockers({})` and all-zero counts → `[]`; `{"other_franchisees": 2}` → one message
    containing `"2 franchisee(s)"`; all four non-zero → four messages, in the dict's order.

---

## 7. Acceptance criteria

All database steps run from `api/` against **RelianceDB** (dev). Production is migrated by the owner
(§8); you only offer to verify it read-only.

1. **Given** dev at `f9c2d8a3e17b`, **before** migrating, record the fingerprint (save the output):
   ```sql
   SELECT 'technician_profiles' t, count(*), md5(string_agg(id::text, ',' ORDER BY id)) FROM technician_profiles
   UNION ALL SELECT 'technician_invites', count(*), md5(string_agg(id::text, ',' ORDER BY id)) FROM technician_invites
   UNION ALL SELECT 'tickets', count(*), md5(string_agg(id::text, ',' ORDER BY id)) FROM tickets
   UNION ALL SELECT 'ledger_entries', count(*), md5(string_agg(id::text, ',' ORDER BY id)) FROM ledger_entries
   UNION ALL SELECT 'redemptions', count(*), md5(string_agg(id::text, ',' ORDER BY id)) FROM redemptions
   UNION ALL SELECT 'memberships', count(*), md5(string_agg(id::text, ',' ORDER BY id)) FROM memberships
   UNION ALL SELECT 'companies', count(*), md5(string_agg(id::text, ',' ORDER BY id)) FROM companies;
   ```
2. **When** `./.venv/Scripts/python.exe -m alembic upgrade head`, then `downgrade f9c2d8a3e17b`, then
   `upgrade head` — **then** all three exit 0 and the query in (1) returns identical counts and md5s
   after each step (ids out = ids in; api/AGENTS.md hard rule 6).
3. **Then** (after the final upgrade) every check below returns the stated result:
   ```sql
   -- exactly one live home per company (soft-deleted companies included): 0 rows
   SELECT c.id FROM companies c
   LEFT JOIN franchisees f ON f.company_id = c.id AND f.is_home AND f.deleted_at IS NULL
   GROUP BY c.id HAVING count(f.id) <> 1;
   -- homes look right: 0 rows
   SELECT f.id FROM franchisees f JOIN companies c ON c.id = f.company_id
   WHERE f.is_home AND (f.name <> c.name OR f.code <> 'HOME' OR f.kind <> 'internal' OR NOT f.is_active);
   -- no other franchisees, no pincode rows: 0 and 0
   SELECT count(*) FROM franchisees WHERE NOT is_home;
   SELECT count(*) FROM franchisee_pincodes;
   -- every stamped row is on ITS company's home: five rows, every count 0
   SELECT 'technician_profiles', count(*) FROM technician_profiles x JOIN franchisees f ON f.id = x.franchisee_id WHERE NOT f.is_home OR f.company_id <> x.company_id
   UNION ALL SELECT 'technician_invites', count(*) FROM technician_invites x JOIN franchisees f ON f.id = x.franchisee_id WHERE NOT f.is_home OR f.company_id <> x.company_id
   UNION ALL SELECT 'tickets', count(*) FROM tickets x JOIN franchisees f ON f.id = x.franchisee_id WHERE NOT f.is_home OR f.company_id <> x.company_id
   UNION ALL SELECT 'ledger_entries', count(*) FROM ledger_entries x JOIN franchisees f ON f.id = x.franchisee_id WHERE NOT f.is_home OR f.company_id <> x.company_id
   UNION ALL SELECT 'redemptions', count(*) FROM redemptions x JOIN franchisees f ON f.id = x.franchisee_id WHERE NOT f.is_home OR f.company_id <> x.company_id;
   -- everyone is a freelancer: only 'freelancer' rows
   SELECT technician_type, count(*) FROM technician_profiles GROUP BY 1;
   SELECT technician_type, count(*) FROM technician_invites GROUP BY 1;
   -- memberships untouched: 0
   SELECT count(*) FROM memberships WHERE franchisee_id IS NOT NULL;
   -- the backfill did not pose as an edit: 0
   SELECT count(*) FROM ledger_entries WHERE updated_at > now() - interval '10 minutes'
                                          AND created_at < now() - interval '10 minutes';
   -- every FK has a covering index (api/AGENTS.md hard rule 6): no row naming a new constraint
   SELECT c.conrelid::regclass, c.conname FROM pg_constraint c
   WHERE c.contype = 'f' AND NOT EXISTS (
     SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
       AND (i.indkey::int2[])[0:array_length(c.conkey,1)-1] = c.conkey);
   ```
4. **Given** the migrated dev DB, **when** `python -m app.scripts.audit_tenancy`, **then** it prints `ok`
   for all seven new links (both the "composite" and the "rows" sections) and exits 0.
5. **When** `python -m app.scripts.cleanup_db --check`, **then** "All N model tables are classified" and
   exit 0.
6. **Tenancy is structural (404-not-403 has no endpoint to test in this task; the database proves it).**
   **Given** companies A and B, **when** inside `BEGIN; … ROLLBACK;` you run
   `UPDATE tickets SET franchisee_id = '<B home id>' WHERE id = '<a ticket of A>';`, **then** it fails with
   a foreign-key violation on `fk_tickets_company_franchisee`. Same for
   `INSERT INTO franchisee_pincodes (company_id, franchisee_id, pincode) VALUES ('<A>', '<B home>', '500001')`.
7. **Given** the dev API running (check for a single listener on :8000 first — root AGENTS.md), **when** the
   superadmin creates a company (`POST /companies`), **then** `SELECT * FROM franchisees WHERE company_id =
   '<new>'` returns one home row named exactly as the company, code `HOME`.
8. **When** a vendor raises a ticket (`POST /tickets`) and an Excel import of two rows runs, **then** all
   three tickets carry the company's home id. **When** a technician is added directly and another is
   invited and registers, **then** both profiles (and the invite) carry the home and `freelancer`.
9. **When** `python -m app.scripts.seed_synthetic --tickets 50` runs on dev, **then** it finishes with no
   verify problems (including the three new checks), and
   `SELECT kind, count(*) FROM ledger_entries l JOIN technician_profiles p ON p.id = l.technician_id
   WHERE l.franchisee_id <> p.franchisee_id GROUP BY 1` returns 0 rows.
10. **Given** a reversal written by `reverse_penalty`, **then** its `franchisee_id` equals the reversed
    penalty's (`SELECT r.franchisee_id = p.franchisee_id FROM ledger_entries r JOIN ledger_entries p ON
    p.id = r.reverses_id` → all true).
11. **Given** a manually created non-home franchisee row on dev (`INSERT` inside a transaction you then
    keep), **when** `alembic downgrade f9c2d8a3e17b`, **then** it raises the RuntimeError naming
    "1 franchisee(s) other than the home" and the schema is unchanged; delete the row and the downgrade
    succeeds.
12. `pytest` (from `api/`) is green, including the 17 cases in §6.
13. Every API screen reads as before (F5): the dev console's Tickets, Technicians, Penalty pool and a
    technician's Earnings in Expo Go show the same numbers as before the migration.

---

## 8. Out of scope and traps

- **Out of scope:** the franchisee CRUD, ranges, carve-out and `FRANCHISEE_*` errors (Task 03); roles and
  `Principal.franchisee_id` (Task 02); eligibility by franchisee (Task 04); choosing a franchisee or type for
  a technician from a request (Task 05); `accept_snapshot` (Task 10). Do **not** add `franchiseeId` to any
  response yet.
- **Production — the owner runs it** (memory: "Prod migrations: the user runs them"; root AGENTS.md:
  `$env:POSTGRES_DB='RelianceProdDB'; python -m alembic upgrade head`). Ask; offer to verify read-only with
  the §7.3 SQL.
- ⚠ **Migrate production, then publish PROMPTLY** (the credits precedent in api/AGENTS.md). Once five
  columns are NOT NULL, the OLD deployed API cannot insert a ticket, a technician, an invite, a ledger
  entry (so a customer confirming closure fails) or a redemption until the new code is live — each fails
  as a clean 409 from `errors.py` and rolls back, nothing half-written. Run the two back to back, out of
  hours. A company the old code creates in that gap has no home; `home_franchisee_id` self-heals it on its
  first stamped write. Afterwards this is safe to run any number of times and should find nothing:
  ```sql
  INSERT INTO franchisees (company_id, name, code, kind, is_home, is_active, created_by)
  SELECT c.id, c.name, 'HOME', 'internal', true, true, c.created_by FROM companies c
  WHERE NOT EXISTS (SELECT 1 FROM franchisees f WHERE f.company_id = c.id AND f.is_home AND f.deleted_at IS NULL);
  ```
- **Alembic false drops** (hard rule 6): delete autogenerated drops of `uq_companies_gst_lower`,
  `uq_companies_slug_lower`, `uq_users_email_lower`, every other hand-written `lower()`/partial index, and
  the new `uq_franchisees_company_name_lower`.
- **UNIQUE naming:** `uq_*` names are taken verbatim — spell `uq_franchisee_pincodes_company_pincode` in
  full. CHECK names are bare (`"technician_type"`) in `create_check_constraint` **and** `drop_constraint`.
- **Partial uniques on soft-deleted tables:** `franchisees` name and code uniques are partial on
  `deleted_at IS NULL`; `uq_franchisees_company_id_id` must stay TOTAL (FK target).
  `franchisee_pincodes` is not soft-deleted, so its UNIQUE is total.
- **Every FK gets a covering index**, columns in FK order: seven new composite FKs + the `pincodes` FK.
- **The round trip proves the schema, not the data** (`a7c93f5e2b18` lesson) — that is why §7.1/§7.2
  fingerprint ids.
- **Hard rule 8 (no table without a writer):** `franchisee_pincodes` has no writer until Task 03. It is
  shipped empty on purpose as the shape `franchisee_for_pincode` reads; Task 03 must land in the same
  release train. Say so in the migration docstring.
- **`scope.py`/`coverage.py`/`visibility.py` do not filter `pincodes.is_active`** for existing work;
  `franchisee_pincodes_subquery` does for the home because it is a picker/range answer (index §3.7), not a
  visibility rule. Do not "fix" either.
- **Hard rule 10 (`autoflush=False`):** `create_home_franchisee` flushes; any new code reading back rows it
  just added must flush first.
- **The blob containers and `cleanup_db` decisions are untouched.** `RGT Play Review` gets its home from
  the migration on both databases; re-running `seed_play_review` afterwards is a good smoke test (owner's
  call on prod).
- `api/AGENTS.md` / root `AGENTS.md` prose updates are Task 16; keep the code's own docstrings accurate now.

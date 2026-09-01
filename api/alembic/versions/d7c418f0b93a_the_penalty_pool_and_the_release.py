"""the penalty pool, and the release that fills it

Revision ID: d7c418f0b93a
Revises: c93a6f1e70d8
Create Date: 2026-08-31 17:42:08.115206

§7's other way into an escalation. A technician can now give up a job they
accepted: the ticket goes back to the pool with its slot untouched, and the
technician is charged by how little notice they gave.

Two things had to exist for that.

**`ledger_entries`** — the pool §7 describes and nothing implemented. *"Penalties
are collected into a pool used to fund reassignment bonuses"*, which makes the
two movements one table rather than two: `balance = SUM(penalty) - SUM(bonus)`.
Until now the console's Ledger screen and its bonus "available pool" tile were
reading invented numbers, and the technician's cancel screen promised a
deduction from earnings that nothing anywhere performed.

**`ticket_events.kind = 'released'`** — the name was chosen for this migration
before it existed: *"Release belongs here too and will be added by the migration
that adds the cancel flow."*

## The amounts are the console's four bands

The penalty scale was a logged open decision with two client-approved answers —
the console's ₹300/₹500/₹800/₹1,200 cutting at 4h and 2h, against the technician
app's ₹80/₹150/₹250 cutting at 8h and 4h. Ruled in favour of the console's,
which is why this migration changes no rule row: `company_rules` already holds
them, already per company, already editable. The technician's cancel screen
needed no redesign to adopt them because it renders whatever the server sends.

## Nothing is backfilled

Every cancellation before this migration went unrecorded and uncharged, and the
pool starts at zero rather than at a number invented to look plausible. The
console's balance is honest from the first entry.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "d7c418f0b93a"
down_revision: Union[str, Sequence[str], None] = "c93a6f1e70d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_BASE = (
    "'created', 'slot_requested', 'slot_confirmed', 'confirmation_sent', "
    "'status_changed', 'assigned', 'started', 'feedback_requested', "
    "'completed', 'feedback_received', 'reopened', 'serial_mismatch', "
    "'serial_corrected', 'reminded', 'escalated', 'bonus_added'"
)
_OLD = f"kind IN ({_BASE})"
_NEW = f"kind IN ({_BASE}, 'released')"


def upgrade() -> None:
    op.create_table(
        "ledger_entries",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("technician_id", sa.Uuid(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=160), nullable=False),
        # Audit columns LAST, from the mixins — see api/AGENTS.md rule 6.
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint("kind IN ('penalty', 'bonus')", name="ck_ledger_entries_kind"),
        sa.CheckConstraint(
            "amount_paise > 0", name="ck_ledger_entries_amount_paise"
        ),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_ledger_entries_company_technician",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_ledger_entries_company_ticket",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ledger_entries_company_created",
        "ledger_entries",
        ["company_id", "created_at"],
    )
    # Serves the composite technician FK AND the monthly-cap query.
    op.create_index(
        "ix_ledger_entries_company_technician",
        "ledger_entries",
        ["company_id", "technician_id", "created_at"],
    )
    op.create_index(
        "ix_ledger_entries_company_ticket",
        "ledger_entries",
        ["company_id", "ticket_id"],
    )

    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _NEW)


def downgrade() -> None:
    # A `released` row cannot satisfy the old CHECK. Same trade-off every
    # widening in this project has made: leaving them would make the constraint
    # uncreatable and the downgrade a dead end.
    #
    # The TICKETS those rows describe are left where they are. A released ticket
    # is back in the pool or escalated, both of which are valid states under the
    # old constraint, and re-assigning it to the technician who gave it up would
    # be a rollback inventing a commitment nobody made.
    op.execute("DELETE FROM ticket_events WHERE kind = 'released'")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _OLD)

    op.drop_index("ix_ledger_entries_company_ticket", table_name="ledger_entries")
    op.drop_index("ix_ledger_entries_company_technician", table_name="ledger_entries")
    op.drop_index("ix_ledger_entries_company_created", table_name="ledger_entries")
    op.drop_table("ledger_entries")

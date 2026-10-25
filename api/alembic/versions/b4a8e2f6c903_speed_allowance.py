"""Speed allowance — a franchisee's speed matrix, two pool kinds, one event kind.

Revision ID: b4a8e2f6c903
Revises: 9e1b5d3c7a26
Create Date: 2026-10-23

Task 11. What the three sections do:

1. `franchisee_speed_rules` — the matrix (S1): franchisee × technician type ×
   (node or model) → the four figures. Configuration, not money: the table
   drops on downgrade without a guard, with its row count printed first so a
   round trip on dev can compare ids out with ids in. Nothing is seeded — W1,
   an empty matrix means OFF.
2. `ledger_entries` — the `kind` CHECK widened to seven values (the e8b2f47c19d3
   helper, matched on 'penalty', NOT on 'kind'), plus the one-speed-row-per-
   ticket partial unique (W9).
3. `ticket_events` — the `kind` CHECK gains `speed_settled` (W12).

Downgrade REFUSES while any speed ledger row (or a reversal naming one) exists:
those are payments, and a downgrade would silently move technicians' money —
a deleted `speed_penalty` refunds it, a deleted `speed_reward` claws it back.
`tickets.accept_snapshot` needs no change here: Task 10's column already holds
the frozen `speed` block.

Downgrade is idempotent about the speed matrix rows: they are DROPPED, and the
count of what is lost is printed — configuration can be re-entered, payment
history cannot.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b4a8e2f6c903"
down_revision: Union[str, Sequence[str], None] = "9e1b5d3c7a26"
branch_labels = None
depends_on = None

#: As they stand at 9e1b5d3c7a26 — spelled out, never imported (a migration
#: describes the database it was written against; the model's own vocabulary is
#: not available at other revisions). The 23 kinds Task 01's 3b7e1f0a9c41
#: widened; Tasks 05 and 10 did not touch this CHECK.
_EVENTS = (
    "'created', 'slot_requested', 'slot_confirmed', 'confirmation_sent', "
    "'status_changed', 'assigned', 'started', 'feedback_requested', "
    "'completed', 'feedback_received', 'reopened', 'serial_mismatch', "
    "'serial_corrected', 'reminded', 'customer_notified', 'escalated', "
    "'bonus_added', 'released', 'no_show', 'force_closed', 'rescheduled', "
    "'penalty_reversed', 'franchisee_changed'"
)
_LEDGER_OLD = "kind IN ('penalty', 'bonus', 'payout', 'reversal', 'travel')"
_LEDGER_NEW = (
    "kind IN ('penalty', 'bonus', 'payout', 'reversal', 'travel', "
    "'speed_reward', 'speed_penalty')"
)


def _drop_ledger_kind_check() -> None:
    """Drop the `kind` CHECK on ledger_entries by whatever it is called.

    The `e8b2f47c19d3` helper, verbatim: matched on `'penalty'` because
    `reversal_points_back` mentions `kind` too. Never "simplify" the match to
    `'%kind%'`.
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


def _drop_ticket_event_kind_check() -> None:
    """Drop the `kind` CHECK on ticket_events by whatever it is called.

    `3b7e1f0a9c41`'s twin of the ledger helper. On this table the CHECK's
    definition mentions `kind` and nothing else is a CHECK on `kind`, so the
    match on `'created'` is exact rather than convenient.
    """
    op.execute(
        """
        DO $$
        DECLARE target text;
        BEGIN
          SELECT conname INTO target
            FROM pg_constraint
           WHERE conrelid = 'ticket_events'::regclass
             AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%''created''%';
          IF target IS NOT NULL THEN
            EXECUTE format('ALTER TABLE ticket_events DROP CONSTRAINT %I', target);
          END IF;
        END $$;
        """
    )


def _audit_columns() -> list[sa.Column]:
    """The audit columns, exactly as 3b7e1f0a9c41 wrote them (Task 01) — same
    server defaults as `db.mixins` declares, `created_by`/`updated_by` NOT FKs."""
    return [
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
    ]


def upgrade() -> None:
    # ── 1. franchisee_speed_rules ────────────────────────────────────────────
    # Constraint names inside create_table are the FULL DB names (op.f() pins
    # them against re-conventioning), the way 9e1b5d3c7a26 wrote its table; the
    # composite FKs and the partial uniques are bare-named everywhere else.
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
        *_audit_columns(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_franchisee_speed_rules")),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], ondelete="CASCADE",
            name=op.f("fk_franchisee_speed_rules_company_id_companies"),
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
            ondelete="CASCADE", name="fk_franchisee_speed_rules_company_franchisee",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "node_id"], ["product_nodes.company_id", "product_nodes.id"],
            ondelete="CASCADE", name="fk_franchisee_speed_rules_company_node",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "model_id"], ["product_models.company_id", "product_models.id"],
            ondelete="CASCADE", name="fk_franchisee_speed_rules_company_model",
        ),
        # CHECKs by FULL name inside create_table (op.f), bare name everywhere
        # else — hard rule 6.
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
    op.create_index("ix_franchisee_speed_rules_company_node", "franchisee_speed_rules",
                    ["company_id", "node_id"])
    op.create_index("ix_franchisee_speed_rules_company_model", "franchisee_speed_rules",
                    ["company_id", "model_id"])
    op.create_index("uq_franchisee_speed_rules_node", "franchisee_speed_rules",
                    ["company_id", "franchisee_id", "technician_type", "node_id"], unique=True,
                    postgresql_where=sa.text("node_id IS NOT NULL"))
    op.create_index("uq_franchisee_speed_rules_model", "franchisee_speed_rules",
                    ["company_id", "franchisee_id", "technician_type", "model_id"], unique=True,
                    postgresql_where=sa.text("model_id IS NOT NULL"))
    # No backfill (W1): an empty matrix means OFF, and there is no honest
    # default reward to stamp.

    # ── 2. ledger_entries ────────────────────────────────────────────────────
    _drop_ledger_kind_check()
    op.create_check_constraint("kind", "ledger_entries", _LEDGER_NEW)
    op.create_index(
        "uq_ledger_entries_speed_once", "ledger_entries", ["company_id", "ticket_id"],
        unique=True,
        postgresql_where=sa.text("kind IN ('speed_reward', 'speed_penalty')"),
    )

    # ── 3. ticket_events ─────────────────────────────────────────────────────
    _drop_ticket_event_kind_check()
    op.create_check_constraint(
        "kind", "ticket_events", f"kind IN ({_EVENTS}, 'speed_settled')"
    )


def downgrade() -> None:
    bind = op.get_bind()

    # Refuse rather than delete money (the e8b2f47c19d3 / 9e1b5d3c7a26 shape).
    # A deleted speed_penalty silently refunds; a deleted speed_reward silently
    # claws back — and the reversal that gave one back is as much the record of
    # that movement as the charge it names.
    money = bind.execute(sa.text(
        "SELECT count(*) FROM ledger_entries e WHERE e.kind IN ('speed_reward','speed_penalty') "
        "OR (e.kind = 'reversal' AND EXISTS (SELECT 1 FROM ledger_entries p "
        "    WHERE p.company_id = e.company_id AND p.id = e.reverses_id AND p.kind = 'speed_penalty'))"
    )).scalar()
    if money:
        raise RuntimeError(f"{money} speed ledger row(s) exist (rewards, penalties or their reversals). "
                           "Downgrading would delete them and silently move technicians' money.")

    # The matrix is configuration, not money — it goes with the table. Print
    # the count first so a round trip on dev can compare ids out with ids in
    # (hard rule 6's lesson).
    rules = bind.execute(
        sa.text("SELECT count(*) FROM franchisee_speed_rules")
    ).scalar()
    print(f"downgrade {revision}: dropping {rules} speed rule row(s) as configuration")
    op.drop_table("franchisee_speed_rules")   # drops its indexes and FKs with it

    op.drop_index("uq_ledger_entries_speed_once", table_name="ledger_entries")
    _drop_ledger_kind_check()
    op.create_check_constraint("kind", "ledger_entries", _LEDGER_OLD)

    op.execute("DELETE FROM ticket_events WHERE kind = 'speed_settled'")
    _drop_ticket_event_kind_check()
    op.create_check_constraint("kind", "ticket_events", f"kind IN ({_EVENTS})")
"""Give a ticket a history, give codes a real counter, and delete what nothing wrote.

Five changes, all from the same review. Each one closes a gap between what the
schema implies and what it can actually answer.

1. `company_sequences` — `INST-…` and `TCH-…` were both `base + COUNT(*)`, whose
   own docstrings admitted the race and called a 409 the resolution. That is
   survivable for one person typing a form and fails outright for bulk upload:
   every row in a batch reads the same COUNT, because none of them are committed
   yet, so every row after the first collides. Seeded here from the highest code
   each company has actually used, not from its row count — a soft-deleted
   ticket must not hand its number to a new one.

2. `ticket_events` — a status column keeps no history. Overwrite `status` and
   the previous value is gone, along with when it changed and who changed it,
   which blocks three things already specified: the daily job cap (jobs assigned
   ON A DATE), the cancellation bands (₹80 / ₹150 / ₹250, by how long before the
   slot), and any "closed within SLA" measure. The existing tickets are
   backfilled with the events their own columns still prove happened — creation,
   and a confirmed slot where there is one — and nothing else, because nothing
   else is knowable after the fact.

   NB this adds `uq_tickets_company_id_id`: tickets had no `(company_id, id)`
   target, so nothing could hang off a ticket with a composite FK until now.

3. `tickets.source` — vendors declare which intake channels they use, but a
   ticket did not record which one produced it. Only 'Manual' exists today; the
   column is added now precisely so that when Excel and API land, the earlier
   rows are known rather than guessed.

4. Technician counters go NULLABLE. `jobs_completed` and `jobs_cancelled`
   defaulted to 0 while nothing anywhere wrote them, so every profile asserted a
   measured zero that had never been measured. `rating` and `on_time_pct` were
   already null-when-unknown and already render as an em dash; these two now
   match. Existing zeros become NULL, since not one of them was counted.

5. `audit_logs` is DROPPED. The model existed, the table existed, and no code
   anywhere constructed a row — 0 in every environment. An audit log that is
   silently empty is worse than none, because eventually somebody trusts it.
   `ticket_events` is the pattern to copy when a real one is wanted.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "7b1e4a9c05d2"
down_revision = "4c8f1b7d2e93"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. per-company code counters ────────────────────────────────────────
    op.create_table(
        "company_sequences",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=32), nullable=False),
        sa.Column("next_value", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", postgresql.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", postgresql.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], name="fk_company_sequences_company_id_companies", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_company_sequences"),
        sa.UniqueConstraint("company_id", "name", name="uq_company_sequence"),
    )
    # No separate index on company_id: `uq_company_sequence` is
    # (company_id, name) and a leading-column prefix already covers both the FK
    # check and any lookup by company.

    # Seed from the HIGHEST code in use, not from a row count: a soft-deleted
    # ticket keeps its number (uq_tickets_company_code is total, deliberately),
    # so counting live rows would re-issue it.
    op.execute(
        """
        INSERT INTO company_sequences (id, company_id, name, next_value, created_at, updated_at)
        SELECT gen_random_uuid(), company_id, 'ticket',
               max(substring(code from 6)::int) + 1, now(), now()
        FROM tickets WHERE code ~ '^INST-[0-9]+$' GROUP BY company_id
        """
    )
    op.execute(
        """
        INSERT INTO company_sequences (id, company_id, name, next_value, created_at, updated_at)
        SELECT gen_random_uuid(), company_id, 'technician',
               max(substring(code from 5)::int) + 1, now(), now()
        FROM technician_profiles WHERE code ~ '^TCH-[0-9]+$' GROUP BY company_id
        """
    )

    # ── 2. ticket history ───────────────────────────────────────────────────
    #
    # The FK target first — nothing could reference a ticket compositely before.
    op.create_unique_constraint(
        "uq_tickets_company_id_id", "tickets", ["company_id", "id"]
    )
    op.create_table(
        "ticket_events",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("from_status", sa.String(length=24), nullable=True),
        sa.Column("to_status", sa.String(length=24), nullable=True),
        sa.Column("actor_kind", sa.String(length=16), nullable=False),
        sa.Column("actor_label", sa.String(length=120), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", postgresql.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", postgresql.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "kind IN ('created', 'slot_requested', 'slot_confirmed', 'status_changed')",
            name="kind",
        ),
        sa.CheckConstraint(
            "actor_kind IN ('staff', 'technician', 'customer', 'system')",
            name="actor_kind",
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], name="fk_ticket_events_company_id_companies", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_ticket_events_company_ticket",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_ticket_events"),
    )
    op.create_index("ix_ticket_events_company_ticket", "ticket_events", ["company_id", "ticket_id"])
    op.create_index("ix_ticket_events_company_created", "ticket_events", ["company_id", "created_at"])

    # Backfill: only what the ticket's own columns still prove.
    op.execute(
        """
        INSERT INTO ticket_events (id, company_id, ticket_id, kind, to_status,
                                   actor_kind, actor_label, note,
                                   created_at, updated_at, created_by)
        SELECT gen_random_uuid(), t.company_id, t.id, 'created', t.status,
               'staff', coalesce(u.full_name, 'Manual entry'),
               t.service_type || ' · ' || t.service_level_hours || 'h service level · '
                 || t.city || ' ' || t.pincode,
               t.created_at, t.created_at, t.created_by
        FROM tickets t LEFT JOIN users u ON u.id = t.created_by
        """
    )
    # `slot_confirmed_at` distinguishes the customer picking from ops typing it
    # in — the same distinction the console already draws — so the backfilled
    # actor is not a guess.
    op.execute(
        """
        INSERT INTO ticket_events (id, company_id, ticket_id, kind, to_status,
                                   actor_kind, actor_label,
                                   created_at, updated_at, created_by)
        SELECT gen_random_uuid(), t.company_id, t.id, 'slot_confirmed', t.status,
               CASE WHEN t.slot_confirmed_at IS NULL THEN 'staff' ELSE 'customer' END,
               CASE WHEN t.slot_confirmed_at IS NULL
                    THEN coalesce(u.full_name, 'Manual entry')
                    ELSE t.customer_name END,
               coalesce(t.slot_confirmed_at, t.created_at),
               coalesce(t.slot_confirmed_at, t.created_at),
               CASE WHEN t.slot_confirmed_at IS NULL THEN t.created_by END
        FROM tickets t LEFT JOIN users u ON u.id = t.created_by
        WHERE t.slot_start IS NOT NULL
        """
    )

    # ── 3. which channel raised it ──────────────────────────────────────────
    op.add_column(
        "tickets",
        sa.Column("source", sa.String(length=16), server_default=sa.text("'Manual'"), nullable=False),
    )
    # Bare names on BOTH sides: the naming convention adds `ck_<table>_`, and
    # passing it as well produces `ck_tickets_ck_tickets_source`.
    op.create_check_constraint("source", "tickets", "source IN ('API', 'Excel', 'Manual')")
    # Backstop for the rule `schemas.py` already enforces, so a future importer
    # that bypasses the request schema cannot write a Service ticket with no
    # fault on it. Verified against existing rows first: 0 violations.
    op.create_check_constraint(
        "description_required",
        "tickets",
        "(service_type = 'Installation + Demo') = (description IS NULL)",
    )

    # ── 4. unmeasured is NULL, not zero ─────────────────────────────────────
    op.alter_column("technician_profiles", "jobs_completed", nullable=True, server_default=None)
    op.alter_column("technician_profiles", "jobs_cancelled", nullable=True, server_default=None)
    op.execute(
        "UPDATE technician_profiles SET jobs_completed = NULL, jobs_cancelled = NULL "
        "WHERE jobs_completed = 0 AND jobs_cancelled = 0"
    )

    # ── 5. the table nothing ever wrote to ──────────────────────────────────
    op.drop_table("audit_logs")


def downgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("company_id", sa.Uuid(), nullable=True),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=True),
        sa.Column("entity_id", sa.String(length=64), nullable=True),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", postgresql.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], name="fk_audit_logs_company_id_companies", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], name="fk_audit_logs_actor_user_id_users", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_audit_logs"),
    )
    op.create_index("ix_audit_logs_company_created", "audit_logs", ["company_id", "created_at"])
    op.create_index("ix_audit_logs_actor_user_id", "audit_logs", ["actor_user_id"])

    # NULL means "never measured"; 0 is what the column meant before. Going back
    # asserts a count that was never taken — which is the bug this migration
    # fixed — but a NOT NULL column cannot hold the honest answer.
    op.execute(
        "UPDATE technician_profiles SET jobs_completed = coalesce(jobs_completed, 0), "
        "jobs_cancelled = coalesce(jobs_cancelled, 0)"
    )
    op.alter_column("technician_profiles", "jobs_cancelled", nullable=False, server_default=sa.text("0"))
    op.alter_column("technician_profiles", "jobs_completed", nullable=False, server_default=sa.text("0"))

    op.drop_constraint("description_required", "tickets", type_="check")
    op.drop_constraint("source", "tickets", type_="check")
    op.drop_column("tickets", "source")

    op.drop_index("ix_ticket_events_company_created", table_name="ticket_events")
    op.drop_index("ix_ticket_events_company_ticket", table_name="ticket_events")
    op.drop_table("ticket_events")
    op.drop_constraint("uq_tickets_company_id_id", "tickets", type_="unique")

    op.drop_table("company_sequences")

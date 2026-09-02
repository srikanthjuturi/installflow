"""A manager can end a stuck job

`Force-Closed` has been a permitted value in the ticket status CHECK, a member
of `core.tickets.TERMINAL_STATUSES`, and a status the technician app maps to
"completed" — since the initial schema. **Nothing could ever produce it.**

That left the one hole the whole feedback design creates. Only the customer
closes a job here, deliberately: the technician's word starts a question and
`Awaiting Customer` is where it waits. A customer who says nothing at all is
therefore a ticket that never settles — the technician is never credited, the
SLA clock never stops, and no other endpoint writes a terminal status either
(nothing in this codebase writes `Cancelled`). Force-closure is the only exit.

Two live surfaces already point managers at it and have since they shipped:
`sweeps.sweep_force_close` raises "ready for force closure" once the customer
has been silent past `company_rules.force_close_hours`, and the dashboard's
"Awaiting force-close" card counts the same population. Both led to a console
screen whose submit button returned a hard-coded 501.

Three things widen so the closure can be recorded, all in this one revision per
hard rule 8 — a vocabulary declared ahead of its rows is how `audit_logs` ended
up a table nothing ever wrote to:

  * `ticket_events.kind = 'force_closed'` — who ended it, when, and on what
    basis. `note` carries the reason and the manager's justification.
  * `ticket_attachments` — the supporting files §10 requires. Its own table
    rather than a fifth kind on `ticket_proofs`: that table means "what the
    technician captured on site", and every row of it carries a phone's capture
    clock and, on a live shot, the coordinates that evidence attendance. A call
    log uploaded from a desk claims none of that.
  * `jobs.force_close` — a new feature, granted by default to the four staff
    roles. `jobs.close` already existed but belongs to `admin` and `technician`
    alone, so reusing it would have either locked out every manager or handed
    technicians the override.

## Nothing is backfilled

Tickets that went silent before this migration are not closed. Which of them a
manager would actually have closed, and on what evidence, is not a question a
migration can answer — and a closure with no attachments and no named author is
exactly the unaccountable record this table exists to prevent.

Revision ID: a1d8e34b90c7
Revises: f2b6a95d10c7
Create Date: 2026-09-02 09:14:32.118904

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1d8e34b90c7"
down_revision: Union[str, Sequence[str], None] = "f2b6a95d10c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_EVENTS = (
    "'created', 'slot_requested', 'slot_confirmed', 'confirmation_sent', "
    "'status_changed', 'assigned', 'started', 'feedback_requested', "
    "'completed', 'feedback_received', 'reopened', 'serial_mismatch', "
    "'serial_corrected', 'reminded', 'escalated', 'bonus_added', 'released', "
    "'no_show'"
)

_FEATURE = "jobs.force_close"
_ROLES = ("admin", "national_head", "regional_head", "area_manager")


def upgrade() -> None:
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint(
        "kind", "ticket_events", f"kind IN ({_EVENTS}, 'force_closed')"
    )

    op.create_table(
        "ticket_attachments",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=False),
        sa.Column("ordinal", sa.SmallInteger(), nullable=False),
        sa.Column("blob_name", sa.String(length=255), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
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
        sa.CheckConstraint("ordinal >= 1", name=op.f("ck_ticket_attachments_ordinal")),
        # Composite, so one company's evidence can never attach to another
        # company's ticket even if somebody guesses an id.
        sa.ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_ticket_attachments_company_ticket",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name=op.f("fk_ticket_attachments_company_id_companies"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_attachments")),
    )
    # The read query AND the covering index the composite FK needs — Postgres
    # creates none, so without it deleting a ticket scans the whole table.
    op.create_index(
        "ix_ticket_attachments_company_ticket",
        "ticket_attachments",
        ["company_id", "ticket_id", "ordinal"],
    )

    # WHERE NOT EXISTS on both inserts: a database stood up from a later seed
    # could already carry these rows, and re-running must be inert.
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            INSERT INTO features (key, label, parent_key, sort_order)
            SELECT CAST(:key AS varchar), CAST(:label AS varchar),
                   CAST(:parent AS varchar), CAST(:sort AS integer)
            WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = :key)
            """
        ),
        {
            "key": _FEATURE,
            "label": "Force Close Job",
            "parent": "jobs.view",
            "sort": 44,
        },
    )
    for role in _ROLES:
        bind.execute(
            sa.text(
                """
                INSERT INTO role_feature_defaults (role, feature_id, enabled)
                SELECT CAST(:role AS varchar), f.id, true
                FROM features f
                WHERE f.key = :key
                  AND NOT EXISTS (
                        SELECT 1 FROM role_feature_defaults rfd
                        WHERE rfd.role = CAST(:role AS varchar)
                          AND rfd.feature_id = f.id
                  )
                """
            ),
            {"role": role, "key": _FEATURE},
        )


def downgrade() -> None:
    bind = op.get_bind()
    # The grants first, then the feature they point at.
    #
    # `company_role_features` too, unlike the precedent in a7c4e1b93d05 which
    # left per-company overrides alone: there the feature itself survived, so an
    # override still referred to something. Here the feature row goes, and a
    # dangling override would be a foreign key violation.
    bind.execute(
        sa.text(
            """
            DELETE FROM company_role_features
            WHERE feature_id IN (SELECT id FROM features WHERE key = :key)
            """
        ),
        {"key": _FEATURE},
    )
    bind.execute(
        sa.text(
            """
            DELETE FROM role_feature_defaults
            WHERE feature_id IN (SELECT id FROM features WHERE key = :key)
            """
        ),
        {"key": _FEATURE},
    )
    bind.execute(sa.text("DELETE FROM features WHERE key = :key"), {"key": _FEATURE})

    op.drop_index(
        "ix_ticket_attachments_company_ticket", table_name="ticket_attachments"
    )
    op.drop_table("ticket_attachments")

    # A force-closed ticket has to come back to something the old CHECK permits.
    # `Awaiting Customer` is where these were before a manager touched them and
    # where the sweep will find them again — the alternative is a status the
    # constraint still allows but no code path expects.
    op.execute(
        "UPDATE tickets SET status = 'Awaiting Customer' "
        "WHERE status = 'Force-Closed'"
    )
    # `jobs_completed` counted those closures, and it is a CACHE recomputed from
    # the tickets rather than a record of anything — unlike the ledger rows the
    # no-show migration deliberately leaves alone, which are money that really
    # moved. Left stale it would credit work whose closure this rollback just
    # undid, until the technician's next closure happened to refresh it. Same
    # query as `feedback_service.refresh_technician_stats`, minus the
    # `Force-Closed` half that no longer exists.
    op.execute(
        """
        UPDATE technician_profiles tp
        SET jobs_completed = (
            SELECT count(*) FROM tickets t
            WHERE t.company_id = tp.company_id
              AND t.technician_id = tp.id
              AND t.status = 'Closed'
              AND t.deleted_at IS NULL
        )
        WHERE tp.jobs_completed IS NOT NULL
        """
    )
    # Rows of the new kind cannot satisfy the old CHECK, so they go — the same
    # trade-off every widening in this project has made.
    op.execute("DELETE FROM ticket_events WHERE kind = 'force_closed'")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", f"kind IN ({_EVENTS})")

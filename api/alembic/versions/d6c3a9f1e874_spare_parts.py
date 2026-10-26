"""Spare parts: a catalogue on the product tree, and a facility's request log

Revision ID: d6c3a9f1e874
Revises: b4a8e2f6c903
Create Date: 2026-10-24

Task 12. Adds what P1-P7 describe: `spare_parts` (on a category node or a
product model, inherited down the tree) and `spare_part_requests` (one
technician's request and every step a facility logs against it). A ticket gains
the status `Awaiting Part`; the trail gains five event kinds; the bell gains
three kinds and the `facility` audience.

Three things autogenerate cannot do: the four CHECK replacements (drop and
recreate, BARE names - the convention adds `ck_<table>_`), and the three
hand-written lower() partial indexes, which it will offer to drop on every
future revision. Delete those drops.

## The downgrade refuses while any request exists or any ticket waits

A request is the only record that a part left a store; deleting one is the
`e8b2f47c19d3` mistake in a different currency. And a ticket in `Awaiting Part`
has no honest older status - `In Progress` would let Complete through with a
part outstanding. So it stops and says how many, the `f4b28d1a67c3` shape. The
catalogue is configuration and is dropped with its table (the count is printed).

## The BEFORE lists are guarded

Tasks 01-12 land as one chain, but a sibling that added a value this file's
BEFORE lists lack would have it silently dropped by a blind drop-and-recreate.
`_assert_check_is` compares the live definition to the spelled-out list first
and stops with both printed. Feature keys (`parts.handle`, `parts.catalogue`,
`franchise.facility_users`) are Task 02's (5d2a8c6e0b13) and are NOT re-seeded
here - one owner per row.
"""

import re
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d6c3a9f1e874"
down_revision: Union[str, Sequence[str], None] = "b4a8e2f6c903"
branch_labels = None
depends_on = None

# -- the vocabularies as they stand BEFORE this revision ------------------------
# Spelled out, never imported from the models (a migration describes the
# database it was written against). Verified against `pg_get_constraintdef` at
# b4a8e2f6c903 on 2026-10-24.
_STATUS_BEFORE = (
    "'New', 'Slot Pending', 'Assigned', 'In Progress', 'Awaiting Customer', "
    "'AI Review', 'Escalated', 'Closed', 'Force-Closed', 'Cancelled'"
)
_EVENTS_BEFORE = (
    "'created', 'slot_requested', 'slot_confirmed', 'confirmation_sent', "
    "'status_changed', 'assigned', 'started', 'feedback_requested', 'completed', "
    "'feedback_received', 'reopened', 'serial_mismatch', 'serial_corrected', "
    "'reminded', 'customer_notified', 'escalated', 'bonus_added', 'released', "
    "'no_show', 'force_closed', 'rescheduled', 'penalty_reversed', "
    "'franchisee_changed', "                                # Task 01 (3b7e1f0a9c41)
    "'speed_settled'"                                       # Task 11 (b4a8e2f6c903)
)
_NOTIFICATIONS_BEFORE = (
    "'escalation', 'ai', 'serial_mismatch', 'force_close', 'slot', "
    "'technician_joined', 'job_started', 'invite_expired', 'assigned', 'no_show', "
    "'product_submitted', 'product_approved', 'product_rejected', 'rescheduled', "
    "'redemption', 'brand_submitted', 'brand_approved', 'brand_rejected', "
    "'upi_change', 'credits', 'recharge', 'vendor_credit', 'vendor_payment', "
    "'vendor_credit_request', "
    "'technician_moved'"                                    # Task 01 (3b7e1f0a9c41)
)
_AUDIENCES_BEFORE = (
    "'payers', 'area_manager', 'regional_head', 'national_head', 'admin', "
    "'billing', 'vendor', "
    "'franchisee_admin'"                                    # Task 05 (7c4f2e9a1d58)
)
_NEW_EVENTS = (
    "'part_requested', 'part_approved', 'part_rejected', 'part_issued', 'part_returned'"
)
_NEW_NOTIFICATIONS = "'part_requested', 'part_decided', 'part_issued'"


def _values(text: str) -> set[str]:
    """Every single-quoted literal in `text` - works on both a spelled-out list
    and on `pg_get_constraintdef`'s `ARRAY['x'::character varying, ...]`."""
    return set(re.findall(r"'([^']*)'", text))


def _assert_check_is(table: str, name: str, must_contain: str) -> None:
    """Refuse to replace a CHECK that is not the one this file was written against.

    If a sibling task added a value this file's BEFORE list lacks, a blind
    drop-and-recreate would silently remove it. Compare the live definition to
    the spelled-out list and stop with both printed.
    """
    bind = op.get_bind()
    live = bind.execute(
        sa.text(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conrelid = CAST(:t AS regclass) AND conname = :n"
        ),
        {"t": table, "n": f"ck_{table}_{name}"},
    ).scalar()
    if live is None:
        raise RuntimeError(f"ck_{table}_{name} does not exist; this migration was written against it.")
    have, want = _values(live), _values(must_contain)
    if have != want:
        raise RuntimeError(
            f"ck_{table}_{name} is not what d6c3a9f1e874 was written against.\n"
            f"  in the database but not in this file: {sorted(have - want)}\n"
            f"  in this file but not in the database: {sorted(want - have)}\n"
            f"  live definition: {live}\n"
            "Add the missing value(s) to the BEFORE list (and the downgrade's), then rerun."
        )


def _audit_columns(*, soft_delete: bool) -> list[sa.Column]:
    """The audit columns, exactly as 3b7e1f0a9c41 wrote them (Task 01)."""
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
    _assert_check_is("tickets", "status", _STATUS_BEFORE)
    _assert_check_is("ticket_events", "kind", _EVENTS_BEFORE)
    _assert_check_is("notifications", "kind", _NOTIFICATIONS_BEFORE)
    _assert_check_is("notifications", "audience", _AUDIENCES_BEFORE)

    # -- 1. spare_parts ---------------------------------------------------------
    # Constraint names inside create_table are the FULL DB names (op.f pins them
    # against re-conventioning); a UNIQUE's explicit name is taken verbatim.
    op.create_table(
        "spare_parts",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("node_id", sa.Uuid(), nullable=True),
        sa.Column("model_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        *_audit_columns(soft_delete=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_spare_parts")),
        sa.CheckConstraint("(node_id IS NULL) <> (model_id IS NULL)",
                           name=op.f("ck_spare_parts_one_owner")),
        sa.CheckConstraint("length(btrim(name)) BETWEEN 1 AND 120",
                           name=op.f("ck_spare_parts_name")),
        sa.UniqueConstraint("company_id", "id", name="uq_spare_parts_company_id_id"),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], ondelete="CASCADE",
            name=op.f("fk_spare_parts_company_id_companies"),
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "node_id"], ["product_nodes.company_id", "product_nodes.id"],
            ondelete="RESTRICT", name="fk_spare_parts_company_node",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "model_id"], ["product_models.company_id", "product_models.id"],
            ondelete="RESTRICT", name="fk_spare_parts_company_model",
        ),
    )
    # Covering indexes for the two composite FKs.
    op.create_index("ix_spare_parts_company_node", "spare_parts", ["company_id", "node_id"])
    op.create_index("ix_spare_parts_company_model", "spare_parts", ["company_id", "model_id"])
    # Hand-written: Alembic cannot express lower() in an index.
    op.execute("""
        CREATE UNIQUE INDEX uq_spare_parts_node_name
            ON spare_parts (company_id, node_id, lower(btrim(name)))
         WHERE node_id IS NOT NULL AND deleted_at IS NULL""")
    op.execute("""
        CREATE UNIQUE INDEX uq_spare_parts_model_name
            ON spare_parts (company_id, model_id, lower(btrim(name)))
         WHERE model_id IS NOT NULL AND deleted_at IS NULL""")

    # -- 2. spare_part_requests ---------------------------------------------------
    op.create_table(
        "spare_part_requests",
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(24), nullable=False),
        sa.Column("franchisee_id", sa.Uuid(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=False),
        sa.Column("technician_id", sa.Uuid(), nullable=False),
        sa.Column("spare_part_id", sa.Uuid(), nullable=True),
        sa.Column("other_name", sa.String(120), nullable=True),
        sa.Column("part_name", sa.String(120), nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("status", sa.String(16), server_default=sa.text("'requested'"), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("decided_by_label", sa.String(120), nullable=True),
        sa.Column("reject_reason", sa.String(255), nullable=True),
        sa.Column("rejected_from", sa.String(16), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("issued_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("issued_by_label", sa.String(120), nullable=True),
        sa.Column("issue_note", sa.String(500), nullable=True),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("returned_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("returned_by_label", sa.String(120), nullable=True),
        sa.Column("return_note", sa.String(500), nullable=True),
        sa.Column("return_photo_blob_name", sa.String(255), nullable=True),
        *_audit_columns(soft_delete=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_spare_part_requests")),
        sa.CheckConstraint(
            "status IN ('requested', 'approved', 'rejected', 'issued', 'returned')",
            name=op.f("ck_spare_part_requests_status")),
        sa.CheckConstraint("(spare_part_id IS NULL) <> (other_name IS NULL)",
                           name=op.f("ck_spare_part_requests_one_part")),
        sa.CheckConstraint("(status = 'requested') = (decided_at IS NULL)",
                           name=op.f("ck_spare_part_requests_decided_matches_status")),
        sa.CheckConstraint("(decided_at IS NULL) = (decided_by_label IS NULL)",
                           name=op.f("ck_spare_part_requests_decided_by_both")),
        sa.CheckConstraint("(status = 'rejected') = (reject_reason IS NOT NULL)",
                           name=op.f("ck_spare_part_requests_rejected_has_reason")),
        sa.CheckConstraint(
            "(status = 'rejected') = (rejected_from IS NOT NULL) "
            "AND (rejected_from IS NULL OR rejected_from IN ('requested', 'approved'))",
            name=op.f("ck_spare_part_requests_rejected_from_matches_status")),
        sa.CheckConstraint("(status IN ('issued', 'returned')) = (issued_at IS NOT NULL)",
                           name=op.f("ck_spare_part_requests_issued_matches_status")),
        sa.CheckConstraint("(status = 'returned') = (returned_at IS NOT NULL)",
                           name=op.f("ck_spare_part_requests_returned_matches_status")),
        sa.CheckConstraint("return_photo_blob_name IS NULL OR status = 'returned'",
                           name=op.f("ck_spare_part_requests_photo_only_when_returned")),
        sa.UniqueConstraint("company_id", "code", name="uq_spare_part_requests_company_code"),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], ondelete="CASCADE",
            name=op.f("fk_spare_part_requests_company_id_companies"),
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "franchisee_id"], ["franchisees.company_id", "franchisees.id"],
            ondelete="RESTRICT", name="fk_spare_part_requests_company_franchisee",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "ticket_id"], ["tickets.company_id", "tickets.id"],
            ondelete="CASCADE", name="fk_spare_part_requests_company_ticket",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            ondelete="RESTRICT", name="fk_spare_part_requests_company_technician",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "spare_part_id"], ["spare_parts.company_id", "spare_parts.id"],
            ondelete="RESTRICT", name="fk_spare_part_requests_company_part",
        ),
    )
    op.create_index("ix_spare_part_requests_queue", "spare_part_requests",
                    ["company_id", "franchisee_id", "status", "created_at"])
    op.create_index("ix_spare_part_requests_company_ticket", "spare_part_requests",
                    ["company_id", "ticket_id", "created_at"])
    op.create_index("ix_spare_part_requests_company_technician", "spare_part_requests",
                    ["company_id", "technician_id"])
    op.create_index("ix_spare_part_requests_company_part", "spare_part_requests",
                    ["company_id", "spare_part_id"])
    op.execute("""
        CREATE UNIQUE INDEX uq_spare_part_requests_open_name
            ON spare_part_requests (company_id, ticket_id, lower(btrim(part_name)))
         WHERE status IN ('requested', 'approved')""")

    # -- 3. the four vocabularies (BARE names, both directions) -------------------
    op.drop_constraint("status", "tickets", type_="check")
    op.create_check_constraint(
        "status", "tickets", f"status IN ({_STATUS_BEFORE}, 'Awaiting Part')")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint(
        "kind", "ticket_events", f"kind IN ({_EVENTS_BEFORE}, {_NEW_EVENTS})")
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint(
        "kind", "notifications", f"kind IN ({_NOTIFICATIONS_BEFORE}, {_NEW_NOTIFICATIONS})")
    op.drop_constraint("audience", "notifications", type_="check")
    op.create_check_constraint(
        "audience", "notifications",
        f"audience IS NULL OR audience IN ({_AUDIENCES_BEFORE}, 'facility')")


def downgrade() -> None:
    bind = op.get_bind()
    waiting = bind.execute(sa.text(
        "SELECT count(*) FROM tickets WHERE status = 'Awaiting Part'")).scalar()
    requests = bind.execute(sa.text(
        "SELECT count(*) FROM spare_part_requests")).scalar()
    if waiting or requests:
        raise RuntimeError(
            f"{requests} spare part request(s) exist and {waiting} ticket(s) are "
            "Awaiting Part. Downgrading would delete the only record of parts "
            "that left a store, and put waiting jobs where Complete is allowed. "
            "Decide what happens to them first.")

    # Nothing can carry these if no request ever existed, but a half-failed
    # run must still be able to come back down.
    bind.execute(sa.text(f"DELETE FROM ticket_events WHERE kind IN ({_NEW_EVENTS})"))
    bind.execute(sa.text(
        f"DELETE FROM notifications WHERE kind IN ({_NEW_NOTIFICATIONS}) OR audience = 'facility'"))
    bind.execute(sa.text("DELETE FROM company_sequences WHERE name = 'spare_part_request'"))

    op.drop_constraint("audience", "notifications", type_="check")
    op.create_check_constraint(
        "audience", "notifications", f"audience IS NULL OR audience IN ({_AUDIENCES_BEFORE})")
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint("kind", "notifications", f"kind IN ({_NOTIFICATIONS_BEFORE})")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", f"kind IN ({_EVENTS_BEFORE})")
    op.drop_constraint("status", "tickets", type_="check")
    op.create_check_constraint("status", "tickets", f"status IN ({_STATUS_BEFORE})")

    op.drop_table("spare_part_requests")       # its indexes go with it
    parts = bind.execute(sa.text("SELECT count(*) FROM spare_parts")).scalar()
    print(f"d6c3a9f1e874 downgrade: dropping {parts} catalogue row(s)")
    op.drop_table("spare_parts")
    # Feature rows are Task 02's; NOT deleted here.

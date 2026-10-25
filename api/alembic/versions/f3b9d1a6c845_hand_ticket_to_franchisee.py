"""Hand an unassigned ticket to another franchisee (Task 18).

Revision ID: f3b9d1a6c845
Revises: e8a2c5b7d913
Create Date: 2026-10-24

`tickets.routing_override`: a person, not the pincode, chose the ticket's franchisee. While true the
pool's pincode-coverage test is waived for that ticket (every other test stays). `notifications.kind`
gains `ticket_handed`. Reversible only while nothing uses either.

Two things autogenerate cannot do: the notifications CHECK replacement (drop and recreate, BARE name -
the convention adds `ck_notifications_`), and the hand-written lower() partial indexes it will offer to
drop on every future revision. Delete those drops.

## The BEFORE list is guarded

It is exactly what `ck_notifications_kind` holds at `e8a2c5b7d913` - read from the live database with
`pg_get_constraintdef` on 2026-10-24, not recalled - and so includes `technician_moved` (Task 01),
`part_requested` / `part_decided` / `part_issued` (Task 12) and everything before them. Task 17 added no
notification kind (its bells are `technician_moved`). `_assert_check_is` compares the live definition to
the spelled-out list and stops with both printed, so a sibling that added a value this file lacks is
never silently dropped by the drop-and-recreate (the shape `d6c3a9f1e874` uses).

## The downgrade refuses while anything uses either

A flagged ticket is stamped with a franchisee that does not own its pincode; dropping the flag would
strand it (the coverage test would come back and nobody could be offered it). And a `ticket_handed`
notification has no older kind to become. So it stops and says how many - the `f4b28d1a67c3` shape.
"""

import re
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f3b9d1a6c845"
down_revision: Union[str, Sequence[str], None] = "e8a2c5b7d913"  # re-point to the live head if the chain moved - never branch
branch_labels = None
depends_on = None

# Spelled out, never imported from the model (a later edit would rewrite history).
OLD_NOTIFICATION_KINDS: tuple[str, ...] = (
    "escalation",
    "ai",
    "serial_mismatch",
    "force_close",
    "slot",
    "technician_joined",
    "job_started",
    "invite_expired",
    "assigned",
    "no_show",
    "product_submitted",
    "product_approved",
    "product_rejected",
    "rescheduled",
    "redemption",
    "brand_submitted",
    "brand_approved",
    "brand_rejected",
    "upi_change",
    "credits",
    "recharge",
    "vendor_credit",
    "vendor_payment",
    "vendor_credit_request",
    "technician_moved",  # Task 01 (3b7e1f0a9c41)
    "part_requested",  # Task 12 (d6c3a9f1e874)
    "part_decided",
    "part_issued",
)
NEW_NOTIFICATION_KINDS: tuple[str, ...] = OLD_NOTIFICATION_KINDS + ("ticket_handed",)


def _in(column: str, values) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def _values(text: str) -> set[str]:
    """Every single-quoted literal in `text` - works on a spelled-out list and on
    `pg_get_constraintdef`'s `ARRAY['x'::character varying, ...]`."""
    return set(re.findall(r"'([^']*)'", text))


def _assert_check_is(table: str, name: str, expected: tuple[str, ...], *, revision_label: str) -> None:
    """Refuse to replace a CHECK that is not the one this file was written against."""
    live = op.get_bind().execute(
        sa.text(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conrelid = CAST(:t AS regclass) AND conname = :n"
        ),
        {"t": table, "n": f"ck_{table}_{name}"},
    ).scalar()
    if live is None:
        raise RuntimeError(f"ck_{table}_{name} does not exist; this migration was written against it.")
    have, want = _values(live), set(expected)
    if have != want:
        raise RuntimeError(
            f"ck_{table}_{name} is not what {revision_label} was written against.\n"
            f"  in the database but not in this file: {sorted(have - want)}\n"
            f"  in this file but not in the database: {sorted(want - have)}\n"
            f"  live definition: {live}\n"
            "Add the missing value(s) to the BEFORE list (and the downgrade's), then rerun."
        )


def upgrade() -> None:
    _assert_check_is("notifications", "kind", OLD_NOTIFICATION_KINDS, revision_label="f3b9d1a6c845")

    # NOT NULL DEFAULT false is a catalogue-only change on Postgres >= 11: no table rewrite, no long lock.
    op.add_column(
        "tickets",
        sa.Column("routing_override", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.drop_constraint("kind", "notifications", type_="check")  # bare name; the convention adds ck_notifications_
    op.create_check_constraint("kind", "notifications", _in("kind", NEW_NOTIFICATION_KINDS))


def downgrade() -> None:
    bind = op.get_bind()
    handed = bind.scalar(sa.text("SELECT count(*) FROM tickets WHERE routing_override"))
    bells = bind.scalar(sa.text("SELECT count(*) FROM notifications WHERE kind = 'ticket_handed'"))
    if handed or bells:
        raise RuntimeError(
            f"Refusing to downgrade: {handed} ticket(s) are handed to a franchisee that does not own "
            f"their pincode and {bells} 'ticket_handed' notification(s) exist. Dropping the flag would "
            "strand those tickets. Hand them back (or delete the rows) first."
        )
    _assert_check_is("notifications", "kind", NEW_NOTIFICATION_KINDS, revision_label="f3b9d1a6c845 (downgrade)")
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint("kind", "notifications", _in("kind", OLD_NOTIFICATION_KINDS))
    op.drop_column("tickets", "routing_override")

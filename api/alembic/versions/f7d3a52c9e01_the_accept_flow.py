"""Record that a technician took a job, and make the pool query cheap.

Two changes, both for the accept flow.

**`assigned` joins the `kind` CHECK.** `ticket_event.py` has said since it was
written that "assignment and release belong here too, and will be added by the
migration that adds the accept flow" — this is that migration. Only `assigned`,
not `release`: nothing releases a job until the cancel flow lands, and hard rule
8 is that the vocabulary declares what the code writes TODAY. The row is what
the daily job cap will eventually be counted from, because a status column keeps
no date.

`actor_kind` already permits `'technician'`, so it needs nothing.

**A partial index for the pool.** The pool asks one question on every poll from
every technician — "which tickets in these pincodes are still unclaimed" — and
`ix_tickets_company_pincode` answers it while scanning every ticket the company
has ever had in that pincode, closed ones included. The predicate here is the
pool's own, so the index holds only rows that can still be offered.

Hand-written with `op.execute`, and NOT reversible through autogenerate:
Alembic cannot see a partial index and will offer to drop it on the next
revision. Delete that drop when it appears, the way the `LOWER()` indexes are
already handled.
"""

from alembic import op

revision = "f7d3a52c9e01"
down_revision = "e5b71a93c2f4"
branch_labels = None
depends_on = None

_OLD = (
    "kind IN ('created', 'slot_requested', 'slot_confirmed', "
    "'confirmation_sent', 'status_changed')"
)
_NEW = (
    "kind IN ('created', 'slot_requested', 'slot_confirmed', "
    "'confirmation_sent', 'status_changed', 'assigned')"
)

_POOL_INDEX = """
CREATE INDEX ix_tickets_pool ON tickets (company_id, pincode, slot_start)
WHERE status = 'New' AND technician_id IS NULL AND deleted_at IS NULL
"""


def upgrade() -> None:
    # Bare name on both sides — the naming convention adds `ck_<table>_`.
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _NEW)
    op.execute(_POOL_INDEX)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_tickets_pool")
    # Rows of the new kind cannot satisfy the old CHECK, and they are real
    # records of real assignments: drop them rather than fail, since the
    # constraint they violate is the statement that they should never have
    # existed. The tickets themselves keep `technician_id` — only the trail of
    # when it happened is lost, which is what going back to the old CHECK means.
    op.execute("DELETE FROM ticket_events WHERE kind = 'assigned'")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _OLD)

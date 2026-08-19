"""A vendor can be the actor on a ticket, and its user's list can be found.

`ticket_events.actor_kind` allowed only staff | technician | customer | system.
A vendor-raised ticket had two ways to be wrong: leave it `staff` and the trail
claims a company employee raised it — the exact fabrication `ticket_events`
exists to prevent — or pass `vendor` without this migration and the CHECK
raises an IntegrityError that the error handler turns into a 409 reading
"That value is already taken" on a ticket creation, which nobody would connect
to a constraint.

And `tickets.created_by` gets an index. A vendor USER's list is
`vendor_id = mine AND created_by = me`, and `created_by` comes from `ActorMixin`
as a plain UUID with no foreign key — so hard rule 6's regression query, which
only inspects FK columns, will never ask for this one. Without it every page of
a vendor user's list is a sequential scan.

NB `serial_number` does NOT become NOT NULL here, though it is now required by
the request schema. Fourteen of the twenty existing tickets have none, and
inventing serials to satisfy a constraint would be worse than the constraint
being late. It lands with the re-seed.
"""

from alembic import op

revision = "b8c30d5e6f14"
down_revision = "a1b7e9f4c206"
branch_labels = None
depends_on = None

_OLD = "actor_kind IN ('staff', 'technician', 'customer', 'system')"
_NEW = "actor_kind IN ('staff', 'technician', 'customer', 'vendor', 'system')"


def upgrade() -> None:
    # Bare name on both sides — the naming convention adds `ck_<table>_`.
    op.drop_constraint("actor_kind", "ticket_events", type_="check")
    op.create_check_constraint("actor_kind", "ticket_events", _NEW)

    op.create_index("ix_tickets_created_by", "tickets", ["created_by"])


def downgrade() -> None:
    op.drop_index("ix_tickets_created_by", table_name="tickets")

    # Rows of the new kind cannot satisfy the old CHECK, and they are real
    # records of real events. Rewriting them to 'staff' would make the trail
    # lie, so they go — the constraint being restored is the statement that
    # they should never have existed.
    op.execute("DELETE FROM ticket_events WHERE actor_kind = 'vendor'")
    op.drop_constraint("actor_kind", "ticket_events", type_="check")
    op.create_check_constraint("actor_kind", "ticket_events", _OLD)

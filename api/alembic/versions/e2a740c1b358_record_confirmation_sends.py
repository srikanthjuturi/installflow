"""Let the trail say whether the confirmation message actually went.

A ticket whose slot was agreed at intake recorded the booking and nothing at all
about the receipt we send the customer. `_send_slot_confirmed` called WhatsApp
and threw the result away, so when a customer said they had not heard from us
there was no record that we had even tried, let alone what Meta answered.

`slot_request_status` does not cover it, and cannot: that column tracks the
request to PICK a time, and reads `not_needed` on exactly the route that sends
this message.

`confirmation_sent` is deliberately separate from `slot_confirmed`. One is the
appointment, the other is the message about it — an appointment can be real
while the message never arrived, and that difference is the whole question when
somebody asks why the customer heard nothing.

CHECK-only change. Nothing is backfilled: whether the older tickets' messages
were sent is exactly what was not recorded, and inventing rows to say either way
would be worse than the gap.
"""

from alembic import op

revision = "e2a740c1b358"
down_revision = "c93f5d81a06b"
branch_labels = None
depends_on = None

_OLD = (
    "kind IN ('created', 'slot_requested', 'slot_confirmed', 'status_changed')"
)
_NEW = (
    "kind IN ('created', 'slot_requested', 'slot_confirmed', "
    "'confirmation_sent', 'status_changed')"
)


def upgrade() -> None:
    # Bare name on both sides — the naming convention adds `ck_<table>_`.
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _NEW)


def downgrade() -> None:
    # Rows of the new kind cannot satisfy the old CHECK, and they are real
    # records of real sends: drop them rather than fail, since the constraint
    # they violate is the statement that they should never have existed.
    op.execute("DELETE FROM ticket_events WHERE kind = 'confirmation_sent'")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", _OLD)

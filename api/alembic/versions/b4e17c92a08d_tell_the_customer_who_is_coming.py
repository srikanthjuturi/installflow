"""Tell the customer who is coming

The customer's last word from us is "your time is booked", which may be two
days old by the morning of the visit. The next thing that happens is a stranger
at the door introducing himself. Nothing in between says who is coming, and
nothing gives the customer a number to ring when the technician is twenty
minutes away in traffic — so that call goes to the vendor, or to nobody, and a
delay somebody could have absorbed becomes a complaint or a cancelled slot.

`sweep_slot_reminders` already solves the same moment from the technician's
side. This is its counterpart, pointed at the customer:

  * `company_rules.customer_notice_minutes` — how long before the slot the
    WhatsApp goes out. Its own rule rather than reusing `slot_reminder_minutes`,
    because "warn my technicians an hour ahead but my customers two" is a real
    policy a company may hold, and one column could not express it. Defaults to
    60, matching the technician's reminder, so a company that never opens Rules
    configuration gets the two messages at the same distance out.
  * `ticket_events.kind = 'customer_notified'` — what was sent, to whom, and
    what Meta said if it refused. "Did anybody tell the customer who was
    coming" is the first question after a complaint about a stranger at the
    door, and a WhatsApp receipt is not something this system keeps.

Both land in this one revision per hard rule 8 — a vocabulary declared ahead of
its rows is how `audit_logs` ended up a table nothing ever wrote to.

## The message needs a Meta template before it reaches anybody real

`WHATSAPP_TECHNICIAN_TEMPLATE_NAME` is empty until `technician_assigned` is
approved, and until then the send falls back to free-form text, which Meta only
delivers to someone who messaged the business in the last 24 hours. That is the
same state the other four customer-facing messages shipped in, and it is why
this migration is safe to run before the template exists: the sweep runs, the
event records the refusal, and nothing else changes.

## Backfilled to the default, not to nothing

Every existing company gets 60, because the column is NOT NULL and a rule with
no value is not a rule. Tickets whose slots are already inside that window when
this deploys will be notified on the next tick — a courtesy arriving slightly
late is not a failure, and suppressing it would need a marker that means
"before the feature existed", which is a column nobody would ever remove.

Revision ID: b4e17c92a08d
Revises: a1d8e34b90c7
Create Date: 2026-09-03 10:22:41.507318

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b4e17c92a08d"
down_revision: Union[str, Sequence[str], None] = "a1d8e34b90c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_EVENTS = (
    "'created', 'slot_requested', 'slot_confirmed', 'confirmation_sent', "
    "'status_changed', 'assigned', 'started', 'feedback_requested', "
    "'completed', 'feedback_received', 'reopened', 'serial_mismatch', "
    "'serial_corrected', 'reminded', 'escalated', 'bonus_added', 'released', "
    "'no_show', 'force_closed'"
)


def upgrade() -> None:
    # `server_default` is what backfills the existing rows — the column is NOT
    # NULL and every company already has a row. It stays on the column
    # afterwards, like every other rule here, so a hand-written INSERT during a
    # restore does not have to know all twelve numbers.
    op.add_column(
        "company_rules",
        sa.Column(
            "customer_notice_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("60"),
        ),
    )
    # The same bound the request schema and `core.rules.LIMITS` state. Three
    # declarations, one source, because each catches a different writer — this
    # one catches psql, a script, and a later migration.
    op.create_check_constraint(
        "customer_notice_minutes",
        "company_rules",
        "customer_notice_minutes >= 5 AND customer_notice_minutes <= 1440",
    )

    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint(
        "kind", "ticket_events", f"kind IN ({_EVENTS}, 'customer_notified')"
    )


def downgrade() -> None:
    # Rows of the new kind cannot satisfy the old CHECK, so they go — the same
    # trade-off every widening in this project has made. Nothing else depends
    # on them: this event records a courtesy message, not money and not a
    # status, so losing it costs the trail a line rather than leaving a balance
    # or a ticket unexplained.
    op.execute("DELETE FROM ticket_events WHERE kind = 'customer_notified'")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", f"kind IN ({_EVENTS})")

    # The short name, not `ck_company_rules_…`: `target_metadata` carries the
    # naming convention, so alembic expands it exactly as `create` did. This is
    # the same spelling every other CHECK drop in this directory uses.
    op.drop_constraint("customer_notice_minutes", "company_rules", type_="check")
    op.drop_column("company_rules", "customer_notice_minutes")

"""nobody turned up

Revision ID: f2b6a95d10c7
Revises: d7c418f0b93a
Create Date: 2026-09-01 11:24:17.903118

The `No-show` penalty band has been priced at ₹1,200 and editable on Rules
configuration since `company_rules` existed, and nothing could ever reach it.

That left the incentive pointing the wrong way. A technician who cancelled ten
minutes before a slot was charged ₹800; one who simply did not turn up and said
nothing was charged **nothing at all**. Silence was the cheapest option
available, which is the opposite of what the band was priced to discourage.

Two vocabularies widen so the band can be reached:

  * `notifications.kind = 'no_show'` — what the sweep raises when a slot closes
    with the job still `Assigned` and no proof against it. Its own kind rather
    than an `escalation`, because it asks a different question: an escalation
    asks "who can go?", this asks "was this really a no-show?".
  * `ticket_events.kind = 'no_show'` — what a MANAGER writes when they confirm
    it. The sweep never writes this and never charges: a dead phone and a
    deliberate no-show are indistinguishable from here, and ₹1,200 is too much
    to take on an inference.

Both writers land in this same change, per hard rule 8 — a vocabulary declared
ahead of its rows is how `audit_logs` ended up a table nothing ever wrote to.

## Nothing is backfilled

Slots that closed before this migration are not swept. The evidence for them is
as good as it is for any other, but charging somebody weeks later for a morning
nobody asked them about at the time is not a penalty, it is an ambush.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f2b6a95d10c7"
down_revision: Union[str, Sequence[str], None] = "d7c418f0b93a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_EVENTS = (
    "'created', 'slot_requested', 'slot_confirmed', 'confirmation_sent', "
    "'status_changed', 'assigned', 'started', 'feedback_requested', "
    "'completed', 'feedback_received', 'reopened', 'serial_mismatch', "
    "'serial_corrected', 'reminded', 'escalated', 'bonus_added', 'released'"
)
_NOTIFICATIONS = (
    "'escalation', 'ai', 'serial_mismatch', 'force_close', 'slot', "
    "'technician_joined', 'job_started', 'invite_expired'"
)


def upgrade() -> None:
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint(
        "kind", "ticket_events", f"kind IN ({_EVENTS}, 'no_show')"
    )
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint(
        "kind", "notifications", f"kind IN ({_NOTIFICATIONS}, 'no_show')"
    )


def downgrade() -> None:
    # Rows of the new kind cannot satisfy the old CHECKs, so they go — the same
    # trade-off every widening in this project has made.
    #
    # The LEDGER rows they justified are deliberately left alone. A penalty
    # that was charged really was charged; deleting the record of it during a
    # rollback would leave a technician's balance short with nothing to explain
    # it, which is worse than an entry whose event has gone.
    op.execute("DELETE FROM ticket_events WHERE kind = 'no_show'")
    op.execute("DELETE FROM notifications WHERE kind = 'no_show'")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", f"kind IN ({_EVENTS})")
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint(
        "kind", "notifications", f"kind IN ({_NOTIFICATIONS})"
    )

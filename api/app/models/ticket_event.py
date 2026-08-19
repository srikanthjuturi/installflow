"""What has happened to a ticket, in order. Append-only.

The ticket row says where it has got to. This says how it got there, and it is
the only place that can, because a status column keeps no history: overwrite
`status` and the previous value is gone, along with when it changed and who
changed it.

That absence blocks three things already specified:

  * the **daily job cap** counts jobs assigned to a technician ON A DATE, and no
    date existed;
  * the **cancellation fee** is banded by how long before the slot the
    cancellation came — ₹80 / ₹150 / ₹250 — which needs the moment it happened;
  * **"closed within SLA"** needs the moment it closed.

`_timeline()` used to derive its events from `status` alone. The mock version of
that invented "Notified 6 eligible technicians" for a ticket nothing had
notified, and a fabricated audit trail is worse than a thin one because people
believe it. Rows here are written when the thing actually happens, so the
timeline can only ever show what is true.

## Why `created_at` and not an `at` column

The event's `created_at` IS when it happened — there is no later moment at which
a past event could be inserted. A second timestamp would be two fields that must
agree and eventually would not.

It is not what the trail is SORTED by, though. See `seq`: a timestamp cannot
order two events written in the same transaction, because they share one.

Nothing here is ever updated or deleted, so `updated_at` / `updated_by` sit
unused. They are inherited anyway rather than hand-declared, because a table
that is *almost* like every other table but not quite is the kind of exception
people trip over later.
"""

import uuid

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

#: What kind of thing happened. Deliberately only what the code writes TODAY.
#: Assignment and release belong here too, and will be added by the migration
#: that adds the accept flow — declaring the vocabulary ahead of the rows is how
#: `audit_logs` ended up a table nothing ever wrote to.
EVENT_KINDS = (
    "created",
    "slot_requested",
    "slot_confirmed",
    #: The receipt we send the customer once a time is locked. Separate from
    #: `slot_confirmed`, which is the booking itself: the appointment can be
    #: real while the message about it never arrived, and that difference is
    #: exactly what somebody asking "why did my customer not hear from us"
    #: needs to see.
    "confirmation_sent",
    "status_changed",
)

#: Who caused it. `system` covers anything nobody chose — an SLA breach, a
#: timed-out slot request. `customer` has no account, which is exactly why
#: `created_by` cannot answer this on its own.
ACTOR_KINDS = ("staff", "technician", "customer", "system")


class TicketEvent(Base, IdMixin, AuditMixin):
    __tablename__ = "ticket_events"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: COMPOSITE FK — see __table_args__. CASCADE: the history of a deleted
    #: ticket has nothing left to describe.
    ticket_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    #: Insertion order, and the ONLY thing the timeline sorts by.
    #:
    #: `created_at` cannot do it. Postgres `now()` is the transaction's start
    #: time, not the statement's, so two events written in one transaction —
    #: which is exactly what creating a ticket with a slot does — carry the
    #: identical timestamp. Sorting then fell through to `id`, a random UUID,
    #: and the trail showed "Slot confirmed" above "Ticket created".
    #:
    #: An identity column is monotonic per table and assigned at INSERT, so the
    #: order is the order things happened, permanently.
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), nullable=False)

    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    #: Both null unless the event moved the ticket. `from_status` is null on the
    #: first event, because there was no previous state.
    from_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(24), nullable=True)

    actor_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    #: What to show as the actor. A name, not an id, because the customer has no
    #: user row and a technician's name at the time is what the trail should
    #: read — renaming somebody must not rewrite history.
    actor_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "kind IN ('created', 'slot_requested', 'slot_confirmed', "
            "'confirmation_sent', 'status_changed')",
            name="kind",
        ),
        CheckConstraint(
            "actor_kind IN ('staff', 'technician', 'customer', 'system')",
            name="actor_kind",
        ),
        # The timeline query: one ticket's events, oldest first. `seq` is in
        # the index so the sort comes off it rather than being done in memory.
        Index("ix_ticket_events_company_ticket", "company_id", "ticket_id", "seq"),
        Index("ix_ticket_events_company_created", "company_id", "created_at"),
        ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_ticket_events_company_ticket",
            ondelete="CASCADE",
        ),
    )

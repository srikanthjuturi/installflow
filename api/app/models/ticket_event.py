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
#: Release belongs here too and will be added by the migration that adds the
#: cancel flow — declaring the vocabulary ahead of the rows is how `audit_logs`
#: ended up a table nothing ever wrote to.
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
    #: A technician took the job out of the pool. The row the daily job cap is
    #: counted from — "jobs assigned to this technician on this DATE" is a
    #: question `tickets.status` cannot answer, because it keeps no history.
    "assigned",
    #: Proof landed and the technician is on the job. Written in the same
    #: transaction as the proof rows: work that started without evidence, or
    #: evidence for work that never started, are both states this refuses to
    #: record.
    "started",
    #: The technician says the work is done. Deliberately NOT the closure —
    #: only the customer closes a job here, and the gap between these two is
    #: the whole point of the feedback link.
    "feedback_requested",
    "completed",
    #: The customer answered. Carries their rating and words, and is written
    #: whichever way they answered — a refusal is as much a record as an
    #: approval, and the one more likely to be argued about later.
    "feedback_received",
    #: The customer said it was NOT done. The ticket goes back to a manager
    #: rather than to the technician who just said otherwise.
    "reopened",
    #: The serial read on site did not match the one on the order. Recorded
    #: rather than enforced: the technician has already done the work, and the
    #: likeliest cause is a slip at intake rather than the wrong unit.
    "serial_mismatch",
    #: Somebody corrected the expected serial — the vendor who holds the
    #: invoice, or a manager. Carries both values, because "what did it say
    #: before" is the question anybody auditing this will ask.
    "serial_corrected",
)

#: Who caused it. `system` covers anything nobody chose — an SLA breach, a
#: timed-out slot request. `customer` has no account, which is exactly why
#: `created_by` cannot answer this on its own; `vendor` is outside the company
#: entirely, and its label is the vendor's name rather than the person's, so a
#: sub-user leaving does not erase who the ticket is owed to.
ACTOR_KINDS = ("staff", "technician", "customer", "vendor", "system")


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
            "'confirmation_sent', 'status_changed', 'assigned', 'started', "
            "'feedback_requested', 'completed', 'feedback_received', "
            "'reopened', 'serial_mismatch', 'serial_corrected')",
            name="kind",
        ),
        CheckConstraint(
            "actor_kind IN ('staff', 'technician', 'customer', 'vendor', "
            "'system')",
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

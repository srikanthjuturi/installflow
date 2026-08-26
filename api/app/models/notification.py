"""Operational events worth interrupting somebody for.

Not a log. The console's own note puts it well — *a bell that rings for anything
else is a bell people stop reading* — so a row here is a WORK ITEM: something
happened that a named person has to look at, and `to` is the screen where they
deal with it.

## One row per event, not one per recipient

An escalation in a pincode concerns every manager whose territory covers it,
and that set changes when somebody's states are reassigned. Fanning out at
write time would freeze the audience at the moment the event happened and would
put territory logic inside every writer.

So the row is written once and scoped by `pincode`, and who may see it is
resolved at READ time by exactly the rule that scopes tickets
(`core.scope.visible_pincodes`). Read state, which genuinely is per person,
lives in `notification_reads`.

## Why `title` and `detail` are stored text

Everywhere else this codebase resolves names on read rather than storing them,
because a renamed vendor should not leave stale copies behind. A notification is
the exception on purpose: it is a record of what was true when somebody needed
to be told. "Serial mismatch on INST-240931 · 62% confidence" describes a
moment, and re-deriving it later from rows that have since changed would
rewrite history rather than preserve it.
"""

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Uuid,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

#: What kind of event this is. The console renders an icon per kind and the
#: dashboard counts them, so adding one means touching both — which is the
#: intended friction. A bell with fifteen categories is a bell nobody reads.
NOTIFICATION_KINDS = (
    #: Nobody accepted a job and the slot is close.
    "escalation",
    #: AI verification flagged the proof. Not written yet — the slice is
    #: deferred — but the console already renders it.
    "ai",
    #: The serial read on site is not the serial on the order.
    "serial_mismatch",
    #: A customer never confirmed, and somebody has to close it by hand.
    "force_close",
    #: The customer has gone quiet on a slot request.
    "slot",
)


class Notification(Base, IdMixin, AuditMixin):
    __tablename__ = "notifications"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)

    title: Mapped[str] = mapped_column(String(160), nullable=False)
    detail: Mapped[str] = mapped_column(String(255), nullable=False)
    #: Where the console goes to deal with it. A notification that leads nowhere
    #: is a note, and notes belong on the ticket.
    to: Mapped[str] = mapped_column(String(255), nullable=False)

    #: The ticket it is about, when there is one. Composite FK, CASCADE — a
    #: deleted ticket's notifications have nothing left to point at.
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    #: Territory key. NULL means the whole company sees it, which is right for
    #: anything not tied to a place.
    pincode: Mapped[str | None] = mapped_column(String(6), nullable=True)

    #: ADDITIONALLY visible to this vendor, on their own portal. Null for the
    #: staff-only events, which is most of them.
    #:
    #: It widens the audience, it does not replace it — the pincode rule above
    #: still decides which staff see the row. A serial mismatch is the case
    #: that needed it: the vendor holds the invoice, so they are usually the
    #: one who can actually settle it, and the console offers them the
    #: correction while nothing told them there was anything to correct.
    #:
    #: One row, two audiences, in keeping with the note at the top of this
    #: file: fanning out per recipient would freeze the staff audience at write
    #: time, which is the thing that design avoids.
    vendor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "kind IN ('escalation', 'ai', 'serial_mismatch', 'force_close', "
            "'slot')",
            name="kind",
        ),
        # The feed: one company's notifications, newest first.
        Index("ix_notifications_company_created", "company_id", "created_at"),
        ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_notifications_company_ticket",
            ondelete="CASCADE",
        ),
        # Composite, like every parent link here: a notification must not be
        # able to name another company's vendor. CASCADE — a removed vendor's
        # notifications have nobody left to read them.
        ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_notifications_company_vendor",
            ondelete="CASCADE",
        ),
        # The vendor portal's feed. Postgres makes no index for a foreign key.
        Index("ix_notifications_company_vendor", "company_id", "vendor_id"),
    )


class NotificationRead(Base, IdMixin, AuditMixin):
    """Who has read what.

    Its own table because read state is the one part of a notification that is
    genuinely per person: the same escalation is unread for one manager and
    dealt with by another. A `read` column on the notification would have to
    mean "somebody read it", which is not a question anybody asks.

    Absence means unread. There is no row until somebody reads it, so the table
    stays small and "mark all read" writes only what it must.
    """

    __tablename__ = "notification_reads"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    notification_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("notifications.id", ondelete="CASCADE"),
        nullable=False,
    )
    #: No FK: a user may be removed while the record of what they read stands.
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    read_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        # Reading twice is not two facts. The unique is what makes "mark all"
        # safely repeatable.
        UniqueConstraint("notification_id", "user_id", name="uq_notification_reads"),
        # "which of these have I read" — the only query this table serves.
        Index("ix_notification_reads_user", "company_id", "user_id"),
    )

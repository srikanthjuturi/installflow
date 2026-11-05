"""Where a technician is RIGHT NOW, while they hold an active job (Epic 4).

## Latest point only, and only while a job is live

One row per technician, overwritten on each report -- there is deliberately no
trail. A location history of a person is personal data nobody asked this product
to keep, and the ask was "see where they are on an active job", not "where they
have been". The row also names the ticket it was reported for, and every READ
joins back to that ticket: a point is shown only while the ticket is still held by
that technician in an active status. A job that ends (completed, cancelled,
released) therefore stops showing the technician at once, with no cleanup race;
`sweep_stale_locations` then deletes the leftovers so nothing lingers.

Foreground reporting only (decision, 2026-10-30): the app sends while it is open
on a job, so a stale `recorded_at` simply means the phone is not reporting, and
the console says so rather than pinning an old place as current.
"""

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import IdMixin


class TechnicianLocation(Base, IdMixin):
    __tablename__ = "technician_locations"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    technician_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    #: The job this point was reported for.
    ticket_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    #: Metres, as the phone's fix reported it; NULL when it did not say.
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: The phone's clock (clamped to not be in the future) and the server's.
    recorded_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    received_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("company_id", "technician_id", name="uq_technician_locations_technician"),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_technician_locations_technician",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_technician_locations_ticket",
            ondelete="CASCADE",
        ),
        # Inside India, the same box tickets and bases use.
        CheckConstraint(
            "latitude BETWEEN 6 AND 38 AND longitude BETWEEN 68 AND 98",
            name="inside_india",
        ),
        CheckConstraint("accuracy_m IS NULL OR accuracy_m >= 0", name="accuracy_m"),
        Index("ix_technician_locations_ticket", "company_id", "ticket_id"),
        Index("ix_technician_locations_received", "received_at"),
    )

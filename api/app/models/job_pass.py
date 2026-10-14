"""A technician's "not for me" on one job offer.

Until this table, Pass on the offer screen only went back a screen. Nothing was
recorded, so the job was in the technician's pool again on the next refresh and
"Pass" meant nothing at all. One row here is one technician declining one job,
and `pool_query` stops offering it to them.

## A pass is a no to THESE terms — so the terms are stored with it

`slot_start` and `bonus_paise` are the time and the bonus the job carried when
the technician passed. The pool hides the job only while the ticket still
carries exactly those two (`core.job_passes`). Change either and it is a
different offer, and it comes back by itself:

  * the customer picks a time for a job that had none, or the slot is moved —
    "not at 7 PM" is not "not at 11 AM";
  * a manager funds or changes an escalation bonus — money is what a bonus is
    there to change somebody's mind with, so hiding it from the very people
    who said no would defeat it.

Stored here rather than deleted from by those writers, because they live in
three other places (`confirm_slot`, `core.reschedule`, `add_bonus_and_renotify`)
and a rule that every future writer has to remember is a rule that drifts. The
payout is not stored: it is stamped at intake and never moves.

What does NOT bring a job back is the same offer being made again — a manager
re-funding the SAME bonus, or the job returning to the pool after whoever
accepted it cancelled. The technician has already answered that offer.

## Shape

One row per (company, ticket, technician); passing again updates it, so the
endpoint is idempotent and the row always holds the terms of the LATEST pass.
`created_at` is the first pass, `updated_at` the last.

Not soft-deleted and never deleted by the app: the row goes when its ticket or
technician is removed, which the CASCADEs do.
"""

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin


class JobPass(Base, IdMixin, AuditMixin):
    __tablename__ = "job_passes"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: Both FKs are COMPOSITE — see __table_args__ — so a pass can never name
    #: another company's ticket or technician.
    ticket_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    technician_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    #: The ticket's `slot_start` when it was passed. NULL is a real value: the
    #: job had no agreed time yet, and the customer picking one brings it back.
    slot_start: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: The ticket's `bonus_paise` when it was passed, NULL meaning none.
    bonus_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        # The same reading as `tickets.bonus_paise`, which this copies.
        CheckConstraint("bonus_paise IS NULL OR bonus_paise > 0", name="bonus_paise"),
        # One answer per technician per job — what makes passing twice an
        # update rather than a second row. TOTAL: the table is not soft-deleted.
        # It also covers the `(company_id, ticket_id)` FK and the `company_id`
        # FK as prefixes, and is exactly the probe `pool_query` makes.
        UniqueConstraint(
            "company_id",
            "ticket_id",
            "technician_id",
            name="uq_job_passes_ticket_technician",
        ),
        # Covers the technician FK, so removing a technician does not scan
        # every pass in the database to cascade.
        Index("ix_job_passes_company_technician", "company_id", "technician_id"),
        ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_job_passes_company_ticket",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_job_passes_company_technician",
            ondelete="CASCADE",
        ),
    )

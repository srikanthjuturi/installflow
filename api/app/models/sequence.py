"""Per-company counters for the human-facing codes: `INST-240912`, `TCH-4021`.

Both used to be `base + COUNT(*)`, which the docstrings admitted was racy and
settled "as a 409". That is survivable for one person typing a form and fails
completely for the next feature: a bulk upload computes the same COUNT for every
row in the batch, because none of them are committed yet, so every row after the
first collides with the one before it.

A counter row fixes both. `UPDATE … RETURNING` takes a row lock, so concurrent
creators serialise instead of guessing, and a batch claims a whole block in one
statement rather than N racing reads.

Not a Postgres SEQUENCE, for two reasons: sequences are not transactional (a
rolled-back ticket would still burn its number, leaving visible gaps in what ops
read out on the phone), and there would have to be one per company per kind,
created by DDL as companies are added.

`name` is the counter's kind — 'ticket' or 'technician'. Kept as a column rather
than a table per kind so a third code series costs a row, not a migration.
"""

import uuid

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin


class CompanySequence(Base, IdMixin, AuditMixin):
    __tablename__ = "company_sequences"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: 'ticket' | 'technician'. See `app.core.sequences.SEQUENCES`.
    name: Mapped[str] = mapped_column(String(32), nullable=False)
    #: The NEXT number to hand out — not the last one used.
    next_value: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        UniqueConstraint("company_id", "name", name="uq_company_sequence"),
    )

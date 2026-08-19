"""Reusable declarative mixins: UUID PK, audit columns, soft-delete.

Every business table gets `AuditMixin` (created_by / updated_by / created_at /
updated_at). `created_by` and `updated_by` reference `users.id` and are nullable
(system-seeded rows leave them NULL). Timestamps are timezone-aware.

## Why every column here is a `declared_attr`

So the six audit columns sort LAST in every table, after the columns that say
what the row actually is.

SQLAlchemy orders a table's columns by when each `Column` object was
constructed. A plain `mapped_column` on a mixin is built when THIS module is
imported — before any model class body has run — so it would sort ahead of every
real column, and `SELECT * FROM tickets` would open with six columns of
bookkeeping before reaching the customer.

`declared_attr` defers construction to when the mapped subclass is configured,
which happens after its own columns exist. Same columns, same behaviour, read in
the order somebody would actually ask for them.

This is the reason the whole schema was rebuilt into one migration; it is not
worth undoing to save four lines.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Uuid, func, text
from sqlalchemy.orm import Mapped, declared_attr, mapped_column


class IdMixin:
    """UUID primary key, generated DB-side by the native `gen_random_uuid()`."""

    @declared_attr
    def id(cls) -> Mapped[uuid.UUID]:
        return mapped_column(
            Uuid,
            primary_key=True,
            server_default=text("gen_random_uuid()"),
        )


class TimestampMixin:
    @declared_attr
    def created_at(cls) -> Mapped[datetime]:
        return mapped_column(
            DateTime(timezone=True), nullable=False, server_default=func.now()
        )

    @declared_attr
    def updated_at(cls) -> Mapped[datetime]:
        return mapped_column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            onupdate=func.now(),
        )


class ActorMixin:
    """Who created / last updated the row — the actor's user id.

    Intentionally NOT a DB foreign key: actors are never hard-deleted (users are
    soft-deleted), and keeping these as plain UUIDs avoids a users<->every-table
    FK cycle. Referential intent is enforced in the service layer.
    """

    @declared_attr
    def created_by(cls) -> Mapped[uuid.UUID | None]:
        return mapped_column(Uuid, nullable=True)

    @declared_attr
    def updated_by(cls) -> Mapped[uuid.UUID | None]:
        return mapped_column(Uuid, nullable=True)


class AuditMixin(TimestampMixin, ActorMixin):
    """created_at / updated_at / created_by / updated_by on one mixin."""


class SoftDeleteMixin:
    @declared_attr
    def deleted_at(cls) -> Mapped[datetime | None]:
        return mapped_column(DateTime(timezone=True), nullable=True)

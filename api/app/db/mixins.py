"""Reusable declarative mixins: UUID PK, audit columns, soft-delete.

Every business table gets `AuditMixin` (created_by / updated_by / created_at /
updated_at). `created_by` and `updated_by` reference `users.id` and are nullable
(system-seeded rows leave them NULL). Timestamps are timezone-aware.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column


class IdMixin:
    """UUID primary key, generated DB-side by the native `gen_random_uuid()`."""

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
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

    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)


class AuditMixin(TimestampMixin, ActorMixin):
    """created_at / updated_at / created_by / updated_by on one mixin."""


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

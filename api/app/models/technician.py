"""Technicians: invites, profiles, certifications and coverage.

A technician is a `User` with role `technician` + a `Membership` + one
`TechnicianProfile`. Not a standalone table, because every authorization
primitive already keys on `users.id` plus an active membership — the principal,
`require_feature`, refresh tokens and `created_by` all do. A separate table
would mean a second principal type and a second feature resolver.

`memberships.manager_id` therefore carries "which manager owns this technician"
for free, and it is tenant-safe by construction (composite FK to the same
company).

Two onboarding modes, and the pair of columns that tell them apart:

    onboarding_mode  invite | direct   — how the record came to exist
    registered_by    self   | manager  — who actually filled it in

`created_by` is the appointing manager in BOTH modes: the row exists on their
authority. Do not overload it to mean "who typed it".
"""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

# ── invite lifecycle ──────────────────────────────────────────────────────────
PENDING = "pending"
SENT = "sent"
FAILED = "failed"
REGISTERED = "registered"
CANCELLED = "cancelled"
EXPIRED = "expired"
#: The statuses that still occupy a phone number. Cancelled, expired and
#: already-registered numbers must all be re-invitable.
LIVE_INVITE_STATUSES = (PENDING, SENT, FAILED)

MODE_INVITE = "invite"
MODE_DIRECT = "direct"

REG_SELF = "self"
REG_MANAGER = "manager"

ACTIVE = "active"
INACTIVE = "inactive"
SUSPENDED = "suspended"


class TechnicianInvite(Base, IdMixin, AuditMixin):
    """A phone number that has been invited, and nothing else yet.

    `sent` means WhatsApp accepted the message, not that it arrived — knowing
    the difference needs a delivery webhook, which is a later phase.
    """

    __tablename__ = "technician_invites"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: E.164. The whole record until the invite is completed.
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    region_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("regions.id", ondelete="RESTRICT"), nullable=False
    )

    #: Who appointed them. The user id has no FK on purpose — the manager may
    #: later leave the company, and the historical fact must survive that.
    invited_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    invited_by_membership_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True
    )
    #: Who the technician reports to once registered. Defaults to the inviter.
    manager_membership_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True
    )
    #: Pre-set by the manager, applied at registration.
    daily_job_cap: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("5")
    )

    status: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Opaque, single-use, 14 days. Stored in clear (unlike a refresh token)
    #: because the console shows a copyable link and a resend must re-send the
    #: same one — both impossible against a hash-only column.
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    wa_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    wa_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    send_attempts: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("0")
    )

    registered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    registered_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    registered_membership_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_technician_invites_company_status", "company_id", "status"),
        Index("ix_technician_invites_region_id", "region_id"),
        # NB: the partial UNIQUE on (company_id, phone) for LIVE invites is
        # hand-written in the migration — SQLAlchemy cannot express a WHERE
        # clause in a table constraint.
    )


class TechnicianProfile(Base, IdMixin, AuditMixin):
    """Per-company technician facts. 1:1 with a membership.

    No SoftDeleteMixin: the membership already soft-deletes and every read
    joins it. One delete flag, one place.
    """

    __tablename__ = "technician_profiles"

    #: The FK is COMPOSITE, declared in __table_args__ — a profile in one
    #: company must not be able to point at another company's membership.
    membership_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: Display id, e.g. TCH-4021.
    code: Mapped[str] = mapped_column(String(24), nullable=False)
    region_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("regions.id", ondelete="RESTRICT"), nullable=False
    )

    daily_job_cap: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("5")
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'active'")
    )

    # ── the tracking the ops console has to be able to query ─────────────────
    onboarding_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    appointed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, nullable=True
    )
    appointed_by_membership_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True
    )
    appointed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    registered_by: Mapped[str] = mapped_column(String(16), nullable=False)
    registered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    invite_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("technician_invites.id", ondelete="SET NULL"), nullable=True
    )

    # ── stats: defaulted now, maintained by the jobs slice later ─────────────
    rating: Mapped[Decimal | None] = mapped_column(Numeric(3, 2), nullable=True)
    jobs_completed: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    jobs_cancelled: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    on_time_pct: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    __table_args__ = (
        UniqueConstraint("membership_id", name="uq_technician_profiles_membership"),
        UniqueConstraint("company_id", "code", name="uq_technician_profiles_company_code"),
        # What the coverage and certification tables' composite FKs point at, so
        # neither can reference a technician from another company.
        UniqueConstraint(
            "company_id", "id", name="uq_technician_profiles_company_id_id"
        ),
        ForeignKeyConstraint(
            ["company_id", "membership_id"],
            ["memberships.company_id", "memberships.id"],
            name="fk_technician_profiles_company_membership",
            ondelete="CASCADE",
        ),
        Index("ix_technician_profiles_company_status", "company_id", "status"),
        Index("ix_technician_profiles_region_id", "region_id"),
        Index("ix_technician_profiles_appointed_by", "appointed_by_user_id"),
        CheckConstraint(
            "daily_job_cap BETWEEN 1 AND 12",
            name="daily_job_cap",
        ),
        CheckConstraint(
            "onboarding_mode IN ('invite','direct')",
            name="onboarding_mode",
        ),
        CheckConstraint(
            "registered_by IN ('self','manager')",
            name="registered_by",
        ),
        CheckConstraint(
            "status IN ('active','inactive','suspended')",
            name="status",
        ),
    )


class TechnicianSubcategory(Base, IdMixin, AuditMixin):
    """What this technician is certified for — the level a job offer matches on.

    `company_id` is here so BOTH ends of the link can be checked by the
    database: a technician from company A being certified for company B's
    Television is impossible, not merely rejected by a service-layer check that
    a race or a future refactor could slip past.
    """

    __tablename__ = "technician_subcategories"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: Both FKs are COMPOSITE — see __table_args__.
    technician_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    subcategory_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "technician_id", "subcategory_id", name="uq_technician_subcategory"
        ),
        Index("ix_technician_subcategories_subcategory_id", "subcategory_id"),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_technician_subcategories_company_technician",
            ondelete="CASCADE",
        ),
        # RESTRICT: removing a subcategory somebody is certified for must be
        # refused with a message, not silently decertify them.
        ForeignKeyConstraint(
            ["company_id", "subcategory_id"],
            ["product_subcategories.company_id", "product_subcategories.id"],
            name="fk_technician_subcategories_company_subcategory",
            ondelete="RESTRICT",
        ),
    )


class TechnicianPincode(Base, IdMixin, AuditMixin):
    """Where this technician works.

    Deliberately NOT unique on (company_id, pincode) — that constraint exists on
    `membership_pincodes`, where it enforces "a pincode belongs to exactly one
    area manager". Technician coverage is the opposite: many technicians serve
    one pincode, and they share it with their ASM. Same datatype, opposite rule,
    hence a separate table rather than a reused one.

    `company_id` is denormalised so the routing lookup — "who covers 400067 in
    this company" — is a single index probe with no join.
    """

    __tablename__ = "technician_pincodes"

    #: The FK is COMPOSITE, declared in __table_args__ — see there.
    technician_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    pincode: Mapped[str] = mapped_column(String(6), nullable=False)

    __table_args__ = (
        UniqueConstraint("technician_id", "pincode", name="uq_technician_pincode"),
        Index("ix_technician_pincodes_company_pincode", "company_id", "pincode"),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_technician_pincodes_company_technician",
            ondelete="CASCADE",
        ),
    )

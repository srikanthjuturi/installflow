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
    Boolean,
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
    #: An optional cap the manager pre-set, applied at registration. NULL means
    #: no limit, which is what an invite carries unless somebody chose one.
    daily_job_cap: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

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
        # Target for the composite FK on `technician_invite_pincodes`.
        UniqueConstraint(
            "company_id", "id", name="uq_technician_invites_company_id_id"
        ),
        Index("ix_technician_invites_company_status", "company_id", "status"),
        Index("ix_technician_invites_region_id", "region_id"),
        # The four membership/user FKs. An invite names up to four people — who
        # sent it, who manages the result, and which membership and user it
        # became — and none of them could be deleted without a full scan here.
        Index("ix_technician_invites_invited_by", "invited_by_membership_id"),
        Index("ix_technician_invites_manager", "manager_membership_id"),
        Index("ix_technician_invites_registered_membership", "registered_membership_id"),
        Index("ix_technician_invites_registered_user", "registered_user_id"),
        # NB: the partial UNIQUE on (company_id, phone) for LIVE invites is
        # hand-written in the migration — SQLAlchemy cannot express a WHERE
        # clause in a table constraint.
    )


class TechnicianInvitePincode(Base, IdMixin, AuditMixin):
    """The coverage a manager assigned when sending the invite.

    Coverage is decided by the manager, not by the person joining: they know
    the area and the workload, and a technician picking their own from a phone
    could claim a district nobody meant to give them. The app shows this list
    and does not offer to change it.

    Copied onto `technician_pincodes` at registration, so the profile keeps its
    own coverage and a later edit to one does not silently rewrite history on
    the other.
    """

    __tablename__ = "technician_invite_pincodes"

    invite_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    pincode: Mapped[str] = mapped_column(String(6), nullable=False)

    __table_args__ = (
        UniqueConstraint("invite_id", "pincode", name="uq_invite_pincode"),
        # Composite, so a row can never name one company's invite while
        # claiming another's company_id.
        ForeignKeyConstraint(
            ["company_id", "invite_id"],
            ["technician_invites.company_id", "technician_invites.id"],
            name="fk_invite_pincodes_company_invite",
            ondelete="CASCADE",
        ),
        Index("ix_technician_invite_pincodes_invite", "invite_id"),
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

    #: Jobs per day this technician will accept. **NULL means no limit** — a
    #: different claim from any number, and the default for somebody nobody has
    #: capped. The technician sets their own in the app; a manager may change
    #: it afterwards.
    daily_job_cap: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'active'")
    )

    # ── availability: two facts, deliberately not one ─────────────────────────
    #
    # "Is this technician online" is a question with two independent halves, and
    # collapsing them into one boolean is what makes availability data rot:
    #
    #   accepting_work  what the technician CHOSE. Survives a restart, a dead
    #                   battery and a new phone, because it is a decision, not
    #                   a symptom. Only they change it.
    #   last_seen_at    whether a device is actually REACHABLE. Stamped by the
    #                   live pool socket and by nothing else.
    #
    # Online is the AND of the two, and it is derived at read time rather than
    # stored (`app.core.presence.is_online`). A stored flag is the thing that
    # goes wrong: a phone that dies mid-shift can never write "offline", so the
    # row claims the technician is available until somebody notices in person.
    # A timestamp cannot lie that way — it just stops moving, and every reader
    # can see that it has.
    #
    # Defaults to True: it is what the app has always done, and a technician
    # who has just onboarded wants work. Going offline is the deliberate act.
    accepting_work: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    #: NULL means never connected — a technician who has not opened the app
    #: since this shipped. Distinct from "connected long ago", which is a time.
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
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

    #: Where this technician's money goes — a UPI VPA, `name@handle`.
    #:
    #: Here rather than on `users` because it is a per-COMPANY payment fact: one
    #: person may work for two companies and be paid by each into a different
    #: account. It is also what `ledger_entries.technician_id` already points at,
    #: so the money and the destination hang off the same row.
    #:
    #: Nullable, and null is a real state rather than an oversight: neither
    #: onboarding mode asks for it up front, a manager may not know it, and a
    #: technician can add it themselves later on Profile → Payout account. What
    #: null costs is only the ability to redeem — never the ability to earn, so
    #: the ledger keeps crediting a technician who has not filled this in.
    #:
    #: NOT unique. A shared family VPA is somebody else's policy question, and a
    #: unique index here would refuse a legitimate second technician with no
    #: screen able to explain why.
    upi_id: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # ── stats: NULL until the jobs slice measures them ───────────────────────
    #
    # All four nullable, and null means "not measured yet" — not zero. They
    # defaulted to 0 until it was noticed that nothing anywhere writes them, so
    # every technician's profile asserted a completed-job count of exactly zero
    # that had never been counted. "Do not fake a number that has a real
    # source" applies hardest when the source does not exist yet: 0 is a claim,
    # `—` is the truth.
    #
    # `rating` and `on_time_pct` were already nullable and already rendered as
    # `—`; these two now match them.
    rating: Mapped[Decimal | None] = mapped_column(Numeric(3, 2), nullable=True)
    jobs_completed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    jobs_cancelled: Mapped[int | None] = mapped_column(Integer, nullable=True)
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
        # The remaining FKs. NB `appointed_by_membership_id` is a different
        # column from `appointed_by_user_id` indexed above — the index that
        # already existed covered the user, not the membership.
        Index("ix_technician_profiles_company_membership", "company_id", "membership_id"),
        Index("ix_technician_profiles_appointed_by_membership", "appointed_by_membership_id"),
        Index("ix_technician_profiles_invite_id", "invite_id"),
        # No ceiling: twelve was a guess, and a technician may take as many
        # jobs a day as they are willing to. A floor still applies, because a
        # cap of zero means "never offer this person work" — which is what
        # `status` says, and should not be reachable by typing a number.
        CheckConstraint(
            "daily_job_cap IS NULL OR daily_job_cap >= 1",
            name="daily_job_cap",
        ),
        # A backstop, not the validator. The real VPA shape is enforced in
        # `schemas.py`, where it can name the field and say what is wrong; this
        # only rules out the shapes that are obviously not an address at all, so
        # an importer that bypasses the request layer cannot store a bare name.
        CheckConstraint(
            "upi_id IS NULL OR (position('@' in upi_id) > 1 "
            "AND upi_id !~ '\\s' AND length(upi_id) >= 3)",
            name="upi_id",
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
        # One per composite FK. The RESTRICT below is checked on every attempt
        # to delete a subcategory, so it wants an index it can actually use.
        Index(
            "ix_technician_subcategories_company_technician",
            "company_id",
            "technician_id",
        ),
        Index(
            "ix_technician_subcategories_company_subcategory",
            "company_id",
            "subcategory_id",
        ),
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
        # Covers the composite FK, so removing a technician does not scan every
        # coverage row in the database to cascade.
        Index(
            "ix_technician_pincodes_company_technician", "company_id", "technician_id"
        ),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_technician_pincodes_company_technician",
            ondelete="CASCADE",
        ),
    )

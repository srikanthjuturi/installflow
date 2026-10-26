"""Franchisees — who runs a company's technicians, and the pincodes each one owns.

Every company has ONE home franchisee (internal, created with the company, never deleted or made
external) and any number of others. The home owns every pincode no other franchisee owns, which is why it
holds no `franchisee_pincodes` rows: "everything else" is not a list anybody should have to keep in step
with a 19,496-row master. See 00-index.md F1–F4.
"""

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin, SoftDeleteMixin

KIND_INTERNAL = "internal"
KIND_EXTERNAL = "external"
KINDS = (KIND_INTERNAL, KIND_EXTERNAL)

#: The home franchisee's code. One per company, so unique per company by construction, and it reserves
#: the string: Task 03 can never mint HOME for another franchisee (uq_franchisees_company_code says so).
HOME_CODE = "HOME"

MAX_NAME = 255  # companies.name is 255, so the home's copy of it never truncates
MAX_CODE = 8


class Franchisee(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "franchisees"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(MAX_NAME), nullable=False)
    #: Stamped once, never recomputed — the `companies.code` rule (core/company_code.py).
    code: Mapped[str] = mapped_column(String(MAX_CODE), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    is_home: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)  # E.164 (core/phone.py)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))

    __table_args__ = (
        CheckConstraint("kind IN ('internal', 'external')", name="kind"),
        CheckConstraint("code ~ '^[A-Z0-9]{2,8}$'", name="code"),
        # F1: the home is internal …
        CheckConstraint("NOT is_home OR kind = 'internal'", name="home_is_internal"),
        # … and can be neither switched off nor removed. The backstop for FRANCHISEE_HOME_IMMUTABLE.
        CheckConstraint("NOT is_home OR (is_active AND deleted_at IS NULL)", name="home_is_permanent"),
        # FK target for every composite (company_id, franchisee_id). TOTAL — a partial index cannot be one.
        UniqueConstraint("company_id", "id", name="uq_franchisees_company_id_id"),
        Index(
            "uq_franchisees_one_home",
            "company_id",
            unique=True,
            postgresql_where=text("is_home AND deleted_at IS NULL"),
        ),
        # Partial: a removed franchisee frees its code (api/AGENTS.md hard rule 6).
        Index(
            "uq_franchisees_company_code",
            "company_id",
            "code",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # NB uq_franchisees_company_name_lower ON (company_id, lower(name)) WHERE deleted_at IS NULL is
        # hand-written in 3b7e1f0a9c41 — Index() cannot say lower() with a WHERE, and autogenerate will keep
        # offering to drop it. Delete that drop.
    )


class FranchiseePincode(Base, IdMixin, AuditMixin):
    """One pincode a NON-home franchisee owns. Never holds rows for the home (F4).

    No SoftDeleteMixin: removing a code from a franchisee hands it back to the home, and the honest
    record of that is the row going away (Task 03 writes the event). The UNIQUE is therefore TOTAL.
    Invariant Task 03 must keep: a soft-deleted franchisee holds NO rows here (deleted in the same
    transaction), so nothing reading this table has to join `franchisees.deleted_at`.
    """

    __tablename__ = "franchisee_pincodes"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)  # COMPOSITE FK below
    #: RESTRICT: a pincode is switched off, never deleted (api/AGENTS.md, Geography).
    pincode: Mapped[str] = mapped_column(
        String(6), ForeignKey("pincodes.code", ondelete="RESTRICT"), nullable=False
    )

    __table_args__ = (
        # F3, no overlap: one owner per pincode per company. Spelled in full — `uq` takes the name verbatim.
        UniqueConstraint("company_id", "pincode", name="uq_franchisee_pincodes_company_pincode"),
        ForeignKeyConstraint(
            ["company_id", "franchisee_id"],
            ["franchisees.company_id", "franchisees.id"],
            name="fk_franchisee_pincodes_company_franchisee",
            ondelete="CASCADE",
        ),
        # Covers the composite FK, and is "the codes this franchisee owns".
        Index("ix_franchisee_pincodes_company_franchisee", "company_id", "franchisee_id"),
        # Covers the pincodes FK (the UNIQUE above leads with company_id, so it does not).
        Index("ix_franchisee_pincodes_pincode", "pincode"),
    )


class FranchiseeTravelRule(Base, IdMixin, AuditMixin):
    """What one franchisee pays one technician type for travel (TA3).

    Exactly two rows per franchisee — freelancer and employee — stamped at
    creation from the defaults in `core.travel.TRAVEL_DEFAULTS` (TA4) and edited
    on the franchise portal's Travel settings. No soft delete: the rows live and
    die with the franchisee. Read ONCE per job, at accept, into
    `tickets.accept_snapshot.travel`; nothing downstream joins this table.

    The CHECK bounds copy `core.travel.TRAVEL_LIMITS` as literals —
    `models/company_rules.py` ↔ `core.rules.LIMITS`'s shape, so the CHECKs, the
    pydantic bounds and the tests read one table. Rate or cap of 0 means OFF
    (TA4), and a rate above 0 with a ₹0 cap is refused by the request layer (W2).
    """

    __tablename__ = "franchisee_travel_rules"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)  # COMPOSITE FK below
    technician_type: Mapped[str] = mapped_column(String(16), nullable=False)
    free_km: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    step_km: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    paise_per_step: Mapped[int] = mapped_column(Integer, nullable=False)
    road_factor_pct: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    max_paise_per_job: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["company_id", "franchisee_id"],
            ["franchisees.company_id", "franchisees.id"],
            name="fk_franchisee_travel_rules_company_franchisee",
            ondelete="CASCADE",
        ),
        # The no-duplicate rule AND the covering index for the FK above (W14).
        UniqueConstraint(
            "company_id", "franchisee_id", "technician_type",
            name="uq_franchisee_travel_rules_company_franchisee_type",
        ),
        # Bare names — the convention prefixes `ck_franchisee_travel_rules_`.
        CheckConstraint("technician_type IN ('employee', 'freelancer')", name="technician_type"),
        CheckConstraint("free_km BETWEEN 0 AND 500", name="free_km"),
        CheckConstraint("step_km BETWEEN 1 AND 50", name="step_km"),
        CheckConstraint("paise_per_step BETWEEN 0 AND 1000000", name="paise_per_step"),
        CheckConstraint("road_factor_pct BETWEEN 100 AND 300", name="road_factor_pct"),
        CheckConstraint("max_paise_per_job BETWEEN 0 AND 10000000", name="max_paise_per_job"),
    )

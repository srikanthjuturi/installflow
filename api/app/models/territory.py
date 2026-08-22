"""Territory: India -> regions -> states -> districts -> pincodes.

Everything above `membership_*` is GLOBAL reference data (geography, not tenant
data) -- the same India for every company, exactly as `regions` has always been.
It is loaded once by a superadmin from a spreadsheet; see `features/geo/`.

    Region      5 seeded rows. North / South / East / West / Central.
    State       one region each. 36 in the loaded data.
    District    one state each. Names REPEAT across states, so a district is
                identified by (state, name) and never by name alone.
    Pincode     one state each. Keyed by the 6-digit code itself, not a UUID.
    PincodeDistrict   many-to-many: 1,209 real pincodes span up to 4 districts,
                so a `district_id` column on `pincodes` would have to lie.

A member's territory is expressed by the join tables:

    national_head  -> no rows at all (all-India is the absence of a restriction)
    regional_head  -> one or more `membership_regions`
    area_manager   -> one or more `membership_states`, and the regions those
                      states belong to, written to `membership_regions` in the
                      same transaction so every region-based query still works

An area manager covers EVERY pincode in his states. That coverage is derived at
query time from `pincodes`, never materialised: one state can hold ~1,900 codes,
and the scope of a page of twenty members would be tens of thousands of strings.

Scope rows are the CURRENT assignment, not history, so they are hard-deleted
when a membership is removed -- which frees the state for the next manager.
"""

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin


class Region(Base, IdMixin, AuditMixin):
    """One of the five parts of India. Seeded; not company-scoped."""

    __tablename__ = "regions"

    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )


class State(Base, IdMixin, AuditMixin):
    """A state or union territory, inside exactly one region.

    NB: the unique on `lower(name)` is created in the migration with
    `op.execute` -- `Index()` cannot express a function, so autogenerate will
    later offer to drop it. That drop is a false positive; delete it.
    """

    __tablename__ = "states"

    region_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("regions.id", ondelete="RESTRICT"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        # Covers the FK, so deleting a region does not scan every state.
        Index("ix_states_region_id", "region_id"),
    )


class District(Base, IdMixin, AuditMixin):
    """A district inside one state.

    Identified by (state, name), NOT by name: five district names in the real
    data belong to two different states each -- AURANGABAD is in Maharashtra
    and in Bihar, and BILASPUR, BALRAMPUR, HAMIRPUR and PRATAPGARH likewise.
    A unique on the name alone would silently merge them.

    Nothing assigns work by district today; it is here because the source data
    carries it and a pincode picker reads it ("500001 - Hyderabad"). The
    importer writes it in the same change, so it is not a table nothing fills.
    """

    __tablename__ = "districts"

    state_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("states.id", ondelete="RESTRICT"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(96), nullable=False)

    __table_args__ = (
        # UNIQUE (state_id, lower(name)) is in the migration -- see State.
        Index("ix_districts_state_id", "state_id"),
    )


class Pincode(Base, AuditMixin):
    """A 6-digit postal code, in exactly one state.

    **The code is the primary key**, deliberately breaking the `IdMixin` habit
    of the rest of the schema. `tickets.pincode`, `technician_pincodes.pincode`
    and `membership_pincodes.pincode` all already store the six characters, and
    a ticket arrives carrying a pincode string and nothing else. A UUID key
    would put a join through a unique index in front of every one of those
    lookups and buy nothing: the code is stable, unique and already the
    identifier everyone uses.

    An Indian pincode never begins with 0, which is what the CHECK below says --
    it also catches the case where a spreadsheet cell arrived as the number
    12345 and was padded back to "012345".
    """

    __tablename__ = "pincodes"

    code: Mapped[str] = mapped_column(String(6), primary_key=True)
    state_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("states.id", ondelete="RESTRICT"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        # The naming convention adds the ck_pincodes_ prefix; passing it here
        # too produced names like ck_tickets_ck_tickets_status once already.
        CheckConstraint("code ~ '^[1-9][0-9]{5}$'", name="format"),
        Index("ix_pincodes_state_id", "state_id"),
    )


class PincodeDistrict(Base, AuditMixin):
    """Which districts a pincode falls in. Many-to-many, because it is.

    Of the 19,490 real pincodes: 18,277 sit in one district, 1,142 in two, 58 in
    three and 9 in four -- so 1,209 span more than one. The widest are 192124
    (Anantnag, Kulgam, Pulwama, Shopian) and 853204 (Bhagalpur, Katihar,
    Madhepura, Purnia). Storing a single `district_id` on `pincodes` would have
    to pick one and quietly discard the rest, so this is a join table rather
    than a column.

    Four pincodes have no row here at all -- 222101, 390008, 605012 and 804454.
    They are real and they have a state; the source simply never named a
    district for them. Anything that walks state -> district -> pincode has to
    account for them or they silently disappear.
    """

    __tablename__ = "pincode_districts"

    pincode_code: Mapped[str] = mapped_column(
        String(6),
        ForeignKey("pincodes.code", ondelete="CASCADE"),
        primary_key=True,
    )
    district_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("districts.id", ondelete="CASCADE"), primary_key=True
    )

    __table_args__ = (
        # The PK covers the pincode_code FK (leading column); the other needs
        # its own, or deleting a district scans the whole table.
        Index("ix_pincode_districts_district_id", "district_id"),
    )


class MembershipRegion(Base, IdMixin, AuditMixin):
    """A region this member covers.

    Chosen directly for a regional head. For an area manager it is DERIVED from
    his states and written by `_set_scope` in the same transaction, so nothing
    that already reads regions has to learn about states.
    """

    __tablename__ = "membership_regions"

    membership_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("memberships.id", ondelete="CASCADE"), nullable=False
    )
    region_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("regions.id", ondelete="CASCADE"), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("membership_id", "region_id", name="uq_membership_region"),
        Index("ix_membership_regions_region_id", "region_id"),
    )


class MembershipState(Base, IdMixin, AuditMixin):
    """A state an area manager covers -- and with it every pincode inside.

    `company_id` is denormalised from the membership for two reasons. The
    UNIQUE below is the first: it is what actually enforces "a state belongs to
    one area manager", which an application check alone would lose under
    concurrent writes. The second is the composite foreign key, which
    `membership_pincodes` never had -- with a plain `membership_id` FK a row
    could name company A while pointing at a membership in company B, and only
    the service layer would object.
    """

    __tablename__ = "membership_states"

    membership_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    state_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("states.id", ondelete="CASCADE"), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("company_id", "state_id", name="uq_company_state"),
        ForeignKeyConstraint(
            ["company_id", "membership_id"],
            ["memberships.company_id", "memberships.id"],
            name="fk_membership_states_company_membership",
            ondelete="CASCADE",
        ),
        Index("ix_membership_states_membership_id", "membership_id"),
        Index("ix_membership_states_state_id", "state_id"),
    )


# `membership_pincodes` used to live here: an area manager's territory as a
# hand-typed list of six-character strings, with no catalogue to check it
# against. It was dropped in `c71d3fa8e520` once `MembershipState` replaced it —
# an area manager is now given whole states and covers every pincode inside
# them, so the list was both redundant and a second place for coverage to
# disagree with itself.

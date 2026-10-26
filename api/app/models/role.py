"""Global role lookup — 11 fixed roles ordered by `rank` (0=highest privilege).

Three families live in this one table, and telling them apart matters:

  * **Staff** run the company — superadmin down to area_manager — plus the
    technician who does the work.
  * **Vendors** are outside the company. They raise the tickets and manage their
    own people, and see nothing else.
  * **Franchise** act FOR one franchisee: its admin, who owns the franchisee's
    technicians and money, and its facility staff, who work its spare-parts desk.

A vendor sits BELOW every staff role rather than beside them, because `rank` is
used for exactly one question — "may I manage this person?" — and the answer for
a vendor is no, in both directions. See `VENDOR_ROLES` below for the guard that
`rank` cannot express. The franchise roles rank below everyone too, for the same
reason in the other direction: every existing `require_min_rank(...)` floor on a
staff-only screen refuses a franchise role automatically (fails closed). See
`FRANCHISE_ROLES` below.
"""

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin

# Canonical role keys (used across the app, tokens, and seeds).
SUPERADMIN = "superadmin"
ADMIN = "admin"
NATIONAL_HEAD = "national_head"
REGIONAL_HEAD = "regional_head"
AREA_MANAGER = "area_manager"
TECHNICIAN = "technician"
#: Signs in to the portal. Raises tickets against itself and manages its own
#: users; sees every ticket its users raised.
VENDOR = "vendor"
#: Created BY a vendor. Raises tickets the same way, but sees only its own.
VENDOR_USER = "vendor_user"

FRANCHISEE_ADMIN = "franchisee_admin"
FACILITY_ADMIN = "facility_admin"
FACILITY_OPERATOR = "facility_operator"

# rank: lower = more privilege. "below me" == rank > my_rank.
#
# Appending 6 and 7 is deliberate: `roles.rank` is UNIQUE, so slotting a vendor
# between existing roles would mean renumbering rows that other tables reference
# by key anyway. And a vendor genuinely is below everyone — no staff role should
# be manageable by one.
#
# 8–10 (the franchise roles) append below everyone for the same reason, and with
# the bonus property: every existing `require_min_rank(...)` floor — credits,
# settings, vendors, vendor credit, redemption pay, force close, reschedule —
# refuses a franchise role automatically, because its rank is above the floor.
# Fails closed, which is what a staff-only screen wants until Task 04/05 open
# the franchise doors deliberately. Authority over TECHNICIANS is a different
# question and rank is never the answer to it: see `FRANCHISE_ROLES` and
# `core.franchise_scope.can_manage_technician`.
ROLE_RANKS: dict[str, int] = {
    SUPERADMIN: 0,
    ADMIN: 1,
    NATIONAL_HEAD: 2,
    REGIONAL_HEAD: 3,
    AREA_MANAGER: 4,
    TECHNICIAN: 5,
    VENDOR: 6,
    VENDOR_USER: 7,
    FRANCHISEE_ADMIN: 8,
    FACILITY_ADMIN: 9,
    FACILITY_OPERATOR: 10,
}

ROLE_LABELS: dict[str, str] = {
    SUPERADMIN: "Super Admin",
    ADMIN: "Admin",
    NATIONAL_HEAD: "National Head",
    REGIONAL_HEAD: "Regional Head",
    AREA_MANAGER: "Area Manager",
    TECHNICIAN: "Technician",
    VENDOR: "Vendor",
    VENDOR_USER: "Vendor User",
    FRANCHISEE_ADMIN: "Franchisee Admin",
    FACILITY_ADMIN: "Facility Admin",
    FACILITY_OPERATOR: "Facility Operator",
}

#: The two roles that act FOR a vendor rather than for the company.
#:
#: Rank cannot express this. Rank answers "who outranks whom", and a vendor is
#: below every staff role — which correctly stops a vendor managing staff, and
#: just as correctly does NOT stop an Area Manager managing a vendor. Anywhere
#: that distinction matters, test membership of this set, not the number.
VENDOR_ROLES = frozenset({VENDOR, VENDOR_USER})

#: The three roles that act FOR a franchisee rather than for the company — like
#: `VENDOR_ROLES`, a set because rank cannot say "this family and no other":
#: franchisee admin (8) sits below every staff role, so a rank floor is silent
#: about it and an Area Manager "outranks" it. Test membership, never the number.
#: Authority over technicians/money is per franchisee, decided in
#: `core.franchise_scope` — never by rank.
FRANCHISE_ROLES = frozenset({FRANCHISEE_ADMIN, FACILITY_ADMIN, FACILITY_OPERATOR})

#: Franchisee staff who work the spare-parts desk (F7): parts and, read-only,
#: tickets — not technicians or money. `FRANCHISE_ROLES` covers everyone who
#: works FOR a franchisee; the franchisee admin may do all these can, but is not
#: one of them, so a guard that means "anyone who works parts" tests
#: `FRANCHISE_ROLES` and one that means "the parts desk itself" tests this.
FACILITY_ROLES = frozenset({FACILITY_ADMIN, FACILITY_OPERATOR})

# Roles that do NOT carry a profile image. A vendor is a company, not a person;
# the portal shows the company name, so there is no avatar to fill. The
# franchise roles stay out deliberately: one login per PERSON, like an Area
# Manager, so they keep an avatar.
ROLES_WITHOUT_PROFILE_IMAGE = frozenset({SUPERADMIN, ADMIN, VENDOR, VENDOR_USER})


class Role(Base, AuditMixin):
    __tablename__ = "roles"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)

"""Global role lookup — 8 fixed roles ordered by `rank` (0=highest privilege).

Two families live in this one table, and telling them apart matters:

  * **Staff** run the company — superadmin down to area_manager — plus the
    technician who does the work.
  * **Vendors** are outside the company. They raise the tickets and manage their
    own people, and see nothing else.

A vendor sits BELOW every staff role rather than beside them, because `rank` is
used for exactly one question — "may I manage this person?" — and the answer for
a vendor is no, in both directions. See `VENDOR_ROLES` below for the guard that
`rank` cannot express.
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

# rank: lower = more privilege. "below me" == rank > my_rank.
#
# Appending 6 and 7 is deliberate: `roles.rank` is UNIQUE, so slotting a vendor
# between existing roles would mean renumbering rows that other tables reference
# by key anyway. And a vendor genuinely is below everyone — no staff role should
# be manageable by one.
ROLE_RANKS: dict[str, int] = {
    SUPERADMIN: 0,
    ADMIN: 1,
    NATIONAL_HEAD: 2,
    REGIONAL_HEAD: 3,
    AREA_MANAGER: 4,
    TECHNICIAN: 5,
    VENDOR: 6,
    VENDOR_USER: 7,
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
}

#: The two roles that act FOR a vendor rather than for the company.
#:
#: Rank cannot express this. Rank answers "who outranks whom", and a vendor is
#: below every staff role — which correctly stops a vendor managing staff, and
#: just as correctly does NOT stop an Area Manager managing a vendor. Anywhere
#: that distinction matters, test membership of this set, not the number.
VENDOR_ROLES = frozenset({VENDOR, VENDOR_USER})

# Roles that do NOT carry a profile image. A vendor is a company, not a person;
# the portal shows the company name, so there is no avatar to fill.
ROLES_WITHOUT_PROFILE_IMAGE = frozenset({SUPERADMIN, ADMIN, VENDOR, VENDOR_USER})


class Role(Base, AuditMixin):
    __tablename__ = "roles"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)

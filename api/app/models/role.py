"""Global role lookup — 6 fixed roles ordered by `rank` (0=highest privilege)."""

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

# rank: lower = more privilege. "below me" == rank > my_rank.
ROLE_RANKS: dict[str, int] = {
    SUPERADMIN: 0,
    ADMIN: 1,
    NATIONAL_HEAD: 2,
    REGIONAL_HEAD: 3,
    AREA_MANAGER: 4,
    TECHNICIAN: 5,
}

ROLE_LABELS: dict[str, str] = {
    SUPERADMIN: "Super Admin",
    ADMIN: "Admin",
    NATIONAL_HEAD: "National Head",
    REGIONAL_HEAD: "Regional Head",
    AREA_MANAGER: "Area Manager",
    TECHNICIAN: "Technician",
}

# Roles that do NOT carry a profile image.
ROLES_WITHOUT_PROFILE_IMAGE = frozenset({SUPERADMIN, ADMIN})


class Role(Base, AuditMixin):
    __tablename__ = "roles"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)

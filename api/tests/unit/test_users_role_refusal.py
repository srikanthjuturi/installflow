"""Task 02 §6 case 14 — why `/users` cannot create a role, said in one place.

Pure: `role_not_creatable_here` decides from the role key alone.
"""

from app.features.users.service import role_not_creatable_here
from app.models.role import (
    ADMIN,
    AREA_MANAGER,
    FACILITY_ADMIN,
    FACILITY_OPERATOR,
    FRANCHISEE_ADMIN,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
    SUPERADMIN,
    TECHNICIAN,
    VENDOR,
    VENDOR_USER,
)


def test_invalid_roles() -> None:
    assert role_not_creatable_here(SUPERADMIN) == "Invalid role"
    assert role_not_creatable_here("nope") == "Invalid role"


def test_technician_message_unchanged() -> None:
    assert (
        role_not_creatable_here(TECHNICIAN)
        == "Onboard technicians from the Technicians screen"
    )


def test_vendor_messages_unchanged() -> None:
    assert (
        role_not_creatable_here(VENDOR)
        == "Vendor accounts are created with the vendor, on the Vendors screen"
    )
    assert (
        role_not_creatable_here(VENDOR_USER)
        == "Vendor accounts are created with the vendor, on the Vendors screen"
    )


def test_franchise_message_is_one_for_all_three() -> None:
    franchise_message = "Franchise accounts are created on the Franchisees screen"
    for role in (FRANCHISEE_ADMIN, FACILITY_ADMIN, FACILITY_OPERATOR):
        assert role_not_creatable_here(role) == franchise_message


def test_staff_roles_are_creatable_here() -> None:
    for role in (ADMIN, NATIONAL_HEAD, REGIONAL_HEAD, AREA_MANAGER):
        assert role_not_creatable_here(role) is None
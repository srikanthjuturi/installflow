"""F7/F8 in one place — which franchisees' technicians and money this role reaches.

F7 splits the duties: the franchisee's OWN admin owns its technicians and money
and nobody outside the company reaches them; the facility staff work spare parts,
not people. F8 is the home proxy: company staff keep today's powers over the HOME
franchisee exactly as they have always had, and the home's own franchisee admin
holds them alongside — a non-home franchisee is out of reach except where F8
deliberately reads wider (an Admin/NH reversing a penalty anywhere, any staff
reading).

Core, not a slice, because technicians, redemptions, the pool and penalty
reversal all ask this question (api hard rule 4 — slices never import each
other), and a second copy of an authority rule is the copy that drifts. Task 02
only DEFINES these; wiring them into the endpoints is Task 05. When it does, a
refusal for a technician the caller can *see* is 403; one they cannot see is 404
via the company-scoped loader — this module never replaces `technician_scope`,
`_load` or an AM floor, it is ANDed with them.

`decide_managed_franchisees` and `decide_can_manage` are pure and unit-testable
with no database, importing only models — the `core/scope.py` pattern. `Principal`
is imported under `TYPE_CHECKING` because `deps` imports core modules and the
real import would cycle.
"""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.franchise import home_franchisee_id
from app.models.role import (
    ADMIN,
    AREA_MANAGER,
    FRANCHISEE_ADMIN,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
)
from app.models.technician import TechnicianProfile

if TYPE_CHECKING:  # `deps` imports core modules, so the real import would cycle.
    from app.core.deps import Principal

MANAGE = "manage"    # add / invite / edit / type / base location / UPI approval / pay / pool / settings
VIEW = "view"        # read-only technician and money views
REVERSE = "reverse"  # give a penalty back
PURPOSES = (MANAGE, VIEW, REVERSE)

STAFF_ALL_INDIA = frozenset({ADMIN, NATIONAL_HEAD})
STAFF_TERRITORY = frozenset({REGIONAL_HEAD, AREA_MANAGER})


def decide_managed_franchisees(
    *,
    role: str,
    principal_franchisee_id: uuid.UUID | None,
    home_id: uuid.UUID | None,
    purpose: str = MANAGE,
) -> frozenset[uuid.UUID] | None:
    """PURE. Which franchisees' technicians/money this role reaches.
    None = every franchisee in the company.

    | role                        | MANAGE        | VIEW | REVERSE |
    | admin, national_head        | {home}        | None | None    |   F8: + reversal & read-only everywhere
    | regional_head, area_manager | {home}        | None | {home}  |   VIEW still narrowed by territory
    | franchisee_admin            | {own}         | {own}| {own}   |   home's own admin included (F8)
    | facility_admin / _operator  | {}            | {}   | {}      |   they work parts, not people (F7)
    | technician, vendor*, other  | {}            | {}   | {}      |

    The answers say nothing about PINCODE territory — `technician_scope` still
    narrows an AM's VIEW of the home roster to his states. This decides only the
    franchisee wall, which is the one question the pincodes cannot answer.
    """
    if purpose not in PURPOSES:
        raise ValueError(f"unknown purpose {purpose!r}")
    if role == FRANCHISEE_ADMIN:
        return frozenset({principal_franchisee_id}) if principal_franchisee_id else frozenset()
    if role in STAFF_ALL_INDIA:
        return None if purpose in (VIEW, REVERSE) else frozenset({home_id})
    if role in STAFF_TERRITORY:
        return None if purpose == VIEW else frozenset({home_id})
    return frozenset()


def decide_can_manage(
    managed: frozenset[uuid.UUID] | None, tech_franchisee_id: uuid.UUID
) -> bool:
    """PURE. `None` (unbounded) admits everything; a wall admits only its own."""
    return managed is None or tech_franchisee_id in managed


async def managed_franchisee_ids(
    db: AsyncSession, principal: "Principal", *, purpose: str = MANAGE
) -> set[uuid.UUID] | None:
    """Index §3.7 signature, plus a keyword-only `purpose`: F8 gives Admin/NH
    reversal and read-only reach that MANAGE must not have, and one function
    answering three questions is three copies fewer than three functions. Loads
    the home id only for staff roles — the one query a franchise principal
    never pays for, since their answer is their own id or nothing."""
    if principal.company_id is None:
        return set()
    home_id: uuid.UUID | None = None
    if principal.role in STAFF_ALL_INDIA | STAFF_TERRITORY:
        home_id = await home_franchisee_id(db, principal.company_id)
    found = decide_managed_franchisees(
        role=principal.role,
        principal_franchisee_id=principal.franchisee_id,
        home_id=home_id,
        purpose=purpose,
    )
    return None if found is None else set(found)


async def can_manage_technician(
    db: AsyncSession,
    principal: "Principal",
    tech: TechnicianProfile,
    *,
    purpose: str = MANAGE,
) -> bool:
    """The FRANCHISE wall, F7/F8. ANDed with — never instead of — the endpoint's
    existing checks (technician_scope territory, `_load`'s company filter, the AM
    floor). A tech from another company never reaches here: callers load it
    through a company-scoped loader first (404).

    Never `ensure_below_rank` for this question (the reason, written out once in
    models/role.py): rank is a property of one role and authority here is a
    relationship between two rows."""
    if tech.company_id != principal.company_id:
        return False
    return decide_can_manage(
        await managed_franchisee_ids(db, principal, purpose=purpose),
        tech.franchisee_id,
    )
"""Row visibility rules that more than one slice has to ask about.

`core/scope.py` answers "which PINCODES may this principal see rows in", and
tickets and notifications both narrow on that. This module is the same idea for
the rules a pincode subquery cannot express on its own.

`technician_scope` lives here rather than in `features/technicians` for the
reason `visible_pincodes` gives in `scope.py`: two slices need it now — the
technician list and global search — and a second copy of a visibility rule is
the copy that drifts. Slices never import each other (`api/AGENTS.md` rule 4),
so the shared rule moves to core and the slice keeps its own local name for it.
"""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Select, or_, select
from sqlalchemy import false as sql_false
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.scope import ALL_INDIA_ROLES, Scope, own_scope, pincodes_in_states
from app.models.membership import Membership
from app.models.role import AREA_MANAGER
from app.models.technician import TechnicianPincode, TechnicianProfile

if TYPE_CHECKING:  # `deps` imports core modules, so the real import would cycle.
    from app.core.deps import Principal


def technician_scope(
    stmt: Select,
    principal: "Principal",
    own_id: uuid.UUID | None,
    own: Scope,
) -> Select:
    """What this role sees of the technician roster.

    Not `territory_scope`: that helper filters a MEMBERSHIP query, and a
    technician's coverage lives in `technician_pincodes` — a separate table with
    the opposite rule (many technicians share one pincode).

    The statement must already join `Membership` and `TechnicianProfile`; this
    only narrows.
    """
    if principal.role in ALL_INDIA_ROLES:
        return stmt

    mine = TechnicianProfile.appointed_by_user_id == principal.user_id

    if own.region_ids:
        if principal.role == AREA_MANAGER:
            # Their own reports, anyone covering a pincode inside their states,
            # and anyone they appointed — an ASM must not lose a technician
            # because the technician's coverage later drifted.
            #
            # The pincode test is a subquery against the master, not a list: an
            # area manager's states can hold thousands of codes and this runs on
            # every page of the technician list.
            covers = select(TechnicianPincode.technician_id).where(
                TechnicianPincode.technician_id == TechnicianProfile.id,
                TechnicianPincode.pincode.in_(pincodes_in_states(own.state_ids))
                if own.state_ids
                else sql_false(),
            )
            return stmt.where(
                or_(
                    Membership.manager_id == own_id,
                    covers.exists(),
                    mine,
                )
            )
        return stmt.where(or_(TechnicianProfile.region_id.in_(own.region_ids), mine))

    # No territory yet — only what they appointed themselves.
    return stmt.where(mine)


async def visible_technicians(
    db: AsyncSession, stmt: Select, principal: "Principal"
) -> Select:
    """`technician_scope` for a caller that has not already loaded the scope.

    The technicians slice resolves `own_scope` once and reuses it across the
    roster and the invite union, so it calls `technician_scope` directly. A
    caller that needs the rule exactly once — global search — should not have to
    know that the rule needs a membership id and a Scope to be asked.
    """
    own_id, own = await own_scope(
        db, user_id=principal.user_id, company_id=principal.company_id
    )
    return technician_scope(stmt, principal, own_id, own)

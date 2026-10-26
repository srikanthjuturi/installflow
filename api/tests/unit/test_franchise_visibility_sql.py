"""Task 02 §6 case 12 — `technician_scope`'s franchise branch compiles right.

Compiled against the postgresql dialect (X1): no database, but the SQL is
real — the branch must say `technician_profiles.franchisee_id` for the
franchisee admin, render a `false` predicate for the facility roles, and leave
a staff principal's statement untouched.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.core.deps import Principal
from app.core.scope import Scope
from app.core.visibility import technician_scope
from app.models.membership import Membership
from app.models.role import ADMIN, FACILITY_ADMIN, FRANCHISEE_ADMIN, ROLE_RANKS
from app.models.technician import TechnicianProfile
from app.models.user import User

_COMPANY = uuid.uuid4()
_FRANCHISEE = uuid.uuid4()


def _stmt():
    return select(TechnicianProfile).join(
        Membership, Membership.id == TechnicianProfile.membership_id
    )


def _principal(role: str, *, franchisee_id: uuid.UUID | None = None) -> Principal:
    principal = Principal(
        user=User(id=uuid.uuid4(), role=role),
        role=role,
        rank=ROLE_RANKS[role],
        is_superadmin=False,
        company_id=_COMPANY,
        franchisee_id=franchisee_id,
    )
    return principal


def _sql(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect()))


def test_franchisee_admin_sees_its_franchisee() -> None:
    out = technician_scope(
        _stmt(), _principal(FRANCHISEE_ADMIN, franchisee_id=_FRANCHISEE), None, Scope()
    )
    text = _sql(out)
    # The predicate rides in the WHERE — note the SELECT list also carries the
    # column's name, which is why the prefix is what is asserted here.
    assert "WHERE technician_profiles.franchisee_id =" in text
    # Bound, not interpolated — the id arrives as a parameter.
    compiled = out.compile(dialect=postgresql.dialect())
    assert compiled.params["franchisee_id_1"] == _FRANCHISEE


def test_facility_principal_sees_nothing() -> None:
    out = technician_scope(
        _stmt(), _principal(FACILITY_ADMIN, franchisee_id=_FRANCHISEE), None, Scope()
    )
    # `sql_false()` renders as a bare `false`, which Postgres executes —
    # the tickets slice learned not to write `func.false()`.
    assert "WHERE false" in _sql(out)


def test_admin_sees_everything_unchanged() -> None:
    before = _sql(_stmt())
    out = technician_scope(_stmt(), _principal(ADMIN), None, Scope())
    assert _sql(out) == before
    # The base statement has no WHERE at all; the admin branch adds none.
    assert " WHERE false" not in before
    assert " WHERE " not in before
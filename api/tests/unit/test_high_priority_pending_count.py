"""E5 — the "Tickets" nav badge's count, `tickets.service.high_priority_pending`
and `count_high_priority_pending`.

Compiled against the postgresql dialect (X1): no database, but the SQL is
real — the same technique `test_franchise_visibility_sql.py` uses for
`technician_scope`. `count_high_priority_pending` is driven directly, with
the database dependency replaced by a bare stub that only records the
statement it was asked to run (`test_guard_pairs.py`'s own phrase for the
same trick) — `scoped()` for an ALL-INDIA role never awaits a real query
(`core.scope.visible_pincodes` returns `None` before touching the database),
so the stub's `scalar` is the only thing ever called.
"""

import asyncio
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.core.deps import Principal
from app.core.scope import ALL_INDIA_ROLES
from app.core.tickets import TERMINAL_STATUSES
from app.features.tickets.service import count_high_priority_pending, high_priority_pending
from app.models.role import ADMIN, AREA_MANAGER, ROLE_RANKS
from app.models.ticket import Ticket
from app.models.user import User

_COMPANY = uuid.uuid4()


class _CapturingDb:
    """Stands in for the `AsyncSession` `count_high_priority_pending` takes.

    Only `scalar` is ever called for an all-India principal — `scoped()`'s
    staff branch short-circuits before awaiting anything for one (see
    `core.scope.visible_pincodes`) — so that is the only method this needs.
    """

    def __init__(self) -> None:
        self.captured: Any = None

    async def scalar(self, stmt: Any) -> None:
        self.captured = stmt
        return None  # also exercises the `or 0` fallback below


def _sql(stmt) -> str:
    return str(
        stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})
    )


def _principal(role: str) -> Principal:
    return Principal(
        user=User(id=uuid.uuid4(), role=role),
        role=role,
        rank=ROLE_RANKS[role],
        is_superadmin=False,
        company_id=_COMPANY,
    )


def test_clause_requires_flagged_unassigned_and_non_terminal() -> None:
    text = _sql(select(Ticket.id).where(high_priority_pending()))
    assert "tickets.is_high_priority IS true" in text
    assert "tickets.technician_id IS NULL" in text
    # `NOT IN (...)` lists every terminal status this build knows about —
    # spelled out so a future addition to `TERMINAL_STATUSES` that forgets to
    # touch this clause fails a test instead of silently under-counting.
    assert "tickets.status NOT IN (" in text
    for status in TERMINAL_STATUSES:
        assert f"'{status}'" in text


def test_admin_count_returns_zero_on_an_empty_result_and_carries_no_territory_filter() -> None:
    """An all-India role's count carries no pincode filter at all — `scoped()`
    is a no-op for `ADMIN` — so the only predicates are the clause above plus
    the ordinary tenant and soft-delete guards."""
    db = _CapturingDb()
    result = asyncio.run(count_high_priority_pending(db, _principal(ADMIN)))  # type: ignore[arg-type]

    assert result == 0  # `int(None or 0)` — the stub's `scalar` answered nothing
    text = _sql(db.captured)
    assert "tickets.company_id =" in text
    assert "tickets.deleted_at IS NULL" in text
    assert "tickets.is_high_priority IS true" in text
    assert "pincode" not in text


def test_area_manager_is_not_the_short_circuiting_branch() -> None:
    """Sanity check on the test above's premise: an Area Manager's branch of
    `scoped()` DOES need the database (`core.scope.own_scope`), which is
    exactly why this suite only drives the caller through `ADMIN`. Proven by
    the role membership itself rather than by calling `scoped()` for one and
    hitting the X1 "no database" guard.
    """
    assert AREA_MANAGER not in ALL_INDIA_ROLES
    assert ADMIN in ALL_INDIA_ROLES

"""The penalty pool — two reads and no writes.

`earnings.view` on both, which is the key the console's "Penalty & Bonus" rail
entry already carries and which is seeded to admin and national head. No rank
floor beside it, unlike the escalation routes: this endpoint changes nothing
and commits nobody's day, so the feature grant is the whole answer.

There is deliberately no POST. An entry exists because something happened — a
technician gave up a job, or finished a bonused one — and it is written in that
act's own transaction. A route that could create one would be a way to move
money with nothing behind it.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_any_feature, require_feature
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.features.ledger import service
from app.features.ledger.schemas import LedgerEntryOut, LedgerPoolOut

router = APIRouter(prefix="/ledger", tags=["ledger"])

Db = Annotated[AsyncSession, Depends(get_db)]

#: The BALANCE and the ENTRIES are not the same disclosure, so they are not the
#: same grant.
#:
#: The balance is operational: it is what a bonus is spent from, and the
#: manager choosing an amount on the escalation screen has to be able to see
#: what is left. That is `jobs.assign`, which an Area Manager holds.
#:
#: The entries are financial detail — who was charged what, by name — and stay
#: on `earnings.view`, which is admin and national head. An Area Manager can
#: see that the pool holds ₹18,400; they cannot read the list of colleagues it
#: was collected from.
CanSeeBalance = Annotated[
    Principal, Depends(require_any_feature("earnings.view", "jobs.assign"))
]
CanView = Annotated[Principal, Depends(require_feature("earnings.view"))]


@router.get("/pool", response_model=ApiEnvelope[LedgerPoolOut])
async def get_pool(db: Db, principal: CanSeeBalance) -> ApiEnvelope[LedgerPoolOut]:
    """The balance, and the two sums it is the difference of.

    Declared above `""` for no routing reason — there is no clash — but because
    it is the figure the screen leads with and the list is its detail.
    """
    assert principal.company_id is not None
    return envelope(await service.get_pool(db, company_id=principal.company_id))


@router.get("", response_model=PaginatedEnvelope[LedgerEntryOut])
async def list_entries(
    db: Db,
    principal: CanView,
    params: Annotated[ListParams, Depends(list_params)],
    kind: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[LedgerEntryOut]:
    """One page of movements, newest first.

    `kind` filters to `penalty` or `bonus`, case-insensitively — the console
    labels them "Penalty" and "Bonus". An unrecognised value matches no rows
    and yields an empty page rather than a 422, which is the lesson from the
    vendor list: a stale bookmark carrying an old filter should show nothing,
    not break the screen.
    """
    assert principal.company_id is not None
    rows, total = await service.list_entries(
        db,
        params,
        company_id=principal.company_id,
        kind=kind.lower() if kind else None,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)

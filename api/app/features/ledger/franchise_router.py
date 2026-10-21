"""The franchisee's own pool — reads and the ONE write the slice has.

Task 05 §4.12 (Door 2): `franchise.pool` + a franchise principal, the wall
being the stamps themselves — every entry a route can reach carries the
principal's `franchisee_id`, or it does not exist on this door (404, never
403). The screens behind it are the portal's Pool tab: a balance, its rows,
and the "give a penalty back" action that reuses `core.penalty_reversal` —
the same body the staff ticket door uses, with the territory step swapped for
the franchisee wall.

⚠ No `require_min_rank` (§8 trap 4). `sortBy`/`sortDir` are accepted and
ignored — the portal draws the newest-first order a ledger is read in, and a
second sort contract here is a second thing to keep consistent.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_feature, require_franchise_principal
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.features.ledger import service
from app.features.ledger.schemas import LedgerEntryOut, LedgerPoolOut, ReverseRequest

router = APIRouter(prefix="/franchise", tags=["franchise"])

Db = Annotated[AsyncSession, Depends(get_db)]
#: `franchise.pool` — their own penalty pool. Role test and feature key, both,
#: like every `/franchise` door (Task 02's guard, Task 02's seeded key).
CanSee = Annotated[
    Principal,
    Depends(require_franchise_principal),
    Depends(require_feature("franchise.pool")),
]


@router.get("/ledger/pool", response_model=ApiEnvelope[LedgerPoolOut])
async def get_pool(db: Db, principal: CanSee) -> ApiEnvelope[LedgerPoolOut]:
    """This franchisee's balance, and the two sums it is the difference of."""
    assert principal.company_id is not None and principal.franchisee_id is not None
    return envelope(
        await service.get_pool(
            db, company_id=principal.company_id, franchisee_id=principal.franchisee_id
        )
    )


@router.get("/ledger", response_model=PaginatedEnvelope[LedgerEntryOut])
async def list_entries(
    db: Db,
    params: Annotated[ListParams, Depends(list_params)],
    principal: CanSee,
    kind: Annotated[str | None, Query()] = None,
    # Accepted and ignored — see the module docstring.
    sortBy: Annotated[str | None, Query()] = None,
    sortDir: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[LedgerEntryOut]:
    """This franchisee's pool movements, newest first.

    `kind` filters the same three words the staff screen uses; an
    unrecognised one is an empty page, never a 422.
    """
    assert principal.company_id is not None and principal.franchisee_id is not None
    rows, total = await service.list_entries(
        db,
        params,
        company_id=principal.company_id,
        franchisee_id=principal.franchisee_id,
        kind=kind.lower() if kind else None,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post(
    "/ledger/{entry_id}/reverse", response_model=ApiEnvelope[LedgerEntryOut]
)
async def reverse_entry(
    entry_id: uuid.UUID,
    body: ReverseRequest,
    db: Db,
    principal: CanSee,
) -> ApiEnvelope[LedgerEntryOut]:
    """Give one of OUR penalties back, in full, with a reason.

    The technician's Earnings screen reads it as never charged, this pool
    pays it out, and once only — the same once-only the staff door holds.
    404 for anything not stamped to this franchisee; 409
    `PENALTY_ALREADY_REVERSED` when somebody already gave it back.
    """
    return envelope(
        await service.reverse_entry(db, principal, entry_id, body.reason),
        message="Penalty reversed",
    )
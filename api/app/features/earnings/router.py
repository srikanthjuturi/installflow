"""The technician's own money. Two reads, no writes, and one person's rows.

Both routes carry the same pair of guards the jobs slice does, for the same
two reasons:

  * `pool.view` — hard rule 2, every endpoint carries a feature key. It is the
    key the technician role has held since the initial migration and the one
    every other technician-facing route already uses.
  * `require_technician_principal` — because a feature grant is overridable per
    company through Feature Access, so the key alone would mean "technician
    only" lasted until an admin handed it to somebody else. It also resolves
    the profile row, which is the whole scope of these queries.

**`earnings.view` is deliberately NOT used here.** That key gates
`/ledger`, which is the whole company's ledger by name — granting it to
technicians so they could read their own would hand them everybody's.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import TechnicianPrincipal, require_feature
from app.core.ledger import EARNINGS_PERIODS
from app.core.schemas import ApiEnvelope, envelope
from app.features.earnings import service
from app.features.earnings.schemas import EarningsSummaryOut, TransactionOut

router = APIRouter(prefix="/earnings", tags=["earnings"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanSeePool = Depends(require_feature("pool.view"))

#: `day` | `week` | `month`. An unrecognised value falls back to the week
#: rather than 422-ing, because this arrives from a control on a screen: a
#: build sending a value this server has not heard of should show the default
#: period, not an error where the money goes.
Period = Annotated[str, Query()]


def _period(value: str | None) -> str:
    return value if value in EARNINGS_PERIODS else "week"


@router.get("/summary", response_model=ApiEnvelope[EarningsSummaryOut])
async def get_summary(
    db: Db, me: TechnicianPrincipal, period: Period = "week"
) -> ApiEnvelope[EarningsSummaryOut]:
    """The hero figures for a day, a week or a month.

    **`netPaise` and `earnedPaise` are null**, and will be until installs are
    priced — there is no payout column on `tickets`. The phone renders null as
    "—". See the schema for why "bonuses minus penalties" is not an acceptable
    stand-in for the net.
    """
    principal, profile = me
    assert principal.company_id is not None
    return envelope(
        await service.summary(
            db,
            company_id=principal.company_id,
            technician_id=profile.id,
            period=_period(period),
        )
    )


@router.get("/transactions", response_model=ApiEnvelope[list[TransactionOut]])
async def list_transactions(
    db: Db, me: TechnicianPrincipal, period: Period = "week"
) -> ApiEnvelope[list[TransactionOut]]:
    """Every bonus and penalty on this technician in the period, newest first.

    No install credits, because nothing records one yet. An empty list is a
    real and common answer — most technicians have neither been fined nor paid
    a bonus — and the screen says so rather than showing a void.
    """
    principal, profile = me
    assert principal.company_id is not None
    return envelope(
        await service.transactions(
            db,
            company_id=principal.company_id,
            technician_id=profile.id,
            period=_period(period),
        )
    )

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

import datetime
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import TechnicianPrincipal, require_feature
from app.core.errors import AppError
from app.core.ledger import (
    EARNINGS_PERIODS,
    MAX_RANGE_DAYS,
    period_bounds,
    range_bounds,
    range_days,
)
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

#: IST calendar dates, inclusive at both ends — the same shape and the same
#: reckoning `tickets` already takes `dateFrom`/`dateTo` in.
Day = Annotated[datetime.date | None, Query()]


def _period(value: str | None) -> str:
    return value if value in EARNINGS_PERIODS else "week"


def _window(
    period: str | None, date_from: datetime.date | None, date_to: datetime.date | None
) -> tuple[datetime.datetime, datetime.datetime]:
    """The half-open UTC range both reads on this router agree on.

    Dates beat the period whenever either is given: the screen's calendar and
    its Today/Week/Month control are one control, and a request carrying both
    kinds means the one the technician touched last.

    **One end alone is that single day**, not "from then until now". It is what
    a calendar's first tap is, and the screen sends a complete range before it
    asks anything — so this only settles what a hand-built request means.

    A span past `MAX_RANGE_DAYS` is refused rather than truncated. Truncating
    would answer a question about their money with a different question's
    figures, silently, and the app never asks for one.
    """
    if date_from is None and date_to is None:
        return period_bounds(_period(period))

    start = date_from or date_to
    end = date_to or date_from
    assert start is not None and end is not None
    if range_days(start, end) > MAX_RANGE_DAYS:
        raise AppError(
            status_code=422,
            code="RANGE_TOO_LONG",
            detail=f"Pick a range of {MAX_RANGE_DAYS} days or fewer.",
        )
    return range_bounds(start, end)


@router.get("/summary", response_model=ApiEnvelope[EarningsSummaryOut])
async def get_summary(
    db: Db,
    me: TechnicianPrincipal,
    period: Period = "week",
    dateFrom: Day = None,
    dateTo: Day = None,
) -> ApiEnvelope[EarningsSummaryOut]:
    """The hero figures for a day, a week, a month or a range they picked.

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
            window=_window(period, dateFrom, dateTo),
        )
    )


@router.get("/transactions", response_model=ApiEnvelope[list[TransactionOut]])
async def list_transactions(
    db: Db,
    me: TechnicianPrincipal,
    period: Period = "week",
    dateFrom: Day = None,
    dateTo: Day = None,
) -> ApiEnvelope[list[TransactionOut]]:
    """Every bonus and penalty on this technician in the window, newest first.

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
            window=_window(period, dateFrom, dateTo),
        )
    )

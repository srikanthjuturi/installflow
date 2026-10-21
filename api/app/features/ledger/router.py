"""The penalty pool — two reads (and, on the FRANCHISE door, one write).

`earnings.view` on the entries, `earnings.view` OR `jobs.assign` on the
balance — which is the key the console's "Penalty & Bonus" rail entry already
carries and which is seeded to admin and national head. No rank floor beside
it, unlike the escalation routes: these endpoints change nothing and commit
nobody's day, so the feature grant is the whole answer.

`require_staff_principal` (Task 05 §4.12) sits under both feature checks: a
franchisee principal reaches its OWN pool through `/franchise/ledger`, and a
feature override must not hand it the company-wide door.

There is deliberately no POST on the staff side. An entry exists because
something happened — a technician gave up a job, or finished a bonused one —
and it is written in that act's own transaction. The ONE write in the slice
is the franchisee's own reversal, on the `/franchise` twin, giving money back
rather than inventing it.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    Principal,
    require_any_feature,
    require_feature,
    require_min_rank,
    require_staff_principal,
)
from app.core.errors import AppError
from app.core.franchise_money import money_context, pool_franchisee
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.core.statements import (
    build_statement_csv,
    load_statement,
    month_label,
    resolve_month,
    statement_filename,
)
from app.features.ledger import service
from app.features.ledger.schemas import LedgerEntryOut, LedgerPoolOut
from app.models.role import NATIONAL_HEAD

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
#:
#: Both now also refuse a franchise/vendor/technician principal outright —
#: these are company money screens, and the families have their own doors.
CanSeeBalance = Annotated[
    Principal,
    Depends(require_staff_principal),
    Depends(require_any_feature("earnings.view", "jobs.assign")),
]
CanView = Annotated[
    Principal,
    Depends(require_staff_principal),
    Depends(require_feature("earnings.view")),
]
#: The statement door (Task 06 §4.9) carries the entries' grant PLUS a rank
#: floor: a Regional/Area Manager cannot read payroll documents for anybody.
#: The same reason the reversal write sits above AM — a monthly statement is a
#: money record a franchisee admin would own on their own door, and the staff
#: one is for the people who already see every franchisee's figures.
CanSeeStatements = Annotated[
    Principal,
    Depends(require_staff_principal),
    Depends(require_feature("earnings.view")),
    Depends(require_min_rank(NATIONAL_HEAD)),
]


async def _scoped(
    db: AsyncSession, principal: Principal, requested: uuid.UUID | None
) -> uuid.UUID:
    """Which pool this read is about — `pool_franchisee`, one answer both routes.

    Absent → home; a franchisee of THIS company → it; unknown → 404 naming
    the miss rather than showing somebody else's numbers (§4.12). A
    franchisee principal never gets here — `require_staff_principal` has
    already turned it away at the door.
    """
    assert principal.company_id is not None
    home_id, known = await money_context(db, principal.company_id)
    scoped = pool_franchisee(
        is_franchise=False,
        own=None,
        requested=requested,
        home_id=home_id,
        known=known,
    )
    if scoped is None:
        raise AppError(404, "NOT_FOUND", "Franchisee not found")
    return scoped


@router.get("/pool", response_model=ApiEnvelope[LedgerPoolOut])
async def get_pool(
    db: Db,
    principal: CanSeeBalance,
    franchiseeId: Annotated[uuid.UUID | None, Query()] = None,
) -> ApiEnvelope[LedgerPoolOut]:
    """The balance, and the two sums it is the difference of.

    Declared above `""` for no routing reason — there is no clash — but because
    it is the figure the screen leads with and the list is its detail.

    One pool per franchisee (F12): `franchiseeId` names which, defaulting to
    home. An Area Manager may read it for any franchisee — they hold
    `jobs.assign` and spend from these balances on the escalation screen.
    """
    assert principal.company_id is not None
    scoped = await _scoped(db, principal, franchiseeId)
    return envelope(
        await service.get_pool(db, company_id=principal.company_id, franchisee_id=scoped)
    )


@router.get("", response_model=PaginatedEnvelope[LedgerEntryOut])
async def list_entries(
    db: Db,
    principal: CanView,
    params: Annotated[ListParams, Depends(list_params)],
    kind: Annotated[str | None, Query()] = None,
    franchiseeId: Annotated[uuid.UUID | None, Query()] = None,
) -> PaginatedEnvelope[LedgerEntryOut]:
    """One page of movements, newest first.

    `kind` filters to `penalty`, `bonus` or `reversal`, case-insensitively — the
    console labels them "Penalty", "Bonus" and "Penalty reversed". An unrecognised value matches no rows
    and yields an empty page rather than a 422, which is the lesson from the
    vendor list: a stale bookmark carrying an old filter should show nothing,
    not break the screen.

    `franchiseeId` (Task 05) names whose rows — defaulting to home, exactly as
    `/pool` does. The entries, unlike the balance, stay on the whole-company
    detail grant, so an Area Manager picking another franchisee here still
    gets 403 from the feature check rather than rows.
    """
    assert principal.company_id is not None
    scoped = await _scoped(db, principal, franchiseeId)
    rows, total = await service.list_entries(
        db,
        params,
        company_id=principal.company_id,
        franchisee_id=scoped,
        kind=kind.lower() if kind else None,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get("/statements/{technicianId}")
async def statement(
    db: Db,
    technicianId: uuid.UUID,
    principal: CanSeeStatements,
    month: Annotated[str, Query()],
) -> Response:
    """One HOME employee's month as the CSV payroll reads (Task 06 §4.9).

    The staff twin of `/franchise/statements` — same file, same wall, same
    `load_statement` — but scoped to the HOME franchisee only (F8: home money
    stays on the existing keys). There is no `franchiseeId` parameter and
    deliberately no way to name one: an external franchisee's statement is its
    OWN admin's document through the `/franchise` door, and offering a staff
    route across that wall would make this the read-around the feature grants
    were drawn against. Same rank floor the reversal write runs behind.

    Same envelope exception as the templates (see the franchise statement's
    docstring): success is the raw file, failure is the standard envelope.
    """
    assert principal.company_id is not None
    scoped = await _scoped(db, principal, None)
    year, month_num = resolve_month(month)
    sheet = await load_statement(
        db,
        company_id=principal.company_id,
        franchisee_id=scoped,
        technician_id=technicianId,
        year=year,
        month=month_num,
    )
    body = build_statement_csv(
        franchisee_name=sheet.franchisee_name,
        franchisee_code=sheet.franchisee_code,
        month_label=month_label(year, month_num),
        employee_name=sheet.employee_name,
        employee_code=sheet.employee_code,
        employee_phone=sheet.employee_phone,
        rows=sheet.rows,
    )
    filename = statement_filename(
        franchisee_code=sheet.franchisee_code,
        technician_code=sheet.employee_code,
        year=year,
        month=month_num,
    )
    return Response(
        # The literal "﻿" at the head of `content` IS the BOM (§4.9) — one
        # zero-width byte, which is what makes Excel show ₹ and Devanagari.
        content=("﻿" + body).encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
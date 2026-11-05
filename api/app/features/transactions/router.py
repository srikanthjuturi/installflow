"""Transactions dashboard + statements (Epic 1.5 / 1.6).

One router for every reader. There is no `require_feature` on the routes: the
callers are four different families (superadmin, company Admin / NH, vendor,
franchisee admin) and a single feature key cannot say that - `service.scope()`
is the guard, and it answers 403 for anyone it does not recognise.

Literal segments are declared before `/{document_id}` or FastAPI parses them
as a UUID and answers 422.
"""

import datetime
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CurrentPrincipal
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    canonical_filter,
    envelope,
    list_params,
    paginated,
)
from app.features.transactions import emailing, service
from app.features.transactions.schemas import (
    RequeueOut,
    CompanyRollupOut,
    DocumentOut,
    PartyOptionOut,
    StatementOut,
    TransactionSummaryOut,
)
from app.models.transaction_document import DOC_TYPES, PARTY_KINDS

router = APIRouter(prefix="/transactions", tags=["transactions"])

Db = Annotated[AsyncSession, Depends(get_db)]
Params = Annotated[ListParams, Depends(list_params)]

#: `from` is a Python keyword, so the query alias carries it.
Start = Annotated[datetime.date | None, Query(alias="from")]
End = Annotated[datetime.date | None, Query(alias="to")]
CompanyQ = Annotated[uuid.UUID | None, Query()]


@router.post("/email/resend", response_model=ApiEnvelope[RequeueOut])
async def resend_emails(
    db: Db,
    principal: CurrentPrincipal,
    companyId: CompanyQ = None,
    start: Start = None,
    end: End = None,
    documentId: Annotated[uuid.UUID | None, Query()] = None,
    onlyUnsent: Annotated[bool, Query()] = False,
) -> ApiEnvelope[RequeueOut]:
    """Queue documents to be emailed to the company's Admins again.

    The sweep sends them within a few minutes; nothing is sent inline, so a
    range of hundreds never holds a request open.
    """
    queued = await emailing.requeue(
        db, principal, company_id=companyId, start=start, end=end,
        document_id=documentId, only_unsent=onlyUnsent,
    )
    return envelope(RequeueOut(queued=queued))


@router.get("/summary", response_model=ApiEnvelope[TransactionSummaryOut])
async def summary(
    db: Db,
    principal: CurrentPrincipal,
    companyId: CompanyQ = None,
    start: Start = None,
    end: End = None,
    docType: Annotated[str | None, Query()] = None,
    partyKind: Annotated[str | None, Query()] = None,
    partyId: Annotated[uuid.UUID | None, Query()] = None,
    search: Annotated[str | None, Query()] = None,
) -> ApiEnvelope[TransactionSummaryOut]:
    doc_type = canonical_filter(docType, DOC_TYPES)
    kind = canonical_filter(partyKind, PARTY_KINDS)
    if doc_type is False or kind is False:
        return envelope(
            await service.summary(
                db, principal, company_id=companyId, start=start, end=end,
                doc_type="__none__", party_kind=None, party_id=None, search=None,
            )
        )
    return envelope(
        await service.summary(
            db, principal, company_id=companyId, start=start, end=end,
            doc_type=doc_type, party_kind=kind, party_id=partyId, search=search,
        )
    )


@router.get("/parties", response_model=ApiEnvelope[list[PartyOptionOut]])
async def parties(
    db: Db,
    principal: CurrentPrincipal,
    companyId: CompanyQ = None,
    partyKind: Annotated[str | None, Query()] = None,
    search: Annotated[str | None, Query()] = None,
) -> ApiEnvelope[list[PartyOptionOut]]:
    kind = canonical_filter(partyKind, PARTY_KINDS)
    if kind is False:
        return envelope([])
    return envelope(
        await service.parties(db, principal, company_id=companyId, party_kind=kind, search=search)
    )


@router.get("/rollup", response_model=ApiEnvelope[list[CompanyRollupOut]])
async def rollup(
    db: Db,
    principal: CurrentPrincipal,
    start: Annotated[datetime.date, Query(alias="from")],
    end: Annotated[datetime.date, Query(alias="to")],
) -> ApiEnvelope[list[CompanyRollupOut]]:
    """Superadmin: every company's debit / credit totals for the period."""
    return envelope(await service.company_rollup(db, principal, start=start, end=end))


@router.get("/statement", response_model=ApiEnvelope[StatementOut])
async def statement(
    db: Db,
    principal: CurrentPrincipal,
    partyKind: Annotated[str, Query()],
    start: Annotated[datetime.date, Query(alias="from")],
    end: Annotated[datetime.date, Query(alias="to")],
    companyId: CompanyQ = None,
    partyId: Annotated[uuid.UUID | None, Query()] = None,
) -> ApiEnvelope[StatementOut]:
    return envelope(
        await service.statement(
            db, principal, company_id=companyId, party_kind=partyKind,
            party_id=partyId, start=start, end=end,
        )
    )


@router.get("/statement.csv")
async def statement_csv(
    db: Db,
    principal: CurrentPrincipal,
    partyKind: Annotated[str, Query()],
    start: Annotated[datetime.date, Query(alias="from")],
    end: Annotated[datetime.date, Query(alias="to")],
    companyId: CompanyQ = None,
    partyId: Annotated[uuid.UUID | None, Query()] = None,
) -> Response:
    st = await service.statement(
        db, principal, company_id=companyId, party_kind=partyKind,
        party_id=partyId, start=start, end=end,
    )
    name, text = service.statement_csv(st)
    return Response(
        # The literal BOM at the head is what makes Excel show the rupee sign.
        content=("﻿" + text).encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("", response_model=PaginatedEnvelope[DocumentOut])
async def list_documents(
    db: Db,
    params: Params,
    principal: CurrentPrincipal,
    companyId: CompanyQ = None,
    start: Start = None,
    end: End = None,
    docType: Annotated[str | None, Query()] = None,
    partyKind: Annotated[str | None, Query()] = None,
    partyId: Annotated[uuid.UUID | None, Query()] = None,
) -> PaginatedEnvelope[DocumentOut]:
    doc_type = canonical_filter(docType, DOC_TYPES)
    kind = canonical_filter(partyKind, PARTY_KINDS)
    if doc_type is False or kind is False:
        # An unknown filter value is an empty page, never a 422.
        return paginated([], page=params.page, limit=params.limit, total=0)
    rows, total = await service.list_page(
        db, principal, params, company_id=companyId, start=start, end=end,
        doc_type=doc_type, party_kind=kind, party_id=partyId,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get("/{document_id}", response_model=ApiEnvelope[DocumentOut])
async def get_document(
    document_id: uuid.UUID, db: Db, principal: CurrentPrincipal
) -> ApiEnvelope[DocumentOut]:
    return envelope(await service.detail(db, principal, document_id))

"""Company endpoints — superadmin only (create / list / get / update / delete)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_superadmin
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.features.companies import service
from app.features.companies.schemas import (
    CodeSuggestionOut,
    CompanyCreateRequest,
    CompanyOut,
    CompanyStatusRequest,
    CompanyUpdateRequest,
)

router = APIRouter(prefix="/companies", tags=["companies"])

Db = Annotated[AsyncSession, Depends(get_db)]
Superadmin = Annotated[Principal, Depends(require_superadmin)]


@router.post("", response_model=ApiEnvelope[CompanyOut], status_code=201)
async def create_company(
    body: CompanyCreateRequest, principal: Superadmin, db: Db
) -> ApiEnvelope[CompanyOut]:
    data = await service.create_company(db, principal, body)
    return envelope(data, message="Company created", status_code=201)


@router.get("/code-suggestion", response_model=ApiEnvelope[CodeSuggestionOut])
async def suggest_code(
    name: str, principal: Superadmin, db: Db
) -> ApiEnvelope[CodeSuggestionOut]:
    """What code the server WOULD assign to a company of this name.

    Exists so the console can show the suggestion without owning a second copy
    of the derivation rule. A rule implemented twice is a rule that disagrees
    with itself eventually, and here the disagreement would only surface as a
    superadmin watching the code they were shown not be the code they got.

    Declared above `/{company_id}` deliberately: FastAPI matches in order, and
    below it this path would be read as a company id and fail to parse as a UUID.
    """
    return envelope(await service.suggest_code(db, name))


@router.get("", response_model=PaginatedEnvelope[CompanyOut])
async def list_companies(
    principal: Superadmin,
    db: Db,
    params: Annotated[ListParams, Depends(list_params)],
) -> PaginatedEnvelope[CompanyOut]:
    rows, total = await service.list_companies(db, params)
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get("/{company_id}", response_model=ApiEnvelope[CompanyOut])
async def get_company(
    company_id: uuid.UUID, principal: Superadmin, db: Db
) -> ApiEnvelope[CompanyOut]:
    data = await service.get_company(db, company_id)
    return envelope(data)


@router.put("/{company_id}", response_model=ApiEnvelope[CompanyOut])
async def update_company(
    company_id: uuid.UUID,
    body: CompanyUpdateRequest,
    principal: Superadmin,
    db: Db,
) -> ApiEnvelope[CompanyOut]:
    data = await service.update_company(db, company_id, body, principal)
    return envelope(data, message="Company updated")


@router.patch("/{company_id}/status", response_model=ApiEnvelope[CompanyOut])
async def set_company_status(
    company_id: uuid.UUID,
    body: CompanyStatusRequest,
    principal: Superadmin,
    db: Db,
) -> ApiEnvelope[CompanyOut]:
    data = await service.set_status(db, company_id, body.isActive, principal)
    return envelope(data, message="Company status updated")


@router.delete("/{company_id}", response_model=ApiEnvelope[None])
async def delete_company(
    company_id: uuid.UUID, principal: Superadmin, db: Db
) -> ApiEnvelope[None]:
    await service.delete_company(db, company_id, principal)
    return envelope(None, message="Company deleted")

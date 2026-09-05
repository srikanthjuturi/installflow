"""Company endpoints — superadmin only (create / list / get / update / delete)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_superadmin
from app.core.gst_lookup import (
    GstinLookupOut,
    GstinLookupRequest,
    lookup_gstin_service,
)
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
    CompanyCreateRequest,
    CompanyCreatedOut,
    CompanyOut,
    CompanyStatusRequest,
    CompanyUpdateRequest,
)

router = APIRouter(prefix="/companies", tags=["companies"])

Db = Annotated[AsyncSession, Depends(get_db)]
Superadmin = Annotated[Principal, Depends(require_superadmin)]

#: Keyed on what happened to the admin's password email. The console reads
#: `data.emailStatus`; this serves API consumers, Swagger and the logs.
_CREATED_MESSAGE = {
    "sent": "Company created — the admin's temporary password has been emailed",
    "skipped": "Company created — the admin signs in with the password they already use",
    "failed": "Company created, but the admin's password email did not go out",
}

#: Keyed on what the lookup found. The console reads `data.outcome`; these
#: serve API consumers, Swagger and the logs. Same wording as the vendor twin.
_LOOKUP_MESSAGE = {
    "found": "GSTIN found",
    "already_registered": "That GSTIN is already registered",
    "not_registered": "That GSTIN is not registered",
    "unavailable": "The GST portal could not be reached",
}


@router.post("", response_model=ApiEnvelope[CompanyCreatedOut], status_code=201)
async def create_company(
    body: CompanyCreateRequest, principal: Superadmin, db: Db
) -> ApiEnvelope[CompanyCreatedOut]:
    """Create a tenant and its first admin.

    The server mints the admin's temporary password and emails it. **201 even
    when that email fails** — read `data.emailStatus` to tell the cases apart.
    """
    data = await service.create_company(db, principal, body)
    return envelope(
        data, message=_CREATED_MESSAGE[data.emailStatus], status_code=201
    )


@router.post("/gstin-lookup", response_model=ApiEnvelope[GstinLookupOut])
async def lookup_gstin(
    body: GstinLookupRequest, principal: Superadmin, db: Db
) -> ApiEnvelope[GstinLookupOut]:
    """What we know about a GSTIN — the company form's autofill.

    The superadmin twin of `POST /vendors/gstin-lookup`. Same registry, same
    answer, same `app.core.gst_lookup` behind both; only the gate and the SCOPE
    of the "do we already hold it?" check differ. The gate has to — a superadmin
    holds no membership and no company feature, so the vendors route refuses
    them outright — and the scope has to as well: this one asks platform-wide,
    because a superadmin can already list every company, where the vendor twin
    may only ever ask about the caller's own tenant.

    **Always 200.** `data.outcome` is `found`, `already_registered` (another
    company, or on an edit one of this company's own vendors, already has it:
    block the save), `not_registered` (a real answer: block the save) or
    `unavailable` (we could not ask: block nothing).

    `already_registered` never reaches the registry, so it costs no
    subscription unit. Send `excludeId` — the company being edited — or
    reopening any company refuses its own GSTIN; it is also what answers "whose
    vendors?" for the second half of the check.

    Declared BEFORE `/{company_id}`, or FastAPI parses the literal as a UUID and
    422s. `company_id` is None for a superadmin, so a subscription failure is
    logged rather than emailed: there is no tenant to tell, and the person who
    renews the subscription is the one reading this screen.
    """
    data = await lookup_gstin_service(
        db,
        principal.company_id,
        body.gstin,
        surface="company",
        exclude_id=body.excludeId,
    )
    return envelope(data, message=_LOOKUP_MESSAGE[data.outcome])


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

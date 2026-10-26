"""Spare parts — the catalogue editor (company Admin / National Head) and the
facility's request queue (franchise staff only).

Two audiences that must never meet, so two guard sets:

  * **catalogue** — `parts.catalogue` + `require_staff_principal`. A vendor
    holds `masters.view` and a franchise role must not reach the editor.
  * **requests** — `require_parts_handler` + `parts.handle`. Franchise staff
    ONLY (owner ruling 2026-10-15, R4): every staff role, Admin and National Head
    included, is 403. There is no home-franchisee exception.

⚠ Guards are listed in `dependencies=[...]` and NEVER stacked inside one
`Annotated[...]`: FastAPI applies only the LAST `Depends` of an `Annotated`
alias, so a stack silently drops the others.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    CompanyPrincipal,
    Principal,
    require_feature,
    require_staff_principal,
)
from app.core.part_request_out import PartRequestOut
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.features.spare_parts import service
from app.features.spare_parts.schemas import (
    ApproveBody,
    CatalogueOut,
    IssueBody,
    PartRequestCountsOut,
    RejectBody,
    ReturnBody,
    SparePartCreate,
    SparePartOut,
    SparePartUpdate,
)
from app.models.role import FRANCHISE_ROLES

router = APIRouter(prefix="/spare-parts", tags=["spare-parts"])

Db = Annotated[AsyncSession, Depends(get_db)]

#: The editor. The feature yields the principal; the staff guard rides in
#: `dependencies` (see the module note).
CanEditCatalogue = Annotated[Principal, Depends(require_feature("parts.catalogue"))]
IsStaff = Depends(require_staff_principal)


def require_parts_handler(principal: CompanyPrincipal) -> Principal:
    """Franchise staff, linked to a franchisee — nobody else (R4).

    A named dependency so the sentence is in one place. It is `require_
    facility_principal` plus the 403 wording this slice promises: every staff
    role is refused, and there is no `parts.catalogue` route into the queue.
    """
    if principal.role not in FRANCHISE_ROLES or principal.franchisee_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Spare parts are handled by the franchise's facility staff.",
        )
    return principal


IsPartsHandler = Depends(require_parts_handler)
CanHandle = Annotated[Principal, Depends(require_feature("parts.handle"))]


# ── catalogue ────────────────────────────────────────────────────────────────


@router.get(
    "/catalogue/nodes/{nodeId}",
    response_model=ApiEnvelope[CatalogueOut],
    dependencies=[IsStaff],
)
async def node_catalogue(
    nodeId: uuid.UUID, db: Db, principal: CanEditCatalogue
) -> ApiEnvelope[CatalogueOut]:
    """A category's own parts (active and inactive) and what it passes down."""
    return envelope(await service.node_catalogue(db, principal, nodeId))


@router.get(
    "/catalogue/models/{modelId}",
    response_model=ApiEnvelope[CatalogueOut],
    dependencies=[IsStaff],
)
async def model_catalogue(
    modelId: uuid.UUID, db: Db, principal: CanEditCatalogue
) -> ApiEnvelope[CatalogueOut]:
    """A product's own parts, and what it inherits — exactly what a technician
    would see minus the product's own rows."""
    return envelope(await service.model_catalogue(db, principal, modelId))


@router.post(
    "/catalogue/nodes/{nodeId}/parts",
    response_model=ApiEnvelope[SparePartOut],
    status_code=201,
    dependencies=[IsStaff],
)
async def add_node_part(
    nodeId: uuid.UUID, body: SparePartCreate, db: Db, principal: CanEditCatalogue
) -> ApiEnvelope[SparePartOut]:
    """409 when a part with that name (case and spacing aside) is already on
    this category."""
    return envelope(
        await service.add_part(db, principal, body, node_id=nodeId),
        message="Part added",
        status_code=201,
    )


@router.post(
    "/catalogue/models/{modelId}/parts",
    response_model=ApiEnvelope[SparePartOut],
    status_code=201,
    dependencies=[IsStaff],
)
async def add_model_part(
    modelId: uuid.UUID, body: SparePartCreate, db: Db, principal: CanEditCatalogue
) -> ApiEnvelope[SparePartOut]:
    return envelope(
        await service.add_part(db, principal, body, model_id=modelId),
        message="Part added",
        status_code=201,
    )


@router.patch(
    "/catalogue/parts/{partId}",
    response_model=ApiEnvelope[SparePartOut],
    dependencies=[IsStaff],
)
async def update_part(
    partId: uuid.UUID, body: SparePartUpdate, db: Db, principal: CanEditCatalogue
) -> ApiEnvelope[SparePartOut]:
    return envelope(await service.update_part(db, principal, partId, body), message="Part updated")


@router.delete(
    "/catalogue/parts/{partId}",
    response_model=ApiEnvelope[None],
    dependencies=[IsStaff],
)
async def delete_part(
    partId: uuid.UUID, db: Db, principal: CanEditCatalogue
) -> ApiEnvelope[None]:
    """Soft delete. Requests keep their frozen part name."""
    await service.delete_part(db, principal, partId)
    return envelope(None, message="Part removed")


# ── the facility's queue ─────────────────────────────────────────────────────
#
# `/requests/counts` is declared BEFORE `/requests/{requestId}`: Starlette
# matches in declaration order, and the id route would swallow it as a UUID.


@router.get(
    "/requests",
    response_model=PaginatedEnvelope[PartRequestOut],
    dependencies=[IsPartsHandler],
)
async def list_requests(
    db: Db,
    principal: CanHandle,
    params: Annotated[ListParams, Depends(list_params)],
    status: Annotated[str | None, Query()] = None,
) -> PaginatedEnvelope[PartRequestOut]:
    """This facility's requests — `status` is a comma set (default
    `requested,approved,issued`; an unknown member empties the page). Oldest
    waiting first."""
    rows, total = await service.list_requests(db, principal, params, status=status)
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get(
    "/requests/counts",
    response_model=ApiEnvelope[PartRequestCountsOut],
    dependencies=[IsPartsHandler],
)
async def request_counts(db: Db, principal: CanHandle) -> ApiEnvelope[PartRequestCountsOut]:
    return envelope(await service.counts(db, principal))


@router.get(
    "/requests/{requestId}",
    response_model=ApiEnvelope[PartRequestOut],
    dependencies=[IsPartsHandler],
)
async def get_request(
    requestId: uuid.UUID, db: Db, principal: CanHandle
) -> ApiEnvelope[PartRequestOut]:
    """404 for another franchisee's — or another company's — request."""
    return envelope(await service.get_request(db, principal, requestId))


@router.post(
    "/requests/{requestId}/approve",
    response_model=ApiEnvelope[PartRequestOut],
    dependencies=[IsPartsHandler],
)
async def approve(
    requestId: uuid.UUID,
    db: Db,
    principal: CanHandle,
    body: ApproveBody | None = None,
) -> ApiEnvelope[PartRequestOut]:
    """`addToCatalogue: true` on an Other request adds its name to the ticket's
    category list and links the request (P7)."""
    return envelope(
        await service.act(db, principal, requestId, "approve", body=body or ApproveBody()),
        message="Part approved",
    )


@router.post(
    "/requests/{requestId}/reject",
    response_model=ApiEnvelope[PartRequestOut],
    dependencies=[IsPartsHandler],
)
async def reject(
    requestId: uuid.UUID, body: RejectBody, db: Db, principal: CanHandle
) -> ApiEnvelope[PartRequestOut]:
    """Valid from `requested` AND from `approved` (owner ruling 2026-10-15, R2);
    the reason is required both times."""
    return envelope(
        await service.act(db, principal, requestId, "reject", body=body),
        message="Part rejected",
    )


@router.post(
    "/requests/{requestId}/issue",
    response_model=ApiEnvelope[PartRequestOut],
    dependencies=[IsPartsHandler],
)
async def issue(
    requestId: uuid.UUID,
    db: Db,
    principal: CanHandle,
    body: IssueBody | None = None,
) -> ApiEnvelope[PartRequestOut]:
    return envelope(
        await service.act(db, principal, requestId, "issue", body=body or IssueBody()),
        message="Part issued",
    )


@router.post(
    "/requests/{requestId}/return",
    response_model=ApiEnvelope[PartRequestOut],
    dependencies=[IsPartsHandler],
)
async def return_part(
    requestId: uuid.UUID,
    db: Db,
    principal: CanHandle,
    body: ReturnBody | None = None,
) -> ApiEnvelope[PartRequestOut]:
    """A log entry, never a gate: allowed whatever the ticket's status."""
    return envelope(
        await service.act(db, principal, requestId, "return", body=body or ReturnBody()),
        message="Part received back",
    )

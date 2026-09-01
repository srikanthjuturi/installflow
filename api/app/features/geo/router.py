"""Geography master — the region/state/district/pincode catalogue.

Separate from the `territory` slice on purpose. `territory` answers "who covers
what" for one company; this answers "what is India", which is the same for every
company and is maintained by a superadmin.

The two reads carry `get_current_principal` and no feature guard. That is
deliberate and matches `/uploads`: geography is reference data every signed-in
client needs to render a picker, and `require_feature` is built on
`CompanyPrincipal`, which refuses a superadmin outright — so a feature key here
would lock the superadmin out of the very screen that maintains the data.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, get_current_principal, require_superadmin
from app.core.scope import ALL_INDIA_ROLES, own_scope
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.features.geo import service
from app.features.geo.schemas import (
    DistrictOut,
    ImportReport,
    PincodeOut,
    RegionOut,
    StateOut,
)
from app.features.geo.service import MAX_UPLOAD_BYTES

router = APIRouter(prefix="/geo", tags=["geo"])

Db = Annotated[AsyncSession, Depends(get_db)]
CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]
Superadmin = Annotated[Principal, Depends(require_superadmin)]


@router.get("/regions", response_model=ApiEnvelope[list[RegionOut]])
async def list_regions(
    principal: CurrentPrincipal,
    db: Db,
    mine: Annotated[bool, Query()] = False,
) -> ApiEnvelope[list[RegionOut]]:
    """Regions with their state counts, including any that hold none.

    `/regions` in the rbac slice stays as it is — it is guarded by
    `CompanyPrincipal` and every company client already uses it. That guard
    refuses a superadmin, so the screen that maintains this data needs its own
    door.

    `mine=true` narrows to the caller's own territory, exactly as on
    `/districts`: it is what the dashboard's territory picker offers, and a
    picker that listed a region the reader cannot see would be a control whose
    every option returns zero.
    """
    region_ids = await _own_regions(db, principal) if mine else None
    if region_ids == []:
        return envelope([])
    return envelope(await service.list_regions(db, region_ids=region_ids))


@router.get("/states", response_model=ApiEnvelope[list[StateOut]])
async def list_states(
    principal: CurrentPrincipal,
    db: Db,
    mine: Annotated[bool, Query()] = False,
) -> ApiEnvelope[list[StateOut]]:
    """Every state with its region and counts. 36 rows — deliberately unpaged.

    `mine=true` narrows the same way, and by whichever side the caller holds —
    an area manager's own states, or every state inside a regional head's
    regions. `StateOut` already carries `regionId`, so one unpaged call is
    enough for a cascading region → state picker.
    """
    if not mine or principal.role in ALL_INDIA_ROLES:
        return envelope(await service.list_states(db))

    _own_id, own = await own_scope(
        db, user_id=principal.user_id, company_id=principal.company_id
    )
    # States first: an area manager holds those and his regions are DERIVED from
    # them, so filtering by region would widen his list to colleagues' states.
    if own.state_ids:
        return envelope(
            await service.list_states(db, state_ids=list(own.state_ids))
        )
    if own.region_ids:
        return envelope(
            await service.list_states(db, region_ids=list(own.region_ids))
        )
    return envelope([])


async def _own_regions(db, principal: Principal) -> list[uuid.UUID] | None:
    """The caller's regions, or `None` for a role whose reach is the country.

    An area manager holds states rather than regions, but his regions are
    derived and stored alongside them — so this answers for him too, with the
    one or two regions his states sit in.
    """
    if principal.role in ALL_INDIA_ROLES:
        return None
    _own_id, own = await own_scope(
        db, user_id=principal.user_id, company_id=principal.company_id
    )
    return list(own.region_ids)


@router.get("/districts", response_model=ApiEnvelope[list[DistrictOut]])
async def list_districts(
    principal: CurrentPrincipal,
    db: Db,
    stateId: Annotated[uuid.UUID | None, Query()] = None,
    regionId: Annotated[uuid.UUID | None, Query()] = None,
    mine: Annotated[bool, Query()] = False,
) -> ApiEnvelope[list[DistrictOut]]:
    """Districts with their pincode counts. Unpaged — 754 in all, 75 at most in
    one state.

    Their counts do not sum to the state's pincode count; see `DistrictOut`.

    `mine=true` narrows the list to the caller's own territory — an area
    manager's states, a regional head's regions, everything for an all-India
    role. Geography is a global master, so the SCOPE is resolved here rather
    than in the service: the service stays a query over a table nobody owns,
    and the one thing that knows who is asking stays at the edge.
    """
    state_ids: list[uuid.UUID] | None = None
    region_ids: list[uuid.UUID] | None = None
    if mine and principal.role not in ALL_INDIA_ROLES:
        _own_id, own = await own_scope(
            db, user_id=principal.user_id, company_id=principal.company_id
        )
        # An area manager holds states; a regional head holds regions and no
        # states at all. Sending an empty list for the one he does not hold
        # would filter everything away, so only the populated side is applied.
        if own.state_ids:
            state_ids = list(own.state_ids)
        elif own.region_ids:
            region_ids = list(own.region_ids)
        else:
            # Scoped role, nothing assigned yet: no districts are his.
            return envelope([])

    return envelope(
        await service.list_districts(
            db,
            state_id=stateId,
            region_id=regionId,
            state_ids=state_ids,
            region_ids=region_ids,
        )
    )


@router.get("/pincodes", response_model=PaginatedEnvelope[PincodeOut])
async def list_pincodes(
    principal: CurrentPrincipal,
    db: Db,
    params: Annotated[ListParams, Depends(list_params)],
    stateId: Annotated[uuid.UUID | None, Query()] = None,
    regionId: Annotated[uuid.UUID | None, Query()] = None,
    districtId: Annotated[uuid.UUID | None, Query()] = None,
    #: The pincodes in no district at all — four of them, and otherwise
    #: unreachable from a district drill-down.
    noDistrict: Annotated[bool, Query()] = False,
) -> PaginatedEnvelope[PincodeOut]:
    rows, total = await service.list_pincodes(
        db,
        params,
        state_id=stateId,
        region_id=regionId,
        district_id=districtId,
        no_district=noDistrict,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.get("/import/template")
async def import_template(principal: Superadmin) -> StreamingResponse:
    """A starter file with the four headers the importer reads."""
    return StreamingResponse(
        service.build_template(),
        media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": 'attachment; filename="geography-template.xlsx"'
        },
    )


@router.post("/import", response_model=ApiEnvelope[ImportReport])
async def import_geography(
    principal: Superadmin,
    db: Db,
    file: Annotated[UploadFile, File()],
    dryRun: Annotated[bool, Query()] = True,
) -> ApiEnvelope[ImportReport]:
    """Load Region/State/District/Pin Code. `dryRun` validates and writes nothing.

    Additive: it creates and updates what the file names, and never deletes what
    the file omits — a half-finished upload must not silently unmap India.
    """
    name = (file.filename or "").lower()
    if not name.endswith((".xlsx", ".csv")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload an .xlsx or .csv file",
        )

    # Read with a ceiling rather than trusting the declared size: a client can
    # claim any content-length, and the body would otherwise be in memory before
    # any check that came after it.
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"The file must be under {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
        )

    report = await service.import_geography(
        db, data, name, dry_run=dryRun, actor_id=principal.user_id
    )
    return envelope(
        report,
        message=(
            "Checked — nothing was saved"
            if dryRun
            else f"Imported {report.pincodes.created:,} new pincodes"
        ),
    )

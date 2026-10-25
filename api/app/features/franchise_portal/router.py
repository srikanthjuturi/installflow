"""`/franchise` read-only master data for the portal's pickers — and the
monthly employee statement download (Task 06 §4.9).

Two guards as ever on a `/franchise` door: `require_franchise_principal`
(who may hold it) and a `franchise.*` feature key (whether the company opened
it). The picker routes read the company's shared master through the franchisee
wall and write nothing, so no rank floor either (§8 trap 4) — a franchisee
admin is the only audience. The statement route shares the guards (it is
`franchise.statements`) and is the one door here that returns a FILE rather
than the envelope.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    Principal,
    require_all,
    require_facility_principal,
    require_feature,
    require_franchise_principal,
)
from app.core.facility_users import (
    CREATED_MESSAGE,
    REISSUED_MESSAGE,
    create_user,
    list_users,
    reissue,
    set_user_active,
)
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
from app.features.franchise_portal import service
from app.features.franchise_portal.schemas import (
    FacilityUserCreateRequest,
    FacilityUserCreatedOut,
    FacilityUserOut,
    FacilityUserUpdateRequest,
    FranchiseOptionsOut,
    FranchisePincodeOut,
)

router = APIRouter(prefix="/franchise", tags=["franchise"])

Db = Annotated[AsyncSession, Depends(get_db)]
#: `franchise.technicians` — the same key the roster door holds, these being
#: the pickers ON that screen.
CanSee = Annotated[
    Principal,
    Depends(
        require_all(
            require_franchise_principal,
            require_feature("franchise.technicians"),
        )
    ),
]
#: `franchise.statements` — the monthly-payroll door (Task 06 §4.9), keyed
#: separately so the feature grant is what turns statements on, not the
#: pickers' key. Same audience as every `/franchise` door: the franchisee's
#: own admin.
CanSeeStatements = Annotated[
    Principal,
    Depends(
        require_all(
            require_franchise_principal,
            require_feature("franchise.statements"),
        )
    ),
]


@router.get(
    "/technician-options", response_model=ApiEnvelope[FranchiseOptionsOut]
)
async def technician_options(db: Db, principal: CanSee) -> ApiEnvelope[FranchiseOptionsOut]:
    """The Add-technician form's two pickers, narrowed to this franchisee."""
    assert principal.company_id is not None and principal.franchisee_id is not None
    return envelope(
        FranchiseOptionsOut(**await service.technician_options(
            db,
            company_id=principal.company_id,
            franchisee_id=principal.franchisee_id,
        ))
    )


@router.get("/pincodes", response_model=PaginatedEnvelope[FranchisePincodeOut])
async def pincodes(
    db: Db,
    params: Annotated[ListParams, Depends(list_params)],
    principal: CanSee,
    search: Annotated[str | None, Query()] = None,
    regionId: Annotated[uuid.UUID | None, Query()] = None,
) -> PaginatedEnvelope[FranchisePincodeOut]:
    """This franchisee's pincodes — the coverage picker.

    `search` is a code prefix; `regionId` narrows to one of the regions the
    options endpoint named. Nothing outside the franchisee is ever answered,
    and the code the portal sees is the code it can assign.
    """
    assert principal.company_id is not None and principal.franchisee_id is not None
    rows, total = await service.pincodes(
        db,
        company_id=principal.company_id,
        franchisee_id=principal.franchisee_id,
        params=params,
        search=search,
        region_id=regionId,
    )
    return paginated(
        [FranchisePincodeOut(**row) for row in rows],
        page=params.page,
        limit=params.limit,
        total=total,
    )


@router.get("/statements/{technicianId}")
async def statement(
    db: Db,
    technicianId: uuid.UUID,
    principal: CanSeeStatements,
    month: Annotated[str, Query()],
) -> Response:
    """One employee's month as the CSV payroll reads (Task 06 §4.9).

    This franchisee's view of THEIR technician only — `load_statement` answers
    through the two-clause wall (an employee of ours now, OR employee-stream
    ledger rows in the month asked for), so last month keeps downloading after
    a type change and a foreign id reads as a 404, never a 403.

    **Envelope exception** — the same one the three `.xlsx` template endpoints
    make: a SUCCESS is the raw file, because that is the only thing a
    statement is for; every failure is the standard envelope, because the
    guards and the wall run before a byte is produced. The console fetches it
    with `apiGetBlob`, which already reads that envelope's message on failure.

    The BOM is added here, at the encoding bound — Excel only shows `₹` and
    non-Latin names when the file leads with it. CORS exposes no
    `Content-Disposition` (`main.py` sets no `expose_headers`, on purpose), so
    the console names the download itself — do not "fix" that by adding
    `expose_headers` here.
    """
    assert principal.company_id is not None and principal.franchisee_id is not None
    year, month_num = resolve_month(month)
    sheet = await load_statement(
        db,
        company_id=principal.company_id,
        franchisee_id=principal.franchisee_id,
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
        # The literal "﻿" at the head of `content` IS the BOM — one
        # zero-width byte, which is what makes Excel show ₹ and Devanagari.
        content=("﻿" + body).encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── facility users (Task 12 §4.8) ────────────────────────────────────────────
#
# `require_facility_principal` — ANY franchise role, because a facility admin
# manages operators and a franchisee-admin-only guard would lock them out; the
# `franchise.facility_users` key (franchisee_admin, facility_admin) is what keeps
# operators out. Both guards are listed in `dependencies`, never stacked into one
# `Annotated`: FastAPI applies only the LAST `Depends` of an alias.
#
# Scoped `company_id` + `franchisee_id` + a facility role in `core.facility_users`,
# so another franchisee's — or a franchisee admin's — membership id is a 404. The
# creation rules (`can_create_facility_role`) are the same module's.

CanManageFacilityUsers = Annotated[
    Principal, Depends(require_feature("franchise.facility_users"))
]
IsFacilityPrincipal = Depends(require_facility_principal)


@router.get(
    "/facility-users",
    response_model=PaginatedEnvelope[FacilityUserOut],
    dependencies=[IsFacilityPrincipal],
)
async def list_facility_users(
    db: Db,
    principal: CanManageFacilityUsers,
    params: Annotated[ListParams, Depends(list_params)],
) -> PaginatedEnvelope[FacilityUserOut]:
    """Facility admins and operators of MY franchisee."""
    assert principal.company_id is not None and principal.franchisee_id is not None
    rows, total = await list_users(
        db,
        company_id=principal.company_id,
        franchisee_id=principal.franchisee_id,
        params=params,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post(
    "/facility-users",
    response_model=ApiEnvelope[FacilityUserCreatedOut],
    status_code=201,
    dependencies=[IsFacilityPrincipal],
)
async def create_facility_user(
    body: FacilityUserCreateRequest, db: Db, principal: CanManageFacilityUsers
) -> ApiEnvelope[FacilityUserCreatedOut]:
    """403 "You can only add roles below your own" for a role the caller may not
    create. **201 even when the email fails** — `data.emailStatus`, and
    `data.temporaryPassword` only when it did not go."""
    assert principal.franchisee_id is not None
    row = await create_user(
        db, actor=principal, franchisee_id=principal.franchisee_id, body=body
    )
    return envelope(row, message=CREATED_MESSAGE[row.emailStatus], status_code=201)


@router.patch(
    "/facility-users/{membershipId}",
    response_model=ApiEnvelope[FacilityUserOut],
    dependencies=[IsFacilityPrincipal],
)
async def update_facility_user(
    membershipId: uuid.UUID,
    body: FacilityUserUpdateRequest,
    db: Db,
    principal: CanManageFacilityUsers,
) -> ApiEnvelope[FacilityUserOut]:
    """Switch a facility user off (their sessions end) or back on."""
    assert principal.franchisee_id is not None
    row = await set_user_active(
        db,
        actor=principal,
        franchisee_id=principal.franchisee_id,
        membership_id=membershipId,
        active=body.isActive,
    )
    return envelope(row, message="User updated")


@router.post(
    "/facility-users/{membershipId}/reissue-password",
    response_model=ApiEnvelope[FacilityUserCreatedOut],
    dependencies=[IsFacilityPrincipal],
)
async def reissue_facility_user_password(
    membershipId: uuid.UUID, db: Db, principal: CanManageFacilityUsers
) -> ApiEnvelope[FacilityUserCreatedOut]:
    """A fresh temporary password, emailed; their old sessions end."""
    assert principal.franchisee_id is not None
    row = await reissue(
        db,
        actor=principal,
        franchisee_id=principal.franchisee_id,
        membership_id=membershipId,
    )
    return envelope(row, message=REISSUED_MESSAGE[row.emailStatus])

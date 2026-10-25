"""Facility users for the HOME franchisee — created by company Admin / National
Head (Task 12 §4.8b, owner ruling 2026-10-15, R4).

With no Admin/NH fallback for spare parts, a home franchise has no parts desk
until somebody gives it one, and it has no franchisee admin by default to do so.
So the company's Admin and National Head can create, deactivate and re-issue
facility users for the HOME franchisee — and only the home.

**There is no franchisee id in the path or body.** The franchisee is resolved
server-side (`core.franchise.home_franchisee_id`); a membership id is scoped to
it, so a facility user of any other franchisee is **404** here — those are
managed by their own franchisee's admins (F7), through
`/franchise/facility-users`.

Guards: `franchisees.manage` (Admin, National Head by default — no new feature
key) + `require_staff_principal` + a National-Head rank floor, because a feature
grant is overridable per company and "Admin / National Head" must stick.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    Principal,
    require_feature,
    require_min_rank,
    require_staff_principal,
)
from app.core.facility_users import (
    CREATED_MESSAGE,
    REISSUED_MESSAGE,
    FacilityUserCreateRequest,
    FacilityUserCreatedOut,
    FacilityUserOut,
    FacilityUserUpdateRequest,
    create_user,
    list_users,
    reissue,
    set_user_active,
)
from app.core.franchise import home_franchisee_id
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.models.role import NATIONAL_HEAD

router = APIRouter(prefix="/spare-parts/home-facility-users", tags=["spare-parts"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanManage = Annotated[Principal, Depends(require_feature("franchisees.manage"))]
#: Both in `dependencies`, never stacked into one Annotated (see router.py).
Guards = [Depends(require_staff_principal), Depends(require_min_rank(NATIONAL_HEAD))]


async def _home(db: AsyncSession, principal: Principal) -> uuid.UUID:
    assert principal.company_id is not None
    return await home_franchisee_id(db, principal.company_id)


@router.get("", response_model=PaginatedEnvelope[FacilityUserOut], dependencies=Guards)
async def list_home_facility_users(
    db: Db,
    principal: CanManage,
    params: Annotated[ListParams, Depends(list_params)],
) -> PaginatedEnvelope[FacilityUserOut]:
    """Facility admins and operators of the home franchisee."""
    assert principal.company_id is not None
    rows, total = await list_users(
        db,
        company_id=principal.company_id,
        franchisee_id=await _home(db, principal),
        params=params,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


@router.post(
    "",
    response_model=ApiEnvelope[FacilityUserCreatedOut],
    status_code=201,
    dependencies=Guards,
)
async def create_home_facility_user(
    body: FacilityUserCreateRequest, db: Db, principal: CanManage
) -> ApiEnvelope[FacilityUserCreatedOut]:
    """201 even when the password email fails — read `data.emailStatus`."""
    row = await create_user(
        db, actor=principal, franchisee_id=await _home(db, principal), body=body
    )
    return envelope(row, message=CREATED_MESSAGE[row.emailStatus], status_code=201)


@router.patch(
    "/{membershipId}", response_model=ApiEnvelope[FacilityUserOut], dependencies=Guards
)
async def update_home_facility_user(
    membershipId: uuid.UUID,
    body: FacilityUserUpdateRequest,
    db: Db,
    principal: CanManage,
) -> ApiEnvelope[FacilityUserOut]:
    row = await set_user_active(
        db,
        actor=principal,
        franchisee_id=await _home(db, principal),
        membership_id=membershipId,
        active=body.isActive,
    )
    return envelope(row, message="User updated")


@router.post(
    "/{membershipId}/reissue-password",
    response_model=ApiEnvelope[FacilityUserCreatedOut],
    dependencies=Guards,
)
async def reissue_home_facility_user_password(
    membershipId: uuid.UUID, db: Db, principal: CanManage
) -> ApiEnvelope[FacilityUserCreatedOut]:
    row = await reissue(
        db,
        actor=principal,
        franchisee_id=await _home(db, principal),
        membership_id=membershipId,
    )
    return envelope(row, message=REISSUED_MESSAGE[row.emailStatus])

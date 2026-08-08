"""Territory endpoint — the region → RH → AM → pincode picture."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_feature
from app.core.schemas import ApiEnvelope, envelope
from app.features.territory import service
from app.features.territory.schemas import TerritoryRegion

router = APIRouter(prefix="/territory", tags=["territory"])

Db = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=ApiEnvelope[list[TerritoryRegion]])
async def get_territory(
    db: Db,
    principal: Annotated[Principal, Depends(require_feature("territory.view"))],
) -> ApiEnvelope[list[TerritoryRegion]]:
    return envelope(await service.get_territory(db, principal))

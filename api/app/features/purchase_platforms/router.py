"""Purchase platform endpoints — a short company-scoped master (A7).

**Reads are open to every authenticated role in the company.** A vendor fills
this list in on the raise-a-ticket form, a franchise principal sees the same
picker in its own portal, and staff see it on the ticket detail — so unlike
most masters there is deliberately NO feature key gating the list, the same
call `notifications` makes: a per-role grant that somebody forgot to flip would
dead-end the very form that needs it. `CompanyPrincipal` alone — any signed-in
member of a company — is the whole guard.

**Writes are Admin only**, via the plain rank floor (`require_min_rank(ADMIN)`)
rather than a feature key: this is a handful of rows a company sets up once,
not a screen with its own nav entry and per-company override story yet.
Superadmin is refused for free — it holds no company membership, so it never
clears `CompanyPrincipal` in the first place.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CompanyPrincipal, require_min_rank
from app.core.schemas import ApiEnvelope, envelope
from app.features.purchase_platforms import service
from app.features.purchase_platforms.schemas import (
    PurchasePlatformCreateRequest,
    PurchasePlatformOut,
    PurchasePlatformUpdateRequest,
)
from app.models.role import ADMIN

router = APIRouter(prefix="/purchase-platforms", tags=["purchase-platforms"])

Db = Annotated[AsyncSession, Depends(get_db)]
AdminUp = Depends(require_min_rank(ADMIN))


@router.get("", response_model=ApiEnvelope[list[PurchasePlatformOut]])
async def list_purchase_platforms(
    db: Db,
    principal: CompanyPrincipal,
    activeOnly: Annotated[bool, Query()] = False,
) -> ApiEnvelope[list[PurchasePlatformOut]]:
    """Every platform this company has.

    No pagination and no guard beyond being signed in to the company — see the
    module docstring. `activeOnly=true` is what the ticket form sends.
    """
    return envelope(
        await service.list_platforms(db, principal, active_only=activeOnly)
    )


@router.post(
    "",
    response_model=ApiEnvelope[PurchasePlatformOut],
    status_code=201,
    dependencies=[AdminUp],
)
async def create_purchase_platform(
    body: PurchasePlatformCreateRequest, db: Db, principal: CompanyPrincipal
) -> ApiEnvelope[PurchasePlatformOut]:
    """Add a platform. **409** when the name already exists (case-insensitive)."""
    return envelope(
        await service.create_platform(db, principal, body),
        message="Purchase platform added",
        status_code=201,
    )


@router.put(
    "/{platform_id}",
    response_model=ApiEnvelope[PurchasePlatformOut],
    dependencies=[AdminUp],
)
async def update_purchase_platform(
    platform_id: uuid.UUID,
    body: PurchasePlatformUpdateRequest,
    db: Db,
    principal: CompanyPrincipal,
) -> ApiEnvelope[PurchasePlatformOut]:
    """Rename a platform, or flip `isActive` — the way to bring a retired one
    back without creating a second row under the same name."""
    return envelope(
        await service.update_platform(db, principal, platform_id, body),
        message="Purchase platform updated",
    )


@router.post(
    "/{platform_id}/deactivate",
    response_model=ApiEnvelope[PurchasePlatformOut],
    dependencies=[AdminUp],
)
async def deactivate_purchase_platform(
    platform_id: uuid.UUID, db: Db, principal: CompanyPrincipal
) -> ApiEnvelope[PurchasePlatformOut]:
    """Retire a platform. Never a hard delete — see `service.deactivate_platform`."""
    return envelope(
        await service.deactivate_platform(db, principal, platform_id),
        message="Purchase platform deactivated",
    )

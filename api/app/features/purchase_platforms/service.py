"""Purchase platform master — service layer.

Mirrors `features/vendors/service.py`'s shape for a simple company-scoped
master: a loader that 404s outside the caller's company (never a 403, which
would confirm a guessed id belongs to somebody else), a case-insensitive
uniqueness pre-check in front of the hand-written `lower()` partial index the
migration creates, and no hard delete — `tickets.purchase_platform_id` may
already point at the row, so `deactivate` is the only way out.
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.features.purchase_platforms.schemas import (
    PurchasePlatformCreateRequest,
    PurchasePlatformOut,
    PurchasePlatformUpdateRequest,
)
from app.models.purchase_platform import PurchasePlatform


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Purchase platform not found"
    )


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


async def _load(
    db: AsyncSession, company_id: uuid.UUID, platform_id: uuid.UUID
) -> PurchasePlatform:
    row = await db.scalar(
        select(PurchasePlatform).where(
            PurchasePlatform.id == platform_id,
            PurchasePlatform.company_id == company_id,
            PurchasePlatform.deleted_at.is_(None),
        )
    )
    if row is None:
        raise _not_found()
    return row


async def _assert_name_free(
    db: AsyncSession,
    company_id: uuid.UUID,
    name: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    stmt = select(PurchasePlatform.id).where(
        PurchasePlatform.company_id == company_id,
        PurchasePlatform.deleted_at.is_(None),
        func.lower(PurchasePlatform.name) == name.lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(PurchasePlatform.id != exclude_id)
    if await db.scalar(stmt) is not None:
        raise _conflict(f"A purchase platform called {name} already exists")


def _out(row: PurchasePlatform) -> PurchasePlatformOut:
    return PurchasePlatformOut(id=row.id, name=row.name, isActive=row.is_active)


# ── read ──────────────────────────────────────────────────────────────────────


async def list_platforms(
    db: AsyncSession, principal: Principal, *, active_only: bool = False
) -> list[PurchasePlatformOut]:
    """Every platform this company has, active first then by name.

    Not paginated: this is a short list meant to fill a dropdown in one round
    trip, the same call `vendors.list_channels` / `list_options` make for the
    same kind of form. `activeOnly=true` is the raise-a-ticket form's own
    call — it must never offer a retired platform — while the screen that
    manages the list wants a paused one too, to bring it back.
    """
    stmt = select(PurchasePlatform).where(
        PurchasePlatform.company_id == principal.company_id,
        PurchasePlatform.deleted_at.is_(None),
    )
    if active_only:
        stmt = stmt.where(PurchasePlatform.is_active.is_(True))
    stmt = stmt.order_by(
        PurchasePlatform.is_active.desc(), func.lower(PurchasePlatform.name)
    )
    rows = list(await db.scalars(stmt))
    return [_out(r) for r in rows]


# ── write (admin only — enforced at the router) ────────────────────────────────


async def create_platform(
    db: AsyncSession, principal: Principal, body: PurchasePlatformCreateRequest
) -> PurchasePlatformOut:
    name = body.name.strip()
    await _assert_name_free(db, principal.company_id, name)
    row = PurchasePlatform(
        company_id=principal.company_id,
        name=name,
        created_by=principal.user_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _out(row)


async def update_platform(
    db: AsyncSession,
    principal: Principal,
    platform_id: uuid.UUID,
    body: PurchasePlatformUpdateRequest,
) -> PurchasePlatformOut:
    row = await _load(db, principal.company_id, platform_id)
    if body.name is not None:
        name = body.name.strip()
        await _assert_name_free(db, principal.company_id, name, exclude_id=platform_id)
        row.name = name
    if body.isActive is not None:
        row.is_active = body.isActive
    row.updated_by = principal.user_id
    await db.commit()
    await db.refresh(row)
    return _out(row)


async def deactivate_platform(
    db: AsyncSession, principal: Principal, platform_id: uuid.UUID
) -> PurchasePlatformOut:
    """Retire a platform. Never a hard delete — a ticket's composite FK may
    already point at it, RESTRICT, and even one that does not yet might
    tomorrow if this were undone by a delete with no row left to restore."""
    row = await _load(db, principal.company_id, platform_id)
    row.is_active = False
    row.updated_by = principal.user_id
    await db.commit()
    await db.refresh(row)
    return _out(row)

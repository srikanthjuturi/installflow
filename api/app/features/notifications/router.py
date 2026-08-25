"""The bell, and the feed behind it.

No feature key. Every console role has events that concern it, and gating the
bell behind a permission would mean a manager with an escalation in their
territory could not be told about it because somebody had not granted a key.
The AUDIENCE is the control here, and it is the same territory rule that scopes
tickets — see `service._visible`.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CompanyPrincipal
from app.core.schemas import ApiEnvelope, envelope
from app.features.notifications import service
from app.features.notifications.schemas import NotificationOut, UnreadCountOut

router = APIRouter(prefix="/notifications", tags=["notifications"])

Db = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=ApiEnvelope[list[NotificationOut]])
async def list_notifications(
    db: Db, principal: CompanyPrincipal
) -> ApiEnvelope[list[NotificationOut]]:
    """This reader's feed, newest first.

    Empty is a normal answer. `read` is per reader — the same escalation is
    unread for one manager and dealt with by another.
    """
    return envelope(await service.list_for(db, principal))


@router.get("/unread", response_model=ApiEnvelope[UnreadCountOut])
async def unread(db: Db, principal: CompanyPrincipal) -> ApiEnvelope[UnreadCountOut]:
    """Just the number. The topbar is on every screen; it should not read a feed."""
    return envelope(UnreadCountOut(unread=await service.unread_count(db, principal)))


@router.post("/read-all", response_model=ApiEnvelope[UnreadCountOut])
async def read_all(db: Db, principal: CompanyPrincipal) -> ApiEnvelope[UnreadCountOut]:
    """Mark everything currently visible and unread. Declared BEFORE `/{id}`."""
    await service.mark_all_read(db, principal)
    return envelope(UnreadCountOut(unread=0), message="All caught up")


@router.post("/{notification_id}/read", response_model=ApiEnvelope[UnreadCountOut])
async def read_one(
    db: Db, principal: CompanyPrincipal, notification_id: uuid.UUID
) -> ApiEnvelope[UnreadCountOut]:
    """Idempotent — a duplicate tap is not an error worth showing anybody."""
    await service.mark_read(db, principal, notification_id)
    return envelope(UnreadCountOut(unread=await service.unread_count(db, principal)))

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
from app.core.deps import CompanyPrincipal, TechnicianPrincipal
from app.core.push import forget_device, register_device
from app.core.schemas import ApiEnvelope, envelope
from app.features.notifications import service
from app.features.notifications.schemas import (
    DeviceRegistration,
    NotificationOut,
    UnreadCountOut,
)

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


@router.post("/devices", response_model=ApiEnvelope[None], status_code=201)
async def register_push_device(
    db: Db, me: TechnicianPrincipal, body: DeviceRegistration
) -> ApiEnvelope[None]:
    """Remember where to push to this technician.

    Technicians only. The console is a browser tab with a live socket and a
    bell; it has nowhere to push TO, and a web-push story is a different
    feature with a different consent model.

    No feature key, and deliberately: this stores a delivery address, it does
    not decide what gets sent. Gating it would mean a technician whose company
    had not enabled some key silently stops being reachable, which looks
    exactly like the app being broken.

    Idempotent — the app calls it on every launch, because an Expo token
    rotates and changes on reinstall.
    """
    principal, profile = me
    assert principal.company_id is not None  # CompanyPrincipal guarantees it

    await register_device(
        db,
        company_id=principal.company_id,
        technician_id=profile.id,
        token=body.token,
        platform=body.platform,
        device_name=body.deviceName,
    )
    await db.commit()
    return envelope(None, message="Device registered")


@router.delete("/devices", response_model=ApiEnvelope[None])
async def unregister_push_device(
    db: Db, me: TechnicianPrincipal, body: DeviceRegistration
) -> ApiEnvelope[None]:
    """Stop pushing to this device — the Profile switch, turned off.

    Takes the token in the body rather than the path: an Expo token contains
    characters that have to be escaped in a URL, and a path parameter would put
    a device identifier into every access log between here and the client.

    Idempotent, and silent when the token is not there. Switching off something
    that is already off is not an error, and a technician toggling it twice
    should not see one.
    """
    principal, profile = me
    assert principal.company_id is not None  # CompanyPrincipal guarantees it

    await forget_device(
        db,
        company_id=principal.company_id,
        technician_id=profile.id,
        token=body.token,
    )
    await db.commit()
    return envelope(None, message="Device removed")

"""The bell, and the feed behind it.

No feature key. Every console role has events that concern it, and gating the
bell behind a permission would mean a manager with an escalation in their
territory could not be told about it because somebody had not granted a key.
The AUDIENCE is the control here, and it is the same territory rule that scopes
tickets — see `service._visible`.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import CompanyPrincipal, TechnicianPrincipal
from app.core.push import forget_device, register_device
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.core.webpush import (
    forget_all_for_user,
    forget_subscription,
    register_subscription,
)
from app.features.notifications import service
from app.features.notifications.schemas import (
    DeviceRegistration,
    NotificationKind,
    NotificationOut,
    UnreadCountOut,
    WebPushKeyOut,
    WebPushRegistration,
    WebPushUnregistration,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])

Db = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=PaginatedEnvelope[NotificationOut])
async def list_notifications(
    db: Db,
    principal: CompanyPrincipal,
    params: Annotated[ListParams, Depends(list_params)],
    kind: Annotated[NotificationKind | None, Query()] = None,
    unread: Annotated[bool, Query()] = False,
) -> PaginatedEnvelope[NotificationOut]:
    """This reader's feed, newest first, a page at a time.

    Empty is a normal answer. `read` is per reader — the same escalation is
    unread for one manager and dealt with by another.

    `search` matches the title and the detail, which between them hold every
    word a reader saw: the ticket code is inside the title. `kind` and `unread`
    narrow; neither can widen, because the audience is settled before any of
    them is applied.

    There is no `sortBy`. A feed has one order — newest first — and offering to
    reverse it would offer to hide the events that matter most behind the ones
    nobody is acting on any more.
    """
    rows, total = await service.list_page(
        db,
        principal,
        page=params.page,
        limit=params.limit,
        search=params.search,
        kind=kind,
        unread_only=unread,
    )
    return paginated(rows, page=params.page, limit=params.limit, total=total)


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


@router.get("/web-push-key", response_model=ApiEnvelope[WebPushKeyOut])
async def web_push_key(principal: CompanyPrincipal) -> ApiEnvelope[WebPushKeyOut]:
    """The VAPID public key a browser needs to subscribe.

    Signed in only. The key is not a secret — every subscriber receives it — but
    an unauthenticated endpoint here would advertise whether this deployment has
    web push configured to anybody who asked, and nothing needs that.

    An empty string is a real answer, not an error: it means this deployment has
    no VAPID pair, and the console renders "not available" instead of a switch
    that could never work.
    """
    return envelope(WebPushKeyOut(publicKey=settings.VAPID_PUBLIC_KEY))


@router.post("/web-devices", response_model=ApiEnvelope[None], status_code=201)
async def register_web_device(
    db: Db, principal: CompanyPrincipal, body: WebPushRegistration
) -> ApiEnvelope[None]:
    """Remember where to reach this browser.

    `CompanyPrincipal` rather than the technician dependency the pair above use:
    this is the console and the vendor portal, and a vendor gets pushed about
    the serial mismatches that name them exactly as staff get pushed about their
    own territory. A technician has the app and `/devices`.

    No feature key, for the same reason as `/devices`: this stores a delivery
    address, it does not decide what is sent. Gating it would mean somebody
    whose company had not been granted some key silently stops being reachable,
    which looks exactly like the feature being broken.

    Idempotent — the console re-registers whenever it finds a subscription it
    has not sent, because a browser may rotate one without telling anybody.
    """
    assert principal.company_id is not None  # CompanyPrincipal guarantees it

    await register_subscription(
        db,
        company_id=principal.company_id,
        user_id=principal.user_id,
        endpoint=body.endpoint,
        p256dh=body.p256dh,
        auth=body.auth,
        user_agent=body.userAgent,
    )
    await db.commit()
    return envelope(None, message="Desktop alerts on")


@router.delete("/web-devices", response_model=ApiEnvelope[None])
async def unregister_web_device(
    db: Db, principal: CompanyPrincipal, body: WebPushUnregistration
) -> ApiEnvelope[None]:
    """Stop pushing to this browser — the toggle off, or a sign-out.

    Takes the endpoint in the body rather than the path for `/devices`' reason
    and more so: an endpoint is a full URL, and a path parameter would put every
    console user's push address into every access log between here and Azure.

    Omitting the endpoint drops every subscription this user holds in this
    company. That is what signing out and switching company send, because
    leaving a row behind is what puts one company's notification text on the
    screen of somebody now working in another.

    Idempotent, and silent when there is nothing to remove. Turning something
    off that is already off is not an error.
    """
    assert principal.company_id is not None  # CompanyPrincipal guarantees it

    if body.endpoint:
        await forget_subscription(
            db,
            company_id=principal.company_id,
            user_id=principal.user_id,
            endpoint=body.endpoint,
        )
    else:
        await forget_all_for_user(
            db, company_id=principal.company_id, user_id=principal.user_id
        )
    await db.commit()
    return envelope(None, message="Desktop alerts off")

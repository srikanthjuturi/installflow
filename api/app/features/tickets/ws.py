"""The console's live ticket feed.

A websocket for the ops console and the vendor portal, saying one thing — *this
ticket moved* — and never what changed. The client re-reads through
`GET /tickets`, which applies the real visibility rule in SQL.

## Why this filters rather than broadcasting

The technician's pool socket biases toward ringing too often, because a spurious
ring costs one query. This one cannot take the same liberty with vendors: a
vendor learning that a ticket id exists is a vendor learning about another
vendor's customer. So the vendor test here is exact, and matches `scoped()`
line for line.

Staff are filtered by territory for the same reason, just a weaker one — an area
manager has no business knowing the ids of tickets outside their states, even
though fetching one would 404.

## The visibility set is cached, and may be a minute stale

An area manager's states can hold nearly two thousand pincodes, so it is
materialised once per connection and refreshed on a TTL rather than re-queried
per event. A territory change therefore takes up to a minute to affect what the
console hears — which is a refresh delay, not an access-control gap: the REST
read behind every one of these is authoritative and always current.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import uuid

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.deps import Principal
from app.core.realtime import NotificationRaised, TicketChanged, broker
from app.core.security import decode_token
from app.models.membership import Membership
from app.models.role import ROLE_RANKS, SUPERADMIN, TECHNICIAN, VENDOR_USER
from app.models.user import User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/tickets", tags=["tickets"])

_AUTH_TIMEOUT = 10.0
_PING_SECONDS = 25.0
_VISIBILITY_TTL = 60.0

_CLOSE_AUTH_FAILED = 4401


class _Visibility:
    """Who this viewer may hear about. Mirrors `service.scoped`, in memory."""

    __slots__ = ("all_india", "pincodes", "vendor_id", "user_id", "vendor_user", "_at")

    def __init__(self) -> None:
        self.all_india = False
        self.pincodes: set[str] = set()
        self.vendor_id: uuid.UUID | None = None
        self.user_id: uuid.UUID | None = None
        self.vendor_user = False
        self._at = 0.0

    @property
    def stale(self) -> bool:
        return (time.monotonic() - self._at) > _VISIBILITY_TTL

    async def load(self, db: AsyncSession, principal: Principal) -> None:
        # Imported here rather than at module scope: `service` imports plenty,
        # and a websocket module pulled into the app at import time should not
        # widen that graph.
        from app.features.tickets import service

        self.user_id = principal.user_id
        if principal.is_vendor:
            self.vendor_id = principal.vendor_id
            self.vendor_user = principal.role == VENDOR_USER
            self._at = time.monotonic()
            return

        visible = await service._visible_pincodes(db, principal)
        if visible is None:
            # All-India role — everything in the company.
            self.all_india = True
            self.pincodes = set()
        elif isinstance(visible, list):
            # Covers nothing, so hears nothing. Fail closed.
            self.all_india = False
            self.pincodes = set()
        else:
            self.all_india = False
            self.pincodes = set(await db.scalars(visible))
        self._at = time.monotonic()

    def hears_notification(
        self, pincode: str | None, vendor: uuid.UUID | None
    ) -> bool:
        """Whether this viewer is in a notification's audience.

        Two audiences, and a row can be in both. Staff are matched on territory
        — a null pincode is company-wide and reaches everyone. A vendor is
        matched only on being NAMED: most events here are operational problems
        of ours, and telling a vendor "no technician accepted this" is telling
        them about our staffing rather than their customer.

        The vendor test is `==` on their own id and never falls through to the
        territory branch. A vendor has no territory, and letting one reach that
        code would hand them every company-wide notification we write.
        """
        if self.vendor_id is not None:
            return vendor is not None and vendor == self.vendor_id
        if self.all_india or pincode is None:
            return True
        return pincode in self.pincodes

    def may_hear(self, event: TicketChanged) -> bool:
        if self.vendor_id is not None:
            if event.vendor_id != self.vendor_id:
                return False
            # A vendor's sub-user sees only what they raised themselves.
            return not self.vendor_user or event.created_by == self.user_id
        if self.all_india:
            return True
        return event.pincode in self.pincodes


async def _authenticate(
    db: AsyncSession, token: str
) -> tuple[Principal, uuid.UUID] | None:
    """A console principal, or None. Never a technician and never a superadmin.

    Technicians have their own stream and their own rules; a superadmin holds no
    membership, so there is no company whose tickets they would be listening to.
    """
    try:
        payload = decode_token(token)
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "access":
        return None

    try:
        user_id = uuid.UUID(str(payload.get("sub")))
        company_id = uuid.UUID(str(payload.get("company_id")))
    except (ValueError, TypeError):
        return None

    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None or not user.is_active or user.deleted_at is not None:
        return None
    if user.role in (TECHNICIAN, SUPERADMIN):
        return None

    membership = await db.scalar(
        select(Membership).where(
            Membership.user_id == user_id,
            Membership.company_id == company_id,
            Membership.is_active.is_(True),
            Membership.deleted_at.is_(None),
        )
    )
    if membership is None:
        return None

    return (
        Principal(
            user=user,
            role=user.role,
            rank=ROLE_RANKS.get(user.role, max(ROLE_RANKS.values())),
            is_superadmin=False,
            company_id=company_id,
            vendor_id=membership.vendor_id,
        ),
        company_id,
    )


async def _drain(ws: WebSocket) -> None:
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        while True:
            await ws.receive_text()


@router.websocket("/stream")
async def ticket_stream(ws: WebSocket) -> None:
    """Live ticket movement for one console user.

    Sessions are opened per operation, never held for the connection — a console
    left open all day would otherwise hold a Postgres connection all day.
    """
    await ws.accept()

    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=_AUTH_TIMEOUT)
    except (asyncio.TimeoutError, WebSocketDisconnect):
        with contextlib.suppress(RuntimeError):
            await ws.close(code=_CLOSE_AUTH_FAILED, reason="No auth frame")
        return

    try:
        token = str(json.loads(raw)["token"])
    except (json.JSONDecodeError, KeyError, TypeError):
        await ws.close(code=_CLOSE_AUTH_FAILED, reason="Malformed auth frame")
        return

    async with AsyncSessionLocal() as db:
        identity = await _authenticate(db, token)
    if identity is None:
        await ws.close(code=_CLOSE_AUTH_FAILED, reason="Invalid token")
        return
    principal, company_id = identity

    visibility = _Visibility()
    try:
        async with AsyncSessionLocal() as db:
            await visibility.load(db, principal)
    except Exception:
        log.exception("realtime: could not resolve visibility for %s", principal.user_id)
        await ws.close(code=_CLOSE_AUTH_FAILED, reason="Visibility unavailable")
        return

    await ws.send_json({"type": "ready", "polling": not broker.listening})

    reader = asyncio.create_task(_drain(ws), name="ticket-stream-drain")
    try:
        async with broker.subscribe() as mailbox:
            while True:
                if reader.done():
                    break
                try:
                    event = await asyncio.wait_for(mailbox.get(), timeout=_PING_SECONDS)
                except asyncio.TimeoutError:
                    await ws.send_json({"type": "ping"})
                    continue

                if event.company_id != company_id:
                    continue

                if isinstance(event, NotificationRaised):
                    if visibility.stale:
                        with contextlib.suppress(Exception):
                            async with AsyncSessionLocal() as db:
                                await visibility.load(db, principal)
                    if visibility.hears_notification(event.pincode, event.vendor_id):
                        # No id and no text: the bell is a count, and the feed
                        # behind it applies the audience rule properly.
                        await ws.send_json({"type": "notification.raised"})
                    continue

                # Only ticket movement past here. The pool and per-technician
                # events share this channel and are not the console's business.
                if not isinstance(event, TicketChanged):
                    continue

                if visibility.stale:
                    with contextlib.suppress(Exception):
                        async with AsyncSessionLocal() as db:
                            await visibility.load(db, principal)
                if not visibility.may_hear(event):
                    continue

                await ws.send_json(
                    {"type": "ticket.changed", "ticketId": str(event.ticket_id)}
                )
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        reader.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await reader

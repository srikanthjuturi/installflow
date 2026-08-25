"""The technician's live pool stream.

A websocket that says one word — *something in your pool changed* — and never
says what. The client answers it by re-reading `GET /jobs/pool`, the endpoint
that already masks the customer and already scopes to the tenant. Keeping the
payload empty is what stops this file from becoming a second, weaker copy of
those rules; see the module docstring in `app.core.realtime`.

## Authentication

The token arrives in the **first frame**, not in the query string:

    → {"type": "auth", "token": "<access token>"}
    ← {"type": "ready", "polling": false}

A `?token=` would be simpler and is what most examples do, but a URL is the one
part of a request that gets written down everywhere — Azure's access logs, any
proxy in between, the browser history of anybody who opens the console. An
access token is a bearer credential; it does not belong in any of those. The
first-frame handshake costs one round trip and keeps it out of all of them.

The handshake is on a timer. A connection that opens and then says nothing is
either a scanner or a broken client, and either way it must not hold a slot.

## Why the socket filters at all

It could forward every event for the company and let the app decide. It does
not, because "decide" would mean the phone re-reading the pool every time
*anybody* in the company raises a ticket — the exact data cost the twenty-second
poll was written to avoid.

The filter is deliberately biased toward **ringing too often rather than too
rarely**. A spurious ring costs one indexed query and the client sees the same
list; a missed ring costs a technician the job. So the coverage cache is allowed
to be up to a minute stale, and anything the socket is unsure of gets sent.
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

from app.core import presence
from app.core.database import AsyncSessionLocal
from app.core.realtime import JobChanged, PoolChanged, broker
from app.core.security import decode_token
from app.models.membership import Membership
from app.models.role import TECHNICIAN
from app.models.technician import (
    TechnicianPincode,
    TechnicianProfile,
    TechnicianSubcategory,
)
from app.models.user import User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["jobs"])

#: Seconds a freshly opened socket has to send its auth frame.
_AUTH_TIMEOUT = 10.0

#: Seconds between server pings.
#:
#: Azure App Service drops an idle connection at 230 seconds and mobile carriers
#: are far less patient than that — an idle NAT mapping on a phone network can
#: go in under a minute. Pinging well inside the shortest of those keeps the
#: connection alive and, just as importantly, makes a dead one *fail*: without
#: traffic, a socket severed by a tunnel or a handover looks identical to a
#: quiet one, and the app would sit there believing it was live.
_PING_SECONDS = 25.0

#: How long a technician's coverage may be cached before the next event re-reads
#: it. See the module docstring on biasing toward a spurious ring.
_COVERAGE_TTL = 60.0

# Close codes. 1008 is "policy violation"; the 4xxx range is reserved for the
# application, and a distinct code is what lets the client tell "your token
# expired, go refresh it" apart from "the server is unwell, back off".
_CLOSE_AUTH_FAILED = 4401
_CLOSE_NOT_TECHNICIAN = 4403


class _Coverage:
    """The two sets a pool event is matched against, cached with a TTL."""

    __slots__ = ("pincodes", "subcategories", "_loaded_at")

    def __init__(self) -> None:
        self.pincodes: set[str] = set()
        self.subcategories: set[uuid.UUID] = set()
        self._loaded_at = 0.0

    @property
    def stale(self) -> bool:
        return (time.monotonic() - self._loaded_at) > _COVERAGE_TTL

    async def load(
        self, db: AsyncSession, *, company_id: uuid.UUID, technician_id: uuid.UUID
    ) -> None:
        pincodes = await db.scalars(
            select(TechnicianPincode.pincode).where(
                TechnicianPincode.company_id == company_id,
                TechnicianPincode.technician_id == technician_id,
            )
        )
        subcategories = await db.scalars(
            select(TechnicianSubcategory.subcategory_id).where(
                TechnicianSubcategory.company_id == company_id,
                TechnicianSubcategory.technician_id == technician_id,
            )
        )
        self.pincodes = set(pincodes)
        self.subcategories = set(subcategories)
        self._loaded_at = time.monotonic()

    def matches(self, event: PoolChanged) -> bool:
        return (
            event.pincode in self.pincodes
            and event.subcategory_id in self.subcategories
        )


async def _authenticate(
    db: AsyncSession, token: str
) -> tuple[uuid.UUID, uuid.UUID] | None:
    """`(company_id, technician_profile_id)`, or None if this token may not listen.

    Mirrors `get_current_principal` + `require_technician_principal` rather than
    depending on them: those raise `HTTPException`, which on a websocket route
    is a 500 and a dropped connection instead of a close code the client can
    read. Every check they make is made here — token type, user still active,
    membership still active and not soft-deleted, role, profile exists — because
    a long-lived socket is precisely where a revoked account would otherwise
    keep working until the token expired.
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
    if user.role != TECHNICIAN:
        return None

    profile = await db.scalar(
        select(TechnicianProfile)
        .join(Membership, Membership.id == TechnicianProfile.membership_id)
        .where(
            Membership.user_id == user_id,
            Membership.company_id == company_id,
            Membership.is_active.is_(True),
            Membership.deleted_at.is_(None),
            TechnicianProfile.company_id == company_id,
        )
    )
    if profile is None:
        return None
    return company_id, profile.id


async def _drain(ws: WebSocket) -> None:
    """Consume whatever the client sends, so a disconnect surfaces promptly.

    Nothing the app sends after the handshake means anything — the stream is
    one-way. But an unread receive buffer is how a closed socket goes unnoticed,
    so this exists to notice.
    """
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        while True:
            await ws.receive_text()


@router.websocket("/stream")
async def pool_stream(ws: WebSocket) -> None:
    """One technician's live pool.

    ## Sessions are opened per operation, never held for the connection

    This socket lives for hours. A `AsyncSessionLocal()` wrapped around all of
    that would check a connection out of the pool on its first query and keep it
    — along with an idle-in-transaction transaction on Postgres — until the
    technician closed the app. A hundred phones would then hold a hundred
    connections to do nothing, and the pool would be exhausted by *success*.

    So every database touch below opens its own short session and gives the
    connection straight back. The socket itself costs no database resources
    while it waits, which is what it does almost all of the time.
    """
    await ws.accept()

    # ── handshake ────────────────────────────────────────────────────────────
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=_AUTH_TIMEOUT)
    except (asyncio.TimeoutError, WebSocketDisconnect):
        with contextlib.suppress(RuntimeError):
            await ws.close(code=_CLOSE_AUTH_FAILED, reason="No auth frame")
        return

    try:
        frame = json.loads(raw)
        token = str(frame["token"])
    except (json.JSONDecodeError, KeyError, TypeError):
        await ws.close(code=_CLOSE_AUTH_FAILED, reason="Malformed auth frame")
        return

    async with AsyncSessionLocal() as db:
        identity = await _authenticate(db, token)
    if identity is None:
        await ws.close(code=_CLOSE_AUTH_FAILED, reason="Invalid token")
        return
    company_id, technician_id = identity

    coverage = _Coverage()
    try:
        async with AsyncSessionLocal() as db:
            await coverage.load(
                db, company_id=company_id, technician_id=technician_id
            )
            # Connected IS the definition of reachable, so presence starts here
            # rather than waiting for the first ping — otherwise a technician who
            # opens the app and immediately looks at it reads as offline for
            # twenty-five seconds.
            await presence.touch(
                db, company_id=company_id, technician_id=technician_id
            )
    except Exception:
        log.exception("realtime: could not start stream for %s", technician_id)
        await ws.close(code=_CLOSE_NOT_TECHNICIAN, reason="Coverage unavailable")
        return

    # `polling` tells the app whether it still needs its fallback timer at full
    # speed. If this worker's LISTEN connection is down, the socket is honest
    # about being useless rather than quietly delivering nothing.
    await ws.send_json({"type": "ready", "polling": not broker.listening})

    # ── the stream ───────────────────────────────────────────────────────────
    reader = asyncio.create_task(_drain(ws), name="pool-stream-drain")
    try:
        async with broker.subscribe() as mailbox:
            while True:
                if reader.done():
                    break
                try:
                    event = await asyncio.wait_for(
                        mailbox.get(), timeout=_PING_SECONDS
                    )
                except asyncio.TimeoutError:
                    await ws.send_json({"type": "ping"})
                    # The ping is also the heartbeat that keeps this technician
                    # visibly online. Failing to stamp is not worth dropping a
                    # working stream over — the next ping is twenty-five seconds
                    # away, and presence tolerates three missed ones.
                    try:
                        async with AsyncSessionLocal() as db:
                            await presence.touch(
                                db,
                                company_id=company_id,
                                technician_id=technician_id,
                            )
                    except Exception:
                        log.warning(
                            "realtime: presence touch failed for %s", technician_id
                        )
                    continue

                if event.company_id != company_id:
                    continue

                # Addressed to one technician — no coverage test, because this
                # is not an offer. It is their own job moving under them,
                # usually because the customer has just answered.
                if isinstance(event, JobChanged):
                    if event.technician_id == technician_id:
                        await ws.send_json(
                            {"type": "job.changed", "jobId": str(event.ticket_id)}
                        )
                    continue

                if coverage.stale:
                    # Refreshed only when there is an event to judge, so an idle
                    # socket costs nothing. A failure here is not fatal: fall
                    # through on the sets we already have.
                    with contextlib.suppress(Exception):
                        async with AsyncSessionLocal() as db:
                            await coverage.load(
                                db,
                                company_id=company_id,
                                technician_id=technician_id,
                            )
                if not coverage.matches(event):
                    continue

                await ws.send_json({"type": "pool.changed"})
    except (WebSocketDisconnect, RuntimeError):
        # The client went away mid-send. Normal on a phone.
        pass
    finally:
        reader.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await reader

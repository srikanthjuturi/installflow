"""Live server→client events, fanned out across workers by Postgres.

## Why this exists

The pool used to be discovered by asking every twenty seconds. That is fine
until you watch somebody raise a ticket and then watch a technician's phone not
show it, which is the moment the delay stops being a design choice and starts
being the product looking broken.

## Why Postgres and not Redis

Azure serves this app with `gunicorn -w 2` (see `application.py`), so there are
**two processes**, and a socket held by worker A is invisible to a ticket
created on worker B. Any in-process registry silently drops half the events —
the worst possible failure, because it works perfectly in local development
where there is one worker.

The usual answer is Redis pub/sub. The better answer here is the database we
already have: Postgres `LISTEN`/`NOTIFY` is exactly a pub/sub bus, it costs one
extra connection per worker, and it needs no new Azure resource, no new secret
and no new thing to be down at 2am.

It also gets the transaction boundary right for free, which Redis does not:
**`NOTIFY` is transactional.** A notify issued inside a transaction is delivered
only if that transaction COMMITS. A ticket whose creation rolls back never rings
anybody's phone, and we did not have to write a line to make that true.

## What travels

As little as possible. The event is a **doorbell, not a delivery van** —

    {"kind": "pool.changed", "company_id": ..., "pincode": ..., "subcategory_id": ...}

— three routing facts and no customer data. The client is told only that
something it can see has changed; it then re-reads the pool through the normal
authenticated REST endpoint, which already masks the customer and already scopes
to the tenant. So this file adds no new place for a name or a phone number to
escape, and hard rule 0 is enforced where it already was.

`pincode` and `subcategory_id` are in the payload so a listening socket can
decide *without a query* whether its technician cares. They are not secrets:
they are the two facts the technician's own coverage is already defined by, and
a socket only ever sees them for its own company.

## The 8000-byte wall

`NOTIFY` payloads are capped at 8000 bytes by Postgres. Nothing here comes close
— but that cap is the reason the design must never grow into shipping the
ticket itself, however tempting it looks later.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import psycopg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

log = logging.getLogger(__name__)

#: One channel for the whole app. Filtering happens in the subscriber, not by
#: multiplying channels: a channel per company would mean re-issuing LISTEN
#: whenever a company is created, and there is no volume here that justifies it.
CHANNEL = "reliancegreentech_events"

#: How long a subscriber's mailbox may grow before we start dropping.
#:
#: A slow socket must never become back-pressure on the shared reader — one
#: phone in a tunnel would stall every other technician's events. Past this
#: depth the OLDEST event is discarded, which is the right one to lose: every
#: event says the same thing ("re-read the pool"), so the newest alone still
#: produces a correct screen.
_MAILBOX_MAX = 64


@dataclass(frozen=True, slots=True)
class PoolChanged:
    """Something entered the pool for one company."""

    company_id: uuid.UUID
    pincode: str
    subcategory_id: uuid.UUID

    def as_payload(self) -> str:
        return json.dumps(
            {
                "kind": "pool.changed",
                "company_id": str(self.company_id),
                "pincode": self.pincode,
                "subcategory_id": str(self.subcategory_id),
            },
            separators=(",", ":"),
        )

    @staticmethod
    def from_payload(raw: dict[str, Any]) -> PoolChanged | None:
        if raw.get("kind") != "pool.changed":
            return None
        try:
            return PoolChanged(
                company_id=uuid.UUID(str(raw["company_id"])),
                pincode=str(raw["pincode"]),
                subcategory_id=uuid.UUID(str(raw["subcategory_id"])),
            )
        except (KeyError, ValueError, TypeError):
            # A malformed payload is a bug on the publishing side, not something
            # to kill the reader over — every other subscriber still wants its
            # events.
            log.warning("realtime: discarding malformed payload %r", raw)
            return None


@dataclass(frozen=True, slots=True)
class JobChanged:
    """Something happened to ONE technician's job, and they should see it now.

    Addressed rather than broadcast. `PoolChanged` says "something you might be
    able to take has changed" and every eligible technician filters it against
    their own coverage; this says "your job moved", and only one person is meant
    to receive it.

    Carries no detail beyond the id — same doorbell rule as everything else on
    this channel. The client re-reads `GET /jobs/{id}`, which already enforces
    that the job is theirs.
    """

    company_id: uuid.UUID
    technician_id: uuid.UUID
    ticket_id: uuid.UUID

    def as_payload(self) -> str:
        return json.dumps(
            {
                "kind": "job.changed",
                "company_id": str(self.company_id),
                "technician_id": str(self.technician_id),
                "ticket_id": str(self.ticket_id),
            },
            separators=(",", ":"),
        )

    @staticmethod
    def from_payload(raw: dict[str, Any]) -> "JobChanged | None":
        if raw.get("kind") != "job.changed":
            return None
        try:
            return JobChanged(
                company_id=uuid.UUID(str(raw["company_id"])),
                technician_id=uuid.UUID(str(raw["technician_id"])),
                ticket_id=uuid.UUID(str(raw["ticket_id"])),
            )
        except (KeyError, ValueError, TypeError):
            log.warning("realtime: discarding malformed payload %r", raw)
            return None


@dataclass(frozen=True, slots=True)
class TicketChanged:
    """A ticket moved, for the CONSOLE and the vendor portal.

    Carries the three facts the console's visibility rule is written in terms
    of, and nothing else:

      pincode     staff see by territory
      vendor_id   a vendor sees the tickets raised against it
      created_by  a vendor USER sees only the ones they raised themselves

    Deliberately no status, no customer, no code. The subscriber decides
    whether this viewer may know the ticket changed, and then the viewer
    re-reads through `GET /tickets`, which applies the same rule properly in
    SQL. Sending the status would mean this file had a second, weaker copy of a
    visibility rule — which is how the wrong person eventually learns something.
    """

    company_id: uuid.UUID
    ticket_id: uuid.UUID
    pincode: str
    vendor_id: uuid.UUID
    created_by: uuid.UUID | None

    def as_payload(self) -> str:
        return json.dumps(
            {
                "kind": "ticket.changed",
                "company_id": str(self.company_id),
                "ticket_id": str(self.ticket_id),
                "pincode": self.pincode,
                "vendor_id": str(self.vendor_id),
                "created_by": str(self.created_by) if self.created_by else None,
            },
            separators=(",", ":"),
        )

    @staticmethod
    def from_payload(raw: dict[str, Any]) -> "TicketChanged | None":
        if raw.get("kind") != "ticket.changed":
            return None
        try:
            raised_by = raw.get("created_by")
            return TicketChanged(
                company_id=uuid.UUID(str(raw["company_id"])),
                ticket_id=uuid.UUID(str(raw["ticket_id"])),
                pincode=str(raw["pincode"]),
                vendor_id=uuid.UUID(str(raw["vendor_id"])),
                created_by=uuid.UUID(str(raised_by)) if raised_by else None,
            )
        except (KeyError, ValueError, TypeError):
            log.warning("realtime: discarding malformed payload %r", raw)
            return None


@dataclass(frozen=True, slots=True)
class NotificationRaised:
    """Somebody's bell should ring now.

    Same doorbell rule as everything else here: no title, no detail, nothing
    about the ticket. The console re-reads `GET /notifications`, which applies
    the audience rule properly. Carrying the text would mean this file held a
    second, weaker copy of who may read what.

    `pincode` travels because it IS the staff audience — the console socket
    already holds each viewer's territory and can decide without a query.
    `vendor_id` is the other half: a row addressed to a vendor reaches their
    portal, and without it here the socket could only guess, which for a vendor
    means either missing their own events or hearing everybody's.

    `notification_id` names the row and carries none of it. It is here for web
    push, which has to re-read the title and detail to put them in an encrypted
    payload, and which has to deduplicate across the two Azure workers that both
    receive this frame. An id is routing — it is the address of the content, not
    the content — so the rule above still holds: nothing here says what
    happened, and the console still learns that by asking.
    """

    company_id: uuid.UUID
    pincode: str | None
    vendor_id: uuid.UUID | None = None
    notification_id: uuid.UUID | None = None

    def as_payload(self) -> str:
        return json.dumps(
            {
                "kind": "notification.raised",
                "company_id": str(self.company_id),
                "pincode": self.pincode,
                "vendor_id": str(self.vendor_id) if self.vendor_id else None,
                "notification_id": (
                    str(self.notification_id) if self.notification_id else None
                ),
            },
            separators=(",", ":"),
        )

    @staticmethod
    def from_payload(raw: dict[str, Any]) -> "NotificationRaised | None":
        if raw.get("kind") != "notification.raised":
            return None
        try:
            code = raw.get("pincode")
            vendor = raw.get("vendor_id")
            # Optional on the way in, so a frame published by an older worker
            # mid-deploy degrades to "the bell rings, nothing is pushed"
            # rather than to a discarded payload.
            row_id = raw.get("notification_id")
            return NotificationRaised(
                company_id=uuid.UUID(str(raw["company_id"])),
                pincode=str(code) if code else None,
                vendor_id=uuid.UUID(str(vendor)) if vendor else None,
                notification_id=uuid.UUID(str(row_id)) if row_id else None,
            )
        except (KeyError, ValueError, TypeError):
            log.warning("realtime: discarding malformed payload %r", raw)
            return None


#: Everything that travels on the channel.
@dataclass(frozen=True, slots=True)
class TechnicianChanged:
    """A technician's own availability moved, for the CONSOLE.

    Raised when they toggle "accepting work" or change their daily cap — the
    two things they can change about themselves that a manager assigning work
    needs to see. Without it the availability pill is only ever as fresh as the
    last page load, and a manager hands a job to somebody who went offline ten
    minutes ago.

    Deliberately NOT raised for presence. `last_seen_at` is stamped on every
    socket ping, so publishing that would be a firehose — one frame per
    technician per 30 seconds, to say nothing anybody asked about. Reachability
    decays on a TTL and the console picks it up on its normal refetch, which is
    the right trade: a toggle is a decision and should be instant, while
    "their phone went quiet" is an observation that can arrive a minute late.

    Carries no state, like everything else here. The console re-reads
    `GET /technicians`, which applies territory scoping in SQL.
    """

    company_id: uuid.UUID
    technician_id: uuid.UUID

    def as_payload(self) -> str:
        return json.dumps(
            {
                "kind": "technician.changed",
                "company_id": str(self.company_id),
                "technician_id": str(self.technician_id),
            },
            separators=(",", ":"),
        )

    @staticmethod
    def from_payload(raw: dict[str, Any]) -> "TechnicianChanged | None":
        if raw.get("kind") != "technician.changed":
            return None
        try:
            return TechnicianChanged(
                company_id=uuid.UUID(str(raw["company_id"])),
                technician_id=uuid.UUID(str(raw["technician_id"])),
            )
        except (KeyError, ValueError, TypeError):
            log.warning("realtime: discarding malformed payload %r", raw)
            return None


async def publish_technician_changed(
    db: AsyncSession, *, company_id: uuid.UUID, technician_id: uuid.UUID
) -> None:
    """Tell the consoles this technician's availability moved."""
    await db.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {
            "channel": CHANNEL,
            "payload": TechnicianChanged(
                company_id=company_id, technician_id=technician_id
            ).as_payload(),
        },
    )


Event = (
    PoolChanged | JobChanged | TicketChanged | NotificationRaised | TechnicianChanged
)


async def publish_notification(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    pincode: str | None,
    vendor_id: uuid.UUID | None = None,
    notification_id: uuid.UUID | None = None,
) -> None:
    """Tell every console whose territory covers this that the bell moved.

    `vendor_id` additionally rings the named vendor's portal. It widens the
    audience; it never narrows the staff one.

    `notification_id` is what web push needs to find the row again and to
    deduplicate across workers. Pass it — `notify()` flushes so the id exists
    before the commit. Omitting it still rings every open console; it only
    means nothing reaches a browser that is closed.
    """
    await db.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {
            "channel": CHANNEL,
            "payload": NotificationRaised(
                company_id=company_id,
                pincode=pincode,
                vendor_id=vendor_id,
                notification_id=notification_id,
            ).as_payload(),
        },
    )


async def publish_ticket_changed(db: AsyncSession, row: Any) -> None:
    """Announce that one ticket moved. Takes the Ticket row itself.

    Called from every transition — created, slot confirmed, assigned, started,
    completed, closed, escalated — so the console and the vendor portal stop
    needing a refresh to see the operation move.

    Typed loosely on purpose: `app.core` must not import a model from a slice's
    world to state a signature, and every caller already holds the row.
    """
    await db.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {
            "channel": CHANNEL,
            "payload": TicketChanged(
                company_id=row.company_id,
                ticket_id=row.id,
                pincode=row.pincode,
                vendor_id=row.vendor_id,
                created_by=row.created_by,
            ).as_payload(),
        },
    )


async def publish_job_changed(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
    ticket_id: uuid.UUID,
) -> None:
    """Tell one technician their job moved, when this transaction commits.

    The case this was built for: the customer answers the confirmation link and
    the job closes — or comes back escalated. The technician may well still be
    outside the house. Waiting up to two minutes for a poll to notice is the
    difference between "the app told me" and "I found out later".
    """
    event = JobChanged(
        company_id=company_id, technician_id=technician_id, ticket_id=ticket_id
    )
    await db.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {"channel": CHANNEL, "payload": event.as_payload()},
    )


async def publish_pool_changed(
    db: AsyncSession, *, company_id: uuid.UUID, pincode: str, subcategory_id: uuid.UUID
) -> None:
    """Ring the doorbell **when this transaction commits**.

    Deliberately not committing here, and deliberately not on its own
    connection: it must join the caller's transaction, because a ticket that
    fails to save must not notify. Callers put this next to the write it
    describes and let their existing commit carry both.

    `pg_notify(...)` rather than `NOTIFY channel, 'payload'` because the payload
    is then a bind parameter — a literal would be string-built SQL wrapped
    around customer-adjacent data, and the first pincode with an apostrophe in
    it would be an injection rather than a bug.
    """
    event = PoolChanged(
        company_id=company_id, pincode=pincode, subcategory_id=subcategory_id
    )
    await db.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {"channel": CHANNEL, "payload": event.as_payload()},
    )


def _raw_dsn() -> str:
    """`postgresql+psycopg://…` → `postgresql://…`.

    SQLAlchemy's driver suffix is meaningless to psycopg itself, and this
    connection is deliberately raw: `LISTEN` needs a session that is never
    returned to a pool and never wrapped in a transaction, which is the exact
    opposite of what the ORM engine is for.
    """
    return settings.DATABASE_URL.replace("postgresql+psycopg://", "postgresql://", 1)


class Broker:
    """One per worker process: a single LISTEN connection, many subscribers.

    The alternative — a connection per websocket — puts a Postgres backend
    behind every technician's phone. This holds exactly one and does the
    fan-out in memory.
    """

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[Event]] = set()
        self._task: asyncio.Task[None] | None = None
        self._up = asyncio.Event()

    # ── lifecycle ────────────────────────────────────────────────────────────
    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="realtime-listener")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    @property
    def listening(self) -> bool:
        """Whether the LISTEN connection is up right now.

        Read by the websocket handler so a client can be told to keep polling
        instead of trusting a stream that is not currently able to speak.
        """
        return self._up.is_set()

    # ── the reader ───────────────────────────────────────────────────────────
    async def _run(self) -> None:
        """Reconnect forever. A dropped listener must never be permanent.

        Azure recycles database connections, deploys restart Postgres, networks
        blink. If this coroutine exits, the worker goes silent for the life of
        the process and the only symptom is "the app feels slow again" — which
        nobody reports as an outage. So the loop is unconditional and the
        backoff is capped.
        """
        delay = 1.0
        while True:
            try:
                async with await psycopg.AsyncConnection.connect(
                    _raw_dsn(), autocommit=True
                ) as conn:
                    await conn.execute(f"LISTEN {CHANNEL}")
                    log.info("realtime: listening on %s", CHANNEL)
                    self._up.set()
                    delay = 1.0
                    async for note in conn.notifies():
                        self._dispatch(note.payload)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("realtime: listener dropped; retrying in %.0fs", delay)
            finally:
                self._up.clear()
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)

    def _dispatch(self, payload: str) -> None:
        try:
            raw = json.loads(payload)
        except json.JSONDecodeError:
            log.warning("realtime: non-JSON payload on %s", CHANNEL)
            return
        if not isinstance(raw, dict):
            return
        event: Event | None = (
            PoolChanged.from_payload(raw)
            or JobChanged.from_payload(raw)
            or TicketChanged.from_payload(raw)
            or NotificationRaised.from_payload(raw)
            or TechnicianChanged.from_payload(raw)
        )
        if event is None:
            return
        for mailbox in self._subscribers:
            if mailbox.full():
                # Drop the oldest rather than block the reader. See _MAILBOX_MAX.
                with contextlib.suppress(asyncio.QueueEmpty):
                    mailbox.get_nowait()
            with contextlib.suppress(asyncio.QueueFull):
                mailbox.put_nowait(event)

    # ── subscription ─────────────────────────────────────────────────────────
    @contextlib.asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[Event]]:
        """A mailbox for one connected client, removed however the caller exits."""
        mailbox: asyncio.Queue[Event] = asyncio.Queue(maxsize=_MAILBOX_MAX)
        self._subscribers.add(mailbox)
        try:
            yield mailbox
        finally:
            self._subscribers.discard(mailbox)


#: Module-level singleton — one per worker process, started in `lifespan`.
broker = Broker()

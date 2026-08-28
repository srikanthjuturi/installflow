"""Turning a raised notification into a web push.

One background task per worker. It listens on the realtime broker for
`NotificationRaised`, re-reads the row, works out whose browsers should hear
about it, and sends. Started in `main.lifespan` beside the broker itself.

## Why it listens rather than being called

`notify()` has three call sites and they commit differently. `jobs.service`
publishes after its commit; `sweeps._raise_for` publishes INSIDE the transaction
and never commits at all — the scheduler does, and its advisory lock is
transaction-scoped, so making a sweep commit early to fit a network call in
would release the lock early and let both workers run the same sweep.

A push must go after the commit, and there is no single place in those three
that means "after the commit". But `pg_notify` already has exactly that
property: Postgres delivers a payload only when its transaction commits, which
is why `realtime` uses it. Listening therefore gets the guarantee for free, in
the same form at all three sites, and a fourth `notify()` added later is
covered without anybody remembering to cover it.

## Both workers hear every frame

Azure runs `gunicorn -w 2`, and a NOTIFY reaches every listener — that is the
point of it. Without a guard each notification would be pushed twice, and only
in production, because a single-worker dev machine never shows the bug.

So delivery takes `pg_try_advisory_xact_lock` on the notification's id, the same
idiom `core.scheduler` uses to stop both workers running the same sweep. The
loser skips rather than waits: the winner is already doing it, and a second
attempt a moment later would be the duplicate this prevents.

If the winner dies mid-send the push is lost. That is consistent with push
everywhere in this codebase — the notification row is durable and the bell still
rings; only the interruption is best-effort.
"""

import asyncio
import contextlib
import logging
import uuid

from sqlalchemy import text

from app.core.coverage import users_notified_by
from app.core.database import AsyncSessionLocal
from app.core.realtime import NotificationRaised, broker
from app.core.webpush import is_configured, send_to_users
from app.models.notification import Notification

log = logging.getLogger(__name__)


def _lock_key(notification_id: uuid.UUID) -> int:
    """A signed 64-bit advisory key from the row's id.

    The full first eight bytes of the UUID rather than a hash of its text: the
    key space is exactly Postgres's, so two different notifications colliding —
    which would silently drop somebody's push — needs a birthday collision in
    64 bits rather than in crc32's 32.
    """
    return int.from_bytes(notification_id.bytes[:8], "big", signed=True)


class NotificationRelay:
    """Listens for raised notifications and pushes them to browsers."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if not is_configured():
            # No VAPID pair, or the switch is off. Subscribing anyway would
            # drain a mailbox to do nothing with it.
            log.info("web push: relay not started (WEB_PUSH_ENABLED off or no keys)")
            return
        self._task = asyncio.create_task(self._run(), name="notification-relay")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    async def _run(self) -> None:
        async with broker.subscribe() as mailbox:
            log.info("web push: relay listening")
            while True:
                event = await mailbox.get()
                if not isinstance(event, NotificationRaised):
                    continue
                if event.notification_id is None:
                    # Published by an older worker mid-deploy. The bell still
                    # rings; there is simply no row named to go and read.
                    continue
                try:
                    await self._deliver(event)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # One bad notification must never take the relay down —
                    # a relay that dies silently stops every later push, and
                    # nothing on screen would say so.
                    log.exception(
                        "web push: relay failed on %s", event.notification_id
                    )

    async def _deliver(self, event: NotificationRaised) -> None:
        assert event.notification_id is not None  # guarded by the caller

        async with AsyncSessionLocal() as db:
            held = await db.scalar(
                text("SELECT pg_try_advisory_xact_lock(:key)"),
                {"key": _lock_key(event.notification_id)},
            )
            if not held:
                # The other worker has it. Not an error and not a missed push.
                return

            row = await db.get(Notification, event.notification_id)
            if row is None or row.company_id != event.company_id:
                # Raised and rolled back, or a frame that does not match its
                # row. Either way there is nothing honest to send.
                return

            user_ids = await users_notified_by(
                db,
                company_id=row.company_id,
                pincode=row.pincode,
                vendor_id=row.vendor_id,
            )
            if not user_ids:
                return

            sent = await send_to_users(
                db,
                company_id=row.company_id,
                user_ids=user_ids,
                title=row.title,
                body=row.detail,
                # Routing only, and the id doubles as the notification's `tag`
                # in the service worker so a repeat replaces rather than stacks.
                data={"id": str(row.id), "kind": row.kind, "to": row.to},
            )
            # Releases the advisory lock. Nothing else in this transaction
            # wrote anything — `send_to_users` commits its own pruning.
            await db.commit()

            if sent:
                log.info("web push: %s reached %d browser(s)", row.kind, sent)


#: Module-level singleton — one per worker process, started in `lifespan`.
relay = NotificationRelay()

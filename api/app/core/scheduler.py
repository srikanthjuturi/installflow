"""Work that happens because time passed, not because somebody did something.

Three of this system's notifications mean "X has not happened and the clock has
run out" — nobody accepted a job whose slot is close, a customer never picked a
time, a customer never confirmed a completed visit. Nothing else in the API can
raise those: every other write is a reaction to a request.

## Why this is a plain asyncio task and not APScheduler

The realtime broker in `core.realtime` already runs exactly this shape — a
long-lived task started in the lifespan, cancelled on shutdown — so the pattern
is established and costs nothing to repeat. APScheduler would add a dependency
for cron expressions, job stores and misfire policies that a single periodic
sweep does not use. Fewer moving parts on a server that has to survive an Azure
restart unattended.

## Two workers, one sweep

Azure runs `gunicorn -w 2`, so this task exists twice and both copies wake at
the same time. Every job therefore runs inside `pg_try_advisory_xact_lock`: the
first worker to ask gets it, the second is told no and skips that tick rather
than queueing. A transaction-scoped lock, deliberately — it is released when the
transaction ends, including when it ends by crashing, so a worker killed
mid-sweep cannot leave the job wedged forever.

Skipping is the correct outcome and not a missed run: the sweeps are idempotent
and the next tick is minutes away.

## Every job must be idempotent

A sweep runs again every few minutes and will see the same overdue ticket until
somebody acts on it. Each job is responsible for not raising the same
notification twice — see `features.tickets.sweeps`, which checks the
notifications table itself rather than keeping a separate marker.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from zlib import crc32

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal

log = logging.getLogger(__name__)

Job = Callable[[AsyncSession], Awaitable[int]]

#: Long enough that a quiet system is not doing constant pointless work, short
#: enough that "1h 05m to slot" is still actionable when somebody reads it.
DEFAULT_INTERVAL_SECONDS = 300

#: Nothing is overdue in the first seconds of a deploy, and starting a sweep
#: while the app is still warming up competes with real requests.
_FIRST_RUN_DELAY = 30.0


def _lock_key(name: str) -> int:
    """A stable 32-bit key per job, so two different jobs never block each other."""
    # Signed, because Postgres advisory locks take a bigint and crc32 is
    # unsigned — the conversion is what keeps the key stable across restarts
    # rather than merely valid.
    return crc32(name.encode()) - 2**31


class Ticker:
    """Runs registered jobs on an interval, one worker at a time."""

    __slots__ = ("_jobs", "_task", "_interval")

    def __init__(self, interval_seconds: int = DEFAULT_INTERVAL_SECONDS) -> None:
        self._jobs: list[tuple[str, Job]] = []
        self._task: asyncio.Task[None] | None = None
        self._interval = interval_seconds

    def register(self, name: str, job: Job) -> None:
        """Add a job. Called at startup, before `start`."""
        self._jobs.append((name, job))

    async def start(self) -> None:
        if self._task is None and self._jobs:
            self._task = asyncio.create_task(self._run(), name="scheduler")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _run(self) -> None:
        await asyncio.sleep(_FIRST_RUN_DELAY)
        while True:
            for name, job in self._jobs:
                try:
                    await self._run_one(name, job)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # One failing sweep must never stop the others, or take the
                    # loop down with it. A scheduler that dies silently on a bad
                    # night is worse than no scheduler, because nobody notices.
                    log.exception("scheduler: job %s failed", name)
            await asyncio.sleep(self._interval)

    async def _run_one(self, name: str, job: Job) -> None:
        async with AsyncSessionLocal() as db:
            held = await db.scalar(
                text("SELECT pg_try_advisory_xact_lock(:key)"),
                {"key": _lock_key(name)},
            )
            if not held:
                # Another worker is on it. Not an error and not a missed run.
                return
            raised = await job(db)
            await db.commit()
            if raised:
                log.info("scheduler: %s raised %d notification(s)", name, raised)


ticker = Ticker()

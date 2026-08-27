"""Is this technician available right now?

Two facts answer that, and the whole point of this module is that they stay
separate:

    accepting_work   the technician's own decision. Persisted, survives a
                     restart and a new phone, changed only by them.
    last_seen_at     whether a device is currently reachable. Stamped by the
                     live pool socket in `app.features.jobs.ws` and by nothing
                     else.

**Online is the AND of the two, derived at read time and never stored.**

## Who asks which question

They have different audiences, and mixing them up is the mistake this module
exists to prevent:

  * **The console asks "online"** — a manager assigning a job by hand needs to
    know whether anybody will actually see it in the next minute. That is
    `TechnicianOut.online`, and it is the only consumer of the derived answer.
  * **The technician's own switch shows `accepting_work`** — their intent, not
    the state of their socket. A switch that flicked to "offline" because the
    connection blinked would be reporting something they did not do, and the
    obvious next move (turn it back on) would fix nothing.
  * **Routing uses `accepting_work` too**, never `online` — see `pool_query`
    and `technicians_covering`. A technician whose app has not connected yet has
    `last_seen_at IS NULL`, so filtering the pool on `online` would hand them an
    empty screen on first launch with no way to fix it.

That last part is the design. The obvious implementation — one `is_online`
boolean the app writes on toggle — fails in the most ordinary situation there
is: a technician's battery dies mid-shift. The phone cannot write "offline"
because the phone is off, so the row keeps claiming the technician is available,
and it will keep claiming it tomorrow. Every consumer downstream then trusts a
fact that nothing is maintaining.

A timestamp cannot fail that way. It does not need a farewell message: it simply
stops advancing, and any reader can see how long ago it stopped. Presence
becomes a thing you *observe* rather than a thing a client *asserts*.

## Why the technician's intent still matters

Reachability alone would be wrong in the other direction. A technician who has
finished for the day and put their phone in their pocket is reachable and is not
available. "Not receiving offers" is a promise the Home screen makes out loud,
and only they can make it.
"""

from __future__ import annotations

import datetime
import uuid

from sqlalchemy import ColumnElement, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.technician import TechnicianProfile

#: How long after the last ping a technician is still considered reachable.
#:
#: The socket pings every 25 seconds (`_PING_SECONDS` in the ws module), so this
#: is three missed pings. Two would make a single dropped packet on a train look
#: like going offline; much more and a phone that genuinely died stays "online"
#: long enough to matter. Any change here must stay a multiple of that ping.
PRESENCE_TTL = datetime.timedelta(seconds=75)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def is_online(profile: TechnicianProfile, *, now: datetime.datetime | None = None) -> bool:
    """The derived answer, for a profile already loaded."""
    if not profile.accepting_work:
        return False
    if profile.last_seen_at is None:
        return False
    return (now or _now()) - profile.last_seen_at <= PRESENCE_TTL


def online_predicate(now: datetime.datetime | None = None) -> ColumnElement[bool]:
    """The same rule as SQL, for queries that filter or count.

    Exists so "who is online" is written once. Two copies of a rule with a
    time window in it drift the first time somebody tunes the window.
    """
    cutoff = (now or _now()) - PRESENCE_TTL
    return and_(
        TechnicianProfile.accepting_work.is_(True),
        TechnicianProfile.last_seen_at.is_not(None),
        TechnicianProfile.last_seen_at >= cutoff,
    )


async def touch(
    db: AsyncSession, *, company_id: uuid.UUID, technician_id: uuid.UUID
) -> None:
    """Record that this technician's device is reachable, as of now.

    A bare UPDATE rather than a load-modify-save: nothing here needs the row,
    two devices touching at once must not overwrite each other's other fields,
    and this runs every 25 seconds per connected phone.

    Scoped by `company_id` as well as by id — hard rule 0 applies to writes the
    same as to reads, and an id on its own is an assertion rather than a fact.
    """
    await db.execute(
        update(TechnicianProfile)
        .where(
            TechnicianProfile.company_id == company_id,
            TechnicianProfile.id == technician_id,
        )
        .values(last_seen_at=_now())
    )
    await db.commit()

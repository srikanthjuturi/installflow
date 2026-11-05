"""Reading where technicians are, for the people watching their jobs (Epic 4).

Read `models/technician_location.py`. A point is returned ONLY while:

  * the ticket is still held by the technician who reported it, and
  * the ticket is in an active status (`ACTIVE_STATUSES`).

So a job that completes, is cancelled or is handed on stops showing the
technician immediately, without anything having to delete the row first.

Who may see a point is exactly who may see the TICKET - `service.scoped()` is
applied unchanged: staff by territory, a vendor by its own tickets (a vendor
user only the ones they raised), a franchisee by the stamped franchisee. The
superadmin has no ticket page, so it gets its own list, pinned to nothing.
"""

import datetime
import uuid

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.errors import AppError
from app.core.schemas import AppModel
from app.features.tickets import service
from app.models.membership import Membership
from app.models.technician import TechnicianProfile
from app.models.technician_location import TechnicianLocation
from app.models.ticket import Ticket
from app.models.user import User

#: The jobs a technician is out working: taken, started, or waiting on a part.
#: `Awaiting Customer` is NOT here - the visit is done, so there is nothing to
#: watch - and neither is anything before acceptance or after closure.
ACTIVE_STATUSES = ("Assigned", "In Progress", "Awaiting Part")

#: A reading older than this is "not reporting", and the console says so rather
#: than pinning an old place as current.
STALE_AFTER_SECONDS = 180


class LiveLocationOut(AppModel):
    ticketId: uuid.UUID
    ticketCode: str
    status: str
    technicianId: uuid.UUID
    technicianName: str
    latitude: float
    longitude: float
    accuracyM: float | None
    recordedAt: datetime.datetime
    receivedAt: datetime.datetime
    #: Seconds since the server heard from the phone, for "last seen N s ago".
    ageSeconds: int
    stale: bool
    #: The job's own map point when the vendor picked one, else null (the console
    #: then falls back to the pincode centre it already draws).
    customerLatitude: float | None
    customerLongitude: float | None
    city: str
    pincode: str
    companyId: uuid.UUID


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _base() -> Select:
    return (
        select(Ticket, TechnicianLocation, User.full_name)
        .join(
            TechnicianLocation,
            (TechnicianLocation.company_id == Ticket.company_id)
            & (TechnicianLocation.ticket_id == Ticket.id)
            & (TechnicianLocation.technician_id == Ticket.technician_id),
        )
        .join(TechnicianProfile, TechnicianProfile.id == Ticket.technician_id)
        .join(Membership, Membership.id == TechnicianProfile.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(Ticket.status.in_(ACTIVE_STATUSES), Ticket.deleted_at.is_(None))
    )


def _out(ticket: Ticket, loc: TechnicianLocation, name: str | None) -> LiveLocationOut:
    age = max(int((_now() - loc.received_at).total_seconds()), 0)
    return LiveLocationOut(
        ticketId=ticket.id,
        ticketCode=ticket.code,
        status=ticket.status,
        technicianId=loc.technician_id,
        technicianName=name or "Technician",
        latitude=loc.latitude,
        longitude=loc.longitude,
        accuracyM=loc.accuracy_m,
        recordedAt=loc.recorded_at,
        receivedAt=loc.received_at,
        ageSeconds=age,
        stale=age > STALE_AFTER_SECONDS,
        customerLatitude=ticket.latitude,
        customerLongitude=ticket.longitude,
        city=ticket.city,
        pincode=ticket.pincode,
        companyId=ticket.company_id,
    )


async def for_ticket(
    db: AsyncSession, principal: Principal, ticket_id: uuid.UUID
) -> LiveLocationOut | None:
    """The technician's position on THIS ticket, or None.

    A ticket the caller cannot see is a 404 (the `_load` rule); a ticket they can
    see with no live point - not active, or the phone has not reported - is
    None, which the console draws as "location not available".
    """
    await service._load(db, principal, ticket_id)  # the 404 wall
    stmt = _base().where(Ticket.company_id == principal.company_id, Ticket.id == ticket_id)
    stmt = await service.scoped(db, stmt, principal)
    row = (await db.execute(stmt)).first()
    return _out(*row) if row else None


async def live_list(
    db: AsyncSession, principal: Principal, limit: int = 200
) -> list[LiveLocationOut]:
    """Every live technician this caller may see, freshest first."""
    stmt = _base().where(Ticket.company_id == principal.company_id)
    stmt = await service.scoped(db, stmt, principal)
    rows = (
        await db.execute(stmt.order_by(TechnicianLocation.received_at.desc()).limit(limit))
    ).all()
    return [_out(*r) for r in rows]


async def live_list_all(
    db: AsyncSession, principal: Principal, company_id: uuid.UUID | None, limit: int = 500
) -> list[LiveLocationOut]:
    """Superadmin: every company's live technicians, optionally one company's."""
    if not principal.is_superadmin:
        raise AppError(403, "FORBIDDEN", "Platform only")
    stmt = _base()
    if company_id is not None:
        stmt = stmt.where(Ticket.company_id == company_id)
    rows = (
        await db.execute(stmt.order_by(TechnicianLocation.received_at.desc()).limit(limit))
    ).all()
    return [_out(*r) for r in rows]

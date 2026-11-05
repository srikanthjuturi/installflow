"""What a vendor's CRM may see of a ticket — an allow-list, built field by field.

The view is assembled from a vendor-scoped hydration (`service._hydrate` with the
vendor's own principal, so every vendor mask already applies) but it NEVER passes
a shape through: each field below is named, and anything not named is not sent.

## Never present, whatever a later change adds to `TicketOut`

The technician's phone, every money figure (payout, price, extra charge, credit),
the franchisee (a vendor never sees which franchisee runs a job), event notes and
reasons (they carry staff reasons and phone numbers), the customer's private
link, coordinates of any person, and anything of another vendor.

## The timeline

Only the kinds in `TIMELINE_TITLES`, each with a FIXED plain title and its time.
The event's own note is never read: "Confirmation sent to +91…" and a manager's
written reason are exactly what must not leave.
"""

import base64
import datetime
import uuid

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.integration_auth import IntegrationContext
from app.core.integration_errors import refusal
from app.features.tickets import service
from app.features.tickets.integration_schemas import (
    IntegrationFeedback,
    IntegrationTechnician,
    IntegrationTicketPage,
    IntegrationTicketView,
    IntegrationTimelineItem,
    IntegrationVisit,
)
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent

IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))

#: event kind -> the title a CRM reads. A kind not listed here is not sent.
TIMELINE_TITLES: dict[str, str] = {
    "created": "Ticket raised",
    "slot_requested": "Customer asked to pick a time",
    "slot_confirmed": "Visit time confirmed",
    "rescheduled": "Visit time changed",
    "assigned": "Technician assigned",
    "started": "Work started",
    "completed": "Work completed",
    "feedback_requested": "Customer asked to confirm the work",
    "feedback_received": "Customer responded",
    "reopened": "Reopened after the customer's response",
    "force_closed": "Closed by the company",
}

DEFAULT_LIMIT = 100
MAX_LIMIT = 200


def _ist(moment: datetime.datetime | None) -> datetime.datetime | None:
    return moment.astimezone(IST) if moment is not None else None


def encode_cursor(changed_at: datetime.datetime, ticket_id: uuid.UUID) -> str:
    raw = f"{changed_at.astimezone(datetime.timezone.utc).isoformat()}|{ticket_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime.datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        stamp, ident = raw.split("|", 1)
        return datetime.datetime.fromisoformat(stamp), uuid.UUID(ident)
    except Exception:  # noqa: BLE001 — any malformed cursor is a validation error
        raise refusal("VALIDATION_ERROR", errors=["cursor: not a cursor we issued"]) from None


def parse_since(value: str) -> datetime.datetime:
    """An ISO 8601 time. One without an offset is read as IST, like every date here."""
    try:
        moment = datetime.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        raise refusal(
            "VALIDATION_ERROR", errors=["changedSince: send an ISO 8601 date and time"]
        ) from None
    return moment if moment.tzinfo else moment.replace(tzinfo=IST)


def _changed_at():
    """When a ticket last changed: its own row, or its newest history entry."""
    newest_event = (
        select(func.max(TicketEvent.created_at))
        .where(
            TicketEvent.ticket_id == Ticket.id,
            TicketEvent.company_id == Ticket.company_id,
        )
        .correlate(Ticket)
        .scalar_subquery()
    )
    return func.greatest(Ticket.updated_at, func.coalesce(newest_event, Ticket.updated_at))


async def _timelines(
    db: AsyncSession, ctx: IntegrationContext, ticket_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[IntegrationTimelineItem]]:
    if not ticket_ids:
        return {}
    rows = (
        await db.execute(
            select(TicketEvent.ticket_id, TicketEvent.kind, TicketEvent.created_at)
            .where(
                TicketEvent.company_id == ctx.company_id,
                TicketEvent.ticket_id.in_(ticket_ids),
                TicketEvent.kind.in_(list(TIMELINE_TITLES)),
            )
            .order_by(TicketEvent.ticket_id, TicketEvent.seq)
        )
    ).all()
    out: dict[uuid.UUID, list[IntegrationTimelineItem]] = {}
    for ticket_id, kind, at in rows:
        out.setdefault(ticket_id, []).append(
            IntegrationTimelineItem(kind=kind, title=TIMELINE_TITLES[kind], at=_ist(at))
        )
    return out


async def _views(
    db: AsyncSession,
    ctx: IntegrationContext,
    rows: list[Ticket],
    changed: dict[uuid.UUID, datetime.datetime],
    *,
    with_timeline: bool,
) -> list[IntegrationTicketView]:
    hydrated = {t.id: t for t in await service._hydrate(db, ctx.principal, rows)}
    timelines = await _timelines(db, ctx, [r.id for r in rows]) if with_timeline else {}
    views: list[IntegrationTicketView] = []
    for row in rows:
        out = hydrated[row.id]
        views.append(
            IntegrationTicketView(
                ticketNumber=row.code,
                reference=row.external_ref,
                status=row.status,
                visit=(
                    IntegrationVisit(
                        start=_ist(row.slot_start),
                        end=_ist(row.slot_end),
                        chosenByCustomer=row.slot_confirmed_at is not None,
                    )
                    if row.slot_start is not None and row.slot_end is not None
                    else None
                ),
                technician=(
                    IntegrationTechnician(name=out.technicianName)
                    if row.technician_id is not None and out.technicianName
                    else None
                ),
                feedback=(
                    IntegrationFeedback(
                        rating=out.customerRating, comment=out.customerFeedback
                    )
                    if out.customerConfirmedAt is not None
                    else None
                ),
                timeline=timelines.get(row.id) if with_timeline else None,
                updatedAt=_ist(changed.get(row.id, row.updated_at)),
            )
        )
    return views


def _own_tickets(ctx: IntegrationContext):
    return select(Ticket).where(
        Ticket.company_id == ctx.company_id,
        Ticket.vendor_id == ctx.vendor_id,
        Ticket.deleted_at.is_(None),
    )


async def get_one(
    db: AsyncSession, ctx: IntegrationContext, ident: str
) -> IntegrationTicketView:
    """By our ticket number or the CRM's own reference. Anything else is 404."""
    key = ident.strip()
    row = await db.scalar(
        _own_tickets(ctx).where(
            or_(Ticket.code == key, func.lower(Ticket.external_ref) == key.lower())
        )
    )
    if row is None:
        raise refusal("TICKET_NOT_FOUND")
    changed = (
        await db.execute(select(Ticket.id, _changed_at()).where(Ticket.id == row.id))
    ).first()
    stamp = {row.id: changed[1]} if changed else {}
    return (await _views(db, ctx, [row], stamp, with_timeline=True))[0]


async def list_changed(
    db: AsyncSession,
    ctx: IntegrationContext,
    *,
    changed_since: datetime.datetime,
    cursor: str | None,
    limit: int,
    with_timeline: bool,
) -> IntegrationTicketPage:
    """This vendor's tickets that changed after `changed_since`, oldest change first."""
    limit = max(1, min(limit, MAX_LIMIT))
    changed = _changed_at().label("changed_at")
    stmt = (
        select(Ticket, changed)
        .where(
            Ticket.company_id == ctx.company_id,
            Ticket.vendor_id == ctx.vendor_id,
            Ticket.deleted_at.is_(None),
        )
        .order_by(changed, Ticket.id)
        .limit(limit + 1)
    )
    if cursor:
        at, last_id = decode_cursor(cursor)
        stmt = stmt.where(
            or_(changed > at, and_(changed == at, Ticket.id > last_id))
        )
    else:
        stmt = stmt.where(changed > changed_since)

    found = (await db.execute(stmt)).all()
    more = len(found) > limit
    found = found[:limit]
    rows = [t for t, _ in found]
    stamps = {t.id: c for t, c in found}
    items = await _views(db, ctx, rows, stamps, with_timeline=with_timeline) if rows else []
    next_cursor = (
        encode_cursor(found[-1][1], found[-1][0].id) if more and found else None
    )
    return IntegrationTicketPage(items=items, nextCursor=next_cursor)

"""The job pool, and taking a job out of it.

A ticket reaches the pool by one route and one route only: its status is `New`.
`app/core/tickets.py` defines that word as "the slot is locked and the ticket is
in the pool — eligible technicians can see it; none has accepted", and
`confirm_slot` sets it the moment the customer picks a window. Nothing here
decides when a job becomes offerable; it only decides WHO it is offered to.

Two axes of eligibility, both already modelled and neither previously used for
routing:

  * **pincode** — `technician_pincodes`, the table whose own docstring says the
    routing lookup is "who covers 400067 in this company";
  * **subcategory** — `technician_subcategories`, whose docstring calls it "the
    level a job offer matches on".

Both are enforced HERE, in SQL, and nowhere else. The app filters nothing: a
client-side filter over a list the server already sent is not a permission
boundary, it is a rendering choice that a network tab undoes.

This slice does not import the tickets slice (hard rule: slices never import
each other). What it shares with it — the status vocabulary, the event builder —
either lives in `app.core.tickets` already or is small enough to state here.
"""

import datetime
import uuid

from fastapi import HTTPException, status as http_status
from sqlalchemy import Select, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.schemas import ListParams
from app.db.repository import paginate
from app.features.jobs.schemas import JobOfferOut, JobOut
from app.models.membership import Membership
from app.models.product import ProductModel, ProductSubcategory
from app.models.technician import (
    TechnicianProfile,
    TechnicianPincode,
    TechnicianSubcategory,
)
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent
from app.models.user import User


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def mask_name(full_name: str) -> str:
    """`Rohit Mehra` → `R•••• M••••`.

    Enough to know a real person is waiting without naming them. Each word keeps
    its initial and its LENGTH is not preserved — a fixed four bullets, so the
    mask does not leak how long the name is.
    """
    parts = [p for p in full_name.split() if p]
    if not parts:
        return "•••••"
    return " ".join(f"{p[0].upper()}••••" for p in parts[:2])


def pool_query(*, company_id: uuid.UUID, technician_id: uuid.UUID) -> Select:
    """Every ticket this technician may be offered, soonest slot first.

    The predicate is deliberately keyed on `status == 'New'` plus
    `slot_start IS NOT NULL`, and NOT on `slot_confirmed_at`. That column is
    null whenever the vendor typed the slot at intake — `create_ticket` sets
    `status='New'` with `slot_request_status='not_needed'` and never stamps a
    confirmation, because there was nothing to ask. Keying on it would silently
    hide every ticket that arrived with a time already agreed, and the pool
    would look like it was working.

    `technician_id IS NULL` as well as `status == 'New'`, though the two should
    never disagree: the guarded UPDATE in `accept` sets both together, and a row
    where they had drifted apart is one this query must not offer twice.
    """
    covers_pincode = (
        select(TechnicianPincode.id)
        .where(
            TechnicianPincode.company_id == company_id,
            TechnicianPincode.technician_id == technician_id,
            TechnicianPincode.pincode == Ticket.pincode,
        )
        .exists()
    )
    certified_for = (
        select(TechnicianSubcategory.id)
        .where(
            # `company_id` is on both tables and is filtered on both, even
            # though `technician_id` alone would already be unambiguous. Hard
            # rule 0: every query filters on the principal's company, and a
            # join that is only accidentally tenant-safe is one refactor away
            # from not being.
            TechnicianSubcategory.company_id == company_id,
            TechnicianSubcategory.technician_id == technician_id,
            TechnicianSubcategory.subcategory_id == Ticket.subcategory_id,
        )
        .exists()
    )

    return (
        select(Ticket)
        .where(
            Ticket.company_id == company_id,
            Ticket.status == "New",
            Ticket.technician_id.is_(None),
            Ticket.deleted_at.is_(None),
            Ticket.slot_start.is_not(None),
            # A window that has already opened cannot be travelled to. The pool
            # is a list of commitments a technician could still keep.
            Ticket.slot_start > _now(),
            covers_pincode,
            certified_for,
        )
        # Soonest first: the pool is read top-down and the job most at risk of
        # going unassigned is the one happening next.
        .order_by(Ticket.slot_start.asc(), Ticket.code.asc())
    )


async def _hydrate(db: AsyncSession, rows: list[Ticket]) -> list[JobOfferOut]:
    """Resolve the two names an offer shows — one query each, never N+1."""
    if not rows:
        return []

    sub_names = {
        r[0]: r[1]
        for r in await db.execute(
            select(ProductSubcategory.id, ProductSubcategory.name).where(
                ProductSubcategory.id.in_({t.subcategory_id for t in rows})
            )
        )
    }
    model_names = {
        r[0]: r[1]
        for r in await db.execute(
            select(ProductModel.id, ProductModel.name).where(
                ProductModel.id.in_({t.model_id for t in rows})
            )
        )
    }

    return [_offer_out(t, sub_names, model_names) for t in rows]


def _offer_out(
    t: Ticket,
    sub_names: dict[uuid.UUID, str],
    model_names: dict[uuid.UUID, str],
) -> JobOfferOut:
    # `slot_start`/`slot_end` are non-null by the query's own predicate; the
    # asserts are for the type checker rather than for runtime.
    assert t.slot_start is not None and t.slot_end is not None
    return JobOfferOut(
        id=t.id,
        code=t.code,
        subcategoryName=sub_names.get(t.subcategory_id, "—"),
        modelName=model_names.get(t.model_id, "—"),
        serviceType=t.service_type,
        city=t.city,
        pincode=t.pincode,
        slotStart=t.slot_start,
        slotEnd=t.slot_end,
        serviceLevelHours=t.service_level_hours,
        maskedCustomer=mask_name(t.customer_name),
    )


async def list_pool(
    db: AsyncSession,
    params: ListParams,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
) -> tuple[list[JobOfferOut], int]:
    stmt = pool_query(company_id=company_id, technician_id=technician_id)
    rows, total = await paginate(db, stmt, page=params.page, limit=params.limit)
    return await _hydrate(db, list(rows)), total


async def get_offer(
    db: AsyncSession,
    ticket_id: uuid.UUID,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
) -> JobOfferOut:
    """One offer, or 404.

    404 rather than 403 for a ticket that exists but is not in this
    technician's pool — the same rule the rest of the API follows, and for the
    same reason: 403 confirms the row is there.
    """
    stmt = pool_query(company_id=company_id, technician_id=technician_id).where(
        Ticket.id == ticket_id
    )
    row = await db.scalar(stmt)
    if row is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Job not found"
        )
    return (await _hydrate(db, [row]))[0]


async def accept(
    db: AsyncSession,
    ticket_id: uuid.UUID,
    *,
    company_id: uuid.UUID,
    profile: TechnicianProfile,
) -> JobOut:
    """Take the job. First accept wins; everybody else gets a 409.

    The race is settled by the WHERE clause, not by reading the row first and
    then writing it. Two technicians tapping at the same moment both reach this
    statement; Postgres serialises them, the second one's
    `status = 'New' AND technician_id IS NULL` no longer matches, and its
    rowcount is 0. No lock, no retry, no window between check and write.

    Losing is a normal outcome, not an error — `AGENTS.md` says so, and the app
    already models it as `JobTakenError` rather than a failure screen.
    """
    # Eligibility first, and through the pool query itself so there is exactly
    # one definition of "may be offered this". A technician who does not cover
    # the pincode gets the same 404 as one guessing at ids.
    offered = await db.scalar(
        pool_query(company_id=company_id, technician_id=profile.id).where(
            Ticket.id == ticket_id
        )
    )
    if offered is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Job not found"
        )

    result = await db.execute(
        update(Ticket)
        .where(
            Ticket.id == ticket_id,
            Ticket.company_id == company_id,
            Ticket.status == "New",
            Ticket.technician_id.is_(None),
        )
        .values(technician_id=profile.id, status="Assigned")
    )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="Another technician accepted this job first",
        )

    name = await db.scalar(
        select(User.full_name)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.id == profile.membership_id)
    )
    # Written in the SAME transaction as the assignment it describes. A trail
    # that can disagree with the ticket is worse than no trail, and this row is
    # what the daily job cap will be counted from — the date lives here, not on
    # `tickets`, which keeps no history.
    db.add(
        TicketEvent(
            company_id=company_id,
            ticket_id=ticket_id,
            kind="assigned",
            actor_kind="technician",
            actor_label=name or profile.code,
            from_status="New",
            to_status="Assigned",
        )
    )
    await db.commit()

    row = await db.scalar(
        select(Ticket).where(Ticket.id == ticket_id, Ticket.company_id == company_id)
    )
    assert row is not None
    offer = (await _hydrate(db, [row]))[0]
    # Now it is theirs, so the three masked fields are theirs to see.
    return JobOut(
        **offer.model_dump(),
        customerName=row.customer_name,
        customerPhone=row.customer_phone,
        address=row.address,
    )

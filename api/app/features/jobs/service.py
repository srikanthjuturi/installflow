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
import secrets
import uuid

from fastapi import HTTPException, status as http_status
from sqlalchemy import Select, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.realtime import publish_pool_changed, publish_ticket_changed
from app.core.schemas import ListParams
from app.core.tickets import (
    MAX_PRODUCT_PHOTOS,
    MIN_PRODUCT_PHOTOS,
    PROOF_KINDS,
    SLOT_TIMEZONE_OFFSET_MINUTES,
    TERMINAL_STATUSES,
)
from app.db.repository import paginate
from app.features.jobs.schemas import (
    JobOfferOut,
    JobOut,
    ProofArtifactIn,
    ProofImageOut,
)
from app.integrations import blob, whatsapp
from app.models.company import Company
from app.models.membership import Membership
from app.models.product import ProductModel, ProductSubcategory
from app.models.technician import (
    TechnicianProfile,
    TechnicianPincode,
    TechnicianSubcategory,
)
from app.models.ticket import Ticket, TicketProof
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


def _job_out(offer: JobOfferOut, t: Ticket) -> JobOut:
    """The offer, plus everything that unlocks once the job is this technician's.

    One builder for all three callers — accept, the detail read and the list —
    because "what does an assigned technician get to see" is a privacy rule, and
    three copies of it would eventually be two rules.
    """
    return JobOut(
        **offer.model_dump(),
        customerName=t.customer_name,
        customerPhone=t.customer_phone,
        address=t.address,
        state=t.state,
        status=t.status,
        description=t.description,
        serialNumber=t.serial_number,
        feedbackRequestStatus=t.feedback_request_status,
    )


def mine_query(*, company_id: uuid.UUID, technician_id: uuid.UUID) -> Select:
    """Every ticket assigned to THIS technician, soonest slot first.

    A second query rather than a parameter on `pool_query`, because that one is
    hard-wired to the opposite case — `status == 'New' AND technician_id IS
    NULL` is what "in the pool" means, and bending it to also express "mine"
    would leave one predicate serving two contradictory questions.

    No status filter here: the caller narrows it. Unfiltered, this is the
    technician's whole history with the company, which is what a "Completed"
    tab eventually reads.

    Ordered by slot rather than by creation — a technician's list is a day plan,
    and the only useful order for a day plan is the order they will drive it.
    `ix_tickets_company_technician` already exists on `tickets` and serves the
    lookup; the sort is over one technician's own rows, which is small.
    """
    return (
        select(Ticket)
        .where(
            Ticket.company_id == company_id,
            Ticket.technician_id == technician_id,
            Ticket.deleted_at.is_(None),
        )
        .order_by(Ticket.slot_start.asc(), Ticket.code.asc())
    )


async def list_mine(
    db: AsyncSession,
    params: ListParams,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
    statuses: tuple[str, ...] | None = None,
) -> tuple[list[JobOut], int]:
    """The My jobs list, narrowed to one segment's statuses."""
    stmt = mine_query(company_id=company_id, technician_id=technician_id)
    if statuses:
        stmt = stmt.where(Ticket.status.in_(statuses))
    rows, total = await paginate(db, stmt, page=params.page, limit=params.limit)
    tickets = list(rows)
    offers = await _hydrate(db, tickets)
    return [_job_out(o, t) for o, t in zip(offers, tickets)], total


async def get_job(
    db: AsyncSession,
    ticket_id: uuid.UUID,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
) -> JobOut:
    """One of this technician's own jobs, unmasked — or 404.

    The 404 is the privacy boundary, not a convenience. `technician_id` is in
    the WHERE clause, so a technician who guesses another's ticket id gets the
    same answer as one who invents a UUID: the row is not theirs, and they
    cannot learn that it exists. 403 would confirm it does.
    """
    row = await db.scalar(
        mine_query(company_id=company_id, technician_id=technician_id).where(
            Ticket.id == ticket_id
        )
    )
    if row is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Job not found"
        )
    return _job_out((await _hydrate(db, [row]))[0], row)


async def list_today(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
) -> list[JobOut]:
    """What Home shows: this technician's jobs whose slot falls today.

    "Today" is measured in the company's operating timezone, not the server's.
    `SLOT_TIMEZONE_OFFSET_MINUTES` is the same constant the slot windows are
    offered in, so a job at 9pm IST belongs to the day the customer thinks it
    does rather than to whatever date it is in UTC.

    Terminal statuses are excluded — a job cancelled this morning is not
    something to drive to, and a closed one is already done. Home is a list of
    work still ahead.
    """
    offset = datetime.timedelta(minutes=SLOT_TIMEZONE_OFFSET_MINUTES)
    local_now = _now() + offset
    start_local = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    # Back to UTC for the comparison, because that is what the column stores.
    start = start_local - offset
    end = start + datetime.timedelta(days=1)

    rows = await db.scalars(
        mine_query(company_id=company_id, technician_id=technician_id).where(
            Ticket.slot_start >= start,
            Ticket.slot_start < end,
            Ticket.status.not_in(TERMINAL_STATUSES),
        )
    )
    tickets = list(rows)
    offers = await _hydrate(db, tickets)
    return [_job_out(o, t) for o, t in zip(offers, tickets)]


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
    # This job has just LEFT the pool, and every other eligible technician is
    # still being shown it. The same doorbell that announces a new job announces
    # one that is gone — first-accept-wins is only fair if losing is visible
    # promptly, rather than on whenever their next poll happens to land.
    #
    # In the same transaction as the assignment, so a rolled-back accept never
    # tells anybody the job disappeared.
    await publish_pool_changed(
        db,
        company_id=company_id,
        pincode=offered.pincode,
        subcategory_id=offered.subcategory_id,
    )
    await publish_ticket_changed(db, offered)
    await db.commit()

    row = await db.scalar(
        select(Ticket).where(Ticket.id == ticket_id, Ticket.company_id == company_id)
    )
    assert row is not None
    # Now it is theirs, so the masked fields are theirs to see.
    return _job_out((await _hydrate(db, [row]))[0], row)


# ── doing the job ────────────────────────────────────────────────────────────
#
# Two transitions, and both are settled in a WHERE clause rather than by reading
# the row and then writing it. The pattern is `accept`'s, for the same reason:
# a guarded UPDATE cannot race, and `rowcount == 0` tells you precisely that
# somebody else moved the ticket first.
#
# Deliberately NOT the pattern in `tickets.confirm_slot`, which reads then
# writes with no lock and can let two simultaneous requests both through.


def _event(
    row: Ticket,
    kind: str,
    *,
    actor_kind: str,
    actor_label: str | None = None,
    note: str | None = None,
    from_status: str | None = None,
    to_status: str | None = None,
) -> TicketEvent:
    """This slice's own event builder.

    `record_event` lives in the tickets slice and slices never import each other
    (hard rule 4), so `accept` already constructs its `TicketEvent` inline. This
    is that, named, now that four more transitions need it.
    """
    return TicketEvent(
        company_id=row.company_id,
        ticket_id=row.id,
        kind=kind,
        actor_kind=actor_kind,
        actor_label=actor_label,
        note=note,
        from_status=from_status,
        to_status=to_status,
    )


async def _technician_name(db: AsyncSession, profile: TechnicianProfile) -> str:
    name = await db.scalar(
        select(User.full_name)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.id == profile.membership_id)
    )
    return name or profile.code


async def submit_proof(
    db: AsyncSession,
    ticket_id: uuid.UUID,
    *,
    company_id: uuid.UUID,
    profile: TechnicianProfile,
    artifacts: list[ProofArtifactIn],
) -> JobOut:
    """Record the four artifacts and start the job.

    The completeness rule is enforced HERE and not on the phone. A client can be
    old, patched, or simply wrong, and "did this technician actually photograph
    the serial" is exactly the kind of claim that must not be decided by the
    thing making the claim.

    Proof and status commit together. Work that started with no evidence, and
    evidence for work that never started, are both states this refuses to leave
    behind.
    """
    _check_proof_complete(artifacts)
    _check_blobs_are_ours(artifacts, company_id=company_id)

    row = await db.scalar(
        mine_query(company_id=company_id, technician_id=profile.id).where(
            Ticket.id == ticket_id
        )
    )
    if row is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Job not found"
        )

    _check_live_was_taken_at_the_job(artifacts, ticket=row)

    result = await db.execute(
        update(Ticket)
        .where(
            Ticket.id == ticket_id,
            Ticket.company_id == company_id,
            Ticket.technician_id == profile.id,
            # Only from Assigned. A second submission on a job already in
            # progress is a duplicate tap, not a new start.
            Ticket.status == "Assigned",
        )
        .values(status="In Progress")
    )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=f"This job is {row.status.lower()} — proof can only be submitted once, when starting.",
        )

    for artifact in artifacts:
        db.add(
            TicketProof(
                company_id=company_id,
                ticket_id=ticket_id,
                kind=artifact.kind,
                ordinal=artifact.ordinal,
                blob_name=artifact.blobName,
                captured_at=artifact.capturedAt,
                latitude=artifact.latitude,
                longitude=artifact.longitude,
                accuracy_m=artifact.accuracyM,
                device_pincode=artifact.devicePincode,
            )
        )

    located = sum(1 for a in artifacts if a.latitude is not None)
    db.add(
        _event(
            row,
            "started",
            actor_kind="technician",
            actor_label=await _technician_name(db, profile),
            note=(
                f"{len(artifacts)} proof images captured"
                + ("" if located else " — no location on the live photo")
            ),
            from_status="Assigned",
            to_status="In Progress",
        )
    )
    await publish_ticket_changed(db, row)
    await db.commit()
    return await get_job(
        db, ticket_id, company_id=company_id, technician_id=profile.id
    )


def _check_live_was_taken_at_the_job(
    artifacts: list[ProofArtifactIn], *, ticket: Ticket
) -> None:
    """The live photo must have been taken where the job is.

    The app already refuses the shutter on a mismatch, but a client-side rule is
    a rendering choice — this is the one that holds. Two conditions, and they
    are not the same condition:

      * the live shot must carry COORDINATES. Without this the block is
        decorative: turning location off would be the way round it.
      * if it also carries a postal code, that code must match the ticket's.

    A null postal code with good coordinates is ACCEPTED. Reverse geocoding
    needs map data the phone may not have, and refusing it would strand a
    technician standing at the right door with a working GPS. The coordinates
    are stored either way, so the position is auditable even where the label is
    missing.

    This cannot be a complete guarantee, and it is worth being honest about why:
    nothing in this database maps a coordinate to a pincode, so the server
    cannot independently verify the label the phone attached. It enforces "if
    you tell me where you were, it must be here" — the coordinates remain the
    evidence for anything argued afterwards.
    """
    live = [a for a in artifacts if a.kind == "live"]
    for shot in live:
        if shot.latitude is None or shot.longitude is None:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail=(
                    "The live site photo must carry a location — it is what "
                    "evidences the visit. Turn location on and retake it."
                ),
            )
        if shot.devicePincode and shot.devicePincode != ticket.pincode:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"The live photo was taken at {shot.devicePincode}, but this "
                    f"job is at {ticket.pincode}. It must be captured at the "
                    "customer's address."
                ),
            )


def _check_blobs_are_ours(
    artifacts: list[ProofArtifactIn], *, company_id: uuid.UUID
) -> None:
    """Every blob name must sit under THIS company's proof prefix.

    Without this the endpoint is a cross-tenant read. `POST /uploads?kind=proof`
    names a blob `proof/{company_id}/{uuid}.jpg`, but nothing stopped a client
    from submitting a name it did not get back from that call — and
    `list_proof` signs whatever name the row holds. A technician who guessed or
    observed another company's blob name could have had a working link to
    photographs of the inside of somebody else's customer's home.
    """
    prefix = f"proof/{company_id}/"
    for a in artifacts:
        name = a.blobName
        # `..` cannot climb out of a blob container, but a name that tries is a
        # client doing something it has no reason to do.
        if not name.startswith(prefix) or ".." in name:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Proof images must be uploaded through this API first",
            )


def _check_proof_complete(artifacts: list[ProofArtifactIn]) -> None:
    """All four kinds present, and product photos within 1–4."""
    by_kind: dict[str, int] = {}
    for a in artifacts:
        by_kind[a.kind] = by_kind.get(a.kind, 0) + 1

    missing = [k for k in PROOF_KINDS if k not in by_kind]
    if missing:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"Proof is incomplete — missing {', '.join(missing)}",
        )
    for single in ("barcode", "serial", "live"):
        if by_kind[single] != 1:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail=f"Expected exactly one {single} image",
            )
    if not MIN_PRODUCT_PHOTOS <= by_kind["photos"] <= MAX_PRODUCT_PHOTOS:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Between {MIN_PRODUCT_PHOTOS} and {MAX_PRODUCT_PHOTOS} product "
                "photos are required"
            ),
        )


async def complete(
    db: AsyncSession,
    ticket_id: uuid.UUID,
    *,
    company_id: uuid.UUID,
    profile: TechnicianProfile,
) -> JobOut:
    """The technician says the work is done, and we go and ask the customer.

    This does NOT close the ticket. In this product the customer closes a job —
    the technician's word starts a question, and `Awaiting Customer` is the
    state of having asked. That gap is the whole feature: before it, nothing but
    the technician's own say-so recorded that the work happened.

    The WhatsApp send happens AFTER the commit, exactly as `create_ticket` does.
    A ticket that reached the customer's phone but was never saved is
    unrecoverable; a saved ticket whose message failed is a resend.
    """
    row = await db.scalar(
        mine_query(company_id=company_id, technician_id=profile.id).where(
            Ticket.id == ticket_id
        )
    )
    if row is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Job not found"
        )

    token = secrets.token_urlsafe(32)
    result = await db.execute(
        update(Ticket)
        .where(
            Ticket.id == ticket_id,
            Ticket.company_id == company_id,
            Ticket.technician_id == profile.id,
            Ticket.status == "In Progress",
        )
        .values(
            status="Awaiting Customer",
            feedback_token=token,
            feedback_request_status="pending",
        )
    )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=(
                "Capture and submit proof before completing this job."
                if row.status == "Assigned"
                else f"This job is already {row.status.lower()}."
            ),
        )

    technician = await _technician_name(db, profile)
    db.add(
        _event(
            row,
            "completed",
            actor_kind="technician",
            actor_label=technician,
            note="Work finished — waiting for the customer to confirm",
            from_status="In Progress",
            to_status="Awaiting Customer",
        )
    )
    await publish_ticket_changed(db, row)
    await db.commit()

    # Durable first, message second.
    await _send_feedback_request(db, ticket_id, company_id=company_id, token=token,
                                 technician=technician)

    return await get_job(
        db, ticket_id, company_id=company_id, technician_id=profile.id
    )


async def _send_feedback_request(
    db: AsyncSession,
    ticket_id: uuid.UUID,
    *,
    company_id: uuid.UUID,
    token: str,
    technician: str,
) -> None:
    """Ask the customer to confirm. Records the outcome, never raises.

    A refusal from Meta must not undo a completed job. The status stays
    `Awaiting Customer` either way and the failure is written where somebody can
    act on it — the same trade `_send_slot_request` makes in the tickets slice.
    """
    row = await db.scalar(
        select(Ticket).where(Ticket.id == ticket_id, Ticket.company_id == company_id)
    )
    if row is None:  # pragma: no cover — it was there a moment ago
        return

    product = await db.scalar(
        select(ProductModel.name).where(ProductModel.id == row.model_id)
    )
    company = await db.scalar(select(Company.name).where(Company.id == company_id))
    link = f"{settings.FEEDBACK_LINK_BASE.rstrip('/')}/{token}"

    result = await whatsapp.send_feedback_request(
        row.customer_phone,
        link,
        company or "Installation Service",
        product or "your product",
        technician,
    )
    row.feedback_request_status = "sent" if result.ok else "failed"
    row.feedback_request_error = None if result.ok else (result.error or "")[:255]
    db.add(
        _event(
            row,
            "feedback_requested",
            actor_kind="system",
            actor_label="WhatsApp",
            note=(
                f"Confirmation link sent to {row.customer_phone}"
                if result.ok
                else f"Could not send: {result.error or 'unknown error'}"
            ),
        )
    )
    await db.commit()


async def list_proof(
    db: AsyncSession,
    ticket_id: uuid.UUID,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
) -> list[ProofImageOut]:
    """One job's proof, each image behind a freshly signed link.

    The 404 is the boundary: `mine_query` puts `technician_id` in the WHERE
    clause, so a technician cannot read another's proof — which, given these are
    photographs of the inside of somebody's home, is the access rule that
    matters most in this slice.
    """
    owns = await db.scalar(
        mine_query(company_id=company_id, technician_id=technician_id).where(
            Ticket.id == ticket_id
        )
    )
    if owns is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Job not found"
        )

    rows = await db.scalars(
        select(TicketProof)
        .where(
            TicketProof.company_id == company_id,
            TicketProof.ticket_id == ticket_id,
        )
        .order_by(TicketProof.captured_at.asc(), TicketProof.ordinal.asc())
    )
    # Belt and braces. `submit_proof` already refuses a name outside this
    # company's prefix, so a row that fails this check should not exist — but
    # signing is the step that would actually hand the bytes over, and it costs
    # one string comparison to make that impossible rather than merely unlikely.
    prefix = f"proof/{company_id}/"
    return [
        ProofImageOut(
            kind=p.kind,
            ordinal=p.ordinal,
            capturedAt=p.captured_at,
            url=(
                blob.signed_url(p.blob_name)
                if p.blob_name.startswith(prefix)
                else None
            ),
            latitude=p.latitude,
            longitude=p.longitude,
            devicePincode=p.device_pincode,
        )
        for p in rows
    ]

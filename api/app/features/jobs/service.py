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
  * **the catalogue node** — `technician_nodes`, whose docstring calls it "the
    level a job offer matches on". A certification covers the whole SUBTREE
    beneath it, so the test is membership of the ticket's stamped
    `node_path_ids` rather than equality with one id.

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
from sqlalchemy import Select, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.coverage import has_cap_room
from app.core.errors import AppError
from app.core.escalation import escalate, whatsapp_the_area_manager
from app.core.ledger import (
    cap_remaining,
    charged_this_month,
    entry as ledger_entry,
)
from app.core.notifications import notify
from app.core.push import announce_pool_job
from app.core.realtime import (
    publish_notification,
    publish_pool_changed,
    publish_ticket_changed,
)
from app.core.coordinates import metres_between, metres_label
from app.core.rules import (
    CANCEL_PENALTY_BANDS,
    cancel_band_index,
    load_rules,
    snapshot_value,
)
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
    PenaltyBandOut,
    ProductParameterOut,
    ProofArtifactIn,
    ProofImageOut,
)
from app.integrations import blob, whatsapp
from app.models.company import Company
from app.models.membership import Membership
from app.models.product import ProductModel, ProductNode
from app.models.technician import (
    ACTIVE,
    TechnicianNode,
    TechnicianPincode,
    TechnicianProfile,
)
from app.models.ledger import LedgerEntry
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


def pool_query(
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
    eligible_only: bool = True,
    open_only: bool = True,
) -> Select:
    """Every ticket this technician may be offered, soonest slot first.

    ## `open_only=False` — "was this ever yours to take?"

    Drops `status == 'New'` and `technician_id IS NULL`, so a job somebody else
    has already accepted still matches. Exactly one caller wants that: `accept`,
    distinguishing "taken" from "not found". Losing a race is a normal outcome
    and the technician has to be told which one it was — "Job not found" for a
    job they were looking at ten seconds ago is both wrong and alarming.

    It discloses nothing new: coverage and certification still apply, so it only
    ever confirms a ticket that WAS in this technician's own pool.

    ## `eligible_only=False` — "would this be yours if you had room?"

    The LIST wants the full predicate: a pool showing a job the technician
    cannot take is a pool that wastes their time. But a single ticket reached
    from a stale list or a push notification must not answer "Job not found"
    just because the day has since filled or the toggle went off — the job
    plainly exists and they could take it tomorrow. Callers that need to tell
    somebody WHY pass `False` and check the reason themselves; see `accept`.

    What `False` drops is exactly two things: the technician's own
    `accepting_work` toggle, and the cap. It does NOT drop `status` — a
    SUSPENDED technician sees nothing through any flag here, because that is
    somebody else's decision about them rather than their own. Coverage,
    certification and company still apply too, so this never widens what a
    technician may see — only what they may be TOLD about a ticket that was
    already theirs to see.

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
        select(TechnicianNode.id)
        .where(
            # `company_id` is on both tables and is filtered on both, even
            # though `technician_id` alone would already be unambiguous. Hard
            # rule 0: every query filters on the principal's company, and a
            # join that is only accidentally tenant-safe is one refactor away
            # from not being.
            TechnicianNode.company_id == company_id,
            TechnicianNode.technician_id == technician_id,
            # ANYWHERE on the job's catalogue path, not just the node it names:
            # certification covers a subtree, so somebody certified on *TV* is
            # eligible for an *Android TV* job. `node_path_ids` was stamped on
            # the ticket at intake precisely so this stays one array containment
            # in the hottest query in the product — no join to the tree, no
            # recursive CTE, and nothing that gets slower as the catalogue deepens.
            TechnicianNode.node_id == func.any(Ticket.node_path_ids),
        )
        .exists()
    )
    # The technician's own row has to qualify too, and until now it did not.
    #
    # Going offline stopped the CLIENT polling and nothing else, so an offline
    # or suspended technician could still read the pool and accept from it with
    # a plain HTTP call — a client-side filter over a list the server already
    # sent, which the note at the top of this module says is not a boundary.
    # `core.coverage.technicians_covering` has always filtered on both, and its
    # docstring warns that the two must agree; this is that debt.
    # Split in two on purpose, because they are different KINDS of state.
    #
    # `status` is an administrative decision somebody else made: a suspended
    # technician should see nothing, ever, and no flag below relaxes it.
    # `accepting_work` is the technician's own toggle — relaxing that lets a
    # single offer still open from a push, so they can be told "you're offline"
    # rather than "job not found".
    is_active = (
        select(TechnicianProfile.id)
        .where(
            TechnicianProfile.company_id == company_id,
            TechnicianProfile.id == technician_id,
            TechnicianProfile.status == ACTIVE,
        )
        .exists()
    )
    accepting = (
        select(TechnicianProfile.id)
        .where(
            TechnicianProfile.company_id == company_id,
            TechnicianProfile.id == technician_id,
            TechnicianProfile.accepting_work.is_(True),
        )
        .exists()
    )

    conditions = [
        Ticket.company_id == company_id,
        Ticket.deleted_at.is_(None),
        Ticket.slot_start.is_not(None),
        # A window that has already opened cannot be travelled to. The pool
        # is a list of commitments a technician could still keep.
        Ticket.slot_start > _now(),
        covers_pincode,
        certified_for,
        is_active,
    ]
    if open_only:
        conditions += [
            Ticket.status == "New",
            Ticket.technician_id.is_(None),
        ]
    if eligible_only:
        conditions += [
            accepting,
            # "New offers stop once you hit this cap" — the approved copy on
            # the Availability screen, which was untrue until this line.
            has_cap_room(company_id=company_id, technician_id=technician_id),
        ]

    return (
        select(Ticket)
        .where(*conditions)
        # Soonest first: the pool is read top-down and the job most at risk of
        # going unassigned is the one happening next.
        .order_by(Ticket.slot_start.asc(), Ticket.code.asc())
    )


async def _hydrate(
    db: AsyncSession, rows: list[Ticket]
) -> tuple[list[JobOfferOut], dict[uuid.UUID, tuple[str, list[dict], str | None]]]:
    """Resolve the two names an offer shows — one query each, never N+1."""
    if not rows:
        return [], {}

    sub_names = {
        r[0]: r[1]
        for r in await db.execute(
            select(ProductNode.id, ProductNode.name).where(
                ProductNode.id.in_({t.node_id for t in rows})
            )
        )
    }
    # Name, specs and notes in ONE query — the same one that already fetched the
    # name. A second query per page would be an N+1 waiting to be written.
    models = {
        r[0]: (r[1], r[2], r[3])
        for r in await db.execute(
            select(
                ProductModel.id,
                ProductModel.name,
                ProductModel.parameters,
                ProductModel.notes,
            ).where(ProductModel.id.in_({t.model_id for t in rows}))
        )
    }

    return [_offer_out(t, sub_names, models) for t in rows], models


def _offer_out(
    t: Ticket,
    sub_names: dict[uuid.UUID, str],
    models: dict[uuid.UUID, tuple[str, list[dict], str | None]],
) -> JobOfferOut:
    # `slot_start`/`slot_end` are non-null by the query's own predicate; the
    # asserts are for the type checker rather than for runtime.
    assert t.slot_start is not None and t.slot_end is not None
    return JobOfferOut(
        id=t.id,
        code=t.code,
        subcategoryName=sub_names.get(t.node_id, "—"),
        modelName=models.get(t.model_id, ("—", [], None))[0],
        serviceType=t.service_type,
        city=t.city,
        pincode=t.pincode,
        slotStart=t.slot_start,
        slotEnd=t.slot_end,
        serviceLevelHours=t.service_level_hours,
        maskedCustomer=mask_name(t.customer_name),
        payoutPaise=t.technician_payout_paise,
        bonusPaise=t.bonus_paise,
    )


def serial_mismatch(t: Ticket) -> bool:
    """Did the unit on site carry a different serial from the order?

    Compared case-insensitively and ignoring surrounding whitespace, because a
    scanner and a keyboard disagree about both and neither difference means a
    different appliance. Null observed serial is not a mismatch — it means
    nobody has looked yet.
    """
    if not t.observed_serial or not t.serial_number:
        return False
    return t.observed_serial.strip().upper() != t.serial_number.strip().upper()


def _job_out(
    offer: JobOfferOut,
    t: Ticket,
    models: dict[uuid.UUID, tuple[str, list[dict], str | None]],
) -> JobOut:
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
        # Where the address is, and how far from it the live proof photo may be
        # taken. Both here rather than on the offer: a coordinate pair IS the
        # address, stated more exactly than the street line the pool withholds.
        # The radius travels with the job so the phone blocks its own shutter
        # on the same number the server will refuse on.
        latitude=t.latitude,
        longitude=t.longitude,
        # The product's own specs, read LIVE rather than stamped: correcting a
        # spec should fix every job that names the product, because the unit on
        # the wall never changed and the old value was simply wrong. Money and
        # policy are the opposite, and are frozen on the ticket.
        modelParameters=[
            ProductParameterOut(name=p.get("name", ""), value=p.get("value", ""))
            for p in (models.get(t.model_id, ("", [], None))[1] or [])
        ],
        modelNotes=models.get(t.model_id, ("", [], None))[2],
        # This TICKET's radius, out of its stamped rules — a rooftop solar
        # job is not photographed from the same distance a set-top box is,
        # and `geo_radius_m` is one of the rules a product node may override.
        geoRadiusM=snapshot_value(t.rules_snapshot, "geo_radius_m"),
        status=t.status,
        description=t.description,
        serialNumber=t.serial_number,
        feedbackRequestStatus=t.feedback_request_status,
        observedSerial=t.observed_serial,
        observedSerialSource=t.observed_serial_source,
        serialMismatch=serial_mismatch(t),
        customerRating=t.customer_rating,
        customerFeedback=t.customer_feedback,
        customerConfirmedAt=t.customer_confirmed_at,
        # Answered, and the answer was no. `Escalated` alone is not enough —
        # a job can reach it without a customer ever being asked — so both
        # halves are required.
        customerRefused=(
            t.customer_confirmed_at is not None and t.status == "Escalated"
        ),
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
    offers, models = await _hydrate(db, tickets)
    return [
        _job_out(o, t, models) for o, t in zip(offers, tickets)
    ], total


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
    offers, models = await _hydrate(db, [row])
    return _job_out(offers[0], row, models)


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
    offers, models = await _hydrate(db, tickets)
    return [_job_out(o, t, models) for o, t in zip(offers, tickets)]


async def list_pool(
    db: AsyncSession,
    params: ListParams,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
) -> tuple[list[JobOfferOut], int]:
    stmt = pool_query(company_id=company_id, technician_id=technician_id)
    rows, total = await paginate(db, stmt, page=params.page, limit=params.limit)
    offers, _ = await _hydrate(db, list(rows))
    return offers, total


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

    `eligible_only=False`, unlike the LIST above. This screen is reached from a
    push sent hours earlier or from a list that has since gone stale, and a job
    that has become untakeable — the day filled, the toggle went off — is not a
    job that stopped existing. Answering 404 would be false, and would leave a
    notification that opens onto "not found". The honest refusal is at `accept`,
    which can say which of the two happened.
    """
    stmt = pool_query(
        company_id=company_id, technician_id=technician_id, eligible_only=False
    ).where(Ticket.id == ticket_id)
    row = await db.scalar(stmt)
    if row is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Job not found"
        )
    offers, _ = await _hydrate(db, [row])
    return offers[0]


def JobRefused(code: str, detail: str) -> AppError:
    """A 409 that says which kind of "no" it is.

    Three of them share this status, and the app has to act differently on
    each: try another job, turn availability on, or raise your cap. Matching on
    409 alone told a capped technician somebody else had been faster.
    """
    return AppError(http_status.HTTP_409_CONFLICT, code, detail)


def _ist_day_label(when: datetime.datetime | None) -> str:
    """"Fri 29 Aug", in the technician's OWN day — never the server's.

    Built by hand rather than with `%-d`/`%#d`, which are the same idea spelled
    differently on Linux and Windows: this codebase is developed on Windows and
    runs on Linux, so a platform-specific format string works on exactly one of
    them.
    """
    if when is None:
        return "that day"
    local = when.astimezone(
        datetime.timezone(datetime.timedelta(minutes=SLOT_TIMEZONE_OFFSET_MINUTES))
    )
    return f"{local:%a} {local.day} {local:%b}"


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
    # `eligible_only=False`, and the availability and cap reasons are raised
    # separately below. With them folded in here, a technician whose day had
    # filled — or who had gone offline — would be told the job did not exist,
    # which is both false and unactionable.
    offered = await db.scalar(
        pool_query(
            company_id=company_id, technician_id=profile.id, eligible_only=False
        ).where(Ticket.id == ticket_id)
    )
    if offered is None:
        # Not in the pool. Two reasons, and only one of them is "no such job":
        # the usual case by far is that somebody accepted it while this
        # technician was reading the card. Answering 404 for a job they were
        # looking at seconds ago is wrong AND alarming, and it is the case the
        # app's `JobTakenError` exists to render calmly.
        taken = await db.scalar(
            pool_query(
                company_id=company_id,
                technician_id=profile.id,
                eligible_only=False,
                open_only=False,
            ).where(Ticket.id == ticket_id)
        )
        if taken is not None:
            # Three ways to leave the pool now, not one, and "somebody was
            # faster" is only the first. A job that ESCALATED left because
            # nobody was fast enough — telling this technician a colleague beat
            # them to it would be false, and would send them looking for the
            # next card when the honest answer is that a manager now owns this
            # one.
            if taken.status == "Escalated" and taken.technician_id is None:
                raise JobRefused(
                    "JOB_ESCALATED",
                    "This job has gone to your Area Service Manager.",
                )
            raise JobRefused(
                "JOB_ALREADY_TAKEN", "Another technician accepted this job first"
            )
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Job not found"
        )

    if profile.status != ACTIVE or not profile.accepting_work:
        raise JobRefused(
            "NOT_ACCEPTING_WORK",
            "You're not accepting work right now — turn availability back on to "
            "take jobs.",
        )

    result = await db.execute(
        update(Ticket)
        .where(
            Ticket.id == ticket_id,
            Ticket.company_id == company_id,
            Ticket.status == "New",
            Ticket.technician_id.is_(None),
            # The cap is re-tested HERE and not only in the eligibility read
            # above, because that read is a read: one technician tapping two
            # jobs for the same day at the same moment passes it twice and
            # would end the transaction over their cap. Settled in the WHERE
            # clause, Postgres serialises them and the second matches nothing.
            has_cap_room(company_id=company_id, technician_id=profile.id),
        )
        .values(technician_id=profile.id, status="Assigned")
    )
    if result.rowcount == 0:
        # Two very different reasons to have matched nothing, and a technician
        # can act on only one of them. Losing a race means try another job;
        # being full means the day is done — telling them "somebody was faster"
        # would send them back to a pool with nothing in it for them either.
        #
        # Read the ticket rather than re-running the cap: if it is still open,
        # the cap is the only clause left that can have failed.
        still_open = await db.scalar(
            select(Ticket.id).where(
                Ticket.id == ticket_id,
                Ticket.company_id == company_id,
                Ticket.status == "New",
                Ticket.technician_id.is_(None),
            )
        )
        if still_open is not None:
            day = _ist_day_label(offered.slot_start)
            raise JobRefused(
                "DAILY_CAP_REACHED",
                f"You already have {profile.daily_job_cap} jobs on {day} — that is "
                "your daily limit. Raise it under Availability & bandwidth.",
            )
        raise JobRefused(
            "JOB_ALREADY_TAKEN", "Another technician accepted this job first"
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
    # NB the bonus is NOT paid here. See `complete` — accepting is a promise,
    # and a promise that can still be cancelled is not something to settle
    # money against.
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
        node_path_ids=offered.node_path_ids,
    )
    await publish_ticket_changed(db, offered)
    await db.commit()

    row = await db.scalar(
        select(Ticket).where(Ticket.id == ticket_id, Ticket.company_id == company_id)
    )
    assert row is not None
    # Now it is theirs, so the masked fields are theirs to see.
    offers, models = await _hydrate(db, [row])
    return _job_out(offers[0], row, models)


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
    observed_serial: str | None = None,
    observed_serial_source: str | None = None,
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
    _check_proof_complete(
        artifacts,
        observed_serial=observed_serial,
        observed_serial_source=observed_serial_source,
    )
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

    # Hoisted out of the check so that check stays a plain predicate over the
    # request — no session, no await, testable on its own. Safe here and only
    # here: at this point the session holds no pending writes, so `load_rules`
    # repairing a missing row can emit at most one INSERT on a table the
    # guarded UPDATE below never touches. After the `TicketProof` adds it would
    # flush those early for nothing.
    metres = _check_live_was_taken_at_the_job(
        artifacts,
        ticket=row,
        # The ticket's own radius — the SAME number `_job_out` sent the phone,
        # so the shutter the app blocked and the upload the server refuses agree
        # by construction.
        geo_radius_m=snapshot_value(row.rules_snapshot, "geo_radius_m"),
    )

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

    if observed_serial:
        row.observed_serial = observed_serial.strip()
        row.observed_serial_source = observed_serial_source or "manual"

    located = sum(1 for a in artifacts if a.latitude is not None)
    started_by = await _technician_name(db, profile)
    db.add(
        _event(
            row,
            "started",
            actor_kind="technician",
            actor_label=started_by,
            note=(
                f"{len(artifacts)} proof images captured"
                + (
                    " — no location on the live photo"
                    if not located
                    # Only for a ticket that HAS coordinates. On a
                    # pincode-ruled ticket there is nothing to measure against,
                    # and a distance from a place we do not know would be a
                    # fabricated number on a permanent record.
                    else f" · {metres_label(metres)} from the address"
                    if metres is not None
                    else ""
                )
            ),
            from_status="Assigned",
            to_status="In Progress",
        )
    )

    # The visit is really happening, and until now the only way to find that out
    # was to be looking at the ticket when its status moved. This is the first
    # moment anybody off the phone knows somebody is standing in the customer's
    # house — which is what makes it the moment a manager can still do something
    # about a job going wrong.
    #
    # Territory, like every ticket-shaped notification here: the pincode reaches
    # the area manager whose area the work is in.
    started = await notify(
        db,
        company_id=company_id,
        kind="job_started",
        title=f"Work started on {row.code}",
        detail=(
            f"{started_by} · {len(artifacts)} proof images"
            + ("" if located else " · no location on the live photo")
        ),
        to=f"/tickets/{row.id}",
        ticket_id=row.id,
        pincode=row.pincode,
    )

    # Recorded, not enforced. The technician has already done the physical work
    # and the likeliest cause is a slip at intake — so this goes in the trail
    # and in front of a manager, rather than stopping somebody standing in a
    # customer's house over a number they cannot correct.
    mismatch = serial_mismatch(row)
    if mismatch:
        db.add(
            _event(
                row,
                "serial_mismatch",
                actor_kind="technician",
                actor_label=started_by,
                note=(
                    f"Read {row.observed_serial} on site "
                    f"({row.observed_serial_source}); the order says "
                    f"{row.serial_number}"
                ),
            )
        )
        # In the same transaction as the proof it describes. A bell that rings
        # for a mismatch whose proof failed to save would send a manager to a
        # ticket where nothing happened.
        raised = await notify(
            db,
            company_id=company_id,
            kind="serial_mismatch",
            title=f"Serial mismatch on {row.code}",
            detail=(
                f"Read {row.observed_serial} · order says {row.serial_number} "
                f"· {started_by}"
            ),
            to=f"/tickets/{row.id}",
            ticket_id=row.id,
            # Territory, so it reaches the manager whose area this is rather
            # than everyone in the company.
            pincode=row.pincode,
            # And the vendor. They hold the invoice, so a mismatch is usually
            # their typo at intake and theirs to settle — the console already
            # offers them the correction, and until now nothing told them there
            # was anything to correct.
            vendor_id=row.vendor_id,
        )

    await publish_ticket_changed(db, row)
    await db.commit()

    # After the commit: both notification rows are durable, so these only tell
    # consoles to go and read them.
    #
    # Two bells for one submit when the serial is also wrong, and that is
    # deliberate. They are different facts with different answers — one says
    # the visit is under way, the other says something on it needs correcting —
    # and they are not addressed to the same people: the mismatch also reaches
    # the vendor, who is usually the one who can fix it.
    await publish_notification(
        db,
        company_id=company_id,
        pincode=row.pincode,
        notification_id=started.id,
    )
    if mismatch:
        await publish_notification(
            db,
            company_id=company_id,
            pincode=row.pincode,
            vendor_id=row.vendor_id,
            notification_id=raised.id,
        )
    await db.commit()

    return await get_job(
        db, ticket_id, company_id=company_id, technician_id=profile.id
    )


def _check_live_was_taken_at_the_job(
    artifacts: list[ProofArtifactIn], *, ticket: Ticket, geo_radius_m: int
) -> float | None:
    """The live photo must have been taken where the job is.

    The app already refuses the shutter on a mismatch, but a client-side rule is
    a rendering choice — this is the one that holds.

    ## The live shot must carry COORDINATES, under either rule below

    Without this the block is decorative: turning location off would be the way
    round it.

    ## Which rule applies is decided by the TICKET, not by the photo

    A ticket whose address was PICKED off a map carries its own coordinates, and
    then distance is the whole rule — the live shot must be within the company's
    `geo_radius_m` of it. The pincode is not consulted at all for such a ticket.

    That is deliberate, and it is not an oversight for a later reader to tidy
    up. A coordinate pair measures where the door is; a postal boundary is a
    line drawn for the post. A technician two hundred metres from the door but
    one street into the next pincode is at the customer's house, and the older
    rule called that a refusal.

    A ticket whose address was TYPED has no coordinates — every ticket that
    existed before this landed, and everything the Excel and API intake channels
    will raise — and falls to the pincode-equality rule, unchanged. A null
    postal code with good coordinates is still ACCEPTED there: reverse geocoding
    needs map data the phone may not have, and refusing it would strand a
    technician standing at the right door with a working GPS.

    ## The phone is given the benefit of the error it reports

    A fix good to ±600m and a fix good to ±5m are not the same evidence, and the
    pincode rule had an accidental escape hatch this one lacks — it no-ops
    whenever reverse geocoding fails, which on Android needs a network. Without
    an equivalent, a technician in a basement car park could not start the job
    at all, and their only exit would be a cancellation penalty for a GPS
    problem. So the phone's own reported accuracy is subtracted before
    comparing.

    Capped at the radius, because otherwise a client claiming ±50km would switch
    the check off by lying about itself. Credit is not trust: it buys at most
    one radius of doubt.

    ## What it cannot do

    Nothing in this database maps a coordinate to a pincode, so on the pincode
    branch the server still cannot verify the label the phone attached — it
    enforces "if you tell me where you were, it must be here". The coordinates
    are stored under both rules, and remain the evidence for anything argued
    afterwards.

    Returns the measured distance in metres, or None when there was nothing to
    measure — so the trail can record what was measured rather than only that
    something was checked.
    """
    at_the_job = ticket.latitude is not None and ticket.longitude is not None
    measured: float | None = None

    for shot in artifacts:
        if shot.kind != "live":
            continue
        if shot.latitude is None or shot.longitude is None:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail=(
                    "The live site photo must carry a location — it is what "
                    "evidences the visit. Turn location on and retake it."
                ),
            )

        if at_the_job:
            # Narrowing for the type checker; `at_the_job` is exactly this.
            assert ticket.latitude is not None and ticket.longitude is not None
            measured = metres_between(
                shot.latitude, shot.longitude, ticket.latitude, ticket.longitude
            )
            credit = min(shot.accuracyM or 0.0, float(geo_radius_m))
            if measured - credit > geo_radius_m:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"The live photo was taken {metres_label(measured)} from "
                        f"the customer's address, and this job allows "
                        f"{metres_label(geo_radius_m)}. It must be captured at "
                        "the customer's address."
                    ),
                )
            # The pincode is NOT then checked. See the docstring: for a ticket
            # that knows where it is, the distance IS the rule.
            continue

        if shot.devicePincode and shot.devicePincode != ticket.pincode:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"The live photo was taken at {shot.devicePincode}, but this "
                    f"job is at {ticket.pincode}. It must be captured at the "
                    "customer's address."
                ),
            )

    return measured


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


def _check_proof_complete(
    artifacts: list[ProofArtifactIn],
    *,
    observed_serial: str | None,
    observed_serial_source: str | None,
) -> None:
    """What a complete proof set is — and the serial photo is CONDITIONAL.

    The barcode carries the serial. When it scans, the number is already in
    hand and photographing the label as well is a step that proves nothing new,
    so it is not required. When it does not scan — a damaged label, glare, or no
    barcode at all — the technician types the number, and then the photo of the
    label IS required, because a typed number with nothing behind it is just an
    assertion.

    A serial is always required by one route or the other. That is the point of
    the step: nobody leaves site without recording which unit they installed.
    """
    by_kind: dict[str, int] = {}
    for a in artifacts:
        by_kind[a.kind] = by_kind.get(a.kind, 0) + 1

    if not (observed_serial or "").strip():
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="The serial number is required — scan the barcode or enter it by hand",
        )

    scanned = observed_serial_source == "scanned"
    required = [k for k in PROOF_KINDS if k != "serial" or not scanned]

    missing = [k for k in required if k not in by_kind]
    if missing:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"Proof is incomplete — missing {', '.join(missing)}",
        )
    for single in ("barcode", "serial", "live"):
        if single in by_kind and by_kind[single] != 1:
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

    # The bonus is settled HERE, and this is the only place it is.
    #
    # Not at acceptance, which is where §7's "paid to whoever accepts" reads
    # like it belongs: an acceptance can still be cancelled, and a bonus paid
    # against one would have to be clawed back out of an append-only ledger —
    # or, worse, would be paid twice when the next technician took the same job
    # with `bonus_paise` still on it. Money settles against work done.
    #
    # Not at CLOSURE either, which is the customer's act and may never come.
    # The technician earned it by turning out at short notice for a job nobody
    # else would take; whether the customer answers their confirmation link is
    # not a fact about that.
    #
    # In the same transaction as the completion, like every other write here.
    #
    # ## Once per TICKET, not once per completion
    #
    # `tickets.bonus_paise` is a standing commitment — it says what this job is
    # worth extra — and it is deliberately never cleared, because "this job
    # carried a ₹400 bonus" stays true afterwards and the escalation card reads
    # it back. So it cannot also serve as the "already paid" marker.
    #
    # The LEDGER is that marker, which is this codebase's own idiom: the record
    # IS the marker, so the two cannot disagree. Without it one job could be
    # paid twice, and the route there is short and entirely ordinary — the
    # technician completes and is paid, the customer says it was NOT done, the
    # ticket goes to `Escalated` with the bonus still on it, a manager
    # re-assigns, and the next completion pays it again out of a pool that
    # only ever collected for it once.
    already_paid = await db.scalar(
        select(LedgerEntry.id).where(
            LedgerEntry.company_id == company_id,
            LedgerEntry.ticket_id == ticket_id,
            LedgerEntry.kind == "bonus",
        )
    )
    if row.bonus_paise and already_paid is None:
        db.add(
            ledger_entry(
                company_id=company_id,
                technician_id=profile.id,
                ticket_id=ticket_id,
                kind="bonus",
                amount_paise=row.bonus_paise,
                reason="Escalation pickup",
            )
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
    # `complete` already rang, but it rang one commit ago and this row is newer.
    # The failure branch is the one that earns it: a customer who never got the
    # link is a job that will sit in `Awaiting Customer` until somebody notices,
    # and "somebody notices" should not depend on reloading the page.
    await publish_ticket_changed(db, row)
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


# ── giving a job back ────────────────────────────────────────────────────────
#
# §7's other way into an escalation, and the one the requirement document leads
# with: *"A technician can cancel an accepted ticket... On cancellation, the
# system first attempts auto-reassignment: the ticket (with its locked slot) is
# re-notified to other eligible technicians."*
#
# Two things follow from "with its locked slot", and both are load-bearing:
#
#   * the SLOT never moves. The customer agreed a time before any technician saw
#     the job, and it was never the technician's to change by leaving.
#   * the ticket goes back to `New` — the pool — not to `Cancelled`. `Cancelled`
#     means the work is not happening; this means somebody else is doing it.


async def _band_for(
    db: AsyncSession, row: Ticket, *, technician_id: uuid.UUID
) -> tuple[int, str, bool]:
    """What cancelling this job costs right now, after the monthly cap.

    Returns `(charge_paise, label, escalates)`.

    The amounts come from the TICKET'S OWN stamped `cancel_penalties_paise`,
    the hour boundaries from `core.rules` — amounts are policy and configurable
    per product, where one band ends is domain and is not. This used to be
    computed on the PHONE, which its own comment called the wrong place:
    `hoursToSlot` came off the device clock, so a wrong clock talked itself into
    a cheaper penalty.

    Reading the snapshot rather than the live rules is what makes the quote
    honest: a technician who accepted a job under a ₹300 band is charged ₹300
    even if somebody re-prices the category that afternoon.

    **The monthly cap is the exception, and comes from the company.** It bounds
    what one technician pays across every job they took that month, so it cannot
    be a property of any single one of them — which is why it is the one rule a
    node may not override.

    `charge_paise` is what will ACTUALLY be taken, which is not always the
    band: the monthly cap can leave less than it, or nothing at all. The
    preview and the charge both read this, so the figure a technician confirms
    is the figure they pay.
    """
    rules = await load_rules(db, row.company_id)
    assert row.slot_start is not None  # an Assigned job always has a slot
    hours = (row.slot_start - _now()).total_seconds() / 3600
    index = cancel_band_index(hours)
    band = int(snapshot_value(row.rules_snapshot, "cancel_penalties_paise")[index])

    already = await charged_this_month(
        db, company_id=row.company_id, technician_id=technician_id
    )
    remaining = cap_remaining(
        cap_paise=rules.cancel_penalty_cap_paise, already_charged=already
    )
    charge = band if remaining is None else min(band, remaining)

    # The same threshold the sweep escalates on, so "under four hours" means one
    # thing for this job across the product. From the ticket's own rules rather
    # than inferred from the band index: a category that moved its escalation
    # window would otherwise have a screen promising an escalation on a
    # different clock from the sweep's.
    escalates = hours < snapshot_value(row.rules_snapshot, "escalate_hours_before_slot")
    return charge, CANCEL_PENALTY_BANDS[index], escalates


async def cancellation_preview(
    db: AsyncSession,
    ticket_id: uuid.UUID,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
) -> PenaltyBandOut:
    """What it would cost to give this job up, before committing to it.

    A separate read from the cancel itself, deliberately: the technician has to
    see the cost BEFORE confirming, and the approved screen prints it twice —
    once in the banner and once on the button — so it cannot be tapped without
    having been read.

    A live figure, not a quote. The band moves as the slot approaches, so a
    screen left open can show one price and charge another; that is the honest
    behaviour — the charge is what it costs at the moment of cancelling — and
    the window in which it changes is minutes wide.
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
    if row.status != "Assigned":
        raise JobRefused(
            "JOB_NOT_CANCELLABLE", "This job can no longer be cancelled."
        )
    charge, label, escalates = await _band_for(
        db, row, technician_id=technician_id
    )
    return PenaltyBandOut(amountPaise=charge, label=label, escalates=escalates)


async def cancel(
    db: AsyncSession,
    ticket_id: uuid.UUID,
    *,
    company_id: uuid.UUID,
    profile: TechnicianProfile,
    reason: str,
) -> PenaltyBandOut:
    """Give the job back, pay the band, and put it in front of whoever is next.

    **`Assigned` only.** Once proof has been captured the technician is on site
    and the job is `In Progress`; walking away from that is a different event
    with different evidence attached, and it is not this one.

    Settled by a guarded UPDATE on `(technician_id = me, status = 'Assigned')`,
    like every other transition in this slice. `rowcount == 0` means the ticket
    moved underneath them — a manager re-assigned it, or they tapped twice from
    two screens — and nothing is charged for a job they no longer hold.

    Three things commit together and must: the release, the ledger row and the
    trail. A penalty that outlived a rolled-back cancellation would charge
    somebody for a job they still have.
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
    if row.status != "Assigned":
        raise JobRefused(
            "JOB_NOT_CANCELLABLE", "This job can no longer be cancelled."
        )

    # ── serialise this technician's own cancellations ────────────────────────
    #
    # Everything else in this slice settles its race in a WHERE clause, and the
    # monthly cap cannot: the amount to charge DEPENDS on the sum of rows that
    # have already been written, so it is a read followed by a write with a gap
    # in between. Two cancellations landing in that gap both see the same
    # remaining cap and both charge it — measured, not theorised: two concurrent
    # cancellations took ₹300 each against a ₹300 ceiling.
    #
    # A row lock on the technician's own profile closes it. It is the narrowest
    # thing that works — two technicians cancelling at once never wait on each
    # other, only one technician cancelling twice at once does, which is the
    # exact case that was wrong — and it is held until this transaction commits,
    # so the second reader sees the first one's ledger row.
    #
    # `refresh` rather than a bare `SELECT ... FOR UPDATE`, because it also
    # re-reads the row: `jobs_cancelled` is incremented below, and that is a
    # read-modify-write with a lost-update race of its own.
    await db.refresh(profile, with_for_update=True)

    charge, label, escalates = await _band_for(db, row, technician_id=profile.id)

    result = await db.execute(
        update(Ticket)
        .where(
            Ticket.id == ticket_id,
            Ticket.company_id == company_id,
            Ticket.status == "Assigned",
            Ticket.technician_id == profile.id,
        )
        .values(technician_id=None, status="New")
    )
    if result.rowcount == 0:
        raise JobRefused(
            "JOB_NOT_CANCELLABLE",
            "This job is no longer assigned to you. Refresh to see your "
            "current jobs.",
        )
    row.status = "New"
    row.technician_id = None

    name = await _technician_name(db, profile)
    db.add(
        _event(
            row,
            "released",
            actor_kind="technician",
            actor_label=name,
            from_status="Assigned",
            to_status="New",
            note=f"Cancelled: {reason} · {label} · ₹{charge // 100:,}",
        )
    )
    # `amount_paise > 0` is the CHECK on the table, and a technician whose
    # monthly cap is already spent genuinely owes nothing more — so there is no
    # row rather than a zero one. The release is still recorded above; only the
    # money is absent, which is the truth.
    if charge > 0:
        db.add(
            ledger_entry(
                company_id=company_id,
                technician_id=profile.id,
                ticket_id=row.id,
                kind="penalty",
                amount_paise=charge,
                reason=f"Cancel {label}",
            )
        )
    # `jobs_cancelled` has been NULL — "not measured" — since the column was
    # made nullable, because nothing counted one. Something does now, and the
    # first cancellation is what turns a profile's "—" into a number.
    profile.jobs_cancelled = (profile.jobs_cancelled or 0) + 1

    escalated = False
    if escalates:
        # "Under 4 hours to the slot - this escalates straight to the Area
        # Service Manager for urgent reassignment" is the approved sentence the
        # technician has just read. Straight means now, not on the next
        # five-minute tick.
        escalated = await escalate(
            db,
            row,
            note=f"{name} cancelled · {label}",
            detail=f"Technician cancelled · {row.city} {row.pincode}",
            actor_kind="technician",
            actor_label=name,
        )
    if not escalated:
        # Still in the pool, so the pool changed. `escalate` publishes its own
        # frames when it fires.
        await publish_pool_changed(
            db,
            company_id=company_id,
            pincode=row.pincode,
            node_path_ids=row.node_path_ids,
        )
        await publish_ticket_changed(db, row)
    await db.commit()

    # Outbound work, after the commit: neither of these can be rolled back.
    if escalated:
        await whatsapp_the_area_manager(db, row)
    else:
        # §7: "the system first attempts auto-reassignment: the ticket (with
        # its locked slot) is re-notified to other eligible technicians."
        await announce_pool_job(
            db,
            company_id=company_id,
            ticket_id=row.id,
            code=row.code,
            pincode=row.pincode,
            city=row.city,
            node_path_ids=row.node_path_ids,
            slot_start=row.slot_start,
        )
    return PenaltyBandOut(amountPaise=charge, label=label, escalates=escalates)

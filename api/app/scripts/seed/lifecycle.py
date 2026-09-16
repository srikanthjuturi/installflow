"""Drive 500 tickets through the real flows, then hand the settled ones back.

Every ticket is walked forward exactly as a person would walk it — the vendor
raises it, the customer picks a window, a technician accepts, photographs,
finishes, the customer rates it. Nothing here writes a status, an event or a
ledger row directly, which is what makes the Earnings total, the pool balance
and the dashboard agree with each other afterwards.

Two facts shape the whole file:

* **Time only runs forwards.** A job cannot be accepted for a window that has
  passed, so every ticket is created with a FUTURE slot and moved into the past
  afterwards by `backdate.py`. Only settled tickets are moved — a ticket still
  in the pool must keep its future slot or it disappears from `pool_query`.
* **Eligibility is not luck.** A ticket is only ever offered to a technician
  covering its pincode and certified for its category, so the technician is
  chosen FIRST and the ticket is built from what that person can actually be
  sent to. Otherwise most of the pool would be invisible to everybody and the
  load test would read an empty list.

What cannot be produced here, and why it is absent rather than faked:
`Cancelled` and `AI Review`. Nothing in the API writes either — a technician
cancelling returns the job to the pool and is charged a penalty, which is what
the 'cancelled' share of the mix actually becomes.
"""

import dataclasses
import datetime
import random
import uuid
from collections.abc import Sequence

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.slots import bookable_slots
from app.features.jobs import service as jobs_service
from app.features.jobs.schemas import ProofArtifactIn
from app.features.tickets import feedback_service
from app.features.tickets import service as tickets_service
from app.features.tickets.schemas import ForceCloseRequest, TicketCreateRequest
from app.models.technician import TechnicianNode, TechnicianPincode, TechnicianProfile
from app.models.ticket import Ticket
from app.scripts.seed.guards import assert_unreachable, synthetic_phone
from app.scripts.seed.tenant import Tenant

#: How the 500 divide. Shares rather than counts so the same mix survives a
#: smaller `--tickets` run. They are the states a real week leaves behind, not
#: a tidy spread: most work is waiting, some is being done, a little is done.
MIX: tuple[tuple[str, float], ...] = (
    ("pool_no_slot", 0.24),   # raised, customer has not picked a time
    ("pool_slot", 0.20),      # time agreed, nobody has taken it
    ("assigned", 0.14),       # a technician holds it
    ("in_progress", 0.06),    # proof captured, work under way
    ("awaiting_customer", 0.06),  # finished, customer not answered
    ("closed", 0.20),         # customer confirmed and rated → payout
    ("penalised", 0.06),      # accepted then cancelled → penalty, back to pool
    ("force_closed", 0.04),   # manager settled it
)

CUSTOMER_NAMES: tuple[str, ...] = (
    "Lakshmi Narayan", "Padma Priya", "Ramesh Chandra", "Sunitha Rao",
    "Vijaya Lakshmi", "Krishna Murthy", "Anitha Reddy", "Bhavani Shankar",
    "Chaitanya Rao", "Divya Bharathi", "Eswari Devi", "Gopika Nair",
    "Indira Prasad", "Jyothi Lakshmi", "Kalyani Devi", "Madhavi Latha",
    "Narasimha Rao", "Pallavi Sharma", "Rajeswari Devi", "Sridevi Kumari",
)

FORCE_CLOSE_REASONS: tuple[str, ...] = (
    "Customer unreachable after the visit",
    "Customer did not respond to the confirmation link",
    "Customer confirmed verbally on call",
)

CANCEL_REASONS: tuple[str, ...] = (
    "Vehicle breakdown on the way",
    "Double booked for this window",
    "Unwell and cannot attend",
    "Address could not be located",
)


@dataclasses.dataclass
class Worker:
    """A technician plus what they can actually be sent to."""

    profile: TechnicianProfile
    node_ids: list[uuid.UUID]
    pincodes: list[str]


@dataclasses.dataclass
class Outcome:
    """What one seeded ticket became."""

    ticket_id: uuid.UUID
    intent: str
    status: str
    #: Settled tickets may be moved into the past; live ones may not.
    settled: bool


async def load_workers(db: AsyncSession, technicians: Sequence[TechnicianProfile]) -> list[Worker]:
    """Read back each technician's coverage, rather than remembering it.

    The service hard-replaces both lists, so what was ASKED for and what is
    stored can differ — an area manager's pincodes are filtered, for one. The
    stored rows are what eligibility is judged on, so those are what we use.
    """
    out: list[Worker] = []
    for profile in technicians:
        nodes = list(
            await db.scalars(
                select(TechnicianNode.node_id).where(
                    TechnicianNode.technician_id == profile.id
                )
            )
        )
        pincodes = list(
            await db.scalars(
                select(TechnicianPincode.pincode).where(
                    TechnicianPincode.technician_id == profile.id
                )
            )
        )
        if nodes and pincodes:
            out.append(Worker(profile=profile, node_ids=nodes, pincodes=pincodes))
    return out


def plan(count: int, rng: random.Random) -> list[str]:
    """The intent for each ticket, shuffled so runs are not grouped by state."""
    intents: list[str] = []
    for intent, share in MIX:
        intents.extend([intent] * round(count * share))
    while len(intents) < count:
        intents.append("pool_no_slot")
    del intents[count:]
    rng.shuffle(intents)
    return intents


def _serial(index: int) -> str:
    """Invented, and that is allowed: no `product_model_serials` are loaded for
    these models, and an EMPTY serial list means intake does not check."""
    return f"SD{index:06d}{uuid.uuid4().hex[:4].upper()}"


async def _raise_ticket(
    db: AsyncSession,
    tenant: Tenant,
    worker: Worker,
    *,
    index: int,
    with_slot: bool,
    rng: random.Random,
) -> Ticket:
    node_id = rng.choice(worker.node_ids)
    model_id, service_types = rng.choice(tenant.models_by_node[node_id])
    service_type = rng.choice(service_types)
    pincode = rng.choice(worker.pincodes)
    today = datetime.datetime.now(datetime.timezone.utc).date()

    body = TicketCreateRequest(
        subcategoryId=node_id,
        modelId=model_id,
        serviceType=service_type,
        # Only the two diagnostic types take one, and they REQUIRE one.
        description=(
            "Unit stopped working two days ago, needs a check"
            if service_type in ("Tech Visit", "Service")
            else None
        ),
        serialNumber=_serial(index),
        customerName=CUSTOMER_NAMES[index % len(CUSTOMER_NAMES)],
        # The upper half of this run's block, so a customer can never be given
        # a number a technician already holds.
        customerPhone=assert_unreachable(
            synthetic_phone(tenant.phone_block + 50_000 + index),
            what=f"customer for ticket {index}",
        ),
        address=f"Flat {index % 400 + 1}, Seed Residency, Phase {index % 4 + 1}",
        city="Hyderabad",
        state="Telangana",
        pincode=pincode,
        # No latitude/longitude on purpose: that is what the Excel and API
        # intake channels always produce, and it puts the live proof photo on
        # the PINCODE rule, which a seeded device pincode can satisfy honestly.
        expectedDate=today + datetime.timedelta(days=rng.choice((0, 1, 1, 2))),
        serviceLevelHours=rng.choice((24, 24, 36, 48)),
    )
    created = await tickets_service.create_ticket(db, tenant.vendor_principal, body)
    row = await db.get(Ticket, created.id)
    if with_slot:
        await _confirm_slot(db, row, rng=rng)
        await db.refresh(row)
    return row


async def _confirm_slot(db: AsyncSession, row: Ticket, *, rng: random.Random, soon: bool = False) -> bool:
    """Let the customer pick one of the windows the server offers.

    `soon` takes the EARLIEST window instead of a random one, which is how a
    late-cancellation band is produced: the penalty is measured from the slot,
    so a ticket cancelled against a window 90 minutes out lands in a dearer
    band than one cancelled against tomorrow's.
    """
    windows = await bookable_slots(db, row)
    if not windows:
        return False
    start, _end = windows[0] if soon else rng.choice(windows[: min(6, len(windows))])
    await tickets_service.confirm_slot(db, row.slot_token, start)
    return True


def _artifacts(company_id: uuid.UUID, row: Ticket) -> list[ProofArtifactIn]:
    """The four artifacts, named the way the uploader would have named them.

    `_check_blobs_are_ours` only inspects the prefix, so these point at nothing
    — deliberately. Uploading 500 jobs' worth of images would leave files in a
    blob container that `cleanup_db` never deletes and that both environments
    share.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    base = f"proof/{company_id}/seed/{row.id}"
    common = {"capturedAt": now}
    return [
        ProofArtifactIn(kind="barcode", blobName=f"{base}/barcode.jpg", **common),
        ProofArtifactIn(kind="serial", blobName=f"{base}/serial.jpg", **common),
        ProofArtifactIn(kind="photos", blobName=f"{base}/unit-1.jpg", ordinal=1, **common),
        ProofArtifactIn(kind="photos", blobName=f"{base}/unit-2.jpg", ordinal=2, **common),
        ProofArtifactIn(
            kind="live",
            blobName=f"{base}/live.jpg",
            # The ticket carries no coordinates, so the gate compares pincodes
            # — but a live shot must still carry a position under both rules.
            latitude=17.4 + (row.id.int % 100) / 10_000,
            longitude=78.4 + (row.id.int % 97) / 10_000,
            accuracyM=12.0,
            devicePincode=row.pincode,
            **common,
        ),
    ]


async def drive(
    db: AsyncSession,
    tenant: Tenant,
    *,
    count: int,
    rng: random.Random,
    on_progress=None,
) -> list[Outcome]:
    """Raise `count` tickets and walk each to the state its intent asks for."""
    workers = await load_workers(db, tenant.technicians)
    if not workers:
        raise RuntimeError("No technician has both coverage and certifications")

    background = BackgroundTasks()
    outcomes: list[Outcome] = []

    for index, intent in enumerate(plan(count, rng), start=1):
        worker = rng.choice(workers)
        try:
            outcome = await _one(
                db,
                tenant,
                worker,
                intent=intent,
                index=index,
                background=background,
                rng=rng,
            )
        except (AppError, HTTPException) as exc:
            # A refusal is a real answer, not a crash: a technician at their
            # daily cap, or a ticket whose service level leaves no window. The
            # ticket keeps whatever state it reached and the run carries on —
            # the check step counts what actually exists rather than what was
            # planned.
            outcome = Outcome(
                ticket_id=uuid.UUID(int=0),
                intent=intent,
                status=f"refused: {getattr(exc, 'detail', exc)}",
                settled=False,
            )
        outcomes.append(outcome)
        if on_progress is not None:
            on_progress(index, count, outcome)
    return outcomes


async def _one(
    db: AsyncSession,
    tenant: Tenant,
    worker: Worker,
    *,
    intent: str,
    index: int,
    background: BackgroundTasks,
    rng: random.Random,
) -> Outcome:
    company_id = tenant.company_id
    profile = worker.profile
    # `penalised` picks its own window below — the EARLIEST one, so the
    # cancellation lands in a dearer band. Confirming a random one here first
    # would make that a second confirmation, which the API rightly refuses.
    wants_slot = intent not in ("pool_no_slot", "penalised")
    row = await _raise_ticket(
        db, tenant, worker, index=index, with_slot=wants_slot, rng=rng
    )

    def done(settled: bool = False) -> Outcome:
        return Outcome(
            ticket_id=row.id, intent=intent, status=row.status, settled=settled
        )

    if intent in ("pool_no_slot", "pool_slot"):
        return done()

    if intent == "penalised":
        # A late cancellation: the earliest window the server will offer, so
        # the band is measured against a slot 90 minutes out rather than
        # tomorrow's. Under four hours it also escalates, which is what puts
        # these on the console's escalation queue.
        await _confirm_slot(db, row, rng=rng, soon=True)
        await db.refresh(row)
        await jobs_service.accept(
            db, row.id, company_id=company_id, profile=profile, background=background
        )
        await jobs_service.cancel(
            db,
            row.id,
            company_id=company_id,
            profile=profile,
            reason=rng.choice(CANCEL_REASONS),
        )
        await db.refresh(row)
        return done()

    await jobs_service.accept(
        db, row.id, company_id=company_id, profile=profile, background=background
    )
    await db.refresh(row)
    if intent == "assigned":
        return done()

    if intent == "force_closed":
        # A manager settling a job the customer never confirmed. The payout is
        # the manager's own number, capped at the job's price — here, roughly
        # half, which is what "travelled and found nobody home" is worth.
        await tickets_service.force_close_ticket(
            db,
            tenant.admin,
            row.id,
            ForceCloseRequest(
                reason=rng.choice(FORCE_CLOSE_REASONS),
                notes=(
                    "Called the customer three times over two days and left a "
                    "message. Work was completed and photographed on site."
                ),
                attachments=[
                    {"blobName": f"attachment/{company_id}/seed/{row.id}/call-log.png"}
                ],
                technicianPayoutPaise=(row.technician_payout_paise or 0) // 2,
            ),
        )
        await db.refresh(row)
        return done(settled=True)

    await jobs_service.submit_proof(
        db,
        row.id,
        company_id=company_id,
        profile=profile,
        artifacts=_artifacts(company_id, row),
        observed_serial=row.serial_number,
        observed_serial_source="scanned",
    )
    await db.refresh(row)
    if intent == "in_progress":
        return done()

    await jobs_service.complete(
        db, row.id, company_id=company_id, profile=profile
    )
    await db.refresh(row)
    if intent == "awaiting_customer":
        return done()

    # closed: only the customer can do this, through the link they were sent.
    await feedback_service.record_feedback(
        db,
        row.feedback_token,
        confirmed=True,
        rating=rng.choice((3, 4, 4, 5, 5, 5)),
        comment=rng.choice(
            (
                "",
                "Technician was on time and explained everything.",
                "Neat installation, happy with the work.",
                "Good service.",
            )
        ),
    )
    await db.refresh(row)
    return done(settled=True)

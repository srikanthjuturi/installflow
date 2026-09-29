"""A vendor's credit line: what it owes, what it has reserved, and the gate.

Read `models/vendor_credits.py` first — it carries the design. This is the part
every other slice calls, so it lives in core rather than in any one of them
(hard rule 4): `vendors` stamps the line and shows it on the list, `tickets`
gates intake and bills both closures, `features.vendor_credits` draws the
screens and takes the payments.

## Four numbers, and only one of them can fall

    limit      vendors.credit_limit_paise
    used       sum(charge) - sum(payment)
    reserved   sum(vendor_price_paise) of non-terminal tickets
    available  limit - used - reserved

Closing a ticket moves its price from `reserved` to `used`, so `available` does
not move — and a force-closure billed at less than the full price moves it UP.
Cancelling frees the reservation and bills nothing. **The only thing that
reduces a vendor's headroom is raising a ticket**, which is why the gate and
both bells live in `assert_within_limit` and nowhere else.

That is worth holding on to, because the instinct is to look for the refusal at
closure. There is none: a customer confirming a visit runs with no principal and
a force-closure is a manager settling a case, and neither may be blocked by what
a vendor owes. `used` may pass `limit` and `available` may go negative — and
that is precisely what stops the vendor's next ticket.
"""

import asyncio
import dataclasses
import datetime
import logging
import uuid

from sqlalchemy import case, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.brand import company_name
from app.core.database import AsyncSessionLocal
from app.core.errors import AppError
from app.core.money import rupees
from app.core.notifications import notify
from app.core.realtime import publish_notification
from app.core.tickets import TERMINAL_STATUSES
from app.models.company import Company
from app.models.notification import Notification
from app.models.ticket import Ticket
from app.models.vendor import Vendor
from app.models.vendor_credits import VendorCreditEntry, VendorPayment

log = logging.getLogger(__name__)

#: Where a staff bell about a vendor's line leads.
VENDOR_CREDIT_ROUTE = "/vendor-credit"

#: Where a vendor's own bell leads — its Credit page inside the portal.
PORTAL_CREDIT_ROUTE = "/portal/credit"


@dataclasses.dataclass(frozen=True)
class VendorCredit:
    """One vendor's line, as three facts and two conclusions.

    The conclusions are properties rather than fields on purpose: a caller
    cannot construct one whose `available` disagrees with its own parts, which
    is the failure mode a fourth stored number would eventually have.
    """

    limit_paise: int
    #: Charged at closure, less every payment somebody confirmed arrived.
    used_paise: int
    #: The stamped price of tickets raised and not yet closed or cancelled.
    reserved_paise: int

    @property
    def available_paise(self) -> int:
        """Room left. Negative once closures have overtaken the line."""
        return self.limit_paise - self.used_paise - self.reserved_paise

    @property
    def paused(self) -> bool:
        """Whether the NEXT ticket is certainly refused.

        Exact rather than a guess, and it is `<= 0` for a reason worth stating:
        `tickets.vendor_price_paise` carries a `> 0` CHECK, so with no room at
        all there is no ticket that could fit. Room left does NOT promise the
        next ticket fits — a single job can cost more than what is left — which
        is why `POST /tickets` still decides for real.
        """
        return self.available_paise <= 0


async def used(db: AsyncSession, company_id: uuid.UUID, vendor_id: uuid.UUID) -> int:
    """What this vendor owes, in paise. Summed every time, never stored."""
    total = await db.scalar(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (
                            VendorCreditEntry.kind == "payment",
                            -VendorCreditEntry.amount_paise,
                        ),
                        else_=VendorCreditEntry.amount_paise,
                    )
                ),
                0,
            )
        ).where(
            VendorCreditEntry.company_id == company_id,
            VendorCreditEntry.vendor_id == vendor_id,
        )
    )
    return int(total or 0)


async def used_many(
    db: AsyncSession, company_id: uuid.UUID, vendor_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Many vendors' totals in one grouped query — the console's list."""
    if not vendor_ids:
        return {}
    rows = await db.execute(
        select(
            VendorCreditEntry.vendor_id,
            func.sum(
                case(
                    (
                        VendorCreditEntry.kind == "payment",
                        -VendorCreditEntry.amount_paise,
                    ),
                    else_=VendorCreditEntry.amount_paise,
                )
            ),
        )
        .where(
            VendorCreditEntry.company_id == company_id,
            VendorCreditEntry.vendor_id.in_(vendor_ids),
        )
        .group_by(VendorCreditEntry.vendor_id)
    )
    found = {vendor_id: int(total or 0) for vendor_id, total in rows.all()}
    return {vendor_id: found.get(vendor_id, 0) for vendor_id in vendor_ids}


async def reserved(
    db: AsyncSession, company_id: uuid.UUID, vendor_id: uuid.UUID
) -> int:
    """What this vendor's OPEN tickets will cost it when they close, in paise.

    A live query, never a stored counter — the ticket's own status is the fact,
    and a column mirroring it would drift the first time a status changed by a
    path nobody remembered to update.
    """
    total = await db.scalar(
        select(func.coalesce(func.sum(Ticket.vendor_price_paise), 0)).where(
            Ticket.company_id == company_id,
            Ticket.vendor_id == vendor_id,
            Ticket.status.not_in(TERMINAL_STATUSES),
        )
    )
    return int(total or 0)


async def reserved_many(
    db: AsyncSession, company_id: uuid.UUID, vendor_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Many vendors' reservations in one grouped query."""
    if not vendor_ids:
        return {}
    rows = await db.execute(
        select(Ticket.vendor_id, func.sum(Ticket.vendor_price_paise))
        .where(
            Ticket.company_id == company_id,
            Ticket.vendor_id.in_(vendor_ids),
            Ticket.status.not_in(TERMINAL_STATUSES),
        )
        .group_by(Ticket.vendor_id)
    )
    found = {vendor_id: int(total or 0) for vendor_id, total in rows.all()}
    return {vendor_id: found.get(vendor_id, 0) for vendor_id in vendor_ids}


async def standing(
    db: AsyncSession, company_id: uuid.UUID, vendor_id: uuid.UUID
) -> VendorCredit:
    """One vendor's line. Three queries, and the two conclusions are derived."""
    limit = await db.scalar(
        select(Vendor.credit_limit_paise).where(
            Vendor.company_id == company_id, Vendor.id == vendor_id
        )
    )
    return VendorCredit(
        limit_paise=int(limit or 0),
        used_paise=await used(db, company_id, vendor_id),
        reserved_paise=await reserved(db, company_id, vendor_id),
    )


async def standing_many(
    db: AsyncSession, company_id: uuid.UUID, *, limits: dict[uuid.UUID, int]
) -> dict[uuid.UUID, VendorCredit]:
    """A page of vendors' lines in two grouped queries. Never N+1.

    Takes the limits rather than reading them, because every caller has the
    vendor rows in hand already — the shape `vendors._hydrate`'s other derived
    figures use.
    """
    vendor_ids = list(limits)
    totals = await used_many(db, company_id, vendor_ids)
    holds = await reserved_many(db, company_id, vendor_ids)
    return {
        vendor_id: VendorCredit(
            limit_paise=limit,
            used_paise=totals.get(vendor_id, 0),
            reserved_paise=holds.get(vendor_id, 0),
        )
        for vendor_id, limit in limits.items()
    }


async def lock(db: AsyncSession, vendor_id: uuid.UUID) -> None:
    """Serialise everything that decides on this vendor's line, until commit.

    An advisory lock rather than `SELECT ... FOR UPDATE` on the vendor row, for
    the reason `core.credits.lock` gives: `FOR UPDATE` conflicts with the
    `KEY SHARE` lock every foreign-key insert takes on its parent, so holding it
    would stall every write that names this vendor — every ticket, every
    product — while one ticket was being raised.

    Keyed on the VENDOR, not the company, so two of a company's vendors raising
    tickets at the same moment do not queue behind each other. They cannot race:
    their lines are separate sums over separate rows.
    """
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"vendor-credit:{vendor_id}"},
    )


@dataclasses.dataclass(frozen=True)
class VendorCreditQuote:
    """Whether work not yet written would fit inside a vendor's line.

    The read-only half of the gate, for anything that has to SHOW the answer
    before committing to it — the spreadsheet importer's dry run, which reports
    what a file would cost, and `intake_status`, which asks the degenerate
    version with `required_paise` of zero.

    One shape so the dry run's figures and the commit's decision cannot come
    from different arithmetic, exactly as `credits.CreditQuote` is one shape for
    the company's side.
    """

    #: The line as it stands, with none of the new work counted.
    line: VendorCredit
    #: What the new work would add to `reserved`.
    required_paise: int

    @property
    def short(self) -> bool:
        return self.required_paise > self.line.available_paise

    @property
    def shortfall_paise(self) -> int:
        return max(0, self.required_paise - self.line.available_paise)


async def quote(
    db: AsyncSession,
    company_id: uuid.UUID,
    vendor_id: uuid.UUID,
    *,
    required_paise: int,
) -> VendorCreditQuote:
    """What this vendor's line looks like, and whether `required_paise` fits.

    Reads and decides nothing else — no lock, no write, no refusal. The caller
    that goes on to write takes `assert_within_limit` instead, which re-derives
    the same answer under the lock: a quote can go stale between being shown and
    being acted on, and only one of the two may be the decision.
    """
    return VendorCreditQuote(
        line=await standing(db, company_id, vendor_id),
        required_paise=required_paise,
    )


async def assert_within_limit(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    vendor_id: uuid.UUID,
    just_reserved_paise: int,
    ticket_count: int = 1,
) -> VendorCredit:
    """Refuse the tickets just written if this vendor has no room for them.

    ## Call this AFTER the tickets have been flushed

    A new ticket is non-terminal, so it is already inside `reserved` by the time
    this counts — which is what makes the check exact and what closes the race.
    Nothing separate is reserved and nothing is written here: the ticket rows ARE
    the reservation, and the advisory lock plus the caller's rollback do the
    rest. Two tickets racing for the last of a line settle the way two racing
    for a company's last credit do — one lands, one gets the 409.

    Ordering it before the flush would compare a line against a reservation that
    does not include the work being decided, and let a single job of any size
    through a line with one rupee left in it.

    `just_reserved_paise` is what this caller added — one ticket's stamped price,
    or the sum of a spreadsheet's. It is not used to decide: `available` has
    already absorbed it. It is used to say what was left BEFORE, which is what
    separates "this is the call that used the line up" from "the line was
    already used up", so the bell rings once rather than on every attempt after.

    ## The bells

    A crossing rings inside the caller's transaction, because it commits with
    the tickets that caused it. A refusal cannot — it rolls back with them — so
    it goes to `_ring_refusal`, in a session of its own.
    """
    await lock(db, vendor_id)
    now = await standing(db, company_id, vendor_id)
    before = now.available_paise + just_reserved_paise

    if now.available_paise < 0:
        name = await db.scalar(select(Company.name).where(Company.id == company_id))
        # A task, not an await: the bell needs a connection of its own and this
        # request is holding its worker's only one (`DB_MAX_OVERFLOW` 0) until
        # the 409 below has rolled back. Awaited here, it would wait for itself.
        task = asyncio.create_task(_ring_refusal(company_id, vendor_id, now))
        _background.add(task)
        task.add_done_callback(_background.discard)
        raise AppError(409, "VENDOR_OUT_OF_CREDITS", _refusal(
            company_name(name),
            line=now,
            required_paise=just_reserved_paise,
            had_paise=before,
            ticket_count=ticket_count,
        ))

    # The crossing: this call took the last of the room. Rung once — a later
    # ticket raised against an already-empty line is a refusal, not a crossing.
    if before > 0 and now.paused:
        await _announce(db, company_id, vendor_id, now)

    return now


def _refusal(
    company: str,
    *,
    line: VendorCredit,
    required_paise: int,
    had_paise: int,
    ticket_count: int,
) -> str:
    """The sentence a refused caller reads. Two, because two things are asking.

    A vendor filling in a form needs to know where its line stands and what to
    do. A vendor uploading a file needs to know what the FILE wanted against
    what was there, because the remedy may be to split it rather than to pay —
    the same distinction `credits.charge_tickets` draws for a company.
    """
    remedy = "Settle what is owed, or ask for a higher limit"
    if ticket_count > 1:
        # "-31,27,900 is left" is not a sentence anybody should have to read. A
        # line already past its limit has NOTHING left, and the figures in the
        # single-ticket wording below are where the detail belongs.
        left = (
            f"{rupees(had_paise)} is left" if had_paise > 0 else "nothing is left"
        )
        return (
            f"This file needs {rupees(required_paise)} of credit and {left} on "
            f"your limit with {company}. {remedy}, then import it again."
        )
    return (
        f"Your credit limit with {company} is used up. "
        f"Limit {rupees(line.limit_paise)}, {rupees(line.used_paise)} owed and "
        f"{rupees(line.reserved_paise)} on tickets not yet closed. {remedy}."
    )


async def charge_closure(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    vendor_id: uuid.UUID,
    ticket_id: uuid.UUID,
    amount_paise: int,
    by_user: uuid.UUID | None,
) -> None:
    """Bill the vendor for a ticket that has just closed. Never refuses.

    Adds to the caller's transaction and flushes; it does not commit, because
    money must commit with the thing it is about — the same rule
    `core.ledger.entry` states for a technician's payout, and the reason both
    closures call this beside theirs rather than afterwards.

    `amount_paise` of zero writes nothing. That is the honest answer for a
    force-closure where nobody attended, and it is not the same as an entry of
    zero, which would claim a bill was raised.

    Charged once per ticket, and the guarantee is structural rather than
    careful: `uq_vendor_credit_entries_company_ticket` makes a second entry for
    the same ticket impossible however often a closure is retried.

    No lock, deliberately. There is nothing to decide here — this is an append
    with no read in front of it, so there is no race for a lock to settle.
    """
    if amount_paise <= 0:
        return
    db.add(
        VendorCreditEntry(
            company_id=company_id,
            vendor_id=vendor_id,
            kind="charge",
            amount_paise=amount_paise,
            ticket_id=ticket_id,
            created_by=by_user,
        )
    )
    await db.flush()


async def apply_payment(
    db: AsyncSession, payment: VendorPayment, *, by_user: uuid.UUID | None
) -> int:
    """Credit a payment somebody has confirmed arrived. Returns what is still owed.

    The one thing that restores a vendor's headroom. Keyed on the payment, so
    pressing Confirm twice credits once —
    `uq_vendor_credit_entries_company_payment` sees to that, and the service's
    guarded UPDATE means the second press never reaches here anyway.
    """
    await lock(db, payment.vendor_id)
    db.add(
        VendorCreditEntry(
            company_id=payment.company_id,
            vendor_id=payment.vendor_id,
            kind="payment",
            amount_paise=payment.amount_paise,
            payment_id=payment.id,
            created_by=by_user,
        )
    )
    await db.flush()
    return await used(db, payment.company_id, payment.vendor_id)


# ── the bells ────────────────────────────────────────────────────────────────

#: Strong references to fire-and-forget bells, so none is collected mid-flight.
_background: set[asyncio.Task] = set()

#: How long one used-up bell stands for every refusal after it.
_REFUSAL_BELL_QUIET = datetime.timedelta(hours=12)


def _figures(line: VendorCredit) -> str:
    """The three numbers, in the one wording every bell about them uses."""
    return (
        f"Limit {rupees(line.limit_paise)} · "
        f"{rupees(line.used_paise)} owed · "
        f"{rupees(line.reserved_paise)} on open tickets."
    )


async def tell_billing(
    db: AsyncSession,
    company_id: uuid.UUID,
    *,
    kind: str,
    title: str,
    detail: str,
    to: str = VENDOR_CREDIT_ROUTE,
) -> None:
    """Ring the people who can act: Admins and National Heads together.

    `audience='billing'`, which is already in all three audience readers — the
    feed, web push and the console socket — so this needs no coverage change.
    """
    raised = await notify(
        db,
        company_id=company_id,
        kind=kind,
        title=title,
        detail=detail,
        to=to,
        audience="billing",
    )
    await publish_notification(
        db,
        company_id=company_id,
        pincode=None,
        notification_id=raised.id,
        audience="billing",
    )


async def tell_vendor(
    db: AsyncSession,
    company_id: uuid.UUID,
    vendor_id: uuid.UUID,
    *,
    kind: str,
    title: str,
    detail: str,
    to: str = PORTAL_CREDIT_ROUTE,
) -> None:
    """Ring the vendor in its own portal.

    A separate row from the staff one rather than a `vendor_id` added to it,
    because a row carries one `to` and the two sides go to different screens.
    The brand decision does the same thing for the same reason.

    `audience='vendor'` as well as the id, and this is the part worth reading
    twice: the id alone WIDENS to the vendor without narrowing away from staff,
    so every Admin would also get the vendor's copy of a bell they already have
    their own row for. The audience is what keeps the staff feed to one row per
    event. See `AUDIENCES` in `models/notification.py`.
    """
    raised = await notify(
        db,
        company_id=company_id,
        kind=kind,
        title=title,
        detail=detail,
        to=to,
        vendor_id=vendor_id,
        audience="vendor",
    )
    await publish_notification(
        db,
        company_id=company_id,
        pincode=None,
        vendor_id=vendor_id,
        notification_id=raised.id,
        audience="vendor",
    )


async def _announce(
    db: AsyncSession,
    company_id: uuid.UUID,
    vendor_id: uuid.UUID,
    line: VendorCredit,
) -> None:
    """Both sides hear that a line has just run out, each on its own screen."""
    name = await db.scalar(
        select(Vendor.name).where(
            Vendor.company_id == company_id, Vendor.id == vendor_id
        )
    )
    vendor = (name or "").strip() or "A vendor"
    await tell_billing(
        db,
        company_id,
        kind="vendor_credit",
        # The vendor's NAME, in the title. It was a fixed string for a while, on
        # the theory that it was the dedup key and a per-vendor title would dedup
        # nothing — but the key is `(kind, vendor_id)` and never was the title, so
        # the fixed string bought nothing and cost the one thing a title is for:
        # a company with six vendors got six identical rows in its feed.
        # Phrased to avoid a possessive: half these names end in "s", and
        # "Crestline Distributors's" is what an apostrophe rule nobody wants to
        # write produces. A verb reads better than either spelling.
        title=f"{vendor} has used up their credit limit",
        detail=f"They cannot raise more tickets. {_figures(line)}",
    )
    await tell_vendor(
        db,
        company_id,
        vendor_id,
        kind="vendor_credit",
        title="Your credit limit is used up",
        detail=f"New tickets are paused. {_figures(line)}",
    )


async def _ring_refusal(
    company_id: uuid.UUID, vendor_id: uuid.UUID, line: VendorCredit
) -> None:
    """Tell both sides a ticket was just refused — in its OWN transaction.

    The crossing bell only rings when a ticket takes the last of the room. A
    vendor can also find itself with none without one: a National Head lowers
    its limit, or a force-closure bills it, and then the first anybody hears is
    somebody being turned away. The refusal rolls the ticket's transaction back,
    so a bell added to it would vanish with it; this one commits on its own.

    Deduped on `(kind, vendor_id)` within `_REFUSAL_BELL_QUIET` — on the VENDOR,
    not on the title — so one vendor retrying all afternoon rings once while
    another vendor's refusal still rings. A crossing bell already rung counts,
    which is the point: if the whole company was told an hour ago, a refusal now
    is noise.

    Never raises: a bell that failed must not turn a clean 409 into a 500.
    """
    try:
        async with AsyncSessionLocal() as side:
            recent = await side.scalar(
                select(Notification.id)
                .where(
                    Notification.company_id == company_id,
                    Notification.kind == "vendor_credit",
                    Notification.vendor_id == vendor_id,
                    Notification.created_at > func.now() - _REFUSAL_BELL_QUIET,
                )
                .limit(1)
            )
            if recent is not None:
                return
            await _announce(side, company_id, vendor_id, line)
            await side.commit()
    except Exception:  # noqa: BLE001 — see the docstring
        log.exception(
            "vendor_credits: could not ring the refusal bell for %s/%s",
            company_id,
            vendor_id,
        )

"""A company's credits: the balance, the ticket charge, and the gift.

Read `models/credits.py` first. This is the part every other slice calls —
`companies` gives the gift, `tickets` charges for a ticket and asks whether
intake is paused, `features.credits` shows and tops up the balance — so it lives
in core rather than in any one of them (hard rule 4).
"""

import asyncio
import datetime
import logging
import uuid

from sqlalchemy import case, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.brand import company_name
from app.core.database import AsyncSessionLocal
from app.core.errors import AppError
from app.core.notifications import notify
from app.core.realtime import publish_notification
from app.models.company import Company
from app.models.credits import (
    PAISE_PER_CREDIT,
    PLATFORM_DEFAULTS,
    CreditEntry,
    CreditRecharge,
    PlatformSettings,
)
from app.models.notification import Notification

log = logging.getLogger(__name__)

#: Where a company's balance alerts lead: the page that recharges.
CREDITS_ROUTE = "/credits"


def credits_label(n: int) -> str:
    """`1,000`, or `−500` with a real minus sign — for bells and messages."""
    return f"−{abs(n):,}" if n < 0 else f"{n:,}"


async def load_platform_settings(db: AsyncSession) -> PlatformSettings:
    """The platform's settings row, rebuilt from `PLATFORM_DEFAULTS` if missing.

    The same shape as `rules.load_rules`: the migration seeds the row, and this
    repairs a missing one on the next read rather than letting every ticket
    fail. Flushes, never commits — the caller owns the transaction.
    """
    row = await db.get(PlatformSettings, 1)
    if row is None:
        row = PlatformSettings(id=1, **PLATFORM_DEFAULTS)
        db.add(row)
        await db.flush()
    return row


async def balance(db: AsyncSession, company_id: uuid.UUID) -> int:
    """What the company has left, in credits. Negative once it is using minus credits.

    Summed from the entries every time — never a stored figure (see
    `models/credits.py`).
    """
    total = await db.scalar(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (CreditEntry.kind == "ticket", -CreditEntry.credits),
                        else_=CreditEntry.credits,
                    )
                ),
                0,
            )
        ).where(CreditEntry.company_id == company_id)
    )
    return int(total or 0)


async def balances(
    db: AsyncSession, company_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Many companies' balances in one grouped query — the superadmin's list."""
    if not company_ids:
        return {}
    rows = await db.execute(
        select(
            CreditEntry.company_id,
            func.sum(
                case(
                    (CreditEntry.kind == "ticket", -CreditEntry.credits),
                    else_=CreditEntry.credits,
                )
            ),
        )
        .where(CreditEntry.company_id.in_(company_ids))
        .group_by(CreditEntry.company_id)
    )
    found = {company_id: int(total or 0) for company_id, total in rows.all()}
    return {company_id: found.get(company_id, 0) for company_id in company_ids}


def paused(current: int, settings: PlatformSettings) -> bool:
    """Whether the NEXT ticket would take the balance past the floor.

    The question intake asks before a vendor fills a form, and the one the
    charge below answers for real. Both read the same live settings, so a
    superadmin lowering the charge or raising the floor unpauses a company at
    once.
    """
    if settings.ticket_credits == 0:
        return False
    return current - settings.ticket_credits < -settings.minus_credit_limit


async def lock(db: AsyncSession, company_id: uuid.UUID) -> None:
    """Serialise everything that decides on this company's balance, until commit.

    An advisory lock rather than `SELECT … FOR UPDATE` on the company row, on
    purpose: `FOR UPDATE` conflicts with the `KEY SHARE` lock every foreign-key
    insert takes on its parent, so holding it would stall every write to every
    tenant table for this company while a ticket was being raised.
    """
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"credits:{company_id}"},
    )


async def grant_free(
    db: AsyncSession, company_id: uuid.UUID, *, by_user: uuid.UUID | None
) -> None:
    """The one-time gift, when a company is created. Nothing when it is set to 0."""
    settings = await load_platform_settings(db)
    if settings.free_credits <= 0:
        return
    db.add(
        CreditEntry(
            company_id=company_id,
            kind="free",
            credits=settings.free_credits,
            created_by=by_user,
        )
    )
    await db.flush()


async def _alert(
    db: AsyncSession, company_id: uuid.UUID, *, title: str, detail: str
) -> None:
    raised = await notify(
        db,
        company_id=company_id,
        kind="credits",
        title=title,
        detail=detail,
        to=CREDITS_ROUTE,
        audience="billing",
    )
    await publish_notification(
        db,
        company_id=company_id,
        pincode=None,
        notification_id=raised.id,
        audience="billing",
    )


#: Strong references to fire-and-forget bells, so none is collected mid-flight.
_background: set[asyncio.Task] = set()

#: The paused bell's title — also its dedup key for a refusal (below).
_PAUSED_TITLE = "New tickets are paused — recharge to continue"

#: How long one paused bell stands for every refusal after it.
_REFUSAL_BELL_QUIET = datetime.timedelta(hours=12)


async def _ring_refusal(company_id: uuid.UUID, current: int) -> None:
    """Tell the company's payers a ticket was just refused — in its OWN transaction.

    The crossing bell below only rings when a TICKET takes the balance to the
    floor. A company can also land there without one — the superadmin raises
    the charge or lowers the limit — and then the first anybody hears of it is a
    vendor being turned away. The refusal rolls the ticket's transaction back,
    so a bell added to it would vanish with it; this one commits on its own.

    Deduped on the title for `_REFUSAL_BELL_QUIET`, so a vendor retrying all
    afternoon rings once, and a crossing bell already rung counts. Never raises:
    a bell that failed must not turn a clean 409 into a 500.
    """
    try:
        async with AsyncSessionLocal() as side:
            recent = await side.scalar(
                select(Notification.id)
                .where(
                    Notification.company_id == company_id,
                    Notification.kind == "credits",
                    Notification.title == _PAUSED_TITLE,
                    Notification.created_at > func.now() - _REFUSAL_BELL_QUIET,
                )
                .limit(1)
            )
            if recent is not None:
                return
            await _alert(
                side,
                company_id,
                title=_PAUSED_TITLE,
                detail=f"Balance {credits_label(current)} credits.",
            )
            await side.commit()
    except Exception:  # noqa: BLE001 — see the docstring
        log.exception("credits: could not ring the refusal bell for %s", company_id)


async def charge_ticket(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    ticket_id: uuid.UUID,
    by_user: uuid.UUID | None,
) -> None:
    """Take a ticket's credits, or refuse the ticket. Call before its commit.

    The refusal is a 409 raised inside the ticket's own transaction, so the
    ticket, its code and everything flushed with it roll back together — a
    ticket that was refused is a ticket that never existed.

    The bells ring once, at the CROSSING, never on every ticket: when the
    balance first reaches zero, and when this ticket leaves too little for the
    next one. When one ticket does both, only the second is worth saying.
    """
    settings = await load_platform_settings(db)
    charge = settings.ticket_credits
    if charge <= 0:
        return

    await lock(db, company_id)
    before = await balance(db, company_id)
    after = before - charge
    if after < -settings.minus_credit_limit:
        name = await db.scalar(select(Company.name).where(Company.id == company_id))
        # A task, not an await: the bell needs a connection of its own, and this
        # request is holding its worker's only one (`DB_MAX_OVERFLOW` 0) until
        # the 409 below has rolled back. Awaited here, it waits for itself.
        _task = asyncio.create_task(_ring_refusal(company_id, before))
        _background.add(_task)
        _task.add_done_callback(_background.discard)
        raise AppError(
            409,
            "OUT_OF_CREDITS",
            f"New tickets are paused for this account. Contact "
            f"{company_name(name)} to resume.",
        )

    db.add(
        CreditEntry(
            company_id=company_id,
            kind="ticket",
            credits=charge,
            ticket_id=ticket_id,
            created_by=by_user,
        )
    )
    await db.flush()

    if paused(after, settings):
        await _alert(
            db,
            company_id,
            title=_PAUSED_TITLE,
            detail=f"Balance {credits_label(after)} credits.",
        )
    elif before > 0 >= after:
        left = after + settings.minus_credit_limit
        await _alert(
            db,
            company_id,
            title="Credits used up — now using minus credits",
            detail=(
                f"{credits_label(left)} minus credits left before new tickets "
                f"pause. Recharge to keep raising tickets."
            ),
        )


async def credit_recharge(
    db: AsyncSession, recharge: CreditRecharge, *, by_user: uuid.UUID | None
) -> int:
    """Add a confirmed recharge's credits. Returns the new balance.

    The caller has already moved the recharge to confirmed with a guarded
    UPDATE; `uq_credit_entries_company_recharge` is the backstop that makes a
    second credit for the same recharge impossible rather than merely unlikely.
    """
    await lock(db, recharge.company_id)
    db.add(
        CreditEntry(
            company_id=recharge.company_id,
            kind="recharge",
            credits=recharge.amount_paise // PAISE_PER_CREDIT,
            recharge_id=recharge.id,
            created_by=by_user,
        )
    )
    await db.flush()
    return await balance(db, recharge.company_id)

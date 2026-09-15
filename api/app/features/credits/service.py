"""Credits and recharges — the company's side and the superadmin's.

Read `models/credits.py` first; the balance, the ticket charge and the gift are
in `core/credits.py`, because three slices need them. This is what only the two
Credits screens need: the statement, and a recharge from request to outcome.

## A recharge is two people's word

The company CLAIMS it paid — UTR and screenshot, both required. Only the
superadmin CONFIRMS, because only the superadmin can see the money arrive; that
confirmation is the one thing here that adds credits. There is no route by
which a company credits itself.

## Every write has the codebase's one shape

A guarded UPDATE (or an INSERT a unique index guards) → the entry → the bell and
its realtime frame → commit. A guess at somebody else's recharge is a 404 on
the company's side; the superadmin has no company and reads across all of them.
"""

import datetime
import uuid

from sqlalchemy import Select, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.brand import company_name
from app.core.credits import (
    balance,
    credit_recharge,
    credits_label,
    load_platform_settings,
    lock,
    paused,
)
from app.core.deps import Principal
from app.core.errors import AppError
from app.core.notifications import notify
from app.core.realtime import publish_notification
from app.core.schemas import ListParams
from app.core.sequences import next_code
from app.core.upi import build_upi_uri
from app.features.credits.schemas import (
    CreditEntryOut,
    CreditSummaryOut,
    PlatformRechargeDetailOut,
    PlatformRechargeOut,
    PlatformSettingsIn,
    PlatformSettingsOut,
    RechargeClaimRequest,
    RechargeDetailOut,
    RechargeOut,
    RechargeRejectRequest,
    RechargeRequest,
    UtrMatchOut,
)
from app.integrations.blob import signed_url
from app.models.company import Company
from app.models.credits import (
    PAISE_PER_CREDIT,
    RECHARGE_MAX_PAISE,
    CreditEntry,
    CreditRecharge,
)
from app.models.ticket import Ticket

#: The private prefix a payment screenshot must live under — the one force-close
#: attachments and redemption claims use. The blob name is the only thing the
#: client hands over, so the prefix is what makes "uploaded here, by this
#: company" checkable.
_PROOF_PREFIX = "attachment"

#: How many waiting recharges the superadmin's bell lists.
_WAITING_LIMIT = 20


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _indian(n: int) -> str:
    """`1,00,000` — Indian digit grouping, for amounts that reach lakhs."""
    digits = str(abs(n))
    if len(digits) <= 3:
        grouped = digits
    else:
        head, tail = digits[:-3], digits[-3:]
        pairs = []
        while len(head) > 2:
            pairs.insert(0, head[-2:])
            head = head[:-2]
        if head:
            pairs.insert(0, head)
        grouped = ",".join(pairs) + "," + tail
    return f"-{grouped}" if n < 0 else grouped


def _rupees(paise: int) -> str:
    return f"₹{_indian(paise // PAISE_PER_CREDIT)}"


def _not_found() -> AppError:
    # 404, never 403: a recharge that is not yours does not exist to you.
    return AppError(404, "NOT_FOUND", "Recharge not found")


def _refused(code: str, detail: str) -> AppError:
    return AppError(409, code, detail)


def _label(principal: Principal, fallback: str = "—") -> str:
    return ((principal.user.full_name or "").strip() or fallback)[:120]


def state_of(row: CreditRecharge) -> str:
    """The one place the timestamps become a word. See `RechargeState`."""
    if row.cancelled_at is not None:
        return "cancelled"
    if row.rejected_at is not None:
        return "rejected"
    if row.confirmed_at is not None:
        return "credited"
    if row.claimed_at is not None:
        return "waiting"
    return "to_pay"


def _in_state(stmt: Select, state: str) -> Select:
    """`state_of`, in SQL."""
    if state == "cancelled":
        return stmt.where(CreditRecharge.cancelled_at.is_not(None))
    if state == "rejected":
        return stmt.where(CreditRecharge.rejected_at.is_not(None))
    if state == "credited":
        return stmt.where(CreditRecharge.confirmed_at.is_not(None))
    if state == "waiting":
        return stmt.where(
            CreditRecharge.claimed_at.is_not(None),
            CreditRecharge.confirmed_at.is_(None),
            CreditRecharge.rejected_at.is_(None),
        )
    return stmt.where(
        CreditRecharge.claimed_at.is_(None), CreditRecharge.cancelled_at.is_(None)
    )


def _open(stmt: Select) -> Select:
    return stmt.where(
        CreditRecharge.confirmed_at.is_(None),
        CreditRecharge.rejected_at.is_(None),
        CreditRecharge.cancelled_at.is_(None),
    )


def _fields(row: CreditRecharge) -> dict:
    return {
        "id": row.id,
        "code": row.code,
        "state": state_of(row),
        "amountPaise": row.amount_paise,
        "credits": row.amount_paise // PAISE_PER_CREDIT,
        "upiId": row.upi_id,
        "payeeName": row.payee_name,
        "requestedAt": row.created_at,
        "requestedBy": row.requested_by_label,
        "claimedAt": row.claimed_at,
        "claimedBy": row.claimed_by_label,
        "utr": row.utr,
        "confirmedAt": row.confirmed_at,
        "confirmedBy": row.confirmed_by_label,
        "rejectedAt": row.rejected_at,
        "rejectedBy": row.rejected_by_label,
        "rejectReason": row.reject_reason,
        "cancelledAt": row.cancelled_at,
    }


def _proof_ok(company_id: uuid.UUID, blob_name: str) -> bool:
    """Uploaded under this company's own private prefix, and nowhere else."""
    return (
        blob_name.startswith(f"{_PROOF_PREFIX}/{company_id}/") and ".." not in blob_name
    )


def _proof_url(row: CreditRecharge) -> str | None:
    # Checked again on the way OUT: a link is signed only for a blob that is
    # provably this company's, whatever wrote the column.
    if not row.proof_blob_name or not _proof_ok(row.company_id, row.proof_blob_name):
        return None
    return signed_url(row.proof_blob_name)


async def _credited_with_utr(
    db: AsyncSession,
    utr: str,
    *,
    exclude_id: uuid.UUID,
    company_id: uuid.UUID | None = None,
) -> tuple[str, str | None] | None:
    """The code and company of a CREDITED recharge carrying this UTR, if any.

    One UTR is one UPI payment, so a credited match means this claim is money
    that has already bought credits. `uq_credit_recharges_credited_utr` is the
    backstop; this is the sentence. `company_id` narrows it for the company's
    own side, which must not learn anything about another company's payments.
    """
    stmt = (
        select(CreditRecharge.code, Company.name)
        .join(Company, Company.id == CreditRecharge.company_id)
        .where(
            CreditRecharge.utr == utr,
            CreditRecharge.confirmed_at.is_not(None),
            CreditRecharge.id != exclude_id,
        )
    )
    if company_id is not None:
        stmt = stmt.where(CreditRecharge.company_id == company_id)
    found = (await db.execute(stmt.limit(1))).first()
    return (found[0], found[1]) if found else None


async def _upi_uri(db: AsyncSession, row: CreditRecharge) -> str:
    """The pay link, from the frozen ROW — never from anything a client sent.

    The note names the paying company, so the payment reads as what it is on
    the platform's own statement; `tr` is the code without its hyphens, which
    several UPI apps otherwise refuse.
    """
    name = await db.scalar(select(Company.name).where(Company.id == row.company_id))
    return build_upi_uri(
        vpa=row.upi_id,
        payee_name=row.payee_name,
        amount_paise=row.amount_paise,
        note=f"{company_name(name)} credits {row.code}",
        ref=row.code.replace("-", ""),
    )


# ── the company's side ───────────────────────────────────────────────────────


def _company_recharges(company_id: uuid.UUID) -> Select:
    return select(CreditRecharge).where(CreditRecharge.company_id == company_id)


async def summary(db: AsyncSession, principal: Principal) -> CreditSummaryOut:
    assert principal.company_id is not None
    settings = await load_platform_settings(db)
    current = await balance(db, principal.company_id)
    open_row = await db.scalar(_open(_company_recharges(principal.company_id)))
    return CreditSummaryOut(
        balance=current,
        ticketCredits=settings.ticket_credits,
        minusCreditLimit=settings.minus_credit_limit,
        paused=paused(current, settings),
        minRechargeRupees=settings.min_recharge_credits,
        maxRechargeRupees=RECHARGE_MAX_PAISE // PAISE_PER_CREDIT,
        rechargeAvailable=bool(settings.upi_id and settings.upi_name),
        openRecharge=RechargeOut(**_fields(open_row)) if open_row is not None else None,
    )


async def entries_page(
    db: AsyncSession, principal: Principal, params: ListParams, *, kind: str | None
) -> tuple[list[CreditEntryOut], int]:
    """The statement, newest first."""
    assert principal.company_id is not None
    stmt = (
        select(CreditEntry, Ticket.code, CreditRecharge.code)
        .outerjoin(
            Ticket,
            (Ticket.company_id == CreditEntry.company_id)
            & (Ticket.id == CreditEntry.ticket_id),
        )
        .outerjoin(
            CreditRecharge,
            (CreditRecharge.company_id == CreditEntry.company_id)
            & (CreditRecharge.id == CreditEntry.recharge_id),
        )
        .where(CreditEntry.company_id == principal.company_id)
    )
    if kind is not None:
        stmt = stmt.where(CreditEntry.kind == kind)
    if params.search and params.search.strip():
        term = f"%{params.search.strip()}%"
        stmt = stmt.where(or_(Ticket.code.ilike(term), CreditRecharge.code.ilike(term)))

    total = (
        await db.scalar(
            select(func.count()).select_from(
                stmt.with_only_columns(CreditEntry.id).subquery()
            )
        )
    ) or 0
    rows = (
        await db.execute(
            stmt.order_by(CreditEntry.created_at.desc(), CreditEntry.id.desc())
            .offset(params.offset)
            .limit(params.limit)
        )
    ).all()
    return [
        CreditEntryOut(
            id=entry.id,
            kind=entry.kind,
            credits=-entry.credits if entry.kind == "ticket" else entry.credits,
            at=entry.created_at,
            ticketId=entry.ticket_id,
            ticketCode=ticket_code,
            rechargeId=entry.recharge_id,
            rechargeCode=recharge_code,
        )
        for entry, ticket_code, recharge_code in rows
    ], total


async def recharges_page(
    db: AsyncSession, principal: Principal, params: ListParams, *, state: str | None
) -> tuple[list[RechargeOut], int]:
    assert principal.company_id is not None
    stmt = _company_recharges(principal.company_id)
    if state is not None:
        stmt = _in_state(stmt, state)
    total = (
        await db.scalar(
            select(func.count()).select_from(
                stmt.with_only_columns(CreditRecharge.id).subquery()
            )
        )
    ) or 0
    rows = list(
        await db.scalars(
            stmt.order_by(CreditRecharge.created_at.desc(), CreditRecharge.id.desc())
            .offset(params.offset)
            .limit(params.limit)
        )
    )
    return [RechargeOut(**_fields(r)) for r in rows], total


async def _load_for_company(
    db: AsyncSession, principal: Principal, recharge_id: uuid.UUID
) -> CreditRecharge:
    assert principal.company_id is not None
    row = await db.scalar(
        _company_recharges(principal.company_id)
        .where(CreditRecharge.id == recharge_id)
        # The read-back after a write — sessions keep objects across a commit.
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise _not_found()
    return row


async def recharge_detail(
    db: AsyncSession, principal: Principal, recharge_id: uuid.UUID
) -> RechargeDetailOut:
    row = await _load_for_company(db, principal, recharge_id)
    return RechargeDetailOut(
        **_fields(row),
        # Only until the company says it paid — after that a QR on screen is an
        # invitation to pay twice.
        upiUri=await _upi_uri(db, row) if state_of(row) == "to_pay" else None,
        proofUrl=_proof_url(row),
    )


async def create_recharge(
    db: AsyncSession, principal: Principal, body: RechargeRequest
) -> RechargeDetailOut:
    """Ask to recharge. The QR is built from the platform's UPI ID, frozen here."""
    assert principal.company_id is not None
    company_id = principal.company_id
    settings = await load_platform_settings(db)
    if not settings.upi_id or not settings.upi_name:
        raise _refused(
            "RECHARGE_UNAVAILABLE", "Recharges aren't available yet. Try again later."
        )

    most = RECHARGE_MAX_PAISE // PAISE_PER_CREDIT
    least = settings.min_recharge_credits
    if not least <= body.amountRupees <= most:
        raise AppError(
            422,
            "BAD_AMOUNT",
            f"Enter an amount between ₹{_indian(least)} and ₹{_indian(most)}.",
        )

    # Two taps from a slow connection would otherwise both find nothing open;
    # the partial unique index would stop the second, but as an IntegrityError
    # rather than the sentence below.
    await lock(db, company_id)
    if await db.scalar(_open(_company_recharges(company_id))) is not None:
        raise _refused(
            "RECHARGE_OPEN",
            "A recharge is already open. Pay and submit it, or cancel it, before "
            "starting another.",
        )

    row = CreditRecharge(
        company_id=company_id,
        code=await next_code(db, company_id, "recharge"),
        amount_paise=body.amountRupees * PAISE_PER_CREDIT,
        upi_id=settings.upi_id,
        payee_name=settings.upi_name,
        requested_by_label=_label(principal),
        created_by=principal.user_id,
    )
    db.add(row)
    await db.commit()
    return await recharge_detail(db, principal, row.id)


async def claim_recharge(
    db: AsyncSession,
    principal: Principal,
    recharge_id: uuid.UUID,
    body: RechargeClaimRequest,
) -> RechargeDetailOut:
    """The company says it paid. Once — a wrong UTR is the superadmin's to reject."""
    assert principal.company_id is not None
    row = await _load_for_company(db, principal, recharge_id)
    if not _proof_ok(principal.company_id, body.proof.blobName):
        raise AppError(
            422,
            "BAD_PROOF",
            "That screenshot was not uploaded here. Upload it again and retry.",
        )
    # Only this company's own credited recharges: whether some other company's
    # payment carries this UTR is not theirs to learn. The superadmin sees both.
    credited = await _credited_with_utr(
        db, body.utr, exclude_id=row.id, company_id=principal.company_id
    )
    if credited is not None:
        raise _refused(
            "UTR_ALREADY_CREDITED",
            f"UTR {body.utr} was already credited on {credited[0]}.",
        )

    result = await db.execute(
        update(CreditRecharge)
        .where(
            CreditRecharge.company_id == principal.company_id,
            CreditRecharge.id == row.id,
            CreditRecharge.claimed_at.is_(None),
            CreditRecharge.cancelled_at.is_(None),
        )
        .values(
            claimed_at=_now(),
            claimed_by_user_id=principal.user_id,
            claimed_by_label=_label(principal),
            utr=body.utr,
            proof_blob_name=body.proof.blobName,
            updated_by=principal.user_id,
        )
    )
    if result.rowcount == 0:
        await db.rollback()
        row = await _load_for_company(db, principal, recharge_id)
        if row.cancelled_at is not None:
            raise _refused(
                "RECHARGE_CANCELLED", "This recharge was cancelled. Start a new one."
            )
        raise _refused("ALREADY_CLAIMED", "This payment has already been submitted.")
    await db.commit()
    return await recharge_detail(db, principal, row.id)


async def cancel_recharge(
    db: AsyncSession, principal: Principal, recharge_id: uuid.UUID
) -> RechargeDetailOut:
    """Withdraw a recharge before paying it. Not after — money may have moved."""
    assert principal.company_id is not None
    row = await _load_for_company(db, principal, recharge_id)
    if row.cancelled_at is not None:
        return await recharge_detail(db, principal, row.id)
    result = await db.execute(
        update(CreditRecharge)
        .where(
            CreditRecharge.company_id == principal.company_id,
            CreditRecharge.id == row.id,
            CreditRecharge.claimed_at.is_(None),
            CreditRecharge.cancelled_at.is_(None),
        )
        .values(
            cancelled_at=_now(),
            cancelled_by_label=_label(principal),
            updated_by=principal.user_id,
        )
    )
    if result.rowcount == 0:
        await db.rollback()
        row = await _load_for_company(db, principal, recharge_id)
        if row.cancelled_at is not None:
            return await recharge_detail(db, principal, row.id)
        raise _refused(
            "ALREADY_CLAIMED",
            "You've already submitted this payment, so it can't be cancelled.",
        )
    await db.commit()
    return await recharge_detail(db, principal, row.id)


# ── the superadmin's side ────────────────────────────────────────────────────


def _settings_out(row) -> PlatformSettingsOut:
    return PlatformSettingsOut(
        freeCredits=row.free_credits,
        ticketCredits=row.ticket_credits,
        minusCreditLimit=row.minus_credit_limit,
        minRechargeRupees=row.min_recharge_credits,
        upiId=row.upi_id,
        upiName=row.upi_name,
        updatedAt=row.updated_at,
    )


async def get_settings(db: AsyncSession) -> PlatformSettingsOut:
    return _settings_out(await load_platform_settings(db))


async def update_settings(
    db: AsyncSession, principal: Principal, body: PlatformSettingsIn
) -> PlatformSettingsOut:
    """The Rules. Free credits apply to companies created from now on; the charge
    and the floor to every company from its next ticket — see `models/credits.py`."""
    row = await load_platform_settings(db)
    row.free_credits = body.freeCredits
    row.ticket_credits = body.ticketCredits
    row.minus_credit_limit = body.minusCreditLimit
    row.min_recharge_credits = body.minRechargeRupees
    row.upi_id = body.upiId
    row.upi_name = body.upiName
    row.updated_by = principal.user_id
    await db.commit()
    await db.refresh(row)
    return _settings_out(row)


def _platform_base() -> Select:
    return select(CreditRecharge, Company.name, Company.code).join(
        Company, Company.id == CreditRecharge.company_id
    )


def _platform_out(row: CreditRecharge, name: str | None, code: str) -> PlatformRechargeOut:
    return PlatformRechargeOut(
        **_fields(row),
        companyId=row.company_id,
        companyName=company_name(name),
        companyCode=code,
    )


async def platform_page(
    db: AsyncSession, params: ListParams, *, state: str | None
) -> tuple[list[PlatformRechargeOut], int]:
    """Every company's recharges. "Waiting" reads OLDEST first — it is a queue."""
    stmt = _platform_base()
    if state is not None:
        stmt = _in_state(stmt, state)
    if params.search and params.search.strip():
        term = f"%{params.search.strip()}%"
        stmt = stmt.where(
            or_(
                CreditRecharge.code.ilike(term),
                CreditRecharge.utr.ilike(term),
                Company.name.ilike(term),
                Company.code.ilike(term),
            )
        )
    total = (
        await db.scalar(
            select(func.count()).select_from(
                stmt.with_only_columns(CreditRecharge.id).subquery()
            )
        )
    ) or 0
    order = (
        (CreditRecharge.claimed_at.asc(), CreditRecharge.id.asc())
        if state == "waiting"
        else (CreditRecharge.created_at.desc(), CreditRecharge.id.desc())
    )
    rows = (
        await db.execute(stmt.order_by(*order).offset(params.offset).limit(params.limit))
    ).all()
    return [_platform_out(r, name, code) for r, name, code in rows], total


def _waiting(stmt: Select) -> Select:
    return _in_state(stmt, "waiting")


async def platform_count(db: AsyncSession) -> int:
    return (
        await db.scalar(
            _waiting(select(func.count()).select_from(CreditRecharge))
        )
    ) or 0


async def platform_waiting(db: AsyncSession) -> list[PlatformRechargeOut]:
    """The bell's list: the latest claims nobody has decided."""
    rows = (
        await db.execute(
            _waiting(_platform_base())
            .order_by(CreditRecharge.claimed_at.desc(), CreditRecharge.id.desc())
            .limit(_WAITING_LIMIT)
        )
    ).all()
    return [_platform_out(r, name, code) for r, name, code in rows]


async def platform_detail(
    db: AsyncSession, recharge_id: uuid.UUID
) -> PlatformRechargeDetailOut:
    found = (
        await db.execute(
            _platform_base()
            .where(CreditRecharge.id == recharge_id)
            .execution_options(populate_existing=True)
        )
    ).first()
    if found is None:
        raise _not_found()
    row, name, code = found
    matches: list[UtrMatchOut] = []
    if row.utr:
        others = (
            await db.execute(
                _platform_base()
                .where(CreditRecharge.utr == row.utr, CreditRecharge.id != row.id)
                .order_by(CreditRecharge.created_at.desc())
                .limit(5)
            )
        ).all()
        matches = [
            UtrMatchOut(
                id=other.id,
                code=other.code,
                companyName=company_name(other_name),
                state=state_of(other),
            )
            for other, other_name, _code in others
        ]
    return PlatformRechargeDetailOut(
        **_fields(row),
        # The superadmin is the payee, never the payer: no QR on their side.
        upiUri=None,
        proofUrl=_proof_url(row),
        companyId=row.company_id,
        companyName=company_name(name),
        companyCode=code,
        companyBalance=await balance(db, row.company_id),
        utrAlsoOn=matches,
    )


async def _announce(
    db: AsyncSession, row: CreditRecharge, *, title: str, detail: str
) -> None:
    """The company hears the outcome — its Admins and National Heads."""
    raised = await notify(
        db,
        company_id=row.company_id,
        kind="recharge",
        title=title,
        detail=detail,
        to=f"/credits/recharges/{row.id}",
        audience="billing",
    )
    await publish_notification(
        db,
        company_id=row.company_id,
        pincode=None,
        notification_id=raised.id,
        audience="billing",
    )


async def confirm(
    db: AsyncSession, principal: Principal, recharge_id: uuid.UUID
) -> PlatformRechargeDetailOut:
    """The payment arrived: add the credits. Idempotent — one credit per recharge."""
    row = await db.get(CreditRecharge, recharge_id)
    if row is None:
        raise _not_found()
    if row.confirmed_at is not None:
        return await platform_detail(db, row.id)
    if row.utr:
        credited = await _credited_with_utr(db, row.utr, exclude_id=row.id)
        if credited is not None:
            raise _refused(
                "UTR_ALREADY_CREDITED",
                f"UTR {row.utr} was already credited on {credited[0]} "
                f"({company_name(credited[1])}). If this is the same payment, reject it.",
            )

    result = await db.execute(
        update(CreditRecharge)
        .where(
            CreditRecharge.id == row.id,
            CreditRecharge.claimed_at.is_not(None),
            CreditRecharge.confirmed_at.is_(None),
            CreditRecharge.rejected_at.is_(None),
            CreditRecharge.cancelled_at.is_(None),
        )
        .values(
            confirmed_at=_now(),
            confirmed_by_user_id=principal.user_id,
            confirmed_by_label=_label(principal, "Platform"),
            updated_by=principal.user_id,
        )
    )
    if result.rowcount == 0:
        await db.rollback()
        detail = await platform_detail(db, recharge_id)
        if detail.state == "credited":
            return detail
        raise _refused(
            "NOT_WAITING",
            "This recharge isn't waiting for confirmation any more. Reload to see why.",
        )

    new_balance = await credit_recharge(db, row, by_user=principal.user_id)
    await _announce(
        db,
        row,
        title=f"Recharge of {_rupees(row.amount_paise)} added",
        detail=f"{row.code} · balance now {credits_label(new_balance)} credits",
    )
    await db.commit()
    return await platform_detail(db, row.id)


async def reject(
    db: AsyncSession,
    principal: Principal,
    recharge_id: uuid.UUID,
    body: RechargeRejectRequest,
) -> PlatformRechargeDetailOut:
    """The payment did not arrive, or does not match. Final; the company reads why."""
    row = await db.get(CreditRecharge, recharge_id)
    if row is None:
        raise _not_found()
    reason = body.reason.strip()
    result = await db.execute(
        update(CreditRecharge)
        .where(
            CreditRecharge.id == row.id,
            CreditRecharge.claimed_at.is_not(None),
            CreditRecharge.confirmed_at.is_(None),
            CreditRecharge.rejected_at.is_(None),
            CreditRecharge.cancelled_at.is_(None),
        )
        .values(
            rejected_at=_now(),
            rejected_by_user_id=principal.user_id,
            rejected_by_label=_label(principal, "Platform"),
            reject_reason=reason,
            updated_by=principal.user_id,
        )
    )
    if result.rowcount == 0:
        await db.rollback()
        detail = await platform_detail(db, recharge_id)
        if detail.state == "rejected":
            return detail
        raise _refused(
            "NOT_WAITING",
            "This recharge isn't waiting for confirmation any more. Reload to see why.",
        )

    await _announce(
        db,
        row,
        title=f"Recharge of {_rupees(row.amount_paise)} not approved",
        detail=reason,
    )
    await db.commit()
    return await platform_detail(db, row.id)

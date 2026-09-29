"""A vendor's credit line — the vendor's side and the company's.

Read `models/vendor_credits.py` first; the four numbers, the gate and both
closure charges are in `core/vendor_credits.py`, because three slices need them.
This is what only the two Credit screens need: the statement, a payment from
request to outcome, and a limit request from asking to decided.

## A payment is two people's word

The vendor CLAIMS it paid — UTR and screenshot, both required. Only an Admin or
National Head CONFIRMS, because only they can see the money arrive in the
company's account; that confirmation is the one thing here that restores
headroom. There is no route by which a vendor clears its own debt.

That is the same split a recharge has one level up, and a redemption has one
level down. Each time, the party who can see the money is the only party who may
say it arrived.

## Every write has the codebase's one shape

A guarded UPDATE (or an INSERT a unique index guards) -> the entry -> the bell
and its realtime frame -> commit. A guess at another company's payment is a 404,
never a 403; a guess at another VENDOR's is the same, because a vendor's reads
are pinned to `principal.vendor_id` server-side and nothing takes an id from the
client (hard rule 0).
"""

import datetime
import uuid

from sqlalchemy import Select, case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.brand import company_name
from app.core.deps import Principal
from app.core.errors import AppError
from app.core.money import rupees
from app.core.sequences import next_code
from app.core.upi import build_upi_uri
from app.core.vendor_credits import (
    PORTAL_CREDIT_ROUTE,
    VENDOR_CREDIT_ROUTE,
    apply_payment,
    lock,
    standing,
    standing_many,
    tell_billing,
    tell_vendor,
)
from app.features.vendor_credits.schemas import (
    LimitApproveRequest,
    LimitRequestIn,
    PaymentClaimRequest,
    PaymentCountOut,
    PaymentRequest,
    RecordPaymentRequest,
    PaymentState,
    RejectRequest,
    VendorCreditEntryOut,
    VendorCreditOut,
    VendorCreditRequestOut,
    VendorPaymentDetailOut,
    VendorPaymentOut,
    VendorStandingOut,
)
from app.core.schemas import ListParams
from app.integrations.blob import signed_url
from app.models.company import Company
from app.models.ticket import Ticket
from app.models.vendor import Vendor
from app.models.vendor_credits import (
    PAYMENT_MAX_PAISE,
    VendorCreditEntry,
    VendorCreditRequest,
    VendorPayment,
)

#: The private blob prefix a screenshot must live under. The same one a recharge
#: and a redemption proof use, because it is the same container and the same
#: per-company isolation rule.
_PROOF_PREFIX = "attachment"


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _not_found(what: str = "Payment") -> AppError:
    # 404, never 403: something that is not yours does not exist to you.
    return AppError(404, "NOT_FOUND", f"{what} not found")


def _refused(code: str, detail: str) -> AppError:
    return AppError(409, code, detail)


def _label(principal: Principal, fallback: str = "—") -> str:
    return ((principal.user.full_name or "").strip() or fallback)[:120]


def state_of(row: VendorPayment) -> PaymentState:
    """The one place the timestamps become a word. See `PaymentState`."""
    if row.cancelled_at is not None:
        return "cancelled"
    if row.rejected_at is not None:
        return "rejected"
    if row.confirmed_at is not None:
        return "paid"
    if row.claimed_at is not None:
        return "waiting"
    return "to_pay"


def _in_state(stmt: Select, state: str) -> Select:
    """`state_of`, in SQL. The two must agree, so they sit together."""
    if state == "cancelled":
        return stmt.where(VendorPayment.cancelled_at.is_not(None))
    if state == "rejected":
        return stmt.where(VendorPayment.rejected_at.is_not(None))
    if state == "paid":
        return stmt.where(VendorPayment.confirmed_at.is_not(None))
    if state == "waiting":
        return stmt.where(
            VendorPayment.claimed_at.is_not(None),
            VendorPayment.confirmed_at.is_(None),
            VendorPayment.rejected_at.is_(None),
        )
    return stmt.where(
        VendorPayment.claimed_at.is_(None), VendorPayment.cancelled_at.is_(None)
    )


def _open(stmt: Select) -> Select:
    return stmt.where(
        VendorPayment.confirmed_at.is_(None),
        VendorPayment.rejected_at.is_(None),
        VendorPayment.cancelled_at.is_(None),
    )


def _fields(row: VendorPayment) -> dict:
    """The camelCase projection every payment model splats."""
    return {
        "id": row.id,
        "code": row.code,
        "state": state_of(row),
        "amountPaise": row.amount_paise,
        "source": row.source,
        "method": row.method,
        "receivedOn": row.received_on,
        "note": row.note,
        "upiId": row.upi_id,
        "payeeName": row.payee_name,
        "utr": row.utr,
        "requestedByLabel": row.requested_by_label,
        "claimedAt": row.claimed_at,
        "claimedByLabel": row.claimed_by_label,
        "confirmedAt": row.confirmed_at,
        "confirmedByLabel": row.confirmed_by_label,
        "rejectedAt": row.rejected_at,
        "rejectedByLabel": row.rejected_by_label,
        "rejectReason": row.reject_reason,
        "cancelledAt": row.cancelled_at,
        "createdAt": row.created_at,
    }


def _proof_ok(company_id: uuid.UUID, blob_name: str) -> bool:
    """Uploaded under this company's own private prefix, and nowhere else."""
    return (
        blob_name.startswith(f"{_PROOF_PREFIX}/{company_id}/") and ".." not in blob_name
    )


def _proof_url(row: VendorPayment) -> str | None:
    # Checked again on the way OUT: a link is signed only for a blob that is
    # provably this company's, whatever wrote the column.
    if not row.proof_blob_name or not _proof_ok(row.company_id, row.proof_blob_name):
        return None
    return signed_url(row.proof_blob_name)


def _request_out(
    row: VendorCreditRequest, vendor_name: str | None = None
) -> VendorCreditRequestOut:
    return VendorCreditRequestOut(
        id=row.id,
        status=row.status,
        currentLimitPaise=row.current_limit_paise,
        requestedLimitPaise=row.requested_limit_paise,
        grantedLimitPaise=row.granted_limit_paise,
        note=row.note,
        submittedAt=row.submitted_at,
        decidedAt=row.decided_at,
        decidedByLabel=row.decided_by_label,
        rejectReason=row.reject_reason,
        vendorName=vendor_name,
        createdAt=row.created_at,
    )


async def _paid_with_utr(
    db: AsyncSession,
    company_id: uuid.UUID,
    utr: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> str | None:
    """The code of a PAID payment of this company carrying this UTR, if any.

    One UTR is one UPI payment, so a paid match means this claim is money that
    has already cleared somebody's debt. `uq_vendor_payments_credited_utr` is the
    backstop; this is the sentence.

    Scoped to the company, which is both the isolation rule and the right
    question: the company is the payee, so a UTR paid to a DIFFERENT company is
    a different payment and not this vendor's business either way.
    """
    stmt = select(VendorPayment.code).where(
        VendorPayment.company_id == company_id,
        VendorPayment.utr == utr,
        VendorPayment.confirmed_at.is_not(None),
    )
    # None when there is no row to exclude yet — a staff record is checked before
    # it exists, so there is nothing for it to match itself against.
    if exclude_id is not None:
        stmt = stmt.where(VendorPayment.id != exclude_id)
    return await db.scalar(stmt.limit(1))


# ── the vendor's own side ─────────────────────────────────────────────────────


async def _open_payment_id(
    db: AsyncSession, company_id: uuid.UUID, vendor_id: uuid.UUID
) -> uuid.UUID | None:
    return await db.scalar(
        _open(select(VendorPayment.id)).where(
            VendorPayment.company_id == company_id,
            VendorPayment.vendor_id == vendor_id,
        )
    )


async def _pending_request_id(
    db: AsyncSession, company_id: uuid.UUID, vendor_id: uuid.UUID
) -> uuid.UUID | None:
    return await db.scalar(
        select(VendorCreditRequest.id).where(
            VendorCreditRequest.company_id == company_id,
            VendorCreditRequest.vendor_id == vendor_id,
            VendorCreditRequest.status == "pending",
        )
    )


async def _payee(db: AsyncSession, company_id: uuid.UUID) -> tuple[str, str] | None:
    """Where this company takes vendor payments, or None if it has not said.

    Both or neither — `ck_companies_upi_pair` makes half a payee impossible, so
    one test covers it.
    """
    row = (
        await db.execute(
            select(Company.upi_id, Company.upi_name).where(Company.id == company_id)
        )
    ).first()
    if row is None or row.upi_id is None or row.upi_name is None:
        return None
    return row.upi_id, row.upi_name


async def me(db: AsyncSession, principal: Principal) -> VendorCreditOut:
    """This vendor's line, and what it can do about it."""
    company_id, vendor_id = principal.company_id, principal.vendor_id
    assert company_id is not None and vendor_id is not None
    line = await standing(db, company_id, vendor_id)
    return VendorCreditOut(
        limitPaise=line.limit_paise,
        usedPaise=line.used_paise,
        reservedPaise=line.reserved_paise,
        availablePaise=line.available_paise,
        paused=line.paused,
        # What is OWED, not what is available — a vendor pays down a debt, and
        # paying more than it owes would leave the company holding money with
        # nothing to apply it to. Capped at UPI's per-transaction limit, so a
        # large debt is settled over several payments.
        maxPaymentPaise=min(max(0, line.used_paise), PAYMENT_MAX_PAISE),
        paymentAvailable=await _payee(db, company_id) is not None,
        openPaymentId=await _open_payment_id(db, company_id, vendor_id),
        pendingRequestId=await _pending_request_id(db, company_id, vendor_id),
    )


async def entries_page(
    db: AsyncSession,
    company_id: uuid.UUID,
    vendor_id: uuid.UUID,
    params: ListParams,
    *,
    kind: str | None,
) -> tuple[list[VendorCreditEntryOut], int]:
    """The statement, newest first.

    Outer-joins the ticket and the payment on the COMPOSITE key pair, so a row
    can never pick up another company's code even if an id collided.
    """
    stmt = (
        select(VendorCreditEntry, Ticket.code, VendorPayment.code)
        .outerjoin(
            Ticket,
            (Ticket.company_id == VendorCreditEntry.company_id)
            & (Ticket.id == VendorCreditEntry.ticket_id),
        )
        .outerjoin(
            VendorPayment,
            (VendorPayment.company_id == VendorCreditEntry.company_id)
            & (VendorPayment.id == VendorCreditEntry.payment_id),
        )
        .where(
            VendorCreditEntry.company_id == company_id,
            VendorCreditEntry.vendor_id == vendor_id,
        )
    )
    if kind is not None:
        stmt = stmt.where(VendorCreditEntry.kind == kind)
    if params.search:
        like = f"%{params.search.strip()}%"
        stmt = stmt.where(or_(Ticket.code.ilike(like), VendorPayment.code.ilike(like)))

    total = await db.scalar(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    )
    rows = await db.execute(
        stmt.order_by(VendorCreditEntry.created_at.desc(), VendorCreditEntry.id.desc())
        .offset(params.offset)
        .limit(params.limit)
    )
    return [
        VendorCreditEntryOut(
            id=entry.id,
            kind=entry.kind,
            # Signed here and nowhere else — see the schema.
            amountPaise=(
                -entry.amount_paise if entry.kind == "charge" else entry.amount_paise
            ),
            ticketId=entry.ticket_id,
            ticketCode=ticket_code,
            paymentId=entry.payment_id,
            paymentCode=payment_code,
            createdAt=entry.created_at,
        )
        for entry, ticket_code, payment_code in rows.all()
    ], int(total or 0)


async def _load_own_payment(
    db: AsyncSession, principal: Principal, payment_id: uuid.UUID
) -> VendorPayment:
    row = await db.scalar(
        select(VendorPayment)
        .where(
            VendorPayment.company_id == principal.company_id,
            VendorPayment.vendor_id == principal.vendor_id,
            VendorPayment.id == payment_id,
        )
        # The read-back after a guarded UPDATE has to see what it wrote.
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise _not_found()
    return row


async def _upi_uri(db: AsyncSession, row: VendorPayment) -> str:
    vendor = await db.scalar(
        select(Vendor.name).where(
            Vendor.company_id == row.company_id, Vendor.id == row.vendor_id
        )
    )
    name = await db.scalar(select(Company.name).where(Company.id == row.company_id))
    return build_upi_uri(
        vpa=row.upi_id,
        payee_name=row.payee_name,
        amount_paise=row.amount_paise,
        note=f"{company_name(name)} {vendor or 'vendor'} {row.code}",
        # Several UPI apps refuse hyphens in `tr`.
        ref=row.code.replace("-", ""),
    )


async def payments_page(
    db: AsyncSession,
    company_id: uuid.UUID,
    params: ListParams,
    *,
    vendor_id: uuid.UUID | None,
    state: str | None,
) -> tuple[list[VendorPaymentOut], int]:
    """A page of payments, newest first — except the queue.

    `vendor_id` set is the vendor's own history; None is the staff queue across
    every vendor of this company.
    """
    stmt = (
        select(VendorPayment, Vendor.name)
        # Joined on the COMPOSITE key pair, so a row can never pick up another
        # company's vendor even if an id collided.
        .join(
            Vendor,
            (Vendor.company_id == VendorPayment.company_id)
            & (Vendor.id == VendorPayment.vendor_id),
        )
        .where(VendorPayment.company_id == company_id)
    )
    if vendor_id is not None:
        stmt = stmt.where(VendorPayment.vendor_id == vendor_id)
    if state is not None:
        stmt = _in_state(stmt, state)
    if params.search:
        stmt = stmt.where(
            or_(
                VendorPayment.code.ilike(f"%{params.search.strip()}%"),
                VendorPayment.utr.ilike(f"%{params.search.strip()}%"),
            )
        )

    total = await db.scalar(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    )
    # Waiting claims are a QUEUE and sort oldest first: the one that has waited
    # longest is the one somebody owes an answer to. Everything else is history
    # and reads newest first.
    order = (
        (VendorPayment.claimed_at.asc(), VendorPayment.id.asc())
        if state == "waiting"
        else (VendorPayment.created_at.desc(), VendorPayment.id.desc())
    )
    rows = await db.execute(
        stmt.order_by(*order).offset(params.offset).limit(params.limit)
    )
    return [
        VendorPaymentOut(**_fields(row), vendorName=name) for row, name in rows.all()
    ], int(total or 0)


async def _detail(
    db: AsyncSession, row: VendorPayment, *, for_payer: bool
) -> VendorPaymentDetailOut:
    vendor_name = await db.scalar(
        select(Vendor.name).where(
            Vendor.company_id == row.company_id, Vendor.id == row.vendor_id
        )
    )
    return VendorPaymentDetailOut(
        **_fields(row),
        # A QR on screen after a claim is an invitation to pay twice. And never
        # for staff: they are the payee, so a QR would ask them to pay
        # themselves.
        upiUri=(
            await _upi_uri(db, row)
            if for_payer and state_of(row) == "to_pay"
            else None
        ),
        proofUrl=_proof_url(row),
        vendorName=vendor_name,
    )


async def own_payment_detail(
    db: AsyncSession, principal: Principal, payment_id: uuid.UUID
) -> VendorPaymentDetailOut:
    row = await _load_own_payment(db, principal, payment_id)
    return await _detail(db, row, for_payer=True)


async def create_payment(
    db: AsyncSession, principal: Principal, body: PaymentRequest
) -> VendorPaymentDetailOut:
    """Ask to pay some or all of what is owed, and get a QR for it."""
    company_id, vendor_id = principal.company_id, principal.vendor_id
    assert company_id is not None and vendor_id is not None

    payee = await _payee(db, company_id)
    if payee is None:
        name = await db.scalar(select(Company.name).where(Company.id == company_id))
        raise _refused(
            "PAYMENT_UNAVAILABLE",
            f"{company_name(name)} has not set up where to receive payments yet. "
            "Ask them to add their UPI ID, then try again.",
        )

    # The lock first, so two taps give the sentence below rather than an
    # IntegrityError from `uq_vendor_payments_one_open`.
    await lock(db, vendor_id)
    if await _open_payment_id(db, company_id, vendor_id) is not None:
        raise _refused(
            "PAYMENT_OPEN",
            "There is already a payment open. Finish or cancel that one first.",
        )

    line = await standing(db, company_id, vendor_id)
    owed = max(0, line.used_paise)
    if owed == 0:
        raise _refused(
            "NOTHING_TO_PAY",
            "You do not owe anything right now. Tickets are billed when they "
            "close.",
        )
    ceiling = min(owed, PAYMENT_MAX_PAISE)
    if body.amountPaise > ceiling:
        # 422, not 409: it is the amount that is wrong, and the console shows it
        # against the field.
        raise AppError(
            422,
            "BAD_AMOUNT",
            f"Enter at most {rupees(ceiling)} — that is what is owed"
            + (
                f", and one UPI payment cannot exceed {rupees(PAYMENT_MAX_PAISE)}."
                if owed > PAYMENT_MAX_PAISE
                else "."
            ),
        )

    upi_id, payee_name = payee
    row = VendorPayment(
        company_id=company_id,
        vendor_id=vendor_id,
        code=await next_code(db, company_id, "vendor_payment"),
        amount_paise=body.amountPaise,
        # Frozen. An Admin changing where payments go must not rewrite where an
        # open request already told this vendor to send it.
        upi_id=upi_id,
        payee_name=payee_name,
        requested_by_label=_label(principal),
        created_by=principal.user_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return await _detail(db, row, for_payer=True)


async def claim_payment(
    db: AsyncSession,
    principal: Principal,
    payment_id: uuid.UUID,
    body: PaymentClaimRequest,
) -> VendorPaymentDetailOut:
    """"I have paid" — the vendor's half of the two words."""
    row = await _load_own_payment(db, principal, payment_id)
    state = state_of(row)
    if state == "waiting":
        # Idempotent: a double tap is the same claim, not a second one.
        return await _detail(db, row, for_payer=True)
    if state != "to_pay":
        raise _refused(
            "NOT_TO_PAY",
            "This payment has already been decided. Reload to see how.",
        )
    if not _proof_ok(row.company_id, body.proof.blobName):
        raise AppError(
            422, "BAD_PROOF", "That screenshot was not uploaded to this account."
        )
    clash = await _paid_with_utr(
        db, row.company_id, body.utr, exclude_id=row.id
    )
    if clash is not None:
        raise _refused(
            "UTR_ALREADY_CREDITED",
            f"That UTR is already on payment {clash}. Check your UPI app and "
            "enter the reference for THIS payment.",
        )

    now = _now()
    result = await db.execute(
        update(VendorPayment)
        .where(
            VendorPayment.id == row.id,
            VendorPayment.company_id == row.company_id,
            # The burn. A second claim finds this non-null and changes nothing.
            VendorPayment.claimed_at.is_(None),
            VendorPayment.cancelled_at.is_(None),
        )
        .values(
            claimed_at=now,
            claimed_by_user_id=principal.user_id,
            claimed_by_label=_label(principal),
            utr=body.utr,
            proof_blob_name=body.proof.blobName,
            updated_by=principal.user_id,
        )
    )
    if result.rowcount == 0:
        raise _refused(
            "NOT_TO_PAY", "This payment has just been decided. Reload to see how."
        )

    vendor = await db.scalar(
        select(Vendor.name).where(
            Vendor.company_id == row.company_id, Vendor.id == row.vendor_id
        )
    )
    await tell_billing(
        db,
        row.company_id,
        kind="vendor_payment",
        title=f"{vendor or 'A vendor'} says it has paid {rupees(row.amount_paise)}",
        detail=f"{row.code} · UTR {body.utr}. Confirm it to restore their limit.",
        to=f"{VENDOR_CREDIT_ROUTE}/payments/{row.id}",
    )
    await db.commit()
    return await _detail(db, await _load_own_payment(db, principal, row.id), for_payer=True)


async def cancel_payment(
    db: AsyncSession, principal: Principal, payment_id: uuid.UUID
) -> VendorPaymentDetailOut:
    """Withdraw a payment — only before claiming it.

    After a claim there is no cancel, and that is not an oversight: the vendor
    has said money left its account, and the only honest next step is somebody
    deciding whether it arrived.
    """
    row = await _load_own_payment(db, principal, payment_id)
    state = state_of(row)
    if state == "cancelled":
        return await _detail(db, row, for_payer=True)
    if state != "to_pay":
        raise _refused(
            "ALREADY_CLAIMED",
            "You have already said this was paid, so it cannot be withdrawn. "
            "Wait for it to be confirmed, or ask for it to be rejected.",
        )
    result = await db.execute(
        update(VendorPayment)
        .where(
            VendorPayment.id == row.id,
            VendorPayment.company_id == row.company_id,
            VendorPayment.claimed_at.is_(None),
            VendorPayment.cancelled_at.is_(None),
        )
        .values(
            cancelled_at=_now(),
            cancelled_by_label=_label(principal),
            updated_by=principal.user_id,
        )
    )
    if result.rowcount == 0:
        raise _refused(
            "ALREADY_CLAIMED", "This payment has just moved on. Reload to see how."
        )
    await db.commit()
    return await _detail(db, await _load_own_payment(db, principal, row.id), for_payer=True)


# ── limit requests, the vendor's side ────────────────────────────────────────


async def own_requests(
    db: AsyncSession, principal: Principal
) -> list[VendorCreditRequestOut]:
    """This vendor's requests, newest first. Short by construction — one open."""
    rows = await db.scalars(
        select(VendorCreditRequest)
        .where(
            VendorCreditRequest.company_id == principal.company_id,
            VendorCreditRequest.vendor_id == principal.vendor_id,
        )
        .order_by(VendorCreditRequest.created_at.desc())
        .limit(20)
    )
    return [_request_out(row) for row in rows.all()]


async def request_limit(
    db: AsyncSession, principal: Principal, body: LimitRequestIn
) -> VendorCreditRequestOut:
    """Ask for a bigger line. One pending at a time."""
    company_id, vendor_id = principal.company_id, principal.vendor_id
    assert company_id is not None and vendor_id is not None

    await lock(db, vendor_id)
    if await _pending_request_id(db, company_id, vendor_id) is not None:
        raise _refused(
            "REQUEST_PENDING",
            "You already have a request waiting. Withdraw it to ask for a "
            "different amount.",
        )
    current = await db.scalar(
        select(Vendor.credit_limit_paise).where(
            Vendor.company_id == company_id, Vendor.id == vendor_id
        )
    )
    current = int(current or 0)
    if body.requestedLimitPaise <= current:
        # Said in words before the CHECK says it in SQL.
        raise AppError(
            422,
            "BAD_AMOUNT",
            f"Your limit is already {rupees(current)}. Ask for more than that.",
        )

    row = VendorCreditRequest(
        company_id=company_id,
        vendor_id=vendor_id,
        # Frozen: without it a decision read later cannot say what it changed.
        current_limit_paise=current,
        requested_limit_paise=body.requestedLimitPaise,
        note=(body.note or "").strip() or None,
        status="pending",
        submitted_at=_now(),
        created_by=principal.user_id,
    )
    db.add(row)
    await db.flush()

    vendor = await db.scalar(
        select(Vendor.name).where(Vendor.company_id == company_id, Vendor.id == vendor_id)
    )
    await tell_billing(
        db,
        company_id,
        kind="vendor_credit_request",
        title=f"{vendor or 'A vendor'} asked for a higher credit limit",
        detail=(
            f"{rupees(current)} → {rupees(body.requestedLimitPaise)}. "
            "Approve it, or set a different figure."
        ),
        to=f"{VENDOR_CREDIT_ROUTE}?view=requests",
    )
    await db.commit()
    await db.refresh(row)
    return _request_out(row)


async def withdraw_request(
    db: AsyncSession, principal: Principal, request_id: uuid.UUID
) -> VendorCreditRequestOut:
    """Take a pending request back."""
    result = await db.execute(
        update(VendorCreditRequest)
        .where(
            VendorCreditRequest.id == request_id,
            VendorCreditRequest.company_id == principal.company_id,
            VendorCreditRequest.vendor_id == principal.vendor_id,
            VendorCreditRequest.status == "pending",
        )
        .values(status="cancelled", updated_by=principal.user_id)
    )
    row = await db.scalar(
        select(VendorCreditRequest)
        .where(
            VendorCreditRequest.id == request_id,
            VendorCreditRequest.company_id == principal.company_id,
            VendorCreditRequest.vendor_id == principal.vendor_id,
        )
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise _not_found("Request")
    if result.rowcount == 0 and row.status != "cancelled":
        raise _refused(
            "NO_PENDING_REQUEST",
            "This request has just been decided. Reload to see how.",
        )
    await db.commit()
    return _request_out(row)


# ── the staff side ───────────────────────────────────────────────────────────


async def vendors_page(
    db: AsyncSession, company_id: uuid.UUID, params: ListParams, *, paused_only: bool
) -> tuple[list[VendorStandingOut], int]:
    """Every vendor's line, one page at a time.

    Paged and searched in SQL; the four figures come from two grouped queries
    over the page, never one query per vendor.

    `paused_only` is applied in PYTHON, after the figures are resolved, and that
    is a deliberate limitation rather than an oversight: "paused" is
    `limit - used - reserved <= 0`, which is a sum over two other tables, and
    filtering on it in SQL means recomputing both as correlated subqueries for
    every vendor in the company. The count then reports the page, so the console
    shows the filter as a view of this page rather than a total.
    """
    stmt = select(Vendor).where(
        Vendor.company_id == company_id, Vendor.deleted_at.is_(None)
    )
    if params.search:
        stmt = stmt.where(Vendor.name.ilike(f"%{params.search.strip()}%"))
    total = await db.scalar(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    )
    rows = list(
        (
            await db.scalars(
                stmt.order_by(Vendor.name.asc()).offset(params.offset).limit(params.limit)
            )
        ).all()
    )
    if not rows:
        return [], int(total or 0)

    credit = await standing_many(
        db, company_id, limits={r.id: r.credit_limit_paise for r in rows}
    )
    # One row per vendor at most — `uq_vendor_payments_one_open` guarantees it.
    open_payments = {
        p.vendor_id: (p.id, state_of(p))
        for p in (
            await db.scalars(
                _open(select(VendorPayment)).where(
                    VendorPayment.company_id == company_id,
                    VendorPayment.vendor_id.in_([r.id for r in rows]),
                )
            )
        ).all()
    }
    pending = {
        vendor_id: request_id
        for vendor_id, request_id in (
            await db.execute(
                select(VendorCreditRequest.vendor_id, VendorCreditRequest.id).where(
                    VendorCreditRequest.company_id == company_id,
                    VendorCreditRequest.vendor_id.in_([r.id for r in rows]),
                    VendorCreditRequest.status == "pending",
                )
            )
        ).all()
    }

    out = []
    for r in rows:
        line = credit[r.id]
        if paused_only and not line.paused:
            continue
        payment = open_payments.get(r.id)
        out.append(
            VendorStandingOut(
                vendorId=r.id,
                vendorName=r.name,
                isActive=r.is_active,
                limitPaise=line.limit_paise,
                usedPaise=line.used_paise,
                reservedPaise=line.reserved_paise,
                availablePaise=line.available_paise,
                paused=line.paused,
                openPaymentId=payment[0] if payment else None,
                openPaymentState=payment[1] if payment else None,
                pendingRequestId=pending.get(r.id),
            )
        )
    return out, int(total or 0)


async def counts(db: AsyncSession, company_id: uuid.UUID) -> PaymentCountOut:
    """The two badges: claims waiting, and requests waiting."""
    waiting = await db.scalar(
        _in_state(
            select(func.count()).select_from(VendorPayment), "waiting"
        ).where(VendorPayment.company_id == company_id)
    )
    requests = await db.scalar(
        select(func.count())
        .select_from(VendorCreditRequest)
        .where(
            VendorCreditRequest.company_id == company_id,
            VendorCreditRequest.status == "pending",
        )
    )
    return PaymentCountOut(waiting=int(waiting or 0), pendingRequests=int(requests or 0))


async def _load_payment(
    db: AsyncSession, company_id: uuid.UUID, payment_id: uuid.UUID
) -> VendorPayment:
    row = await db.scalar(
        select(VendorPayment)
        .where(VendorPayment.company_id == company_id, VendorPayment.id == payment_id)
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise _not_found()
    return row


async def payment_detail(
    db: AsyncSession, company_id: uuid.UUID, payment_id: uuid.UUID
) -> VendorPaymentDetailOut:
    row = await _load_payment(db, company_id, payment_id)
    return await _detail(db, row, for_payer=False)


async def confirm_payment(
    db: AsyncSession, principal: Principal, payment_id: uuid.UUID
) -> VendorPaymentDetailOut:
    """The one thing that restores a vendor's headroom."""
    company_id = principal.company_id
    assert company_id is not None
    row = await _load_payment(db, company_id, payment_id)
    state = state_of(row)
    if state == "paid":
        # Idempotent. The entry's partial unique would stop a second credit
        # anyway; returning early means nobody sees a 409 for pressing twice.
        return await _detail(db, row, for_payer=False)
    if state != "waiting":
        raise _refused(
            "NOT_WAITING",
            "This payment is not waiting to be confirmed. Reload to see where "
            "it is.",
        )
    clash = await _paid_with_utr(db, company_id, row.utr or "", exclude_id=row.id)
    if clash is not None:
        raise _refused(
            "UTR_ALREADY_CREDITED",
            f"UTR {row.utr} has already been credited on payment {clash}. "
            "Reject this one instead.",
        )

    now = _now()
    result = await db.execute(
        update(VendorPayment)
        .where(
            VendorPayment.id == row.id,
            VendorPayment.company_id == company_id,
            VendorPayment.claimed_at.is_not(None),
            VendorPayment.confirmed_at.is_(None),
            VendorPayment.rejected_at.is_(None),
            VendorPayment.cancelled_at.is_(None),
        )
        .values(
            confirmed_at=now,
            confirmed_by_user_id=principal.user_id,
            confirmed_by_label=_label(principal),
            updated_by=principal.user_id,
        )
    )
    if result.rowcount == 0:
        raise _refused(
            "NOT_WAITING", "This payment has just been decided. Reload to see how."
        )

    owed = await apply_payment(db, row, by_user=principal.user_id)
    await tell_vendor(
        db,
        company_id,
        row.vendor_id,
        kind="vendor_payment",
        title=f"Your payment of {rupees(row.amount_paise)} was confirmed",
        detail=f"{row.code} · {rupees(max(0, owed))} still owed.",
    )
    await db.commit()
    return await _detail(db, await _load_payment(db, company_id, row.id), for_payer=False)


async def record_payment(
    db: AsyncSession,
    principal: Principal,
    vendor_id: uuid.UUID,
    body: RecordPaymentRequest,
) -> VendorPaymentDetailOut:
    """Write down money that reached the company by some route other than the QR.

    ## Why this exists at all

    The QR flow only covers money sent BY UPI, and UPI caps one transfer at
    ₹1,00,000. Without this door, a vendor settling ₹5,00,000 by RTGS — which is
    how most B2B settlement in India actually moves — had no way to have it
    credited, and neither did a cheque, cash, or a UPI payment made outside the
    flow. Their only remedies were to redo it as five separate QR payments or to
    have their limit raised, which records a credit decision in place of a
    payment that actually happened.

    ## It is one person's word, and it says so

    Every other door here needs two: the vendor claims, the company confirms.
    That works because both can see something — the vendor knows they sent it, the
    company knows it arrived. A NEFT leaves evidence on the company's side only,
    and the vendor has told nobody, so there is no second observer to ask.
    `source='staff'` records which kind of evidence this was, and the screens
    print it, so nobody reading the trail later mistakes one for the other.

    Final the moment it is written — as confirming a vendor's payment is. There is
    no reversal in this product.

    ## No payee, and no cap

    The UPI pair is left NULL: the money went to no UPI address, and filling it
    from the company's settings would assert a route it never took. That also
    means a company which has never set a UPI ID can still clear a line, which is
    most of the point. The amount is uncapped for the same reason — UPI's limit is
    a fact about one QR.

    It may exceed what is owed. An advance is a real thing, and the line then
    reads as being in credit rather than the payment being refused outright.
    """
    company_id = principal.company_id
    assert company_id is not None

    vendor = await db.scalar(
        select(Vendor).where(
            Vendor.company_id == company_id,
            Vendor.id == vendor_id,
            Vendor.deleted_at.is_(None),
        )
    )
    if vendor is None:
        raise _not_found("Vendor")

    reference = (body.reference or "").strip().upper() or None
    if reference is not None:
        clash = await _paid_with_utr(db, company_id, reference)
        if clash is not None:
            raise _refused(
                "UTR_ALREADY_CREDITED",
                f"Reference {reference} is already credited on payment {clash}. "
                "Check the statement — this may be money you have already recorded.",
            )
    if body.proof is not None and not _proof_ok(company_id, body.proof.blobName):
        raise AppError(
            422, "BAD_PROOF", "That attachment was not uploaded to this account."
        )

    now = _now()
    label = _label(principal)
    row = VendorPayment(
        company_id=company_id,
        vendor_id=vendor_id,
        code=await next_code(db, company_id, "vendor_payment"),
        amount_paise=body.amountPaise,
        source="staff",
        method=body.method.strip(),
        received_on=body.receivedOn,
        note=(body.note or "").strip() or None,
        # No UPI pair — see the docstring.
        upi_id=None,
        payee_name=None,
        requested_by_label=label,
        # Born claimed AND confirmed: recording it IS both halves, by the only
        # party in a position to make either.
        claimed_at=now,
        claimed_by_user_id=principal.user_id,
        claimed_by_label=label,
        utr=reference,
        proof_blob_name=body.proof.blobName if body.proof else None,
        confirmed_at=now,
        confirmed_by_user_id=principal.user_id,
        confirmed_by_label=label,
        created_by=principal.user_id,
    )
    db.add(row)
    await db.flush()

    owed = await apply_payment(db, row, by_user=principal.user_id)
    await tell_vendor(
        db,
        company_id,
        vendor_id,
        kind="vendor_payment",
        title=f"A payment of {rupees(row.amount_paise)} was recorded",
        detail=(
            f"{row.code} · {row.method} received "
            f"{body.receivedOn.isoformat()} · {rupees(max(0, owed))} still owed."
        ),
    )
    await db.commit()
    return await _detail(db, await _load_payment(db, company_id, row.id), for_payer=False)


async def reject_payment(
    db: AsyncSession, principal: Principal, payment_id: uuid.UUID, body: RejectRequest
) -> VendorPaymentDetailOut:
    """Say it did not arrive, or did not match. Final, and needs a reason.

    There is no partial credit and no refund path in this product: money that
    left somebody's account and did not match is settled outside it. The vendor
    can ask to pay again with the right reference.
    """
    company_id = principal.company_id
    assert company_id is not None
    row = await _load_payment(db, company_id, payment_id)
    if state_of(row) != "waiting":
        raise _refused(
            "NOT_WAITING",
            "This payment is not waiting to be decided. Reload to see where it is.",
        )
    reason = body.reason.strip()
    result = await db.execute(
        update(VendorPayment)
        .where(
            VendorPayment.id == row.id,
            VendorPayment.company_id == company_id,
            VendorPayment.claimed_at.is_not(None),
            VendorPayment.confirmed_at.is_(None),
            VendorPayment.rejected_at.is_(None),
        )
        .values(
            rejected_at=_now(),
            rejected_by_user_id=principal.user_id,
            rejected_by_label=_label(principal),
            reject_reason=reason,
            updated_by=principal.user_id,
        )
    )
    if result.rowcount == 0:
        raise _refused(
            "NOT_WAITING", "This payment has just been decided. Reload to see how."
        )
    await tell_vendor(
        db,
        company_id,
        row.vendor_id,
        kind="vendor_payment",
        title=f"Your payment of {rupees(row.amount_paise)} was not accepted",
        detail=f"{row.code} · Reason: {reason}",
    )
    await db.commit()
    return await _detail(db, await _load_payment(db, company_id, row.id), for_payer=False)


# ── limit requests, the staff side ───────────────────────────────────────────


async def requests_page(
    db: AsyncSession, company_id: uuid.UUID, params: ListParams, *, status: str | None
) -> tuple[list[VendorCreditRequestOut], int]:
    """The request queue, pending first and longest-waiting within it.

    The two-halves ordering `masters.list_brand_approvals` uses: what nobody has
    decided sorts by how long it has waited, and what has been decided sorts
    newest first, because that is the half somebody scans for what just changed.
    """
    stmt = (
        select(VendorCreditRequest, Vendor.name)
        .join(
            Vendor,
            (Vendor.company_id == VendorCreditRequest.company_id)
            & (Vendor.id == VendorCreditRequest.vendor_id),
        )
        .where(VendorCreditRequest.company_id == company_id)
    )
    if status is not None:
        stmt = stmt.where(VendorCreditRequest.status == status)
    if params.search:
        stmt = stmt.where(Vendor.name.ilike(f"%{params.search.strip()}%"))

    total = await db.scalar(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    )
    # The two halves, the shape `masters.list_brand_approvals` settled on.
    # `waited` falls back to `created_at` for a row that somehow never recorded
    # a submission, so no request can sort as infinitely old.
    waited = func.coalesce(
        VendorCreditRequest.submitted_at, VendorCreditRequest.created_at
    )
    is_decided = case((VendorCreditRequest.status == "pending", 0), else_=1)
    within_half = case(
        # Pending: longest wait first — somebody is owed an answer.
        (VendorCreditRequest.status == "pending", func.extract("epoch", waited)),
        # Decided: newest first, by negating the instant rather than needing a
        # second ORDER BY direction the first half would also take.
        else_=-func.extract(
            "epoch", func.coalesce(VendorCreditRequest.decided_at, waited)
        ),
    )
    rows = await db.execute(
        stmt.order_by(is_decided.asc(), within_half.asc(), VendorCreditRequest.id.asc())
        .offset(params.offset)
        .limit(params.limit)
    )
    return [_request_out(row, vendor_name) for row, vendor_name in rows.all()], int(
        total or 0
    )


async def _load_request(
    db: AsyncSession, company_id: uuid.UUID, request_id: uuid.UUID
) -> VendorCreditRequest:
    row = await db.scalar(
        select(VendorCreditRequest)
        .where(
            VendorCreditRequest.company_id == company_id,
            VendorCreditRequest.id == request_id,
        )
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise _not_found("Request")
    if row.status != "pending":
        raise _refused(
            "ALREADY_DECIDED",
            "This request has already been reviewed. Reload to see the decision.",
        )
    return row


async def approve_request(
    db: AsyncSession,
    principal: Principal,
    request_id: uuid.UUID,
    body: LimitApproveRequest,
) -> VendorCreditRequestOut:
    """Grant a line — the amount decided here, not the amount asked for.

    Granting LESS than was asked is the point. Granting less than the vendor
    already has is refused, and that is not the same judgement: an Admin or
    National Head may absolutely cut a line, but they do it on the Vendors form
    where it reads as what it is. Doing it through Approve would write
    `status = 'approved'` over a reduction, and a year later nobody reading the
    trail could tell a grant from a cut.

    Checked against the LIVE limit, not the `current_limit_paise` frozen on the
    request: if somebody raised the line while this sat waiting, the frozen figure
    is stale and approving against it would still be a reduction.
    """
    company_id = principal.company_id
    assert company_id is not None
    row = await _load_request(db, company_id, request_id)

    live = await db.scalar(
        select(Vendor.credit_limit_paise).where(
            Vendor.company_id == company_id, Vendor.id == row.vendor_id
        )
    )
    live = int(live or 0)
    if body.grantedLimitPaise < live:
        raise AppError(
            422,
            "BAD_AMOUNT",
            f"That is below the {rupees(live)} limit they already have. Approve "
            f"{rupees(live)} or more, or lower it on the Vendors screen instead.",
        )

    result = await db.execute(
        update(VendorCreditRequest)
        .where(
            VendorCreditRequest.id == row.id,
            VendorCreditRequest.company_id == company_id,
            VendorCreditRequest.status == "pending",
        )
        .values(
            status="approved",
            granted_limit_paise=body.grantedLimitPaise,
            decided_at=_now(),
            decided_by_user_id=principal.user_id,
            decided_by_label=_label(principal),
            updated_by=principal.user_id,
        )
    )
    if result.rowcount == 0:
        raise _refused(
            "ALREADY_DECIDED", "This request was just decided. Reload to see how."
        )
    # The line itself, in the SAME transaction as the decision. A decision that
    # committed without the change it describes would be a record of something
    # that did not happen.
    await db.execute(
        update(Vendor)
        .where(Vendor.company_id == company_id, Vendor.id == row.vendor_id)
        .values(credit_limit_paise=body.grantedLimitPaise, updated_by=principal.user_id)
    )
    await tell_vendor(
        db,
        company_id,
        row.vendor_id,
        kind="vendor_credit_request",
        title="Your credit limit was raised",
        detail=(
            f"{rupees(row.current_limit_paise)} → {rupees(body.grantedLimitPaise)}."
            + (
                f" You asked for {rupees(row.requested_limit_paise)}."
                if body.grantedLimitPaise != row.requested_limit_paise
                else ""
            )
        ),
    )
    await db.commit()
    fresh = await db.scalar(
        select(VendorCreditRequest)
        .where(VendorCreditRequest.id == row.id)
        .execution_options(populate_existing=True)
    )
    assert fresh is not None
    return _request_out(fresh)


async def reject_request(
    db: AsyncSession, principal: Principal, request_id: uuid.UUID, body: RejectRequest
) -> VendorCreditRequestOut:
    """Turn a request down, with the reason the vendor will read."""
    company_id = principal.company_id
    assert company_id is not None
    row = await _load_request(db, company_id, request_id)
    reason = body.reason.strip()
    result = await db.execute(
        update(VendorCreditRequest)
        .where(
            VendorCreditRequest.id == row.id,
            VendorCreditRequest.company_id == company_id,
            VendorCreditRequest.status == "pending",
        )
        .values(
            status="rejected",
            reject_reason=reason,
            decided_at=_now(),
            decided_by_user_id=principal.user_id,
            decided_by_label=_label(principal),
            updated_by=principal.user_id,
        )
    )
    if result.rowcount == 0:
        raise _refused(
            "ALREADY_DECIDED", "This request was just decided. Reload to see how."
        )
    await tell_vendor(
        db,
        company_id,
        row.vendor_id,
        kind="vendor_credit_request",
        title="Your credit limit was not raised",
        detail=f"Reason: {reason}",
        to=PORTAL_CREDIT_ROUTE,
    )
    await db.commit()
    fresh = await db.scalar(
        select(VendorCreditRequest)
        .where(VendorCreditRequest.id == row.id)
        .execution_options(populate_existing=True)
    )
    assert fresh is not None
    return _request_out(fresh)


async def vendor_line(
    db: AsyncSession, company_id: uuid.UUID, vendor_id: uuid.UUID
) -> VendorStandingOut:
    """One vendor's line, for the drawer a staff row opens."""
    row = await db.scalar(
        select(Vendor).where(
            Vendor.company_id == company_id,
            Vendor.id == vendor_id,
            Vendor.deleted_at.is_(None),
        )
    )
    if row is None:
        raise _not_found("Vendor")
    line = await standing(db, company_id, vendor_id)
    return VendorStandingOut(
        vendorId=row.id,
        vendorName=row.name,
        isActive=row.is_active,
        limitPaise=line.limit_paise,
        usedPaise=line.used_paise,
        reservedPaise=line.reserved_paise,
        availablePaise=line.available_paise,
        paused=line.paused,
        openPaymentId=await _open_payment_id(db, company_id, vendor_id),
        pendingRequestId=await _pending_request_id(db, company_id, vendor_id),
    )

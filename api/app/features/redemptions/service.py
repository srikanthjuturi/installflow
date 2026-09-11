"""A technician cashing out, paid by UPI — claim, then confirm.

Read `models/redemption.py` first; this is the behaviour it describes. The
short version: the payer (National Head, else Admin) CLAIMS they paid, with a
screenshot; only the technician CONFIRMS it arrived; nothing else in the system
may say a redemption is paid, because nothing else can see the money.

## Every write has the codebase's one shape

A guarded UPDATE (or an INSERT a unique index guards) → the event → the bell
and its realtime frame → commit → a push AFTER the commit. A push about a claim
that then failed to save would send a technician to their bank app for money
nobody recorded sending.

## Two audiences, two doors, never the same function

The technician's reads resolve the row through THEIR profile id and nothing
else — there is no path from one technician to another's money. The payer's
resolve through the company, behind a feature and a rank floor in the router.
A guessed id is a 404 on both sides.
"""

import datetime
import uuid

from sqlalchemy import Select, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.brand import company_name
from app.core.coverage import payer_role
from app.core.deps import Principal
from app.core.errors import AppError
from app.core.ledger import credited
from app.core.notifications import notify
from app.core.push import send_to_technician
from app.core.realtime import publish_notification
from app.core.schemas import ListParams
from app.core.sequences import next_code
from app.core.tickets import SLOT_TIMEZONE_OFFSET_MINUTES
from app.core.upi import build_upi_uri
from app.features.redemptions.schemas import (
    ClaimRequest,
    DeclineRequest,
    RedeemableOut,
    RedeemRequest,
    RedemptionDetailOut,
    RedemptionEventOut,
    RedemptionOut,
    StaffRedemptionDetailOut,
    StaffRedemptionOut,
)
from app.integrations.blob import signed_url
from app.models.company import Company
from app.models.membership import Membership
from app.models.redemption import UPI_MAX_PAISE, Redemption, RedemptionEvent
from app.models.role import ROLE_LABELS
from app.models.technician import TechnicianProfile
from app.models.user import User

#: Where the payer's screenshot must live. The same private prefix force-close
#: attachments use — a blob name is the only thing the client hands over, so the
#: prefix is what makes "this file was uploaded here, for this company" checkable.
_PROOF_PREFIX = "attachment"

IST = datetime.timezone(datetime.timedelta(minutes=SLOT_TIMEZONE_OFFSET_MINUTES))


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _rupees(paise: int) -> str:
    """`₹4,250`, or `₹4,250.50` when there are paise — for bells and pushes."""
    whole = f"₹{paise // 100:,}"
    return whole if paise % 100 == 0 else f"{whole}.{paise % 100:02d}"


def _not_found() -> AppError:
    # 404, never 403: a redemption that is not yours does not exist to you.
    return AppError(404, "NOT_FOUND", "Redemption not found")


def _refused(code: str, detail: str) -> AppError:
    return AppError(409, code, detail)


def state_of(row: Redemption) -> str:
    """The one place the timestamps become a word. See `RedemptionState`."""
    if row.declined_at is not None:
        return "declined"
    if row.confirmed_at is not None:
        return "settled"
    if row.claimed_at is not None:
        return "awaiting"
    return "to_pay"


# ── the balance ──────────────────────────────────────────────────────────────


async def reserved(
    db: AsyncSession, *, company_id: uuid.UUID, technician_id: uuid.UUID
) -> int:
    """Every redemption not declined — paid, being paid, or waiting to be.

    An open one counts from the moment it is asked for, not from when it is
    confirmed: the money is spoken for, and counting it only once settled would
    let a technician ask for the same balance twice while the first request sat
    in somebody's queue.
    """
    total = await db.scalar(
        select(func.coalesce(func.sum(Redemption.amount_paise), 0)).where(
            Redemption.company_id == company_id,
            Redemption.technician_id == technician_id,
            Redemption.declined_at.is_(None),
        )
    )
    return int(total or 0)


async def balance(
    db: AsyncSession, *, company_id: uuid.UUID, technician_id: uuid.UUID
) -> int:
    """What this technician is owed and has not yet asked for. May be negative."""
    owed = await credited(db, company_id=company_id, technician_id=technician_id)
    return owed - await reserved(
        db, company_id=company_id, technician_id=technician_id
    )


def redeemable(available: int) -> int:
    """What one request may be for: the balance, floored at 0, capped at UPI's limit."""
    return min(max(available, 0), UPI_MAX_PAISE)


# ── shaping ──────────────────────────────────────────────────────────────────


async def _events(db: AsyncSession, row: Redemption) -> list[RedemptionEvent]:
    return list(
        await db.scalars(
            select(RedemptionEvent)
            .where(
                RedemptionEvent.company_id == row.company_id,
                RedemptionEvent.redemption_id == row.id,
            )
            .order_by(RedemptionEvent.seq)
        )
    )


def _denied_at(events: list[RedemptionEvent]) -> datetime.datetime | None:
    """The latest "not yet" said about the CURRENT claim, if any."""
    for event in reversed(events):
        if event.kind == "claimed":
            return None
        if event.kind == "denied":
            return event.created_at
    return None


def _fields(row: Redemption, denied_at: datetime.datetime | None) -> dict:
    return {
        "id": row.id,
        "code": row.code,
        "state": state_of(row),
        "amountPaise": row.amount_paise,
        "upiId": row.upi_id,
        "payeeName": row.payee_name,
        "requestedAt": row.created_at,
        "claimedAt": row.claimed_at,
        "claimedBy": row.claimed_by_label,
        "utr": row.utr,
        "confirmedAt": row.confirmed_at,
        "declinedAt": row.declined_at,
        "declinedBy": row.declined_by_label,
        "declineReason": row.decline_reason,
        "deniedAt": denied_at,
    }


def _event_out(event: RedemptionEvent) -> RedemptionEventOut:
    return RedemptionEventOut(
        id=event.id,
        kind=event.kind,
        at=event.created_at,
        actorKind=event.actor_kind,
        actorLabel=event.actor_label,
        utr=event.utr,
        note=event.note,
    )


async def _upi_uri(db: AsyncSession, row: Redemption) -> str:
    """The pay link, from the ROW — never from anything a client sent.

    The amount, the address and the name all come off the frozen redemption,
    so the QR, the figure on screen and the sum owed are one number. The note
    names the company (white-labelled, `core.brand`) so the payment reads as
    what it is on the technician's statement; `tr` is the code without its
    hyphens, because several UPI apps silently refuse a punctuated reference.
    """
    name = await db.scalar(select(Company.name).where(Company.id == row.company_id))
    return build_upi_uri(
        vpa=row.upi_id,
        payee_name=row.payee_name,
        amount_paise=row.amount_paise,
        note=f"{company_name(name)} payout {row.code}",
        ref=row.code.replace("-", ""),
    )


# ── the technician's side ────────────────────────────────────────────────────


async def _technician_user(db: AsyncSession, profile: TechnicianProfile) -> User:
    user = await db.scalar(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.id == profile.membership_id,
            Membership.company_id == profile.company_id,
        )
    )
    assert user is not None  # `require_technician_principal` just joined it
    return user


def _mine(profile: TechnicianProfile) -> Select:
    return select(Redemption).where(
        Redemption.company_id == profile.company_id,
        Redemption.technician_id == profile.id,
    )


def _open(stmt: Select) -> Select:
    return stmt.where(Redemption.confirmed_at.is_(None), Redemption.declined_at.is_(None))


async def summary(db: AsyncSession, profile: TechnicianProfile) -> RedeemableOut:
    available = await balance(
        db, company_id=profile.company_id, technician_id=profile.id
    )
    open_row = await db.scalar(_open(_mine(profile)))
    open_out = None
    if open_row is not None:
        open_out = RedemptionOut(
            **_fields(open_row, _denied_at(await _events(db, open_row)))
        )
    role = await payer_role(db, company_id=profile.company_id)
    return RedeemableOut(
        availablePaise=available,
        redeemablePaise=redeemable(available),
        upiId=profile.upi_id,
        payerLabel=ROLE_LABELS.get(role, role),
        open=open_out,
    )


async def _my_detail(
    db: AsyncSession, profile: TechnicianProfile, row: Redemption
) -> RedemptionDetailOut:
    events = await _events(db, row)
    return RedemptionDetailOut(
        **_fields(row, _denied_at(events)),
        # Only until somebody claims. After that a QR on the technician's
        # screen is an invitation to pay twice; the payer still has theirs.
        upiUri=await _upi_uri(db, row) if state_of(row) == "to_pay" else None,
        # The technician is the payee — the screenshot is proof of a payment
        # TO them, and exactly what they check their bank against.
        proofUrl=signed_url(row.proof_blob_name) if row.proof_blob_name else None,
        events=[_event_out(e) for e in events],
    )


async def my_detail(
    db: AsyncSession, profile: TechnicianProfile, redemption_id: uuid.UUID
) -> RedemptionDetailOut:
    # `populate_existing`: sessions keep objects across a commit
    # (`expire_on_commit=False`), and this is also the read-back after a write.
    row = await db.scalar(
        _mine(profile)
        .where(Redemption.id == redemption_id)
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise _not_found()
    return await _my_detail(db, profile, row)


async def my_history(
    db: AsyncSession, profile: TechnicianProfile, params: ListParams
) -> tuple[list[RedemptionOut], int]:
    stmt = _mine(profile)
    total = (
        await db.scalar(
            select(func.count()).select_from(
                stmt.with_only_columns(Redemption.id).subquery()
            )
        )
    ) or 0
    rows = list(
        await db.scalars(
            stmt.order_by(Redemption.created_at.desc(), Redemption.id.desc())
            .offset(params.offset)
            .limit(params.limit)
        )
    )
    # Events only for what could carry a "not yet" — an awaiting one.
    out = []
    for r in rows:
        denied = _denied_at(await _events(db, r)) if state_of(r) == "awaiting" else None
        out.append(RedemptionOut(**_fields(r, denied)))
    return out, total


async def request(
    db: AsyncSession,
    principal: Principal,
    profile: TechnicianProfile,
    body: RedeemRequest,
) -> RedemptionDetailOut:
    """Ask to be paid the balance. The server decides the sum; see `RedeemRequest`.

    The profile row is locked first. Two taps from a slow connection would
    otherwise both compute the same balance and both insert; the partial unique
    index would stop the second, but as an IntegrityError rather than the
    sentence below. With the lock the second waits, then finds the first.
    """
    company_id = profile.company_id
    locked = await db.scalar(
        select(TechnicianProfile)
        .where(
            TechnicianProfile.company_id == company_id,
            TechnicianProfile.id == profile.id,
        )
        .with_for_update()
    )
    assert locked is not None

    if await db.scalar(_open(_mine(profile))) is not None:
        raise _refused(
            "REDEMPTION_OPEN",
            "You already have a redemption open. It has to be paid and "
            "confirmed, or declined, before you can ask for another.",
        )
    if not locked.upi_id:
        raise _refused("NO_UPI_ID", "Add a UPI ID before you redeem.")

    available = await balance(db, company_id=company_id, technician_id=profile.id)
    amount = redeemable(available)
    if amount <= 0:
        raise _refused("NOTHING_TO_REDEEM", "There is nothing to redeem yet.")
    if body.amountPaise != amount:
        # Not a validation error: the balance moved between the screen and the
        # tap. The app refetches and shows the new figure.
        raise _refused(
            "BALANCE_CHANGED", f"Your balance changed to {_rupees(amount)}."
        )

    user = await _technician_user(db, profile)
    technician = (user.full_name or "").strip()[:120] or "Technician"
    # The name ON THE UPI ACCOUNT when they gave one — it is what the payer's
    # app shows on scanning, so it is what the QR's `pn` and the "check the
    # name" line must match. Their own name for accounts added before names
    # were captured.
    payee = (locked.upi_name or "").strip()[:120] or technician
    code = await next_code(db, company_id, "redemption")
    row = Redemption(
        company_id=company_id,
        technician_id=profile.id,
        code=code,
        amount_paise=amount,
        upi_id=locked.upi_id,
        payee_name=payee,
        created_by=principal.user_id,
    )
    db.add(row)
    await db.flush()
    db.add(
        RedemptionEvent(
            company_id=company_id,
            redemption_id=row.id,
            kind="requested",
            actor_kind="technician",
            actor_label=technician,
            note=f"{_rupees(amount)} to {locked.upi_id}",
            created_by=principal.user_id,
        )
    )

    raised = await notify(
        db,
        company_id=company_id,
        kind="redemption",
        title=f"{technician} requested {_rupees(amount)}",
        detail=f"{code} · {locked.upi_id}",
        to=f"/redemptions/{row.id}",
        audience="payers",
    )
    await publish_notification(
        db,
        company_id=company_id,
        pincode=None,
        notification_id=raised.id,
        audience="payers",
    )
    await db.commit()
    await db.refresh(row)
    return await _my_detail(db, profile, row)


async def confirm(
    db: AsyncSession,
    principal: Principal,
    profile: TechnicianProfile,
    redemption_id: uuid.UUID,
    *,
    received: bool,
) -> RedemptionDetailOut:
    """The technician's word — the only one that settles a redemption.

    Idempotent both ways, because this is a button on a phone on a bad
    connection. A second "received" is the same fact, not a second event; a
    second "not yet" to the same claim is the same complaint, and ringing the
    payer twice for it is how a bell stops being read.
    """
    row = await db.scalar(_mine(profile).where(Redemption.id == redemption_id))
    if row is None:
        raise _not_found()

    if received and row.confirmed_at is not None:
        return await _my_detail(db, profile, row)
    if row.claimed_at is None or row.declined_at is not None:
        raise _refused(
            "NOT_CLAIMED", "Nobody has marked this as paid yet, so there is "
            "nothing to confirm."
        )
    if row.confirmed_at is not None:
        raise _refused(
            "ALREADY_CONFIRMED", "You have already confirmed you received this."
        )

    user = await _technician_user(db, profile)
    label = (user.full_name or "").strip() or "Technician"

    if received:
        result = await db.execute(
            update(Redemption)
            .where(
                Redemption.company_id == row.company_id,
                Redemption.id == row.id,
                Redemption.claimed_at.is_not(None),
                Redemption.confirmed_at.is_(None),
                Redemption.declined_at.is_(None),
            )
            .values(confirmed_at=_now(), updated_by=principal.user_id)
        )
        if result.rowcount == 0:
            # A double tap that raced itself. Whatever won is the answer.
            await db.rollback()
            return await my_detail(db, profile, redemption_id)
        db.add(
            RedemptionEvent(
                company_id=row.company_id,
                redemption_id=row.id,
                kind="confirmed",
                actor_kind="technician",
                actor_label=label,
                created_by=principal.user_id,
            )
        )
        # No bell. A payment that arrived is the routine outcome, and a bell
        # for it is noise the next real one gets lost in.
        await db.commit()
        await db.refresh(row)
        return await _my_detail(db, profile, row)

    if _denied_at(await _events(db, row)) is not None:
        return await _my_detail(db, profile, row)

    claimed_on = row.claimed_at.astimezone(IST)
    db.add(
        RedemptionEvent(
            company_id=row.company_id,
            redemption_id=row.id,
            kind="denied",
            actor_kind="technician",
            actor_label=label,
            created_by=principal.user_id,
        )
    )
    raised = await notify(
        db,
        company_id=row.company_id,
        kind="redemption",
        title=f"{label} hasn't received {_rupees(row.amount_paise)}",
        detail=f"{row.code} · marked paid {claimed_on.day} {claimed_on:%b}",
        to=f"/redemptions/{row.id}",
        audience="payers",
    )
    await publish_notification(
        db,
        company_id=row.company_id,
        pincode=None,
        notification_id=raised.id,
        audience="payers",
    )
    await db.commit()
    await db.refresh(row)
    return await _my_detail(db, profile, row)


# ── the payer's side ─────────────────────────────────────────────────────────


def _staff_base(company_id: uuid.UUID) -> Select:
    """Every redemption in the company, with who it is for."""
    return (
        select(Redemption, TechnicianProfile.code, User.full_name, User.phone)
        .join(
            TechnicianProfile,
            (TechnicianProfile.company_id == Redemption.company_id)
            & (TechnicianProfile.id == Redemption.technician_id),
        )
        .join(
            Membership,
            (Membership.id == TechnicianProfile.membership_id)
            & (Membership.company_id == TechnicianProfile.company_id),
        )
        .join(User, User.id == Membership.user_id)
        .where(Redemption.company_id == company_id)
    )


def _in_state(stmt: Select, state: str) -> Select:
    if state == "to_pay":
        return stmt.where(
            Redemption.claimed_at.is_(None), Redemption.declined_at.is_(None)
        )
    if state == "awaiting":
        return stmt.where(
            Redemption.claimed_at.is_not(None), Redemption.confirmed_at.is_(None)
        )
    if state == "settled":
        return stmt.where(Redemption.confirmed_at.is_not(None))
    return stmt.where(Redemption.declined_at.is_not(None))


async def list_page(
    db: AsyncSession,
    principal: Principal,
    params: ListParams,
    *,
    state: str | None,
) -> tuple[list[StaffRedemptionOut], int]:
    """The payer's queue.

    "To pay" reads OLDEST first — it is a queue, and the one waiting longest is
    the one to pay next. Everything else reads newest first, as history does.
    """
    assert principal.company_id is not None
    stmt = _staff_base(principal.company_id)
    if state is not None:
        stmt = _in_state(stmt, state)
    if params.search and params.search.strip():
        term = f"%{params.search.strip()}%"
        stmt = stmt.where(
            or_(
                Redemption.code.ilike(term),
                Redemption.upi_id.ilike(term),
                User.full_name.ilike(term),
                TechnicianProfile.code.ilike(term),
            )
        )

    total = (
        await db.scalar(
            select(func.count()).select_from(
                stmt.with_only_columns(Redemption.id).subquery()
            )
        )
    ) or 0

    order = (
        (Redemption.created_at.asc(), Redemption.id.asc())
        if state == "to_pay"
        else (Redemption.created_at.desc(), Redemption.id.desc())
    )
    rows = (
        await db.execute(stmt.order_by(*order).offset(params.offset).limit(params.limit))
    ).all()

    out = []
    for row, tech_code, name, _phone in rows:
        denied = (
            _denied_at(await _events(db, row)) if state_of(row) == "awaiting" else None
        )
        out.append(
            StaffRedemptionOut(
                **_fields(row, denied),
                technicianId=row.technician_id,
                technicianName=name or row.payee_name,
                technicianCode=tech_code,
            )
        )
    return out, total


async def count_to_pay(db: AsyncSession, principal: Principal) -> int:
    assert principal.company_id is not None
    return (
        await db.scalar(
            select(func.count()).where(
                Redemption.company_id == principal.company_id,
                Redemption.claimed_at.is_(None),
                Redemption.declined_at.is_(None),
            )
        )
    ) or 0


async def staff_detail(
    db: AsyncSession, principal: Principal, redemption_id: uuid.UUID
) -> StaffRedemptionDetailOut:
    assert principal.company_id is not None
    found = (
        await db.execute(
            _staff_base(principal.company_id)
            .where(Redemption.id == redemption_id)
            # The read-back after `claim` / `decline` — see `my_detail`.
            .execution_options(populate_existing=True)
        )
    ).first()
    if found is None:
        raise _not_found()
    row, tech_code, name, phone = found
    events = await _events(db, row)
    state = state_of(row)
    return StaffRedemptionDetailOut(
        **_fields(row, _denied_at(events)),
        # Until it is settled or declined. Kept after a claim on purpose: a
        # payment that failed after the screenshot has to be payable again —
        # the console puts it behind a warning rather than taking it away.
        upiUri=await _upi_uri(db, row) if state in ("to_pay", "awaiting") else None,
        proofUrl=signed_url(row.proof_blob_name) if row.proof_blob_name else None,
        events=[_event_out(e) for e in events],
        technicianId=row.technician_id,
        technicianName=name or row.payee_name,
        technicianCode=tech_code,
        technicianPhone=phone,
    )


async def _load_for_staff(
    db: AsyncSession, principal: Principal, redemption_id: uuid.UUID
) -> Redemption:
    row = await db.scalar(
        select(Redemption).where(
            Redemption.company_id == principal.company_id,
            Redemption.id == redemption_id,
        )
    )
    if row is None:
        raise _not_found()
    return row


async def claim(
    db: AsyncSession,
    principal: Principal,
    redemption_id: uuid.UUID,
    body: ClaimRequest,
) -> StaffRedemptionDetailOut:
    """The payer says they paid. Repeatable until the technician confirms.

    A repeat overwrites the row's claim — the row is CURRENT state — and the
    trail keeps every one, with its own screenshot. Allowed because the reasons
    to claim again are ordinary: a mistyped UTR, a retried payment, or a nudge
    to a technician who has not looked. Nobody checks a UPI app unprompted.
    """
    assert principal.company_id is not None
    row = await _load_for_staff(db, principal, redemption_id)

    prefix = f"{_PROOF_PREFIX}/{principal.company_id}/"
    if not body.proof.blobName.startswith(prefix):
        raise AppError(
            422,
            "BAD_PROOF",
            "That screenshot was not uploaded here. Upload it again and retry.",
        )

    label = (principal.user.full_name or "").strip() or "—"
    now = _now()
    result = await db.execute(
        update(Redemption)
        .where(
            Redemption.company_id == principal.company_id,
            Redemption.id == row.id,
            Redemption.confirmed_at.is_(None),
            Redemption.declined_at.is_(None),
        )
        .values(
            claimed_at=now,
            claimed_by_user_id=principal.user_id,
            claimed_by_label=label[:120],
            utr=body.utr,
            proof_blob_name=body.proof.blobName,
            updated_by=principal.user_id,
        )
    )
    if result.rowcount == 0:
        raise _refused(
            "ALREADY_SETTLED",
            "This redemption is already settled or declined. Reload to see how.",
        )
    db.add(
        RedemptionEvent(
            company_id=principal.company_id,
            redemption_id=row.id,
            kind="claimed",
            actor_kind="staff",
            actor_label=label[:120],
            utr=body.utr,
            proof_blob_name=body.proof.blobName,
            note=body.proof.fileName,
            created_by=principal.user_id,
        )
    )
    await db.commit()

    await send_to_technician(
        db,
        company_id=principal.company_id,
        technician_id=row.technician_id,
        title=f"{_rupees(row.amount_paise)} paid to your UPI",
        body="Check your bank app and confirm you received it.",
        data={"type": "redemption", "redemptionId": str(row.id)},
    )
    return await staff_detail(db, principal, row.id)


async def decline(
    db: AsyncSession,
    principal: Principal,
    redemption_id: uuid.UUID,
    body: DeclineRequest,
) -> StaffRedemptionDetailOut:
    """Refuse a redemption before paying it. Frees the amount back to the balance.

    Only before a claim — once somebody has said they paid, money may have
    moved, and declining would free a sum that has already left.
    """
    assert principal.company_id is not None
    row = await _load_for_staff(db, principal, redemption_id)
    label = (principal.user.full_name or "").strip() or "—"
    reason = body.reason.strip()

    result = await db.execute(
        update(Redemption)
        .where(
            Redemption.company_id == principal.company_id,
            Redemption.id == row.id,
            Redemption.claimed_at.is_(None),
            Redemption.confirmed_at.is_(None),
            Redemption.declined_at.is_(None),
        )
        .values(
            declined_at=_now(),
            declined_by_user_id=principal.user_id,
            declined_by_label=label[:120],
            decline_reason=reason,
            updated_by=principal.user_id,
        )
    )
    if result.rowcount == 0:
        await db.refresh(row)
        if row.declined_at is not None:
            raise _refused("ALREADY_DECLINED", "This redemption is already declined.")
        raise _refused(
            "ALREADY_CLAIMED",
            "This has already been marked as paid, so it can't be declined.",
        )
    db.add(
        RedemptionEvent(
            company_id=principal.company_id,
            redemption_id=row.id,
            kind="declined",
            actor_kind="staff",
            actor_label=label[:120],
            note=reason,
            created_by=principal.user_id,
        )
    )
    await db.commit()

    await send_to_technician(
        db,
        company_id=principal.company_id,
        technician_id=row.technician_id,
        title="Redemption declined",
        body=reason,
        data={"type": "redemption", "redemptionId": str(row.id)},
    )
    return await staff_detail(db, principal, row.id)

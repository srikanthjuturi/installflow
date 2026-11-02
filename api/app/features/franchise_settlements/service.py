"""Company <-> franchisee transfers (Epic 1.2). Read `models/franchise_settlement.py`.

One service, two doors: the company's Admin / National Head (`router.py`) and
the franchisee's own admin (`portal_router.py`). `_side(principal)` is the only
place that decides which side a caller is, so the rule "the receiver confirms,
the sender cannot" lives once.
"""

import datetime
import uuid

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import documents
from app.core.deps import Principal
from app.core.errors import AppError
from app.core.schemas import ListParams
from app.core.sequences import next_code
from app.features.franchise_settlements.schemas import (
    FranchiseeOptionOut,
    RecordSettlementRequest,
    SettlementCountOut,
    SettlementOut,
    SettlementSummaryOut,
)
from app.integrations.blob import signed_url
from app.models.franchise_settlement import FranchiseSettlement
from app.models.franchisee import Franchisee
from app.models.transaction_document import TransactionDocument

_PROOF_PREFIX = "attachment"
COMPANY, FRANCHISEE = "company", "franchisee"
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
#: A transfer cannot be dated further back than a year - further than that is a
#: typo, and the statement would sort it nonsensically.
_MAX_AGE_DAYS = 366


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _not_found(what: str = "Settlement") -> AppError:
    # 404, never 403: another franchisee's or company's transfer does not exist
    # to the caller.
    return AppError(404, "NOT_FOUND", f"{what} not found")


def _refused(code: str, detail: str, status: int = 409) -> AppError:
    return AppError(status, code, detail)


def _label(principal: Principal) -> str:
    return ((principal.user.full_name or "").strip() or "—")[:120]


def _side(principal: Principal) -> str:
    """Which party the caller IS in these transfers."""
    return FRANCHISEE if principal.is_franchise else COMPANY


def _proof_ok(company_id: uuid.UUID, blob_name: str) -> bool:
    return blob_name.startswith(f"{_PROOF_PREFIX}/{company_id}/") and ".." not in blob_name


def state_of(row: FranchiseSettlement) -> str:
    if row.declined_at is not None:
        return "declined"
    if row.confirmed_at is not None:
        return "settled"
    return "awaiting"


def _receiver_of(direction: str) -> str:
    return FRANCHISEE if direction == "company_to_franchisee" else COMPANY


def waiting_on(row: FranchiseSettlement) -> str | None:
    """The RECEIVING side, while undecided."""
    if state_of(row) != "awaiting":
        return None
    return _receiver_of(row.direction)


def _scope(stmt: Select, principal: Principal, franchisee_id: uuid.UUID | None) -> Select:
    """Pin every read to the caller's company, and to its franchisee if it is one."""
    stmt = stmt.where(FranchiseSettlement.company_id == principal.company_id)
    if principal.is_franchise:
        return stmt.where(FranchiseSettlement.franchisee_id == principal.franchisee_id)
    if franchisee_id is not None:
        stmt = stmt.where(FranchiseSettlement.franchisee_id == franchisee_id)
    return stmt


async def _document_numbers(db: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = await db.execute(
        select(TransactionDocument.source_id, TransactionDocument.number).where(
            TransactionDocument.source_kind == "franchise_settlement",
            TransactionDocument.source_id.in_(ids),
        )
    )
    return {r.source_id: r.number for r in rows}


def _out(row: FranchiseSettlement, name: str, document_number: str | None) -> SettlementOut:
    proof = None
    if _proof_ok(row.company_id, row.proof_blob_name):
        proof = signed_url(row.proof_blob_name)
    return SettlementOut(
        id=row.id,
        code=row.code,
        franchiseeId=row.franchisee_id,
        franchiseeName=name,
        direction=row.direction,
        amountPaise=row.amount_paise,
        reason=row.reason,
        note=row.note,
        transferredOn=row.transferred_on,
        utr=row.utr,
        proofUrl=proof,
        state=state_of(row),
        waitingOn=waiting_on(row),
        recordedByLabel=row.recorded_by_label,
        createdAt=row.created_at,
        confirmedAt=row.confirmed_at,
        confirmedByLabel=row.confirmed_by_label,
        declinedAt=row.declined_at,
        declinedByLabel=row.declined_by_label,
        declineReason=row.decline_reason,
        documentNumber=document_number,
    )


async def _outs(db: AsyncSession, rows: list[FranchiseSettlement]) -> list[SettlementOut]:
    names: dict[uuid.UUID, str] = {}
    if rows:
        found = await db.execute(
            select(Franchisee.id, Franchisee.name).where(
                Franchisee.id.in_({r.franchisee_id for r in rows}),
                Franchisee.company_id == rows[0].company_id,
            )
        )
        names = {r.id: r.name for r in found}
    docs = await _document_numbers(db, [r.id for r in rows])
    return [_out(r, names.get(r.franchisee_id, "—"), docs.get(r.id)) for r in rows]


async def list_page(
    db: AsyncSession,
    principal: Principal,
    params: ListParams,
    *,
    state: str | None,
    direction: str | None,
    franchisee_id: uuid.UUID | None,
) -> tuple[list[SettlementOut], int]:
    stmt = _scope(select(FranchiseSettlement), principal, franchisee_id)
    if direction:
        stmt = stmt.where(FranchiseSettlement.direction == direction)
    if state == "awaiting":
        stmt = stmt.where(
            FranchiseSettlement.confirmed_at.is_(None),
            FranchiseSettlement.declined_at.is_(None),
        )
    elif state == "settled":
        stmt = stmt.where(FranchiseSettlement.confirmed_at.is_not(None))
    elif state == "declined":
        stmt = stmt.where(FranchiseSettlement.declined_at.is_not(None))
    if params.search:
        like = f"%{params.search.strip()}%"
        stmt = stmt.where(
            or_(FranchiseSettlement.code.ilike(like), FranchiseSettlement.utr.ilike(like))
        )
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(
            stmt.order_by(FranchiseSettlement.created_at.desc(), FranchiseSettlement.id)
            .offset(params.offset)
            .limit(params.limit)
        )
    ).all()
    return await _outs(db, list(rows)), total


async def _load(
    db: AsyncSession, principal: Principal, settlement_id: uuid.UUID
) -> FranchiseSettlement:
    row = await db.scalar(
        _scope(select(FranchiseSettlement), principal, None)
        .where(FranchiseSettlement.id == settlement_id)
        .with_for_update()
    )
    if row is None:
        raise _not_found()
    return row


async def detail(
    db: AsyncSession, principal: Principal, settlement_id: uuid.UUID
) -> SettlementOut:
    row = await db.scalar(
        _scope(select(FranchiseSettlement), principal, None).where(
            FranchiseSettlement.id == settlement_id
        )
    )
    if row is None:
        raise _not_found()
    return (await _outs(db, [row]))[0]


async def summary(
    db: AsyncSession, principal: Principal, franchisee_id: uuid.UUID | None
) -> SettlementSummaryOut:
    confirmed = FranchiseSettlement.confirmed_at.is_not(None)

    def total(direction: str):
        return func.coalesce(
            func.sum(FranchiseSettlement.amount_paise).filter(
                confirmed, FranchiseSettlement.direction == direction
            ),
            0,
        )

    awaiting = func.count().filter(
        FranchiseSettlement.confirmed_at.is_(None),
        FranchiseSettlement.declined_at.is_(None),
    )
    row = (
        await db.execute(
            _scope(
                select(total("company_to_franchisee"), total("franchisee_to_company"), awaiting),
                principal,
                franchisee_id,
            )
        )
    ).one()
    out, back, waiting = int(row[0]), int(row[1]), int(row[2])
    scoped = principal.franchisee_id if principal.is_franchise else franchisee_id
    return SettlementSummaryOut(
        franchiseeId=scoped,
        companyToFranchiseePaise=out,
        franchiseeToCompanyPaise=back,
        netPaise=out - back,
        awaitingCount=waiting,
    )


async def counts(db: AsyncSession, principal: Principal) -> SettlementCountOut:
    # The transfers waiting for THIS side to confirm: those the other side sent.
    direction = (
        "company_to_franchisee" if _side(principal) == FRANCHISEE else "franchisee_to_company"
    )
    n = await db.scalar(
        _scope(select(func.count()).select_from(FranchiseSettlement), principal, None).where(
            FranchiseSettlement.direction == direction,
            FranchiseSettlement.confirmed_at.is_(None),
            FranchiseSettlement.declined_at.is_(None),
        )
    )
    return SettlementCountOut(awaitingMe=int(n or 0))


async def _franchisee_for(
    db: AsyncSession, principal: Principal, wanted: uuid.UUID | None
) -> Franchisee:
    if principal.is_franchise:
        target = principal.franchisee_id
    else:
        if wanted is None:
            raise _refused("FRANCHISEE_REQUIRED", "Choose the franchisee.", 422)
        target = wanted
    franchisee = await db.scalar(
        select(Franchisee).where(
            Franchisee.id == target,
            Franchisee.company_id == principal.company_id,
            Franchisee.deleted_at.is_(None),
        )
    )
    if franchisee is None:
        raise _not_found("Franchisee")
    if franchisee.is_home:
        # The home franchisee IS the company; money between them is not a thing.
        raise _refused(
            "HOME_FRANCHISEE_NO_SETTLEMENT",
            "The home franchisee is the company itself, so there is nothing to settle.",
        )
    return franchisee


def _check_date(on: datetime.date) -> None:
    today = _now().astimezone(IST).date()
    if on > today:
        raise _refused("DATE_IN_FUTURE", "A transfer cannot be dated in the future.", 422)
    if (today - on).days > _MAX_AGE_DAYS:
        raise _refused("DATE_TOO_OLD", "That date is more than a year ago - check it.", 422)


async def record(
    db: AsyncSession, principal: Principal, body: RecordSettlementRequest
) -> SettlementOut:
    assert principal.company_id is not None
    franchisee = await _franchisee_for(db, principal, body.franchiseeId)
    _check_date(body.transferredOn)
    if not _proof_ok(principal.company_id, body.proof.blobName):
        raise _refused("INVALID_PROOF", "Upload the screenshot again.", 422)
    if body.reason == "other" and not body.note:
        raise _refused("NOTE_REQUIRED", "Say what this transfer was for.", 422)

    direction = (
        "franchisee_to_company" if _side(principal) == FRANCHISEE else "company_to_franchisee"
    )
    row = FranchiseSettlement(
        company_id=principal.company_id,
        franchisee_id=franchisee.id,
        code=await next_code(db, principal.company_id, "franchise_settlement"),
        direction=direction,
        amount_paise=body.amountPaise,
        reason=body.reason,
        note=body.note,
        transferred_on=body.transferredOn,
        utr=body.utr,
        proof_blob_name=body.proof.blobName,
        recorded_by_user_id=principal.user_id,
        recorded_by_label=_label(principal),
        created_by=principal.user_id,
    )
    db.add(row)
    await db.flush()
    await db.commit()
    return (await _outs(db, [row]))[0]


def _must_be_receiver(principal: Principal, row: FranchiseSettlement) -> None:
    if _side(principal) != _receiver_of(row.direction):
        # The sender cannot say their own money arrived - the whole point.
        raise _refused(
            "NOT_THE_RECEIVER",
            "Only the side that received this transfer can confirm or decline it.",
            403,
        )


async def confirm(
    db: AsyncSession, principal: Principal, settlement_id: uuid.UUID
) -> SettlementOut:
    row = await _load(db, principal, settlement_id)
    _must_be_receiver(principal, row)
    if row.confirmed_at is not None:  # idempotent: a button on a bad connection
        return (await _outs(db, [row]))[0]
    if row.declined_at is not None:
        raise _refused("ALREADY_DECLINED", "This transfer was declined.")
    row.confirmed_at = _now()
    row.confirmed_by_user_id = principal.user_id
    row.confirmed_by_label = _label(principal)
    row.updated_by = principal.user_id
    franchisee = await db.get(Franchisee, row.franchisee_id)
    # Epic 1.3: the company paying out is a `payment`; money reaching the company
    # is a `receipt` - issued in the SAME transaction as the confirmation.
    paid_out = row.direction == "company_to_franchisee"
    await documents.issue(
        db,
        company_id=row.company_id,
        doc_type="payment" if paid_out else "receipt",
        party_kind="franchisee",
        party_id=row.franchisee_id,
        party_label=franchisee.name if franchisee else "—",
        amount_paise=row.amount_paise,
        source_kind="franchise_settlement",
        source_id=row.id,
        description=f"Transfer {row.code} ({row.reason.replace('_', ' ')})",
        issued_at=row.confirmed_at,
        note=row.note,
        proof_blob_name=row.proof_blob_name,
        proof_reference=row.utr,
        created_by=principal.user_id,
    )
    await db.commit()
    return (await _outs(db, [row]))[0]


async def decline(
    db: AsyncSession, principal: Principal, settlement_id: uuid.UUID, reason: str
) -> SettlementOut:
    row = await _load(db, principal, settlement_id)
    _must_be_receiver(principal, row)
    if row.confirmed_at is not None:
        # Once confirmed it is a fact about money, and a document exists for it.
        raise _refused("ALREADY_CONFIRMED", "This transfer was already confirmed.")
    if row.declined_at is not None:
        return (await _outs(db, [row]))[0]
    row.declined_at = _now()
    row.declined_by_user_id = principal.user_id
    row.declined_by_label = _label(principal)
    row.decline_reason = reason.strip()[:160]
    row.updated_by = principal.user_id
    await db.commit()
    return (await _outs(db, [row]))[0]


async def franchisee_options(
    db: AsyncSession, principal: Principal
) -> list[FranchiseeOptionOut]:
    """The non-home franchisees a company can settle with, for the record form."""
    rows = await db.execute(
        select(Franchisee.id, Franchisee.name)
        .where(
            Franchisee.company_id == principal.company_id,
            Franchisee.is_home.is_(False),
            Franchisee.deleted_at.is_(None),
        )
        .order_by(Franchisee.name)
    )
    return [FranchiseeOptionOut(id=r.id, name=r.name) for r in rows]

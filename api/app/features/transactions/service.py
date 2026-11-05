"""Reading the numbered documents: the dashboard, statements and roll-ups.

Four kinds of reader, one query: `scope()` turns the caller into WHERE clauses
and is the only place that decides who may see what.

    superadmin      every company (optionally narrowed with `companyId`)
    Admin / NH      their own company (feature `finance.transactions`)
    vendor          only documents naming THEIR vendor (the primary vendor
                    login; a vendor's sub-user sees none - it is the vendor's
                    account, not a person's)
    franchisee      documents naming their franchisee, and their technicians'
    admin           (feature `franchise.documents`)

Anyone else is 403. A document that is not in the caller's scope answers 404,
the same as one in another company.
"""

import datetime
import uuid
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import account_statements as acct
from app.core.deps import Principal
from app.core.errors import AppError
from app.core.features import effective_features
from app.core.schemas import ListParams
from app.features.transactions.schemas import (
    CompanyRollupOut,
    DocumentOut,
    PartyOptionOut,
    StatementLineOut,
    StatementOut,
    TransactionSummaryOut,
    TypeTotalOut,
)
from app.integrations.blob import signed_url
from app.models.company import Company
from app.models.role import ADMIN, FRANCHISEE_ADMIN, NATIONAL_HEAD, VENDOR
from app.models.technician import TechnicianProfile
from app.models.ticket import Ticket
from app.models.transaction_document import DOC_TYPES, PARTY_KINDS, TransactionDocument

IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
_PROOF_PREFIX = "attachment"
#: The most a statement may span. Longer than this is a typo, and a CSV of
#: several years of one vendor's invoices is not what anybody wants to scroll.
_MAX_SPAN_DAYS = 3 * 366


def _forbidden() -> HTTPException:
    return HTTPException(status_code=403, detail="You cannot view transactions")


@dataclass(frozen=True)
class Scope:
    conditions: list
    #: True only for the superadmin, who may name a company.
    all_companies: bool
    company_id: uuid.UUID | None


async def scope(db: AsyncSession, principal: Principal, company_id: uuid.UUID | None) -> Scope:
    if principal.is_superadmin:
        conds = [TransactionDocument.company_id == company_id] if company_id else []
        return Scope(conds, True, company_id)
    if principal.company_id is None:
        raise _forbidden()
    cid = principal.company_id
    base = [TransactionDocument.company_id == cid]
    features = await effective_features(db, role=principal.role, company_id=cid)

    if principal.role in (ADMIN, NATIONAL_HEAD):
        if "finance.transactions" not in features:
            raise _forbidden()
        return Scope(base, False, cid)
    if principal.role == VENDOR and principal.vendor_id is not None:
        return Scope(
            base
            + [
                TransactionDocument.party_kind == "vendor",
                TransactionDocument.vendor_id == principal.vendor_id,
            ],
            False,
            cid,
        )
    if principal.role == FRANCHISEE_ADMIN and principal.franchisee_id is not None:
        if "franchise.documents" not in features:
            raise _forbidden()
        own_technicians = select(TechnicianProfile.id).where(
            TechnicianProfile.company_id == cid,
            TechnicianProfile.franchisee_id == principal.franchisee_id,
        )
        return Scope(
            base
            + [
                or_(
                    TransactionDocument.franchisee_id == principal.franchisee_id,
                    TransactionDocument.technician_id.in_(own_technicians),
                )
            ],
            False,
            cid,
        )
    raise _forbidden()


def day_start(day: datetime.date) -> datetime.datetime:
    return datetime.datetime.combine(day, datetime.time.min, tzinfo=IST).astimezone(
        datetime.timezone.utc
    )


def _filters(
    scoped: Scope,
    *,
    start: datetime.date | None,
    end: datetime.date | None,
    doc_type: str | None,
    party_kind: str | None,
    party_id: uuid.UUID | None,
    search: str | None,
) -> list:
    conds = list(scoped.conditions)
    if start:
        conds.append(TransactionDocument.issued_at >= day_start(start))
    if end:
        conds.append(TransactionDocument.issued_at < day_start(end + datetime.timedelta(days=1)))
    if doc_type:
        conds.append(TransactionDocument.doc_type == doc_type)
    if party_kind:
        conds.append(TransactionDocument.party_kind == party_kind)
    if party_id:
        conds.append(
            or_(
                TransactionDocument.vendor_id == party_id,
                TransactionDocument.franchisee_id == party_id,
                TransactionDocument.technician_id == party_id,
            )
        )
    if search and search.strip():
        like = f"%{search.strip()}%"
        conds.append(
            or_(
                TransactionDocument.number.ilike(like),
                TransactionDocument.party_label.ilike(like),
                TransactionDocument.description.ilike(like),
                TransactionDocument.proof_reference.ilike(like),
            )
        )
    return conds


def _proof_url(row: TransactionDocument) -> str | None:
    name = row.proof_blob_name
    if not name:
        return None
    # Checked again on the way OUT, as every proof is: a link is signed only for a
    # blob that is provably this company's.
    if not name.startswith(f"{_PROOF_PREFIX}/{row.company_id}/") or ".." in name:
        return None
    return signed_url(name)


async def _out(db: AsyncSession, rows: list[TransactionDocument]) -> list[DocumentOut]:
    names: dict[uuid.UUID, str] = {}
    codes: dict[uuid.UUID, str] = {}
    if rows:
        found = await db.execute(
            select(Company.id, Company.name).where(
                Company.id.in_({r.company_id for r in rows})
            )
        )
        names = {r.id: r.name for r in found}
        ticket_ids = {r.ticket_id for r in rows if r.ticket_id}
        if ticket_ids:
            found_t = await db.execute(
                select(Ticket.id, Ticket.code).where(Ticket.id.in_(ticket_ids))
            )
            codes = {r.id: r.code for r in found_t}
    return [
        DocumentOut(
            id=r.id,
            number=r.number,
            docType=r.doc_type,
            companyId=r.company_id,
            companyName=names.get(r.company_id, "—"),
            partyKind=r.party_kind,
            partyId=r.vendor_id or r.franchisee_id or r.technician_id,
            partyLabel=r.party_label,
            effect=r.party_effect,
            amountPaise=r.amount_paise,
            ticketId=r.ticket_id,
            ticketCode=codes.get(r.ticket_id) if r.ticket_id else None,
            description=r.description,
            note=r.note,
            issuedAt=r.issued_at,
            proofUrl=_proof_url(r),
            proofReference=r.proof_reference,
            relatedDocumentId=r.related_document_id,
            emailStatus=r.email_status,
            emailedAt=r.emailed_at,
        )
        for r in rows
    ]


async def list_page(
    db: AsyncSession,
    principal: Principal,
    params: ListParams,
    *,
    company_id: uuid.UUID | None,
    start: datetime.date | None,
    end: datetime.date | None,
    doc_type: str | None,
    party_kind: str | None,
    party_id: uuid.UUID | None,
) -> tuple[list[DocumentOut], int]:
    scoped = await scope(db, principal, company_id)
    conds = _filters(
        scoped,
        start=start,
        end=end,
        doc_type=doc_type,
        party_kind=party_kind,
        party_id=party_id,
        search=params.search,
    )
    stmt = select(TransactionDocument).where(*conds)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(
            stmt.order_by(TransactionDocument.issued_at.desc(), TransactionDocument.id)
            .offset(params.offset)
            .limit(params.limit)
        )
    ).all()
    return await _out(db, list(rows)), int(total)


async def detail(
    db: AsyncSession, principal: Principal, document_id: uuid.UUID
) -> DocumentOut:
    scoped = await scope(db, principal, None)
    row = await db.scalar(
        select(TransactionDocument).where(TransactionDocument.id == document_id, *scoped.conditions)
    )
    if row is None:
        raise AppError(404, "NOT_FOUND", "Document not found")
    return (await _out(db, [row]))[0]


async def summary(
    db: AsyncSession,
    principal: Principal,
    *,
    company_id: uuid.UUID | None,
    start: datetime.date | None,
    end: datetime.date | None,
    doc_type: str | None,
    party_kind: str | None,
    party_id: uuid.UUID | None,
    search: str | None,
) -> TransactionSummaryOut:
    scoped = await scope(db, principal, company_id)
    conds = _filters(
        scoped,
        start=start,
        end=end,
        doc_type=doc_type,
        party_kind=party_kind,
        party_id=party_id,
        search=search,
    )
    rows = await db.execute(
        select(
            TransactionDocument.doc_type,
            TransactionDocument.party_effect,
            func.count(),
            func.coalesce(func.sum(TransactionDocument.amount_paise), 0),
        )
        .where(*conds)
        .group_by(TransactionDocument.doc_type, TransactionDocument.party_effect)
    )
    per_type: dict[str, list[int]] = {t: [0, 0] for t in DOC_TYPES}
    debit = credit = count = 0
    for doc_type_, effect, n, total in rows.all():
        per_type[doc_type_][0] += int(n)
        per_type[doc_type_][1] += int(total)
        count += int(n)
        if effect == "debit":
            debit += int(total)
        else:
            credit += int(total)
    return TransactionSummaryOut(
        byType=[
            TypeTotalOut(docType=t, count=v[0], totalPaise=v[1]) for t, v in per_type.items()
        ],
        count=count,
        debitPaise=debit,
        creditPaise=credit,
        netPaise=debit - credit,
    )


async def parties(
    db: AsyncSession,
    principal: Principal,
    *,
    company_id: uuid.UUID | None,
    party_kind: str | None,
    search: str | None,
) -> list[PartyOptionOut]:
    """Who has documents -- the filter's options, so it never offers an empty party."""
    scoped = await scope(db, principal, company_id)
    stmt = (
        select(
            TransactionDocument.party_kind,
            TransactionDocument.vendor_id,
            TransactionDocument.franchisee_id,
            TransactionDocument.technician_id,
            func.max(TransactionDocument.party_label),
        )
        .where(*scoped.conditions)
        .group_by(
            TransactionDocument.party_kind,
            TransactionDocument.vendor_id,
            TransactionDocument.franchisee_id,
            TransactionDocument.technician_id,
        )
        .order_by(func.max(TransactionDocument.party_label))
        .limit(200)
    )
    if party_kind:
        stmt = stmt.where(TransactionDocument.party_kind == party_kind)
    if search and search.strip():
        stmt = stmt.where(TransactionDocument.party_label.ilike(f"%{search.strip()}%"))
    out = []
    for kind, vid, fid, tid, label in (await db.execute(stmt)).all():
        out.append(PartyOptionOut(partyKind=kind, partyId=vid or fid or tid, label=label))
    return out


def _check_period(start: datetime.date, end: datetime.date) -> None:
    if end < start:
        raise AppError(422, "BAD_PERIOD", "The end date is before the start date.")
    if (end - start).days > _MAX_SPAN_DAYS:
        raise AppError(422, "PERIOD_TOO_LONG", "Pick a period of three years or less.")


async def statement(
    db: AsyncSession,
    principal: Principal,
    *,
    company_id: uuid.UUID | None,
    party_kind: str,
    party_id: uuid.UUID | None,
    start: datetime.date,
    end: datetime.date,
) -> StatementOut:
    if party_kind not in PARTY_KINDS:
        raise AppError(422, "BAD_PARTY", "Unknown party kind.")
    _check_period(start, end)
    scoped = await scope(db, principal, company_id)
    cid = scoped.company_id
    if cid is None:
        # The superadmin must say which company's books: a statement across
        # companies would add up money that was never in one account.
        raise AppError(422, "COMPANY_REQUIRED", "Choose a company.")
    if party_kind == "platform":
        if party_id is not None:
            raise AppError(422, "BAD_PARTY", "The platform has no id.")
        party_cond = TransactionDocument.party_kind == "platform"
    else:
        if party_id is None:
            raise AppError(422, "BAD_PARTY", "Choose the party.")
        column = {
            "vendor": TransactionDocument.vendor_id,
            "franchisee": TransactionDocument.franchisee_id,
            "technician": TransactionDocument.technician_id,
        }[party_kind]
        party_cond = column == party_id

    base = [*scoped.conditions, party_cond]
    signed = func.coalesce(
        func.sum(
            case(
                (TransactionDocument.party_effect == "debit", TransactionDocument.amount_paise),
                else_=-TransactionDocument.amount_paise,
            )
        ),
        0,
    )
    opening = int(
        await db.scalar(
            select(signed).where(*base, TransactionDocument.issued_at < day_start(start))
        )
        or 0
    )
    rows = (
        await db.scalars(
            select(TransactionDocument)
            .where(
                *base,
                TransactionDocument.issued_at >= day_start(start),
                TransactionDocument.issued_at < day_start(end + datetime.timedelta(days=1)),
            )
            .order_by(TransactionDocument.issued_at, TransactionDocument.id)
        )
    ).all()
    company_name = await db.scalar(select(Company.name).where(Company.id == cid)) or "—"
    label = rows[0].party_label if rows else await _party_label(db, cid, party_kind, party_id)
    built = acct.build(
        opening,
        [
            acct.Line(
                number=r.number,
                doc_type=r.doc_type,
                issued_at=r.issued_at,
                description=r.description,
                effect=r.party_effect,
                amount_paise=r.amount_paise,
                reference=r.proof_reference,
            )
            for r in rows
        ],
    )
    return StatementOut(
        companyId=cid,
        companyName=company_name,
        partyKind=party_kind,
        partyId=party_id,
        partyLabel=label,
        start=start,
        end=end,
        openingPaise=built.opening_paise,
        totalDebitPaise=built.total_debit_paise,
        totalCreditPaise=built.total_credit_paise,
        closingPaise=built.closing_paise,
        lines=[
            StatementLineOut(
                documentId=rows[i].id,
                number=sl.line.number,
                docType=sl.line.doc_type,
                issuedAt=sl.line.issued_at,
                description=sl.line.description,
                reference=sl.line.reference,
                debitPaise=sl.debit_paise,
                creditPaise=sl.credit_paise,
                balancePaise=sl.balance_paise,
            )
            for i, sl in enumerate(built.lines)
        ],
    )


async def _party_label(
    db: AsyncSession, company_id: uuid.UUID, kind: str, party_id: uuid.UUID | None
) -> str:
    if kind == "platform":
        return "Platform"
    label = await db.scalar(
        select(func.max(TransactionDocument.party_label)).where(
            TransactionDocument.company_id == company_id,
            {
                "vendor": TransactionDocument.vendor_id,
                "franchisee": TransactionDocument.franchisee_id,
                "technician": TransactionDocument.technician_id,
            }[kind]
            == party_id,
        )
    )
    return label or kind.title()


def statement_csv(st: StatementOut) -> tuple[str, str]:
    """(file name, text) for a statement already built by `statement()`."""
    built = acct.Statement(
        opening_paise=st.openingPaise,
        lines=[
            acct.StatementLine(
                acct.Line(
                    number=l.number,
                    doc_type=l.docType,
                    issued_at=l.issuedAt,
                    description=l.description,
                    effect="debit" if l.debitPaise else "credit",
                    amount_paise=l.debitPaise or l.creditPaise,
                    reference=l.reference,
                ),
                l.debitPaise,
                l.creditPaise,
                l.balancePaise,
            )
            for l in st.lines
        ],
        total_debit_paise=st.totalDebitPaise,
        total_credit_paise=st.totalCreditPaise,
    )
    text = acct.build_csv(
        company_name=st.companyName,
        party_kind=st.partyKind,
        party_label=st.partyLabel,
        start=st.start,
        end=st.end,
        statement=built,
    )
    return acct.filename(st.partyLabel, st.start, st.end), text


async def company_rollup(
    db: AsyncSession,
    principal: Principal,
    *,
    start: datetime.date,
    end: datetime.date,
) -> list[CompanyRollupOut]:
    """Superadmin: every company's totals for the period, side by side."""
    if not principal.is_superadmin:
        raise _forbidden()
    _check_period(start, end)
    rows = await db.execute(
        select(
            Company.id,
            Company.name,
            func.count(TransactionDocument.id),
            func.coalesce(
                func.sum(
                    case(
                        (TransactionDocument.party_effect == "debit", TransactionDocument.amount_paise),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (TransactionDocument.party_effect == "credit", TransactionDocument.amount_paise),
                        else_=0,
                    )
                ),
                0,
            ),
        )
        .select_from(Company)
        .outerjoin(
            TransactionDocument,
            and_(
                TransactionDocument.company_id == Company.id,
                TransactionDocument.issued_at >= day_start(start),
                TransactionDocument.issued_at < day_start(end + datetime.timedelta(days=1)),
            ),
        )
        .where(Company.deleted_at.is_(None))
        .group_by(Company.id, Company.name)
        .order_by(Company.name)
    )
    return [
        CompanyRollupOut(
            companyId=cid,
            companyName=name,
            documents=int(n),
            debitPaise=int(d),
            creditPaise=int(c),
            netPaise=int(d) - int(c),
        )
        for cid, name, n, d, c in rows.all()
    ]

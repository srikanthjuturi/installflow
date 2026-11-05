"""Issuing a numbered document -- the one door every money flow goes through.

`issue()` is called INSIDE the transaction of the change it documents (a vendor
charged at closure, a payment confirmed, a penalty reversed). A document that
can disagree with its ledger is worse than none, so it commits or rolls back
with it, and never commits on its own. See `models/transaction_document.py`.

## Idempotent

`(company_id, source_kind, source_id, doc_type)` is UNIQUE, so a retried closure
or a backfill run twice returns the document already issued rather than a second
one. The existing row is looked up first so a repeat does not burn a number from
the series; the unique constraint, caught under a SAVEPOINT, settles the race
where two callers both found nothing.

## Direction

`DEFAULT_EFFECT` is the usual answer to "does this raise or reduce what the party
owes the company". It is a default, not a rule: the caller states `effect` when
the usual answer is wrong for its flow.
"""

import datetime
import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import sequences
from app.models.transaction_document import (
    DOC_TYPES,
    PARTY_EFFECTS,
    PARTY_KINDS,
    SOURCE_KINDS,
    TransactionDocument,
)

#: From the PARTY'S account in the company's books: `debit` adds to what they
#: owe the company, `credit` reduces it (or adds to what the company owes them).
DEFAULT_EFFECT: dict[str, str] = {
    "sales_invoice": "debit",  # the vendor is billed
    "debit_note": "debit",  # a further charge on the same account
    "payment": "debit",  # the company paid the party out
    "receipt": "credit",  # the party paid the company
    "credit_note": "credit",  # a charge given back
    "purchase_note": "credit",  # the company bought from the party
}


async def vendor_label(db: AsyncSession, company_id: uuid.UUID, vendor_id: uuid.UUID) -> str:
    """The vendor's name as it should read on a document issued now."""
    from app.models.vendor import Vendor

    name = await db.scalar(
        select(Vendor.name).where(Vendor.id == vendor_id, Vendor.company_id == company_id)
    )
    return name or "Vendor"


async def ticket_code(db: AsyncSession, company_id: uuid.UUID, ticket_id: uuid.UUID) -> str:
    from app.models.ticket import Ticket

    code = await db.scalar(
        select(Ticket.code).where(Ticket.id == ticket_id, Ticket.company_id == company_id)
    )
    return code or "ticket"


class DocumentError(ValueError):
    """The caller described a document that could never be valid."""


def sequence_name(doc_type: str) -> str:
    """The `core.sequences` series for a document type."""
    if doc_type not in DOC_TYPES:
        raise DocumentError(f"unknown document type {doc_type!r}")
    return f"doc_{doc_type}"


def party_columns(
    party_kind: str, party_id: uuid.UUID | None
) -> dict[str, uuid.UUID | None]:
    """The one FK column that matches `party_kind`, the others None.

    Mirrors the table's `party_matches_kind` CHECK so a mistake is a clear error
    here instead of an IntegrityError from the database.
    """
    if party_kind not in PARTY_KINDS:
        raise DocumentError(f"unknown party kind {party_kind!r}")
    columns: dict[str, uuid.UUID | None] = {
        "vendor_id": None,
        "franchisee_id": None,
        "technician_id": None,
    }
    if party_kind == "platform":
        if party_id is not None:
            raise DocumentError("the platform has no party id")
        return columns
    if party_id is None:
        raise DocumentError(f"a {party_kind} document needs a party id")
    columns[f"{party_kind}_id"] = party_id
    return columns


async def issue(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    doc_type: str,
    party_kind: str,
    party_id: uuid.UUID | None,
    party_label: str,
    amount_paise: int,
    source_kind: str,
    source_id: uuid.UUID,
    description: str,
    effect: str | None = None,
    ticket_id: uuid.UUID | None = None,
    related_document_id: uuid.UUID | None = None,
    issued_at: datetime.datetime | None = None,
    note: str | None = None,
    proof_blob_name: str | None = None,
    proof_reference: str | None = None,
    created_by: uuid.UUID | None = None,
) -> TransactionDocument:
    """Issue the document, or return the one already issued for this source."""
    if amount_paise <= 0:
        raise DocumentError("a document is for a positive amount")
    if source_kind not in SOURCE_KINDS:
        raise DocumentError(f"unknown source kind {source_kind!r}")
    effect = effect or DEFAULT_EFFECT[doc_type]
    if effect not in PARTY_EFFECTS:
        raise DocumentError(f"unknown effect {effect!r}")
    series = sequence_name(doc_type)
    columns = party_columns(party_kind, party_id)

    existing = await _by_source(db, company_id, source_kind, source_id, doc_type)
    if existing is not None:
        return existing

    number = await sequences.next_code(db, company_id, series)
    row = TransactionDocument(
        company_id=company_id,
        doc_type=doc_type,
        number=number,
        party_kind=party_kind,
        party_label=party_label[:160],
        party_effect=effect,
        amount_paise=amount_paise,
        ticket_id=ticket_id,
        related_document_id=related_document_id,
        source_kind=source_kind,
        source_id=source_id,
        description=description[:240],
        note=note,
        proof_blob_name=proof_blob_name,
        proof_reference=proof_reference,
        created_by=created_by,
        **columns,
    )
    if issued_at is not None:
        row.issued_at = issued_at

    try:
        # A SAVEPOINT, so losing the race rolls back this insert alone and not
        # the ledger change the caller is in the middle of.
        async with db.begin_nested():
            db.add(row)
            await db.flush()
    except IntegrityError:
        winner = await _by_source(db, company_id, source_kind, source_id, doc_type)
        if winner is None:
            raise
        return winner
    return row


async def _by_source(
    db: AsyncSession,
    company_id: uuid.UUID,
    source_kind: str,
    source_id: uuid.UUID,
    doc_type: str,
) -> TransactionDocument | None:
    return await db.scalar(
        select(TransactionDocument).where(
            TransactionDocument.company_id == company_id,
            TransactionDocument.source_kind == source_kind,
            TransactionDocument.source_id == source_id,
            TransactionDocument.doc_type == doc_type,
        )
    )

"""The Transactions dashboard's shapes (Epic 1.5 / 1.6)."""

import datetime
import uuid
from typing import Literal

from app.core.schemas import AppModel

DocType = Literal[
    "sales_invoice", "receipt", "payment", "debit_note", "credit_note", "purchase_note"
]
PartyKind = Literal["vendor", "franchisee", "technician", "platform"]


class DocumentOut(AppModel):
    id: uuid.UUID
    number: str
    docType: DocType
    companyId: uuid.UUID
    companyName: str
    partyKind: PartyKind
    partyId: uuid.UUID | None
    partyLabel: str
    #: `debit` raises what the party owes the company; `credit` reduces it.
    effect: Literal["debit", "credit"]
    amountPaise: int
    ticketId: uuid.UUID | None
    ticketCode: str | None
    description: str
    note: str | None
    issuedAt: datetime.datetime
    proofUrl: str | None
    proofReference: str | None
    relatedDocumentId: uuid.UUID | None
    emailStatus: Literal["pending", "sent", "failed", "skipped"]
    emailedAt: datetime.datetime | None


class TypeTotalOut(AppModel):
    docType: DocType
    count: int
    totalPaise: int


class TransactionSummaryOut(AppModel):
    byType: list[TypeTotalOut]
    count: int
    debitPaise: int
    creditPaise: int
    #: debit - credit over the filtered documents.
    netPaise: int


class PartyOptionOut(AppModel):
    partyKind: PartyKind
    partyId: uuid.UUID | None
    label: str


class StatementLineOut(AppModel):
    documentId: uuid.UUID
    number: str
    docType: DocType
    issuedAt: datetime.datetime
    description: str
    reference: str | None
    debitPaise: int
    creditPaise: int
    balancePaise: int


class StatementOut(AppModel):
    companyId: uuid.UUID
    companyName: str
    partyKind: PartyKind
    partyId: uuid.UUID | None
    partyLabel: str
    start: datetime.date
    end: datetime.date
    openingPaise: int
    totalDebitPaise: int
    totalCreditPaise: int
    closingPaise: int
    lines: list[StatementLineOut]


class CompanyRollupOut(AppModel):
    """One company's account with each party kind over a period -- the
    super-admin's 'statements for all companies'."""

    companyId: uuid.UUID
    companyName: str
    documents: int
    debitPaise: int
    creditPaise: int
    netPaise: int


class RequeueOut(AppModel):
    """How many documents were put back in the queue to be emailed."""

    queued: int

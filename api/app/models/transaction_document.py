"""The numbered paper trail over the money ledgers: invoices, receipts, notes.

`ledger_entries`, `credit_entries`, `vendor_credit_entries` and `redemptions`
say WHAT moved. This table says WHICH NUMBERED DOCUMENT a person can quote
about it -- `RGT-INV-0001` -- and is what the Transactions dashboard, the
statements and the invoice emails read. Internal documents only: there are no
tax fields, by decision, and none should be added without asking.

## Append-only

Nothing updates or deletes a row. A mistake is corrected by a LATER document
(a credit note offsetting an invoice, `related_document_id` pointing back), so
the trail never disagrees with what was once told to somebody. The one column
that changes after insert is the email bookkeeping (`emailed_at`,
`email_status`), which is about delivery, not about the document.

## Idempotent by its source

`(company_id, source_kind, source_id, doc_type)` is UNIQUE. A closure retried
after a timeout, or a backfill run twice, cannot issue a second invoice for the
same ledger row -- the second insert is a conflict the issuer treats as "already
issued".

## One party, with a real foreign key per kind

The counter-party is a vendor, a franchisee, a technician, or the platform
(whose books a company's credit purchase lands in). A polymorphic
`(kind, id)` pair cannot carry a foreign key, and a tenant table without one is
how a document ends up naming another company's vendor. So there is a nullable
column per kind, each a COMPOSITE FK on `(company_id, ...)`, and a CHECK that
exactly the column matching `party_kind` is set.

## Debit and credit

`party_effect` is stated from the PARTY'S account in the company's books:
`debit` adds to what the party owes the company, `credit` reduces it (or adds
to what the company owes them). It is stored rather than derived from
`doc_type` because a payment can mean the company paying out or a note can sit
on either side; the hook that issues the document knows, and a later reader
should not have to guess. `core.documents.DEFAULT_EFFECT` is the usual answer.
"""

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

DOC_TYPES = (
    "sales_invoice",
    "receipt",
    "payment",
    "debit_note",
    "credit_note",
    "purchase_note",
)

PARTY_KINDS = ("vendor", "franchisee", "technician", "platform")

PARTY_EFFECTS = ("debit", "credit")

#: Which ledger row (or ticket) caused the document. Not a foreign key -- the
#: rows live in different tables -- which is what the UNIQUE below is for.
SOURCE_KINDS = (
    "ticket",
    "vendor_credit_entry",
    "credit_entry",
    "ledger_entry",
    "redemption",
    "franchise_settlement",
    "manual",
)

EMAIL_STATUSES = ("pending", "sent", "failed", "skipped")


def _in(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


class TransactionDocument(Base, IdMixin, AuditMixin):
    __tablename__ = "transaction_documents"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    doc_type: Mapped[str] = mapped_column(String(16), nullable=False)
    #: `RGT-INV-0001`, from `core.sequences`. One series per type per company.
    number: Mapped[str] = mapped_column(String(32), nullable=False)

    party_kind: Mapped[str] = mapped_column(String(12), nullable=False)
    #: Exactly one of these three is set, matching `party_kind`; all null for
    #: `platform`. Composite FKs -- see __table_args__.
    vendor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    franchisee_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    technician_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    #: The party's name when the document was issued, frozen: a renamed vendor
    #: must not rewrite a document already emailed.
    party_label: Mapped[str] = mapped_column(String(160), nullable=False)

    party_effect: Mapped[str] = mapped_column(String(8), nullable=False)
    #: PAISE, always positive; direction is `party_effect`.
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)

    #: The ticket this is about, when there is one (an invoice, a debit note).
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    #: The document this one offsets or settles (a credit note -> its invoice).
    related_document_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)

    source_kind: Mapped[str] = mapped_column(String(24), nullable=False)
    #: The id of the ledger row / ticket. For `manual` a fresh UUID, so a manual
    #: document is never mistaken for a duplicate of another.
    source_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    issued_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    #: A human line for statements: "Ticket RGT-INST-0042 closed".
    description: Mapped[str] = mapped_column(String(240), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: Payment evidence. Blob name, never a URL (signed on read, as redemption
    #: proofs are), and the bank reference (UTR / cheque no.).
    proof_blob_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    proof_reference: Mapped[str | None] = mapped_column(String(64), nullable=True)

    #: Delivery bookkeeping for the invoice email (Epic 1.7). The only columns
    #: that are ever updated.
    email_status: Mapped[str] = mapped_column(
        String(8), nullable=False, server_default="pending"
    )
    emailed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_transaction_documents_company_id_id"),
        UniqueConstraint("company_id", "number", name="uq_transaction_documents_company_number"),
        UniqueConstraint(
            "company_id",
            "source_kind",
            "source_id",
            "doc_type",
            name="uq_transaction_documents_source",
        ),
        ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_transaction_documents_vendor",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "franchisee_id"],
            ["franchisees.company_id", "franchisees.id"],
            name="fk_transaction_documents_franchisee",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_transaction_documents_technician",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_transaction_documents_ticket",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "related_document_id"],
            ["transaction_documents.company_id", "transaction_documents.id"],
            name="fk_transaction_documents_related",
            ondelete="RESTRICT",
        ),
        CheckConstraint(f"doc_type IN ({_in(DOC_TYPES)})", name="doc_type"),
        CheckConstraint(f"party_kind IN ({_in(PARTY_KINDS)})", name="party_kind"),
        CheckConstraint(f"party_effect IN ({_in(PARTY_EFFECTS)})", name="party_effect"),
        CheckConstraint(f"source_kind IN ({_in(SOURCE_KINDS)})", name="source_kind"),
        CheckConstraint(f"email_status IN ({_in(EMAIL_STATUSES)})", name="email_status"),
        CheckConstraint("amount_paise > 0", name="amount_paise"),
        # Exactly the column matching the kind is set.
        CheckConstraint(
            "(party_kind = 'vendor' AND vendor_id IS NOT NULL "
            "AND franchisee_id IS NULL AND technician_id IS NULL) "
            "OR (party_kind = 'franchisee' AND franchisee_id IS NOT NULL "
            "AND vendor_id IS NULL AND technician_id IS NULL) "
            "OR (party_kind = 'technician' AND technician_id IS NOT NULL "
            "AND vendor_id IS NULL AND franchisee_id IS NULL) "
            "OR (party_kind = 'platform' AND vendor_id IS NULL "
            "AND franchisee_id IS NULL AND technician_id IS NULL)",
            name="party_matches_kind",
        ),
        CheckConstraint(
            "related_document_id IS NULL OR related_document_id <> id",
            name="not_self_related",
        ),
        # A covering index for every foreign key (Postgres makes none), led by
        # company_id so the dashboard's scoped, date-ordered reads use them too.
        Index("ix_transaction_documents_company_issued", "company_id", "issued_at"),
        Index("ix_transaction_documents_company_type", "company_id", "doc_type", "issued_at"),
        Index("ix_transaction_documents_vendor", "company_id", "vendor_id", "issued_at"),
        Index("ix_transaction_documents_franchisee", "company_id", "franchisee_id", "issued_at"),
        Index("ix_transaction_documents_technician", "company_id", "technician_id", "issued_at"),
        Index("ix_transaction_documents_ticket", "company_id", "ticket_id"),
        Index("ix_transaction_documents_related", "company_id", "related_document_id"),
    )

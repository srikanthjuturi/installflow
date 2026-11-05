"""One row per call a CRM made with a KNOWN credential.

`created_at` (from `AuditMixin`) IS the time of the call; there is no second
timestamp for the same fact.

## What is stored, and for how long

`detail` is a redacted summary of the request. It holds customers' names, phones
and addresses, so a scheduled job clears it after 30 days and deletes the whole
row after a year. NOTHING here ever holds a Client Secret, an access token, a
refresh token or the Authorization header.

## What is NOT stored here

A call whose Client ID matches no credential. It belongs to no company, so it
has no tenant to own it; it goes to the server log only.
"""

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

ENDPOINTS = ("token", "create_ticket", "get_ticket", "list_tickets")


class IntegrationCallLog(Base, IdMixin, AuditMixin):
    __tablename__ = "integration_call_logs"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    vendor_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    credential_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    endpoint: Mapped[str] = mapped_column(String(24), nullable=False)
    http_status: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    #: The stable error code, or NULL on success.
    outcome_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    check_only: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    crm_reference: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    #: True when an existing ticket was returned instead of a new one.
    repeat: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    #: Redacted request summary; cleared after 30 days.
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "endpoint IN ('token', 'create_ticket', 'get_ticket', 'list_tickets')",
            name="endpoint",
        ),
        # The screen and the retention job read by company and time (and this is
        # the covering index for the company FK); the per-minute limit reads by
        # credential and time.
        Index(
            "ix_integration_call_logs_company_created",
            "company_id",
            text("created_at DESC"),
        ),
        Index(
            "ix_integration_call_logs_credential_created", "credential_id", "created_at"
        ),
        ForeignKeyConstraint(
            ["company_id", "credential_id"],
            ["api_credentials.company_id", "api_credentials.id"],
            name="fk_integration_call_logs_company_credential",
            ondelete="CASCADE",
        ),
    )

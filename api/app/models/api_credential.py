"""A vendor CRM's machine login, and the 30-day renewal tokens issued from it.

## What a credential is

A Client ID and a hashed Client Secret that belong to ONE vendor. A CRM that
presents it acts for that vendor and its company and nobody else, which is why
no request ever names either: `company_id` / `vendor_id` here are the only
source.

A credential is REVOKED, never deleted — the call log and the tickets created
with it keep pointing at it. `revoked_at` being NULL is what "Active" means.

## What is never stored

The Client Secret. Only its SHA-256 hash, which is enough because the secret is
a 256-bit random string rather than something a person chose.

## Why a refresh token has a table

A refresh token is opaque and single-use: using it issues a new pair and ends
the old one, so it has to be remembered. Only its hash is kept, so a database
leak cannot be replayed, the same reason `refresh_tokens` does it for the
console.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin


class ApiCredential(Base, IdMixin, AuditMixin):
    __tablename__ = "api_credentials"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: COMPOSITE FK — see `__table_args__`. Never a plain single-column FK.
    vendor_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    #: Public, like a username: `<vendor-slug>_<3 digits>`. GLOBALLY unique,
    #: because the CRM sends it with no company named.
    client_id: Mapped[str] = mapped_column(String(64), nullable=False)
    secret_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    #: An optional label such as "Production CRM".
    note: Mapped[str | None] = mapped_column(String(120), nullable=True)
    #: The credential this one was made to replace. The old one keeps working
    #: until somebody revokes it.
    replaces_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        # The covering index for the composite FK, columns IN ORDER, which is
        # also the console's per-vendor list.
        Index("ix_api_credentials_company_vendor", "company_id", "vendor_id"),
        # The target of the composite FKs on the two tables below.
        UniqueConstraint("company_id", "id", name="uq_api_credentials_company_id_id"),
        UniqueConstraint("client_id", name="uq_api_credentials_client_id"),
        ForeignKeyConstraint(
            ["company_id", "vendor_id"],
            ["vendors.company_id", "vendors.id"],
            name="fk_api_credentials_company_vendor",
            ondelete="CASCADE",
        ),
    )

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None


class ApiRefreshToken(Base, IdMixin, AuditMixin):
    __tablename__ = "api_refresh_tokens"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    credential_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    #: Issue time + 30 days.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    #: Set when exchanged. A used token is refused, never honoured twice.
    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index(
            "ix_api_refresh_tokens_company_credential", "company_id", "credential_id"
        ),
        UniqueConstraint("token_hash", name="uq_api_refresh_tokens_token_hash"),
        ForeignKeyConstraint(
            ["company_id", "credential_id"],
            ["api_credentials.company_id", "api_credentials.id"],
            name="fk_api_refresh_tokens_company_credential",
            ondelete="CASCADE",
        ),
    )

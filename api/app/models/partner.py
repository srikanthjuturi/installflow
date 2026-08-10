"""Partner invites — the freelancers and franchises who service jobs.

A partner registers in the **technician** app, so an invite is a WhatsApp
message carrying a link to install it. The row is the tracking record: who sent
it, where it applies, whether WhatsApp accepted it, and (later) who registered
from it.

The `token` here is what `videocontech://invite/<token>` resolves against — see
`mobileapp/app/(auth)/invite.tsx` — so registration lands on this row without a
schema change.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

# Partner types.
FREELANCER = "freelancer"
FRANCHISE = "franchise"
PARTNER_TYPES = (FREELANCER, FRANCHISE)

# Lifecycle. `sent` means WhatsApp ACCEPTED it — not that it arrived; that
# needs a delivery webhook, which is a later phase.
PENDING = "pending"
SENT = "sent"
FAILED = "failed"
REGISTERED = "registered"
CANCELLED = "cancelled"


class PartnerInvite(Base, IdMixin, AuditMixin):
    __tablename__ = "partner_invites"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    partner_type: Mapped[str] = mapped_column(String(16), nullable=False)
    # E.164, e.g. +919876543210 — WhatsApp needs the country code.
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Territory stamp, so partners scope exactly like users do.
    region_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("regions.id", ondelete="RESTRICT"), nullable=False
    )

    # Who sent the link. The membership is what territory filtering reads; the
    # user id survives even if that membership is later removed.
    invited_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    invited_by_membership_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True
    )

    status: Mapped[str] = mapped_column(String(16), nullable=False)
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)

    # What WhatsApp said. The error is kept on the row so a failed invite can be
    # explained and retried rather than vanishing into a log.
    wa_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    wa_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Who registered from the link. Filled by the registration phase.
    registered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    registered_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # NB: the partial UNIQUE on (company_id, phone) for live invites is created
    # in the migration — a cancelled number must be invitable again.
    __table_args__ = (
        Index("ix_partner_invites_company_status", "company_id", "status"),
        Index("ix_partner_invites_region_id", "region_id"),
    )

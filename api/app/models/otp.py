"""One-time codes for technician sign-in and self-registration.

Stored as `sha256(phone:code:OTP_PEPPER)`, deliberately NOT bcrypt. A 6-digit
code has 10^6 entropy, so bcrypt at any sane cost factor is still brute-forced
offline in seconds — it buys nothing against the real threat while costing
~100 ms on a hot path that is already rate-limited. The pepper (a server-side
secret, absent from the database) is what actually stops enumeration from a
dump; a short TTL, an attempt cap and throttling are the rest of the defence.

Throttle counters are `SELECT count(*)` over this table rather than an
in-process counter, so they stay correct across uvicorn workers without Redis.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

PURPOSE_LOGIN = "login"
PURPOSE_INVITE = "invite"


class OtpCode(Base, IdMixin, AuditMixin):
    __tablename__ = "otp_codes"

    #: 'login' — an existing technician signing in.
    #: 'invite' — proving possession of the phone before self-registering.
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    #: E.164.
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    invite_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("technician_invites.id", ondelete="CASCADE"), nullable=True
    )

    code_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    attempts: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("0")
    )
    #: Set on success, on running out of attempts, and on every prior code when
    #: a new one is requested — so "the old message still works" cannot happen.
    consumed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    #: 'whatsapp' | 'log'. Which channel actually took it.
    sent_channel: Mapped[str | None] = mapped_column(String(16), nullable=True)
    wa_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    wa_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: For the per-IP throttle. IPv6-length.
    request_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)

    __table_args__ = (
        Index("ix_otp_codes_phone_created", "phone", "created_at"),
        Index("ix_otp_codes_purpose_phone", "purpose", "phone"),
        Index("ix_otp_codes_ip_created", "request_ip", "created_at"),
        CheckConstraint(
            "purpose IN ('login','invite')", name="purpose"
        ),
    )

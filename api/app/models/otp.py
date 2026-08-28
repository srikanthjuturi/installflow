"""One-time codes for technician sign-in, self-registration and password reset.

Stored as `sha256(destination:code:OTP_PEPPER)`, deliberately NOT bcrypt. A
6-digit code has 10^6 entropy, so bcrypt at any sane cost factor is still
brute-forced offline in seconds — it buys nothing against the real threat while
costing ~100 ms on a hot path that is already rate-limited. The pepper (a
server-side secret, absent from the database) is what actually stops enumeration
from a dump; a short TTL, an attempt cap and throttling are the rest of the
defence.

A **destination** is a phone OR an email, never both and never neither — the
`destination` CHECK says so. One table rather than two because everything that
makes a one-time code safe is the same whichever way it travelled: the pepper,
the TTL, the attempt cap, the three throttle counters and the rule that
requesting a new code kills the old one. A second table would be a second copy
of all of it, and copies drift.

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
PURPOSE_PASSWORD_RESET = "password_reset"

#: The one place the three are listed. The CHECK below and the wire schemas both
#: read it, so adding a fourth cannot be done in one place and forgotten in the
#: other.
PURPOSES = (PURPOSE_LOGIN, PURPOSE_INVITE, PURPOSE_PASSWORD_RESET)


class OtpCode(Base, IdMixin, AuditMixin):
    __tablename__ = "otp_codes"

    #: 'login' — an existing technician signing in.
    #: 'invite' — proving possession of the phone before self-registering.
    #: 'password_reset' — a console account proving possession of its EMAIL
    #: before choosing a new password. The only purpose that travels by email.
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    #: E.164. Null exactly when this code went to an email instead.
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    #: Lowercased, so a lookup never needs `func.lower()` over this column the
    #: way `users.email` does. 320 is the RFC 5321 maximum rather than
    #: `users.email`'s 255: this is a log of what was sent where, and it should
    #: not be the thing that refuses an address the user table would have taken.
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
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

    #: 'whatsapp' | 'email' | 'log'. Which channel actually took it.
    sent_channel: Mapped[str | None] = mapped_column(String(16), nullable=True)
    #: The provider's own id for the send — WhatsApp's message id, or Azure
    #: Communication Services' operation id. Named for what it is rather than
    #: for WhatsApp, because two providers write here now.
    provider_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    send_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: For the per-IP throttle. IPv6-length.
    request_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)

    __table_args__ = (
        Index("ix_otp_codes_phone_created", "phone", "created_at"),
        Index("ix_otp_codes_purpose_phone", "purpose", "phone"),
        # The email twin of the two above. Every throttle counter and every
        # lookup keys on the destination, so an email code needs the same
        # covering index a phone code has or each one table-scans.
        Index("ix_otp_codes_email_created", "email", "created_at"),
        Index("ix_otp_codes_ip_created", "request_ip", "created_at"),
        # The two FKs. An OTP row outlives the sign-in attempt, so both parents
        # can be deleted while codes still point at them.
        Index("ix_otp_codes_user_id", "user_id"),
        Index("ix_otp_codes_invite_id", "invite_id"),
        CheckConstraint(
            "purpose IN ('" + "','".join(PURPOSES) + "')", name="purpose"
        ),
        # Exactly one destination. Neither would be a code nobody could ever
        # receive; both would make "which rows count against this throttle"
        # ambiguous, and the answer would differ by caller.
        CheckConstraint(
            "num_nonnulls(phone, email) = 1", name="destination"
        ),
    )

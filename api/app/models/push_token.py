"""Where to reach a technician when the app is closed.

One row per DEVICE, not per person: a technician with a work phone and a
personal one gets a notification on both, and losing that is worse than the
duplicate row costs.

## The token is globally unique, deliberately

An Expo push token identifies one installation of the app on one device. If the
same phone is later signed in by a different technician — a shared handset, a
replacement — the token must MOVE rather than exist twice, or the new user's
jobs get pushed to a row still pointing at the old one. So registration upserts
on the token and rewrites `technician_id` and `company_id`, which is also the
only thing standing between a shared device and one tenant's job details
arriving on another tenant's screen.

That is why the unique is on `token` alone and not on `(company_id, token)`:
scoping it per company would allow exactly the duplicate this prevents.

## Tokens rot, and nothing tells us

Expo reports a token as `DeviceNotRegistered` when the app is uninstalled or the
token is rotated. That receipt is the only signal there is — nothing else ever
says a device stopped existing — so the sender deletes on it. Rows are hard
deleted rather than soft: a dead token has no history worth keeping and a
soft-deleted one would keep failing a unique that a reinstall needs.
"""

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Uuid,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

#: Only Android today — iOS needs a paid Apple account and APNs credentials
#: nobody has bought yet. Stored anyway: knowing which platform a dead token
#: came from is the first question when delivery goes wrong on one and not the
#: other.
PUSH_PLATFORMS = ("android", "ios")


class PushToken(Base, IdMixin, AuditMixin):
    __tablename__ = "push_tokens"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: COMPOSITE FK — see __table_args__.
    technician_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    #: `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`. Expo's own token, not the
    #: raw FCM one — the FCM credential lives with EAS, and this server never
    #: holds a Firebase secret.
    token: Mapped[str] = mapped_column(String(255), nullable=False)
    platform: Mapped[str] = mapped_column(String(16), nullable=False)
    #: "Pixel 7a". Shown to nobody yet; it is what makes a list of four tokens
    #: answerable when a technician says they stopped getting notifications.
    device_name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    #: Refreshed every time the app registers, which it does on each launch.
    #: A token that has not been seen for months is a phone that is gone.
    last_seen_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        CheckConstraint("platform IN ('android', 'ios')", name="platform"),
        # See the module note: one device, one row, whoever is signed in.
        UniqueConstraint("token", name="uq_push_tokens_token"),
        # "everything to send to for this technician" — the only read there is.
        Index("ix_push_tokens_company_technician", "company_id", "technician_id"),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_push_tokens_company_technician",
            ondelete="CASCADE",
        ),
    )

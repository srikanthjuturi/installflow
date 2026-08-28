"""Where to reach a console user when their browser tab is not open.

The browser counterpart of `push_tokens`. That module's notes apply here almost
line for line, because the two solve the same problem for two different clients:
a technician's phone with the app closed, and a manager's laptop with the console
closed. Read it alongside this one.

## What a subscription is

Three strings the browser hands over when somebody turns desktop alerts on: an
`endpoint` URL at their browser vendor's push service, and the two keys
(`p256dh`, `auth`) that this server encrypts the payload with. Nobody in between
— not Google, not Mozilla, not Azure — can read a notification's text; the push
service only routes the ciphertext.

## The endpoint is globally unique, deliberately

An endpoint identifies one browser profile on one machine. If somebody else
signs in on that profile — a shared desk, a colleague borrowing a laptop — the
row must MOVE rather than exist twice, or the previous user's escalations keep
arriving on a screen somebody else is now looking at. Across two companies that
is a tenant leak onto a lock screen.

So registration upserts on the endpoint and rewrites `user_id` and `company_id`,
and the unique is on `endpoint` alone rather than on `(company_id, endpoint)` —
scoping it per company would permit exactly the duplicate this prevents.

The same reasoning makes signing out and switching company DELETE the row rather
than leave it. `detail` can name a customer, and a subscription left behind is
company A's text on the screen of somebody now working in company B.

## Subscriptions rot, and almost nothing tells us

A push service answers **404** or **410** once a subscription is gone —
permission revoked, site data cleared, the browser profile deleted. That is the
only signal there is, the exact counterpart of Expo's `DeviceNotRegistered`, so
the sender deletes on it. Rows are hard deleted rather than soft: a dead
endpoint has no history worth keeping, and a soft-deleted one would keep failing
the unique that turning alerts back on needs.
"""

import datetime
import uuid

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    Uuid,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin


class WebPushSubscription(Base, IdMixin, AuditMixin):
    __tablename__ = "web_push_subscriptions"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: No FK, matching `notification_reads.user_id`: `users` is not a tenant
    #: table, so there is no `(company_id, id)` unique for a composite FK to
    #: point at, and a user may be removed while their browser still holds a
    #: subscription this server should stop sending to.
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    #: The push service URL the browser minted. `Text` rather than a bounded
    #: String: no specification caps it, and Chrome's are already ~200
    #: characters with no promise they stay there.
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    #: The subscription's public key and auth secret, base64url, straight from
    #: `PushSubscription.toJSON().keys`. Both are needed to encrypt a payload
    #: and neither is a secret of ours.
    p256dh: Mapped[str] = mapped_column(String(255), nullable=False)
    auth: Mapped[str] = mapped_column(String(255), nullable=False)

    #: "Chrome 141 on Windows". Shown to nobody yet; it is what makes a list of
    #: three subscriptions answerable when somebody says they stopped getting
    #: alerts on one of their machines.
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)

    #: Refreshed every time the console re-registers, which it does whenever
    #: the browser rotates the subscription behind our back.
    last_seen_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        # See the module note: one browser profile, one row, whoever is signed in.
        UniqueConstraint("endpoint", name="uq_web_push_subscriptions_endpoint"),
        # "everywhere to send to for these users" — the only read there is.
        Index("ix_web_push_subscriptions_company_user", "company_id", "user_id"),
    )

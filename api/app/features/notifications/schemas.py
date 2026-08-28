"""What the console's bell and feed read, and where a phone registers."""

import datetime
import uuid

from typing import Literal, get_args

from pydantic import Field

from app.core.schemas import AppModel
from app.models.notification import NOTIFICATION_KINDS

#: What the feed may be filtered to. Spelled out rather than built from
#: `NOTIFICATION_KINDS` because a `Literal` has to be readable by a type checker
#: and by FastAPI's schema generator, neither of which can see through a tuple.
#: The assertion below is what keeps the two in step — adding a kind to the
#: model and forgetting this line fails at import, not in production.
NotificationKind = Literal[
    "escalation",
    "ai",
    "serial_mismatch",
    "force_close",
    "slot",
    "technician_joined",
    "job_started",
    "invite_expired",
]

assert set(get_args(NotificationKind)) == set(NOTIFICATION_KINDS), (
    "NotificationKind and NOTIFICATION_KINDS have drifted apart"
)


class NotificationOut(AppModel):
    """One event somebody has to look at."""

    id: uuid.UUID
    kind: str
    title: str
    detail: str
    #: The console route that DEALS with it. A notification leading nowhere is
    #: a note, and notes belong on the ticket.
    to: str
    #: An instant, not "4m ago". The relative phrasing is the reader's clock's
    #: business — a server that sends "4m ago" is sending something that was
    #: true when the response was built and is wrong by the time it renders.
    createdAt: datetime.datetime
    #: Per THIS reader. The same escalation is unread for one manager and dealt
    #: with by another.
    read: bool


class UnreadCountOut(AppModel):
    """Just the number, for the bell.

    Its own endpoint because the topbar is on every screen and re-reading the
    whole feed to render a badge is the sort of thing that quietly costs a
    query per navigation.
    """

    unread: int


class DeviceRegistration(AppModel):
    """A technician's phone, saying where to reach it.

    Sent on every launch, not just the first: an Expo token is not permanent —
    it rotates, and it changes on reinstall — so the app re-registers rather
    than assuming what it stored last time still works.
    """

    #: `ExponentPushToken[...]`. Expo's token, never a raw FCM one; the Firebase
    #: credential lives with EAS and this server never sees it.
    token: str = Field(min_length=1, max_length=255)
    platform: Literal["android", "ios"]
    #: "Pixel 7a". Optional, and only ever used to answer "which of this
    #: person's phones stopped receiving anything".
    deviceName: str | None = Field(default=None, max_length=120)


class WebPushKeyOut(AppModel):
    """The VAPID public key, for `pushManager.subscribe`.

    Served rather than baked into the bundle as a `VITE_` variable so there is
    one source of truth for it, Netlify deploy previews work without their own
    build configuration, and rotating the pair does not need a frontend release.

    Not a secret: it is handed to every browser that subscribes, and its only
    power is to make a subscription that this server's private half can sign for.
    """

    #: Empty when web push is not configured, which is how the console decides
    #: to render "Desktop alerts are not available" rather than a dead switch.
    publicKey: str


class WebPushRegistration(AppModel):
    """A browser saying where to reach it — `PushSubscription.toJSON()`.

    Re-sent whenever the console finds a subscription it has not registered:
    a browser may rotate one on its own, and site data cleared on one machine
    must not stop the others working.
    """

    #: The push service URL. No specification bounds it, and Chrome's are
    #: already ~200 characters, so this is generous on purpose.
    endpoint: str = Field(min_length=1, max_length=2048)
    #: `PushSubscription.toJSON().keys` — the pair this server encrypts with.
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)
    #: "Chrome 141 on Windows". Only ever used to answer "which of my machines
    #: stopped showing alerts".
    userAgent: str | None = Field(default=None, max_length=255)


class WebPushUnregistration(AppModel):
    """Which browser to stop pushing to.

    The endpoint is optional. A browser can lose its subscription object while
    keeping the permission — cleared site data, a revoked registration — and a
    client that cannot name its endpoint must still be able to say "stop
    sending to me here", which drops every subscription this user holds in this
    company. That is also exactly what signing out wants.
    """

    endpoint: str | None = Field(default=None, max_length=2048)

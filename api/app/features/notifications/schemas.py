"""What the console's bell and feed read, and where a phone registers."""

import datetime
import uuid

from typing import Literal

from pydantic import Field

from app.core.schemas import AppModel


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

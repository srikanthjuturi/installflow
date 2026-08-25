"""What the console's bell and feed read."""

import datetime
import uuid

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

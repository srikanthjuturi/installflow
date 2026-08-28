"""Raising a notification — the WRITE side, usable from any slice.

In core rather than in `features/notifications` for the reason `realtime` is:
several slices need to ring the bell, and slices never import each other (hard
rule 4). The notifications slice owns the READ side — the feed, the unread
count, marking read — which is one audience and one API, and belongs there.

The split is not arbitrary. Writing is a side effect of something else
happening; reading is a feature with its own screen.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification


async def notify(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    kind: str,
    title: str,
    detail: str,
    to: str,
    ticket_id: uuid.UUID | None = None,
    pincode: str | None = None,
    vendor_id: uuid.UUID | None = None,
) -> Notification:
    """Ring the bell. Adds to the caller's transaction; does NOT commit.

    Deliberately no commit: a notification must land with the thing it is about,
    or not at all. A bell that rings for a serial mismatch whose proof failed to
    save sends somebody to look at a ticket that says nothing happened.

    `pincode` IS the staff audience — matched against the reader's territory by
    the same rule that scopes tickets. NULL means the whole company, which is
    right for anything not tied to a place and is not a way to skip scoping.

    `vendor_id` WIDENS it to one vendor's portal; it never narrows the staff
    audience. Pass it when the vendor is a party to the event rather than a
    spectator of it — a serial mismatch they can correct, not an escalation
    about our own staffing.

    The realtime frame is the caller's to publish. See
    `core.realtime.publish_notification`, and pass it the returned row's `id` —
    web push needs it to find the row again and to deduplicate across workers.
    """
    row = Notification(
        company_id=company_id,
        kind=kind,
        title=title[:160],
        detail=detail[:255],
        to=to[:255],
        ticket_id=ticket_id,
        pincode=pincode,
        vendor_id=vendor_id,
    )
    db.add(row)
    # `id` is a DB-side `gen_random_uuid()` default and sessions run
    # `autoflush=False` (hard rule 10), so without this the returned row's id is
    # None and no caller can name what it just raised. Still the caller's
    # transaction — this changes when the INSERT is sent, not whether it commits.
    await db.flush()
    return row

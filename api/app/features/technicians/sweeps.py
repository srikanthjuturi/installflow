"""The notification time raises about people rather than tickets.

Run by `core.scheduler.ticker`, alongside the ticket sweeps. Its own module in
its own slice because an invite is this slice's record and slices never import
each other (hard rule 4) — `main.py` is the composition root that registers both.

## The status flip IS the marker

`tickets.sweeps` checks whether a notification of that kind already exists for
that ticket, because a ticket stays overdue until somebody deals with it. An
invite is different: expiring it is a real state change, and once `status` is
`expired` the query below cannot see it again. So there is nothing extra to
remember, and no second marker that could disagree with the first.

## Why this exists at all

`resend_invite` already expires an invite it finds past its date — but only when
somebody happens to try a resend. An invite nobody touches keeps `sent` for ever
and the manager who sent it is never told it lapsed, which is the one case where
being told matters: they are waiting on a technician who can no longer register.
"""

import datetime
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.notifications import notify
from app.core.realtime import publish_notification
from app.models.technician import (
    EXPIRED,
    LIVE_INVITE_STATUSES,
    TechnicianInvite,
    TechnicianInvitePincode,
)
from app.models.user import User

log = logging.getLogger(__name__)

#: A run is capped so one long-neglected company cannot make a single tick take
#: minutes. Whatever is left over is picked up on the next pass.
_BATCH = 200


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def sweep_expired_invites(db: AsyncSession) -> int:
    """Expire invites past their date, and tell whoever sent them.

    Never commits — `core.scheduler` does, which is also what releases the
    advisory lock that stops both workers running this at once. Publishing
    inside that transaction is safe for the reason it always is here:
    `pg_notify` is transactional, so a rolled-back sweep tells nobody anything.
    """
    rows = list(
        await db.scalars(
            select(TechnicianInvite)
            .where(
                # `LIVE_INVITE_STATUSES` is pending/sent/failed — the three that
                # still occupy the phone number. Cancelled, registered and
                # already-expired are all finished with, and re-expiring one
                # would raise a second bell about the same lapse.
                #
                # No `deleted_at` filter: this table is not soft-deleted. A
                # cancelled invite carries the `cancelled` status instead, which
                # the check above already excludes.
                TechnicianInvite.status.in_(LIVE_INVITE_STATUSES),
                TechnicianInvite.expires_at <= _now(),
            )
            .order_by(TechnicianInvite.expires_at)
            .limit(_BATCH)
        )
    )
    if not rows:
        return 0

    for invite in rows:
        invite.status = EXPIRED

        # The coverage the manager chose, for the same reason the arrival
        # notification carries it: "an invite lapsed" is not actionable until
        # you know which area it was for.
        pincodes = list(
            await db.scalars(
                select(TechnicianInvitePincode.pincode).where(
                    TechnicianInvitePincode.company_id == invite.company_id,
                    TechnicianInvitePincode.invite_id == invite.id,
                )
            )
        )
        anchor = pincodes[0] if pincodes else None

        sender = None
        if invite.invited_by_user_id is not None:
            sender = await db.scalar(
                select(User.full_name).where(User.id == invite.invited_by_user_id)
            )

        detail = f"Sent {_days_ago(invite.created_at)} · never registered"
        if sender:
            detail += f" · invited by {sender}"

        raised = await notify(
            db,
            company_id=invite.company_id,
            kind="invite_expired",
            # The phone, not a name: nobody typed a name — that is exactly what
            # the technician never got as far as doing.
            title=f"Invite to {invite.phone} expired",
            detail=detail,
            # The list, where invites live and where a new one is sent from.
            # There is no page for one invite, and inventing a route a
            # notification links to nothing is worse than linking to the list.
            to="/technicians",
            pincode=anchor,
        )
        await publish_notification(
            db,
            company_id=invite.company_id,
            pincode=anchor,
            notification_id=raised.id,
        )

    log.info("invites: expired %d", len(rows))
    return len(rows)


def _days_ago(when: datetime.datetime | None) -> str:
    if when is None:
        return "some time ago"
    days = max(0, (_now() - when).days)
    if days == 0:
        return "today"
    return "yesterday" if days == 1 else f"{days} days ago"

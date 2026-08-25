"""Reading the bell, and writing to it.

Visibility is the same rule as tickets — `core.scope.visible_pincodes` — and it
is imported from core rather than copied, because a second copy of a visibility
rule is the one that goes wrong.

A notification with no `pincode` is company-wide. That is deliberate and is what
anything not tied to a place should use; it is not a way to skip scoping.
"""

import datetime
import uuid

from sqlalchemy import Select, false as sql_false, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.deps import Principal
from app.core.scope import visible_pincodes
from app.features.notifications.schemas import NotificationOut
from app.models.notification import Notification, NotificationRead

#: The feed is a working queue, not an archive. Older than this and nobody is
#: acting on it; it stays in the database and simply stops ringing.
FEED_LIMIT = 50


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def _visible(db: AsyncSession, principal: Principal) -> Select:
    """This principal's notifications, newest first.

    A vendor sees none. Every kind written today is an operational event for
    staff — an escalation, a serial mismatch, a slot timeout — and showing a
    vendor "no technician accepted this" would be telling them about our
    problem rather than theirs. When a vendor-facing kind exists it gets an
    explicit audience rather than inheriting this one by default.
    """
    stmt = select(Notification).where(Notification.company_id == principal.company_id)

    if principal.is_vendor:
        # `sql_false()`, not `func.false()`: the latter renders as `false()`,
        # which Postgres rejects as a call to a function that does not exist.
        # The tickets slice learned this the same way.
        return stmt.where(sql_false())

    pincodes = await visible_pincodes(db, principal)
    if isinstance(pincodes, list):
        # Covers nothing, so hears nothing. Fail closed.
        return stmt.where(sql_false())
    if pincodes is not None:
        # Company-wide rows (no pincode) reach everyone; the rest are territory.
        stmt = stmt.where(
            (Notification.pincode.is_(None)) | (Notification.pincode.in_(pincodes))
        )
    return stmt.order_by(Notification.created_at.desc())


async def list_for(
    db: AsyncSession, principal: Principal
) -> list[NotificationOut]:
    rows = list(await db.scalars((await _visible(db, principal)).limit(FEED_LIMIT)))
    if not rows:
        return []

    read_ids = set(
        await db.scalars(
            select(NotificationRead.notification_id).where(
                NotificationRead.user_id == principal.user_id,
                NotificationRead.notification_id.in_([r.id for r in rows]),
            )
        )
    )
    return [
        NotificationOut(
            id=r.id,
            kind=r.kind,
            title=r.title,
            detail=r.detail,
            to=r.to,
            createdAt=r.created_at,
            read=r.id in read_ids,
        )
        for r in rows
    ]


async def unread_count(db: AsyncSession, principal: Principal) -> int:
    visible = (await _visible(db, principal)).with_only_columns(Notification.id)
    read = select(NotificationRead.notification_id).where(
        NotificationRead.user_id == principal.user_id
    )
    return (
        await db.scalar(
            select(func.count()).select_from(
                visible.where(Notification.id.not_in(read)).order_by(None).subquery()
            )
        )
    ) or 0


async def mark_read(
    db: AsyncSession, principal: Principal, notification_id: uuid.UUID
) -> None:
    """Idempotent by construction — reading twice is not two facts.

    `ON CONFLICT DO NOTHING` rather than a read-then-insert: two tabs marking
    the same row would otherwise race into a unique violation, and a duplicate
    tap is not an error worth showing anybody.
    """
    owned = await db.scalar(
        (await _visible(db, principal)).where(Notification.id == notification_id)
    )
    if owned is None:
        # Not visible to this reader. Silent rather than 404: the console is
        # marking something off a list it already holds, and the only way here
        # is a stale list.
        return

    await db.execute(
        pg_insert(NotificationRead)
        .values(
            company_id=principal.company_id,
            notification_id=notification_id,
            user_id=principal.user_id,
            read_at=_now(),
        )
        .on_conflict_do_nothing(constraint="uq_notification_reads")
    )
    await db.commit()


async def mark_all_read(db: AsyncSession, principal: Principal) -> int:
    """Everything currently visible and unread. Returns how many were marked."""
    read = select(NotificationRead.notification_id).where(
        NotificationRead.user_id == principal.user_id
    )
    ids = list(
        await db.scalars(
            (await _visible(db, principal))
            .with_only_columns(Notification.id)
            .where(Notification.id.not_in(read))
        )
    )
    if not ids:
        return 0

    now = _now()
    await db.execute(
        pg_insert(NotificationRead)
        .values(
            [
                {
                    "company_id": principal.company_id,
                    "notification_id": i,
                    "user_id": principal.user_id,
                    "read_at": now,
                }
                for i in ids
            ]
        )
        .on_conflict_do_nothing(constraint="uq_notification_reads")
    )
    await db.commit()
    return len(ids)

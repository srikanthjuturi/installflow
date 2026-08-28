"""Reading the bell, and writing to it.

Visibility is the same rule as tickets — `core.scope.visible_pincodes` — and it
is imported from core rather than copied, because a second copy of a visibility
rule is the one that goes wrong.

A notification with no `pincode` is company-wide. That is deliberate and is what
anything not tied to a place should use; it is not a way to skip scoping.
"""

import datetime
import uuid

from sqlalchemy import Select, false as sql_false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.deps import Principal
from app.core.scope import visible_pincodes
from app.features.notifications.schemas import NotificationKind, NotificationOut
from app.models.notification import Notification, NotificationRead


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


#: Newest first, and `id` breaks the tie.
#:
#: The tiebreaker is not cosmetic. The feed is read a page at a time with
#: OFFSET, and two rows written in the same transaction share a `created_at` to
#: the microsecond — an escalation sweep raises several at once. Without a
#: second, total key Postgres may order those rows differently between two
#: queries, which is how the same notification appears on page 1 AND page 2
#: while another is never shown at all.
_NEWEST_FIRST = (Notification.created_at.desc(), Notification.id.desc())


async def _visible(db: AsyncSession, principal: Principal) -> Select:
    """This principal's notifications, newest first.

    A vendor sees ONLY what names them. Most events here are operational
    problems of ours — an escalation, a slot timeout — and telling a vendor "no
    technician accepted this" is telling them about our staffing rather than
    their customer. A row reaches them only when `notify` was given their id,
    which is a decision taken per event at the point of writing it.
    """
    stmt = select(Notification).where(Notification.company_id == principal.company_id)

    if principal.is_vendor:
        if principal.vendor_id is None:
            # A vendor principal with no vendor. Fail closed rather than
            # matching every row whose vendor_id is also null.
            #
            # `sql_false()`, not `func.false()`: the latter renders as
            # `false()`, which Postgres rejects as a call to a function that
            # does not exist. The tickets slice learned this the same way.
            return stmt.where(sql_false())
        return stmt.where(Notification.vendor_id == principal.vendor_id).order_by(
            *_NEWEST_FIRST
        )

    pincodes = await visible_pincodes(db, principal)
    if isinstance(pincodes, list):
        # Covers nothing, so hears nothing. Fail closed.
        return stmt.where(sql_false())
    if pincodes is not None:
        # Company-wide rows (no pincode) reach everyone; the rest are territory.
        stmt = stmt.where(
            (Notification.pincode.is_(None)) | (Notification.pincode.in_(pincodes))
        )
    return stmt.order_by(*_NEWEST_FIRST)


def _my_reads(principal: Principal) -> Select:
    """The ids this reader has already read. A subquery, never a fetched list."""
    return select(NotificationRead.notification_id).where(
        NotificationRead.user_id == principal.user_id
    )


async def list_page(
    db: AsyncSession,
    principal: Principal,
    *,
    page: int,
    limit: int,
    search: str | None = None,
    kind: NotificationKind | None = None,
    unread_only: bool = False,
) -> tuple[list[NotificationOut], int]:
    """One page of this reader's feed, newest first, with the total behind it.

    Paged rather than capped. The feed used to stop at the 50 most recent rows,
    which is fine for a bell and wrong for a screen somebody scrolls: past that
    line the events still existed and simply could not be reached. The audience
    rule is unchanged — `_visible` decides what is readable, and every filter
    below only ever narrows it.

    OFFSET paging over a live feed has one honest consequence worth stating: an
    event raised while somebody is scrolling shifts everything down by one, so a
    row can repeat across two pages. The alternative is a keyset cursor, which
    the rest of this API does not speak; a duplicate row in a feed is a much
    smaller problem than one pagination contract per endpoint.
    """
    stmt = await _visible(db, principal)

    if kind is not None:
        stmt = stmt.where(Notification.kind == kind)

    if search and search.strip():
        # Title and detail are the only free text a notification has, and the
        # ticket code lives inside the title — "CA-INST-0003 unassigned" — so
        # searching a code needs no separate join.
        term = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(Notification.title.ilike(term), Notification.detail.ilike(term))
        )

    if unread_only:
        stmt = stmt.where(Notification.id.not_in(_my_reads(principal)))

    total = (
        await db.scalar(
            select(func.count()).select_from(
                stmt.with_only_columns(Notification.id).order_by(None).subquery()
            )
        )
    ) or 0

    rows = list(await db.scalars(stmt.offset((page - 1) * limit).limit(limit)))
    if not rows:
        return [], total

    # Read state for THIS page only. Reading the whole `notification_reads` set
    # would grow with the reader's history rather than with what is on screen.
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
    ], total


async def unread_count(db: AsyncSession, principal: Principal) -> int:
    visible = (await _visible(db, principal)).with_only_columns(Notification.id)
    return (
        await db.scalar(
            select(func.count()).select_from(
                visible.where(Notification.id.not_in(_my_reads(principal)))
                .order_by(None)
                .subquery()
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
    """Everything currently visible and unread. Returns how many were marked.

    Deliberately NOT narrowed by the search term or the kind filter the feed was
    last read with. "Mark all as read" is the button that empties the bell, and
    a bell still showing a count after it would be the thing people report.
    """
    ids = list(
        await db.scalars(
            (await _visible(db, principal))
            .with_only_columns(Notification.id)
            .where(Notification.id.not_in(_my_reads(principal)))
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

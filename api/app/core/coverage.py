"""Who covers a job — the inverse of the pool query.

`jobs.service.pool_query` asks "which tickets may THIS technician be offered".
This asks the other direction: given a ticket that has just entered the pool,
who should hear about it. Same two facts, read the other way round.

In `core` because both the jobs slice and the tickets slice put tickets into the
pool — `publish_pool_changed` is called from each — and slices never import each
other (hard rule 4). It sits beside `core.scope`, which was promoted here for
exactly the same reason: a rule two slices need is a rule that must have one
copy, or the second one drifts.

## It must agree with `pool_query`, and that is the whole risk

A technician pushed about a job the pool will not show them opens the app to
nothing. The two predicates that decide it — covers the pincode, certified for
the subcategory — are duplicated here rather than shared, because the two
queries are shaped differently: one correlates against `Ticket` columns, this
one against literals. If a THIRD condition is ever added to pool eligibility,
it belongs in both, and this note is where whoever adds it should look.
"""

import datetime
import uuid

from sqlalchemy import ColumnElement, Date, case, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.scope import ALL_INDIA_ROLES
from app.core.tickets import SLOT_TIMEZONE_OFFSET_MINUTES
from app.models.membership import Membership
from app.models.role import AREA_MANAGER, REGIONAL_HEAD, VENDOR_ROLES
from app.models.technician import (
    ACTIVE,
    TechnicianPincode,
    TechnicianProfile,
    TechnicianSubcategory,
)
from app.models.territory import MembershipRegion, MembershipState, Pincode, State
from app.models.ticket import Ticket
from app.models.user import User

#: Statuses that do NOT consume a technician's day.
#:
#: A deny-list on purpose. A status added later then defaults to COUNTING,
#: which is the safe direction: one that should not count is a decision
#: somebody has to make out loud, whereas an allow-list silently stops counting
#: whatever nobody remembered to add.
#:
#: Only `Cancelled` is exempt. The slot is released, the work did not happen,
#: and the technician already pays the cancellation band — counting it would
#: charge them twice.
#:
#: `Closed` and `Force-Closed` DO count, which is the load-bearing call here. If
#: finishing a job freed capacity, a technician who completed all five of
#: Friday's jobs would find Friday empty again and take a sixth — and the cap
#: would mean "how many can I have open at once", varying with how quickly
#: customers answer their feedback link. It means "how many jobs will I do that
#: day".
CAP_EXEMPT_STATUSES = ("Cancelled",)


async def technicians_covering(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    pincode: str,
    subcategory_id: uuid.UUID,
    slot_start: datetime.datetime | None = None,
) -> list[uuid.UUID]:
    """Technician profile ids eligible to be offered this job.

    Only technicians who are ONLINE. Going offline is the app's way of saying
    "do not offer me work", and a push that ignored it would make the toggle a
    lie — the one setting a technician uses to protect their evening.

    `slot_start` applies the DAILY CAP as well, and omitting it is a bug waiting
    to happen: `pool_query` hides a job from a technician whose day is full, so
    without this they would still be pushed about it, tap the notification, and
    land on a job they cannot take. That is precisely the notification that
    teaches people to ignore notifications. It is optional only because a caller
    may genuinely not have a slot — a ticket in the pool always does.

    Returns profile ids, which is what `push_tokens.technician_id` keys on.
    """
    covers_pincode = (
        select(TechnicianPincode.id)
        .where(
            TechnicianPincode.company_id == company_id,
            TechnicianPincode.technician_id == TechnicianProfile.id,
            TechnicianPincode.pincode == pincode,
        )
        .exists()
    )
    certified_for = (
        select(TechnicianSubcategory.id)
        .where(
            TechnicianSubcategory.company_id == company_id,
            TechnicianSubcategory.technician_id == TechnicianProfile.id,
            TechnicianSubcategory.subcategory_id == subcategory_id,
        )
        .exists()
    )

    conditions = [
        TechnicianProfile.company_id == company_id,
        # `status`, not a soft-delete column — this table has none.
        # A suspended technician keeps their coverage rows, so
        # filtering on coverage alone would still reach them.
        TechnicianProfile.status == ACTIVE,
        TechnicianProfile.accepting_work.is_(True),
        covers_pincode,
        certified_for,
    ]
    if slot_start is not None:
        conditions.append(has_room_at(slot_start))

    return list(await db.scalars(select(TechnicianProfile.id).where(*conditions)))


def ist_date(column: ColumnElement) -> ColumnElement:
    """The local calendar date of a `timestamptz`.

    Slots are stored `timestamptz`, and a raw `::date` would split the day in
    whatever timezone the CONNECTION happens to be set to — silently, with
    nothing in the result to show it happened. Worse, UTC splits an Indian day
    in the wrong place: a 05:00 IST job is 23:30 UTC the previous day, so two
    jobs the technician experiences as one morning would count against two
    different caps.

    `SLOT_TIMEZONE_OFFSET_MINUTES` is reused rather than a second constant. It
    is already what the slot windows are generated from and what `list_today`
    measures "today" with; a second source of truth for the same fact is one
    that drifts.
    """
    return cast(
        func.timezone("UTC", column)
        + datetime.timedelta(minutes=SLOT_TIMEZONE_OFFSET_MINUTES),
        Date,
    )


def jobs_held_on(
    *, company_id: uuid.UUID, technician_id: uuid.UUID, on_date: ColumnElement
) -> ColumnElement:
    """How many jobs this technician already holds for that IST date.

    `on_date` is an expression, not a value, so this works both correlated to an
    outer `Ticket` (the pool query, asking "on the day of THIS candidate") and
    against a literal date (the console's `bwUsed`).
    """
    held = aliased(Ticket)
    return (
        select(func.count())
        .select_from(held)
        .where(
            held.company_id == company_id,
            held.technician_id == technician_id,
            held.deleted_at.is_(None),
            held.status.not_in(CAP_EXEMPT_STATUSES),
            held.slot_start.is_not(None),
            ist_date(held.slot_start) == on_date,
        )
        .scalar_subquery()
    )


def has_cap_room(*, company_id: uuid.UUID, technician_id: uuid.UUID) -> ColumnElement:
    """Has this technician room on the day of the ticket being considered?

    Correlates to the OUTER `Ticket`, so it drops straight into `pool_query`'s
    WHERE clause and into the guarded UPDATE in `accept` — the same predicate
    deciding what is offered and what may be taken, which is what stops the pool
    showing a job that accepting would then refuse.

    A NULL cap is unlimited and short-circuits to true. That is the default every
    technician starts with, so the common case costs no counting.

    Counted by SLOT date, not by when the job was accepted. "Maximum installs
    you'll take per day" is about work performed: taking five jobs this evening
    for next Friday should exhaust FRIDAY, not tonight.
    """
    cap = (
        select(TechnicianProfile.daily_job_cap)
        .where(
            TechnicianProfile.company_id == company_id,
            TechnicianProfile.id == technician_id,
        )
        .scalar_subquery()
    )
    used = jobs_held_on(
        company_id=company_id,
        technician_id=technician_id,
        on_date=ist_date(Ticket.slot_start),
    )
    # `CASE`, not `OR`. Postgres does not promise an evaluation order for `OR`,
    # and an uncapped technician is the DEFAULT — the common path must provably
    # skip the count rather than merely usually skip it.
    #
    # `<`, never `<=`: a cap of 5 with `<=` admits a sixth job.
    return case((cap.is_(None), True), else_=used < cap)


def has_room_at(slot_start: datetime.datetime) -> ColumnElement:
    """The cap predicate with the PROFILE as the outer row and the day fixed.

    `has_cap_room` is the mirror of this: there the technician is fixed and the
    day comes from the candidate ticket. Here the day is known and the question
    is which technicians still have room on it — which is what push targeting
    asks.

    Uses a half-open UTC range rather than `ist_date`, so it is sargable and
    reaches `ix_tickets_company_technician`. The cast form cannot be indexed —
    see `ist_day_bounds`.
    """
    start, end = ist_day_bounds(slot_start)
    held = aliased(Ticket)
    used = (
        select(func.count())
        .select_from(held)
        .where(
            held.company_id == TechnicianProfile.company_id,
            held.technician_id == TechnicianProfile.id,
            held.deleted_at.is_(None),
            held.status.not_in(CAP_EXEMPT_STATUSES),
            held.slot_start >= start,
            held.slot_start < end,
        )
        .scalar_subquery()
    )
    return case(
        (TechnicianProfile.daily_job_cap.is_(None), True),
        else_=used < TechnicianProfile.daily_job_cap,
    )


def ist_day_bounds(
    when: datetime.datetime,
) -> tuple[datetime.datetime, datetime.datetime]:
    """The half-open UTC range covering the IST day containing `when`.

    A range rather than a date cast, and that is not a style choice: the cast in
    `ist_date` cannot use an index, because `timezone(text, timestamptz)` is
    STABLE rather than IMMUTABLE and Postgres will not build a functional index
    on it. Wherever the date is known in Python — which is everywhere except the
    correlated pool predicate — this form is sargable and uses
    `ix_tickets_company_technician` as it stands.
    """
    offset = datetime.timedelta(minutes=SLOT_TIMEZONE_OFFSET_MINUTES)
    local = when.astimezone(datetime.timezone(offset))
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    start = midnight.astimezone(datetime.timezone.utc)
    return start, start + datetime.timedelta(days=1)


async def jobs_today_by_technician(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    technician_ids: list[uuid.UUID],
    now: datetime.datetime | None = None,
) -> dict[uuid.UUID, int]:
    """How many jobs each of these technicians holds for today, by SLOT date.

    One grouped query for a whole page — `_technicians_out` hydrates a list and
    its own docstring forbids N+1.

    Counted by the same rule the cap enforces, deliberately. If the console's
    bandwidth bar and the pool disagreed, one of them would be lying to somebody
    about the same technician's day.
    """
    if not technician_ids:
        return {}
    start, end = ist_day_bounds(now or datetime.datetime.now(datetime.timezone.utc))
    rows = await db.execute(
        select(Ticket.technician_id, func.count())
        .where(
            Ticket.company_id == company_id,
            Ticket.technician_id.in_(technician_ids),
            Ticket.deleted_at.is_(None),
            Ticket.status.not_in(CAP_EXEMPT_STATUSES),
            Ticket.slot_start >= start,
            Ticket.slot_start < end,
        )
        .group_by(Ticket.technician_id)
    )
    counts = {tid: n for tid, n in rows}
    # Absent means none, and the caller wants a number for every technician it
    # asked about rather than a dict it has to `.get(…, 0)` at each use.
    return {tid: counts.get(tid, 0) for tid in technician_ids}


async def area_managers_covering(
    db: AsyncSession, *, company_id: uuid.UUID, pincode: str
) -> list[User]:
    """The area managers responsible for this pincode, for reaching OFF console.

    `core.scope.visible_pincodes` answers "which codes are this person's"; this
    is the same rule read backwards — which people is this code's.

    Area managers ONLY, and that is the point rather than a limitation. The
    requirement document sends an escalation to the Area Service Manager, and
    every rank above them covers so much ground that a message per escalation
    would be a message they learn to ignore. The bell still reaches everyone
    senior; this is the interruption, and an interruption that fires too often
    stops being one.

    A pincode belongs to exactly one state, and an area manager covers states,
    so the join is direct — no `pincodes_in_states` subquery needed in this
    direction.

    Returns only managers who have a phone number. `users.phone` is nullable
    for console staff, who sign in with an email; one without a number cannot
    be reached this way and the caller is told how many were skipped.
    """
    state = select(Pincode.state_id).where(Pincode.code == pincode).scalar_subquery()

    return list(
        await db.scalars(
            select(User)
            .join(Membership, Membership.user_id == User.id)
            .join(MembershipState, MembershipState.membership_id == Membership.id)
            .where(
                Membership.company_id == company_id,
                Membership.is_active.is_(True),
                Membership.deleted_at.is_(None),
                User.role == AREA_MANAGER,
                User.is_active.is_(True),
                User.deleted_at.is_(None),
                User.phone.is_not(None),
                MembershipState.state_id == state,
            )
            .distinct()
        )
    )


async def users_notified_by(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    pincode: str | None,
    vendor_id: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    """Whose browsers should be pushed about this notification.

    `notifications.service._visible` asks "which notifications may THIS reader
    see". This asks the other direction: given a notification that has just been
    raised, who should hear about it. Same rule, read backwards — the same
    relationship `area_managers_covering` above has with `visible_pincodes`.

    ## It must agree with `_visible`, and that is the whole risk

    Somebody pushed about an event they then cannot find on `/notifications`
    opens the console to an empty feed, and that is precisely the notification
    that teaches people to ignore notifications. The two cannot share code —
    `_visible` narrows a query correlated to one principal, this one tests many
    principals against literals — so they are duplicated deliberately, exactly
    as `technicians_covering` duplicates `pool_query`. **If a sixth audience
    rule is ever added it belongs in both, and this note is where whoever adds
    it should look.**

    Four branches, mirroring `_visible` clause for clause:

    * **Admin and national head** hear everything in the company. They are the
      `ALL_INDIA_ROLES` for whom `visible_pincodes` returns None. A superadmin
      is in that set too and is silently absent here for the right reason: they
      hold no membership, so they never join.
    * **An area manager** hears a notification whose pincode is in one of their
      states — a pincode belongs to exactly one state, so the join is direct.
    * **A regional head** hears the same thing one level up, via the state's
      region.
    * **A vendor's people** hear a row that NAMES their vendor. It widens the
      audience; it never narrows the staff one.

    Note what the `EXISTS` clauses do to a company-wide row (`pincode IS NULL`):
    an area manager with no states assigned hears nothing at all, not even that.
    That is not an oversight — it is `_visible` failing closed on an empty
    scope, and the mirror has to fail closed the same way or the push would
    reach somebody whose feed is empty.

    Returns user ids, which is what `web_push_subscriptions.user_id` keys on.
    """
    state_of_pincode = (
        select(Pincode.state_id).where(Pincode.code == pincode).scalar_subquery()
    )
    region_of_pincode = (
        select(State.region_id)
        .join(Pincode, Pincode.state_id == State.id)
        .where(Pincode.code == pincode)
        .scalar_subquery()
    )

    # An area manager's states, restricted to the one holding this pincode
    # unless the row is company-wide.
    covers_state = select(MembershipState.id).where(
        MembershipState.membership_id == Membership.id
    )
    covers_region = select(MembershipRegion.id).where(
        MembershipRegion.membership_id == Membership.id
    )
    if pincode is not None:
        covers_state = covers_state.where(MembershipState.state_id == state_of_pincode)
        covers_region = covers_region.where(
            MembershipRegion.region_id == region_of_pincode
        )

    audience = [
        User.role.in_(ALL_INDIA_ROLES),
        (User.role == AREA_MANAGER) & covers_state.exists(),
        (User.role == REGIONAL_HEAD) & covers_region.exists(),
    ]
    if vendor_id is not None:
        audience.append(
            User.role.in_(VENDOR_ROLES) & (Membership.vendor_id == vendor_id)
        )

    return list(
        await db.scalars(
            select(Membership.user_id)
            .join(User, User.id == Membership.user_id)
            .where(
                Membership.company_id == company_id,
                Membership.is_active.is_(True),
                Membership.deleted_at.is_(None),
                User.is_active.is_(True),
                User.deleted_at.is_(None),
                or_(*audience),
            )
            .distinct()
        )
    )

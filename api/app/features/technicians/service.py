"""Technician onboarding — both modes, and everything that reads them back.

Two ways a technician comes to exist:

    direct   a manager fills in everything; `create_technician` writes the
             User, Membership and profile in one go. registered_by='manager'.
    invite   a manager supplies only a phone; `create_invite` sends a link and
             the technician completes it themselves from the app. The write
             lands in `features/onboarding`, with registered_by='self'.

Visibility deliberately does NOT reuse `db.repository.territory_scope`. Its
area-manager branch filters through `membership_pincodes` — the one table
technician coverage cannot use — so an ASM would see zero technicians through
it. `_visible_technicians` below is the equivalent written against
`technician_pincodes` plus the manager link.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, func, literal, or_, select, union_all
from sqlalchemy import false as sql_false
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import Principal
from app.core.schemas import ListParams
from app.core.scope import (
    ALL_INDIA_ROLES,
    Scope,
    load_scope,
    own_scope,
    pincodes_in_regions,
    pincodes_in_states,
)
from app.core.sequences import next_code as allocate_code
from app.features.technicians.schemas import (
    InviteCreateRequest,
    OnboardingOut,
    SubcategoryRef,
    TechnicianCreateRequest,
    TechnicianInviteOut,
    TechnicianOut,
    TechnicianSessionOut,
    TechnicianUpdateRequest,
)
from app.integrations import whatsapp
from app.models.company import Company
from app.models.membership import Membership
from app.models.product import ProductCategory, ProductSubcategory
from app.models.role import AREA_MANAGER, ROLE_LABELS, TECHNICIAN
from app.models.technician import (
    ACTIVE,
    CANCELLED,
    EXPIRED,
    FAILED,
    LIVE_INVITE_STATUSES,
    MODE_DIRECT,
    MODE_INVITE,
    PENDING,
    REG_MANAGER,
    REGISTERED,
    SENT,
    TechnicianInvite,
    TechnicianInvitePincode,
    TechnicianPincode,
    TechnicianProfile,
    TechnicianSubcategory,
)
from app.models.territory import MembershipRegion, Pincode, Region
from app.models.user import User


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _not_found(what: str = "Technician") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} not found"
    )


def invite_link(token: str) -> str:
    return f"{settings.INVITE_LINK_BASE.rstrip('/')}/{token}"


# ── territory ─────────────────────────────────────────────────────────────────


async def resolve_region(
    session: AsyncSession, principal: Principal, region_id: uuid.UUID | None
) -> Region:
    """Which region this technician works in.

    An area manager holds exactly one, so they never have to pick. A regional
    head with one region is likewise filled in. Anyone else must say.
    """
    _own_id, own = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )

    if region_id is None:
        if len(own.regions) == 1:
            return own.regions[0]
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Select the region this technician will work in",
        )

    region = await session.scalar(select(Region).where(Region.id == region_id))
    if region is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown region"
        )
    if principal.role not in ALL_INDIA_ROLES and region.id not in own.region_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only onboard technicians into your own regions",
        )
    return region


async def check_pincodes_exist(
    session: AsyncSession, region_id: uuid.UUID, pincodes: list[str]
) -> None:
    """Every pincode must be real, and inside the region being assigned.

    The geography master makes this answerable for the first time: before it
    existed a manager could type any six digits and nobody found out until a
    job was raised somewhere nobody covered.
    """
    if not pincodes:
        return
    wanted = sorted(set(pincodes))
    inside = set(
        (
            await session.scalars(
                pincodes_in_regions([region_id]).where(Pincode.code.in_(wanted))
            )
        ).all()
    )
    outside = [code for code in wanted if code not in inside]
    if outside:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Not in this region: {', '.join(outside)}. "
                "Pick pincodes from the region you selected."
            ),
        )


async def check_pincodes_in_own_area(
    session: AsyncSession, principal: Principal, pincodes: list[str]
) -> None:
    """An area manager may only assign pincodes from their own territory.

    Their territory is a set of STATES, and they cover every pincode inside
    them — so a technician they onboard who serves outside those states is by
    definition somebody else's to manage.

    Checked as one bounded query over the codes actually submitted, never by
    loading the states' full pincode list: Uttar Pradesh alone holds 1,667, and
    the question is only ever "are these few inside?".

    The refusal names the offending codes so the console can say which ones,
    rather than making the manager guess.
    """
    if principal.role != AREA_MANAGER or not pincodes:
        return

    _own_id, own = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )
    wanted = sorted(set(pincodes))
    if not own.state_ids:
        # Covers no states, so covers nothing. Fail closed rather than allowing
        # everything through an empty-set subtraction.
        inside: set[str] = set()
    else:
        inside = set(
            (
                await session.scalars(
                    pincodes_in_states(own.state_ids).where(Pincode.code.in_(wanted))
                )
            ).all()
        )
    outside = [code for code in wanted if code not in inside]
    if outside:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Outside your area: "
                f"{', '.join(outside)}. You can only add pincodes you cover."
            ),
        )


async def invite_pincodes(
    session: AsyncSession, invite_id: uuid.UUID
) -> list[str]:
    """The coverage a manager assigned when sending this invite."""
    rows = await session.scalars(
        select(TechnicianInvitePincode.pincode)
        .where(TechnicianInvitePincode.invite_id == invite_id)
        .order_by(TechnicianInvitePincode.pincode)
    )
    return list(rows)


async def set_invite_pincodes(
    session: AsyncSession,
    *,
    invite: TechnicianInvite,
    pincodes: list[str],
    actor_id: uuid.UUID,
) -> None:
    """Replace an invite's coverage. Caller has already validated it."""
    await session.execute(
        delete(TechnicianInvitePincode).where(
            TechnicianInvitePincode.invite_id == invite.id
        )
    )
    for code in dict.fromkeys(pincodes):
        session.add(
            TechnicianInvitePincode(
                invite_id=invite.id,
                company_id=invite.company_id,
                pincode=code,
                created_by=actor_id,
            )
        )


# ── visibility ────────────────────────────────────────────────────────────────


def _visible_technicians(stmt, principal: Principal, own_id, own: Scope):
    """What this role sees in the technician list.

    Not `territory_scope`: that helper filters a MEMBERSHIP query, and a
    technician's coverage lives in `technician_pincodes` — a separate table with
    the opposite rule (many technicians share one pincode).
    """
    if principal.role in ALL_INDIA_ROLES:
        return stmt

    mine = TechnicianProfile.appointed_by_user_id == principal.user_id

    if own.region_ids:
        if principal.role == AREA_MANAGER:
            # Their own reports, anyone covering a pincode inside their states,
            # and anyone they appointed — an ASM must not lose a technician
            # because the technician's coverage later drifted.
            #
            # The pincode test is a subquery against the master, not a list: an
            # area manager's states can hold thousands of codes and this runs on
            # every page of the technician list.
            covers = select(TechnicianPincode.technician_id).where(
                TechnicianPincode.technician_id == TechnicianProfile.id,
                TechnicianPincode.pincode.in_(pincodes_in_states(own.state_ids))
                if own.state_ids
                else sql_false(),
            )
            return stmt.where(
                or_(
                    Membership.manager_id == own_id,
                    covers.exists(),
                    mine,
                )
            )
        return stmt.where(
            or_(TechnicianProfile.region_id.in_(own.region_ids), mine)
        )

    # No territory yet — only what they appointed themselves.
    return stmt.where(mine)


def _visible_invites(stmt, principal: Principal, own: Scope):
    if principal.role in ALL_INDIA_ROLES:
        return stmt
    mine = TechnicianInvite.invited_by_user_id == principal.user_id
    if own.region_ids:
        return stmt.where(or_(TechnicianInvite.region_id.in_(own.region_ids), mine))
    return stmt.where(mine)


# ── hydration ─────────────────────────────────────────────────────────────────


async def _subcategories_by_technician(
    session: AsyncSession, technician_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[SubcategoryRef]]:
    if not technician_ids:
        return {}
    rows = await session.execute(
        select(
            TechnicianSubcategory.technician_id,
            ProductSubcategory.id,
            ProductSubcategory.name,
            ProductCategory.name,
        )
        .join(
            ProductSubcategory,
            ProductSubcategory.id == TechnicianSubcategory.subcategory_id,
        )
        .join(ProductCategory, ProductCategory.id == ProductSubcategory.category_id)
        .where(TechnicianSubcategory.technician_id.in_(technician_ids))
        .order_by(ProductCategory.sort_order, ProductSubcategory.sort_order)
    )
    out: dict[uuid.UUID, list[SubcategoryRef]] = {}
    for tech_id, sub_id, sub_name, cat_name in rows:
        out.setdefault(tech_id, []).append(
            SubcategoryRef(id=sub_id, name=sub_name, categoryName=cat_name)
        )
    return out


async def _pincodes_by_technician(
    session: AsyncSession, technician_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[str]]:
    if not technician_ids:
        return {}
    rows = await session.execute(
        select(TechnicianPincode.technician_id, TechnicianPincode.pincode)
        .where(TechnicianPincode.technician_id.in_(technician_ids))
        .order_by(TechnicianPincode.pincode)
    )
    out: dict[uuid.UUID, list[str]] = {}
    for tech_id, pincode in rows:
        out.setdefault(tech_id, []).append(pincode)
    return out


async def _appointers(
    session: AsyncSession, user_ids: list[uuid.UUID]
) -> dict[uuid.UUID, User]:
    ids = [i for i in user_ids if i is not None]
    if not ids:
        return {}
    rows = await session.scalars(select(User).where(User.id.in_(ids)))
    return {u.id: u for u in rows}


async def _technicians_out(
    session: AsyncSession, triples: list[tuple[TechnicianProfile, Membership, User]]
) -> list[TechnicianOut]:
    """Batch-hydrate profiles into responses — one query per collection, never N+1."""
    if not triples:
        return []
    ids = [p.id for p, _m, _u in triples]
    subs = await _subcategories_by_technician(session, ids)
    pins = await _pincodes_by_technician(session, ids)
    appointers = await _appointers(
        session, [p.appointed_by_user_id for p, _m, _u in triples]
    )
    regions = {
        r.id: r
        for r in await session.scalars(
            select(Region).where(
                Region.id.in_([p.region_id for p, _m, _u in triples])
            )
        )
    }

    out: list[TechnicianOut] = []
    for profile, membership, user in triples:
        appointer = appointers.get(profile.appointed_by_user_id)
        out.append(
            TechnicianOut(
                id=profile.id,
                membershipId=membership.id,
                userId=user.id,
                code=profile.code,
                name=user.full_name or user.phone or "—",
                phone=user.phone or "",
                profileImageUrl=user.profile_image_url,
                isActive=membership.is_active and user.is_active,
                status=profile.status,
                regionId=profile.region_id,
                regionName=regions[profile.region_id].name,
                subcategories=subs.get(profile.id, []),
                pincodes=pins.get(profile.id, []),
                dailyJobCap=profile.daily_job_cap,
                bwUsed=0,
                rating=float(profile.rating) if profile.rating is not None else None,
                jobsCompleted=profile.jobs_completed,
                jobsCancelled=profile.jobs_cancelled,
                onTimePct=profile.on_time_pct,
                onboarding=OnboardingOut(
                    mode=profile.onboarding_mode,
                    registeredBy=profile.registered_by,
                    appointedByName=(appointer.full_name if appointer else None),
                    appointedByEmail=(appointer.email if appointer else None),
                    appointedByRole=(appointer.role if appointer else None),
                    appointedByRoleLabel=(
                        ROLE_LABELS.get(appointer.role, appointer.role)
                        if appointer
                        else None
                    ),
                    appointedAt=profile.appointed_at,
                    registeredAt=profile.registered_at,
                ),
                createdAt=profile.created_at,
            )
        )
    return out


async def _invites_out(
    session: AsyncSession, invites: list[TechnicianInvite]
) -> list[TechnicianInviteOut]:
    if not invites:
        return []
    inviters = await _appointers(session, [i.invited_by_user_id for i in invites])
    regions = {
        r.id: r
        for r in await session.scalars(
            select(Region).where(Region.id.in_([i.region_id for i in invites]))
        )
    }
    # One query for every invite's coverage, never one per row.
    coverage: dict[uuid.UUID, list[str]] = {i.id: [] for i in invites}
    for invite_id, code in await session.execute(
        select(TechnicianInvitePincode.invite_id, TechnicianInvitePincode.pincode)
        .where(TechnicianInvitePincode.invite_id.in_([i.id for i in invites]))
        .order_by(TechnicianInvitePincode.pincode)
    ):
        coverage[invite_id].append(code)
    return [
        TechnicianInviteOut(
            id=i.id,
            phone=i.phone,
            status=i.status,
            regionId=i.region_id,
            regionName=regions[i.region_id].name,
            invitedByName=(
                inviters[i.invited_by_user_id].full_name
                if i.invited_by_user_id in inviters
                else None
            ),
            invitedByEmail=(
                inviters[i.invited_by_user_id].email
                if i.invited_by_user_id in inviters
                else None
            ),
            inviteLink=invite_link(i.token),
            failureReason=i.wa_error,
            dailyJobCap=i.daily_job_cap,
            pincodes=coverage[i.id],
            sentAt=i.sent_at,
            registeredAt=i.registered_at,
            expiresAt=i.expires_at,
            createdAt=i.created_at,
        )
        for i in invites
    ]


# ── list ──────────────────────────────────────────────────────────────────────


async def list_technicians(
    session: AsyncSession,
    principal: Principal,
    params: ListParams,
    *,
    view: str = "all",
    tech_status: str | None = None,
    invite_status: str | None = None,
    region_id: uuid.UUID | None = None,
    subcategory_id: uuid.UUID | None = None,
    pincode: str | None = None,
    onboarding_mode: str | None = None,
) -> tuple[list, int]:
    """One page of the Technicians screen — registered technicians and open invites.

    They are one entity at two lifecycle stages, so they share a list. That
    means a UNION: paginating two endpoints into one table would give a page
    size that is neither endpoint's.

    The union carries only (kind, id, created_at) — just enough to order and
    slice — and each side is hydrated afterwards, so neither query has to be
    shaped like the other.
    """
    own_id, own = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )
    company_id = principal.company_id
    term = f"%{params.search.lower()}%" if params.search else None

    tech_keys = (
        select(
            literal("tech").label("kind"),
            TechnicianProfile.id.label("row_id"),
            TechnicianProfile.created_at.label("created_at"),
        )
        .join(Membership, Membership.id == TechnicianProfile.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            TechnicianProfile.company_id == company_id,
            Membership.deleted_at.is_(None),
            User.deleted_at.is_(None),
        )
    )
    tech_keys = _visible_technicians(tech_keys, principal, own_id, own)
    if tech_status:
        tech_keys = tech_keys.where(TechnicianProfile.status == tech_status)
    if region_id:
        tech_keys = tech_keys.where(TechnicianProfile.region_id == region_id)
    if onboarding_mode:
        tech_keys = tech_keys.where(
            TechnicianProfile.onboarding_mode == onboarding_mode
        )
    if subcategory_id:
        tech_keys = tech_keys.where(
            select(TechnicianSubcategory.id)
            .where(
                TechnicianSubcategory.technician_id == TechnicianProfile.id,
                TechnicianSubcategory.subcategory_id == subcategory_id,
            )
            .exists()
        )
    if pincode:
        tech_keys = tech_keys.where(
            select(TechnicianPincode.id)
            .where(
                TechnicianPincode.technician_id == TechnicianProfile.id,
                TechnicianPincode.pincode == pincode,
            )
            .exists()
        )
    if term:
        tech_keys = tech_keys.where(
            or_(
                func.lower(User.full_name).like(term),
                func.lower(User.phone).like(term),
                func.lower(TechnicianProfile.code).like(term),
            )
        )

    invite_keys = select(
        literal("invite").label("kind"),
        TechnicianInvite.id.label("row_id"),
        TechnicianInvite.created_at.label("created_at"),
    ).where(
        TechnicianInvite.company_id == company_id,
        # A registered invite has become a technician row; showing both would
        # list the same person twice.
        TechnicianInvite.status != REGISTERED,
    )
    invite_keys = _visible_invites(invite_keys, principal, own)
    if invite_status:
        invite_keys = invite_keys.where(TechnicianInvite.status == invite_status)
    if region_id:
        invite_keys = invite_keys.where(TechnicianInvite.region_id == region_id)
    if term:
        invite_keys = invite_keys.where(func.lower(TechnicianInvite.phone).like(term))

    # An invite has no status, subcategory, pincode or mode of the technician
    # kind — filtering on one is implicitly "registered only".
    if view == "registered" or tech_status or subcategory_id or pincode or onboarding_mode:
        combined = tech_keys.subquery()
    elif view == "invites" or invite_status:
        combined = invite_keys.subquery()
    else:
        combined = union_all(tech_keys, invite_keys).subquery()

    total = await session.scalar(
        select(func.count()).select_from(combined.alias("counted"))
    )

    page = (
        await session.execute(
            select(combined.c.kind, combined.c.row_id)
            .order_by(combined.c.created_at.desc())
            .limit(params.limit)
            .offset(params.offset)
        )
    ).all()

    tech_ids = [rid for kind, rid in page if kind == "tech"]
    invite_ids = [rid for kind, rid in page if kind == "invite"]

    triples = (
        (
            await session.execute(
                select(TechnicianProfile, Membership, User)
                .join(Membership, Membership.id == TechnicianProfile.membership_id)
                .join(User, User.id == Membership.user_id)
                .where(TechnicianProfile.id.in_(tech_ids))
            )
        ).all()
        if tech_ids
        else []
    )
    invites = (
        list(
            await session.scalars(
                select(TechnicianInvite).where(TechnicianInvite.id.in_(invite_ids))
            )
        )
        if invite_ids
        else []
    )

    by_id: dict[uuid.UUID, object] = {}
    for row in await _technicians_out(session, [tuple(t) for t in triples]):
        by_id[row.id] = row
    for row in await _invites_out(session, invites):
        by_id[row.id] = row

    # Re-apply the union's order — the hydration queries do not preserve it.
    rows = [by_id[rid] for _kind, rid in page if rid in by_id]
    return rows, int(total or 0)


# ── read one ──────────────────────────────────────────────────────────────────


async def _load(
    session: AsyncSession, principal: Principal, technician_id: uuid.UUID
):
    own_id, own = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )
    stmt = (
        select(TechnicianProfile, Membership, User)
        .join(Membership, Membership.id == TechnicianProfile.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            TechnicianProfile.id == technician_id,
            TechnicianProfile.company_id == principal.company_id,
            Membership.deleted_at.is_(None),
        )
    )
    # The same filter as the list, so a guessed id from another area reads as
    # absent rather than forbidden — 404, never 403.
    stmt = _visible_technicians(stmt, principal, own_id, own)
    row = (await session.execute(stmt)).first()
    if row is None:
        raise _not_found()
    return tuple(row)


async def get_technician(
    session: AsyncSession, principal: Principal, technician_id: uuid.UUID
) -> TechnicianOut:
    triple = await _load(session, principal, technician_id)
    return (await _technicians_out(session, [triple]))[0]


async def get_me(session: AsyncSession, principal: Principal) -> TechnicianSessionOut:
    if principal.role != TECHNICIAN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not a technician account"
        )
    row = (
        await session.execute(
            select(TechnicianProfile, Membership, User)
            .join(Membership, Membership.id == TechnicianProfile.membership_id)
            .join(User, User.id == Membership.user_id)
            .where(
                Membership.user_id == principal.user_id,
                TechnicianProfile.company_id == principal.company_id,
                Membership.deleted_at.is_(None),
            )
        )
    ).first()
    if row is None:
        raise _not_found("Technician profile")
    return await technician_session(session, *tuple(row))


async def technician_session(
    session: AsyncSession,
    profile: TechnicianProfile,
    membership: Membership,
    user: User,
) -> TechnicianSessionOut:
    """The shape the mobile app gets on sign-in and from /technicians/me."""
    subs = (await _subcategories_by_technician(session, [profile.id])).get(
        profile.id, []
    )
    pins = (await _pincodes_by_technician(session, [profile.id])).get(profile.id, [])
    region = await session.scalar(select(Region).where(Region.id == profile.region_id))
    company = await session.scalar(
        select(Company).where(Company.id == profile.company_id)
    )
    appointer = (
        await _appointers(session, [profile.appointed_by_user_id])
    ).get(profile.appointed_by_user_id)

    onboarded_by = company.name if company else "Videocon Service"
    if appointer and appointer.full_name:
        onboarded_by = f"{appointer.full_name} · {onboarded_by}"

    return TechnicianSessionOut(
        id=profile.id,
        code=profile.code,
        name=user.full_name or "",
        phone=user.phone or "",
        profileImageUrl=user.profile_image_url,
        regionName=region.name if region else "—",
        onboardedBy=onboarded_by,
        subcategories=subs,
        pincodes=pins,
        dailyJobCap=profile.daily_job_cap,
        status=profile.status,
        rating=float(profile.rating) if profile.rating is not None else None,
        jobsCompleted=profile.jobs_completed,
        onTimePct=profile.on_time_pct,
    )


# ── write helpers ─────────────────────────────────────────────────────────────


async def next_code(session: AsyncSession, company_id: uuid.UUID) -> str:
    """`TCH-4021`, from the company's counter row — see `app.core.sequences`.

    Was `4021 + COUNT(*)`, which raced: two managers onboarding at once read the
    same count, and one got a 409 on a code the other had just taken.
    """
    return await allocate_code(session, company_id, "technician")


async def validate_subcategories(
    session: AsyncSession, company_id: uuid.UUID, ids: list[uuid.UUID]
) -> list[uuid.UUID]:
    unique = list(dict.fromkeys(ids))
    found = list(
        await session.scalars(
            select(ProductSubcategory.id).where(
                ProductSubcategory.id.in_(unique),
                ProductSubcategory.company_id == company_id,
                ProductSubcategory.is_active.is_(True),
                ProductSubcategory.deleted_at.is_(None),
            )
        )
    )
    if len(found) != len(unique):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unknown or inactive category",
        )
    return unique


async def set_certifications(
    session: AsyncSession,
    *,
    profile: TechnicianProfile,
    subcategory_ids: list[uuid.UUID],
    actor_id: uuid.UUID | None,
) -> None:
    await session.execute(
        delete(TechnicianSubcategory).where(
            TechnicianSubcategory.technician_id == profile.id
        )
    )
    for sub_id in dict.fromkeys(subcategory_ids):
        session.add(
            TechnicianSubcategory(
                # Denormalised so the composite FKs can check BOTH ends: a
                # technician certified against another company's catalogue is
                # rejected by the database, not just by the caller above.
                company_id=profile.company_id,
                technician_id=profile.id,
                subcategory_id=sub_id,
                created_by=actor_id,
            )
        )
    # The session runs with autoflush=False, so a caller that reads the
    # certifications back before committing — self-registration builds its
    # sign-in payload that way — would otherwise see none of these.
    await session.flush()


async def set_coverage(
    session: AsyncSession,
    *,
    profile: TechnicianProfile,
    pincodes: list[str],
    actor_id: uuid.UUID | None,
) -> None:
    await session.execute(
        delete(TechnicianPincode).where(TechnicianPincode.technician_id == profile.id)
    )
    for pincode in dict.fromkeys(pincodes):
        session.add(
            TechnicianPincode(
                technician_id=profile.id,
                company_id=profile.company_id,
                pincode=pincode,
                created_by=actor_id,
            )
        )
    # Same reason as set_certifications: autoflush is off, and the coverage is
    # read straight back into the response that signs the technician in.
    await session.flush()


async def reuse_or_create_user(
    session: AsyncSession,
    *,
    phone: str,
    full_name: str,
    profile_image_url: str | None,
    actor_id: uuid.UUID | None,
) -> User:
    """One identity per phone.

    A soft-deleted technician is revived rather than duplicated — the partial
    unique index frees a removed technician's number, so re-onboarding the same
    person must reuse the row instead of racing the index.
    """
    existing = await session.scalar(
        select(User).where(User.phone == phone, User.role == TECHNICIAN)
    )
    if existing is not None:
        if existing.deleted_at is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{phone} is already a technician",
            )
        existing.deleted_at = None
        existing.is_active = True
        existing.full_name = full_name
        if profile_image_url is not None:
            existing.profile_image_url = profile_image_url
        existing.updated_by = actor_id
        return existing

    user = User(
        email=None,
        password_hash=None,
        full_name=full_name,
        phone=phone,
        role=TECHNICIAN,
        profile_image_url=profile_image_url,
        is_active=True,
        created_by=actor_id,
    )
    session.add(user)
    return user


async def reuse_or_create_membership(
    session: AsyncSession,
    *,
    user: User,
    company_id: uuid.UUID,
    manager_id: uuid.UUID | None,
    actor_id: uuid.UUID | None,
) -> Membership:
    membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == user.id, Membership.company_id == company_id
        )
    )
    if membership is not None:
        membership.deleted_at = None
        membership.is_active = True
        membership.manager_id = manager_id
        membership.updated_by = actor_id
        return membership

    membership = Membership(
        user_id=user.id,
        company_id=company_id,
        manager_id=manager_id,
        is_active=True,
        created_by=actor_id,
    )
    session.add(membership)
    return membership


async def set_membership_region(
    session: AsyncSession,
    *,
    membership: Membership,
    region_id: uuid.UUID,
    actor_id: uuid.UUID | None,
) -> None:
    """Also write the membership's region row.

    Technician territory lives on the profile, but a Regional Head's existing
    `territory_scope` filter reads `membership_regions` — without this row a
    technician is invisible to every screen that reuses it.
    """
    await session.execute(
        delete(MembershipRegion).where(
            MembershipRegion.membership_id == membership.id
        )
    )
    session.add(
        MembershipRegion(
            membership_id=membership.id, region_id=region_id, created_by=actor_id
        )
    )


async def _own_membership_id(
    session: AsyncSession, principal: Principal
) -> uuid.UUID | None:
    own_id, _own = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )
    return own_id


# ── direct onboarding ─────────────────────────────────────────────────────────


async def create_technician(
    session: AsyncSession, principal: Principal, body: TechnicianCreateRequest
) -> TechnicianOut:
    region = await resolve_region(session, principal, body.regionId)
    await check_pincodes_exist(session, region.id, body.pincodes)
    await check_pincodes_in_own_area(session, principal, body.pincodes)
    subcategory_ids = await validate_subcategories(
        session, principal.company_id, body.subcategoryIds
    )
    # NB: never `_check_pincodes_free`. That guards membership_pincodes, where
    # a pincode belongs to one area manager. Technician coverage is shared by
    # design — two technicians on the same street is the normal case.

    own_id = await _own_membership_id(session, principal)
    manager_id = body.managerId or own_id

    user = await reuse_or_create_user(
        session,
        phone=body.phone,
        full_name=body.fullName,
        profile_image_url=body.profileImageUrl,
        actor_id=principal.user_id,
    )
    await session.flush()

    membership = await reuse_or_create_membership(
        session,
        user=user,
        company_id=principal.company_id,
        manager_id=manager_id,
        actor_id=principal.user_id,
    )
    await session.flush()
    await set_membership_region(
        session, membership=membership, region_id=region.id, actor_id=principal.user_id
    )

    profile = await session.scalar(
        select(TechnicianProfile).where(
            TechnicianProfile.membership_id == membership.id
        )
    )
    now = _now()
    if profile is None:
        profile = TechnicianProfile(
            membership_id=membership.id,
            company_id=principal.company_id,
            code=await next_code(session, principal.company_id),
            region_id=region.id,
            daily_job_cap=body.dailyJobCap,
            status=ACTIVE,
            onboarding_mode=MODE_DIRECT,
            appointed_by_user_id=principal.user_id,
            appointed_by_membership_id=own_id,
            appointed_at=now,
            registered_by=REG_MANAGER,
            registered_at=now,
            created_by=principal.user_id,
        )
        session.add(profile)
    else:
        profile.region_id = region.id
        profile.daily_job_cap = body.dailyJobCap
        profile.status = ACTIVE
        profile.updated_by = principal.user_id
    await session.flush()

    await set_certifications(
        session,
        profile=profile,
        subcategory_ids=subcategory_ids,
        actor_id=principal.user_id,
    )
    await set_coverage(
        session, profile=profile, pincodes=body.pincodes, actor_id=principal.user_id
    )
    await session.commit()

    return await get_technician(session, principal, profile.id)


async def update_technician(
    session: AsyncSession,
    principal: Principal,
    technician_id: uuid.UUID,
    body: TechnicianUpdateRequest,
) -> TechnicianOut:
    profile, membership, user = await _load(session, principal, technician_id)

    if body.regionId is not None:
        region = await resolve_region(session, principal, body.regionId)
        profile.region_id = region.id
        await set_membership_region(
            session,
            membership=membership,
            region_id=region.id,
            actor_id=principal.user_id,
        )
    if body.pincodes is not None:
        # Against the region this technician ENDS UP in — the one just set if
        # the caller changed it, otherwise the one they already had. Reading
        # `region` here unconditionally was an UnboundLocalError on every
        # coverage-only edit.
        await check_pincodes_exist(session, profile.region_id, body.pincodes)
        await check_pincodes_in_own_area(session, principal, body.pincodes)
        if not body.pincodes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A technician needs at least one pincode",
            )
        await set_coverage(
            session,
            profile=profile,
            pincodes=body.pincodes,
            actor_id=principal.user_id,
        )
    if body.subcategoryIds is not None:
        if not body.subcategoryIds:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A technician needs at least one category",
            )
        ids = await validate_subcategories(
            session, principal.company_id, body.subcategoryIds
        )
        await set_certifications(
            session, profile=profile, subcategory_ids=ids, actor_id=principal.user_id
        )
    if body.managerId is not None:
        membership.manager_id = body.managerId
    if body.fullName is not None:
        user.full_name = body.fullName
    if "profileImageUrl" in body.model_fields_set:
        user.profile_image_url = body.profileImageUrl
    # `model_fields_set`, not `is not None`: null is a real value here — it
    # means NO LIMIT — so testing for None would make the cap one-way, settable
    # but never clearable. Same reasoning as `profileImageUrl` above.
    if "dailyJobCap" in body.model_fields_set:
        profile.daily_job_cap = body.dailyJobCap
    if body.status is not None:
        profile.status = body.status

    profile.updated_by = principal.user_id
    user.updated_by = principal.user_id
    await session.commit()
    return await get_technician(session, principal, technician_id)


async def delete_technician(
    session: AsyncSession, principal: Principal, technician_id: uuid.UUID
) -> None:
    """Soft-remove: the membership goes, the profile and its history stay.

    Coverage rows are hard-deleted so the technician stops being matched — the
    profile is history, the coverage is a live routing table.
    """
    profile, membership, _user = await _load(session, principal, technician_id)
    membership.deleted_at = _now()
    membership.is_active = False
    membership.updated_by = principal.user_id
    profile.status = "inactive"
    profile.updated_by = principal.user_id
    await session.execute(
        delete(TechnicianPincode).where(TechnicianPincode.technician_id == profile.id)
    )
    await session.commit()


# ── invites ───────────────────────────────────────────────────────────────────


async def _send_and_record(session: AsyncSession, invite: TechnicianInvite) -> None:
    """Try to deliver, then record what happened. Never raises.

    A refusal is not an error for the caller: the invite exists and can be
    resent, which is more useful than a 500 and a lost row.
    """
    # The invite names the company the technician is joining — theirs, resolved
    # from the invite row rather than from a constant, because one WhatsApp
    # number sends for every tenant on this platform.
    company_name = await session.scalar(
        select(Company.name).where(Company.id == invite.company_id)
    )

    result = await whatsapp.send_invite(
        invite.phone, invite_link(invite.token), company_name or "Videocon Service"
    )
    invite.send_attempts = (invite.send_attempts or 0) + 1
    if result.ok:
        # Meta ACCEPTED it. That is not the same as delivered — without a
        # webhook we never learn about an asynchronous drop (131047).
        invite.status = SENT
        invite.wa_message_id = result.message_id
        invite.wa_error = None
        invite.sent_at = _now()
    else:
        invite.status = FAILED
        invite.wa_error = result.error


async def create_invite(
    session: AsyncSession, principal: Principal, body: InviteCreateRequest
) -> TechnicianInviteOut:
    region = await resolve_region(session, principal, body.regionId)
    # Validated before anything is written, so a bad pincode never leaves a
    # half-sent invite behind. Both checks: real and in the chosen region, and
    # inside the sender's own states when an area manager is sending.
    await check_pincodes_exist(session, region.id, body.pincodes)
    await check_pincodes_in_own_area(session, principal, body.pincodes)

    existing_tech = await session.scalar(
        select(User.id).where(
            User.phone == body.phone,
            User.role == TECHNICIAN,
            User.deleted_at.is_(None),
        )
    )
    if existing_tech is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{body.phone} is already a technician",
        )

    live = await session.scalar(
        select(TechnicianInvite.id).where(
            TechnicianInvite.company_id == principal.company_id,
            TechnicianInvite.phone == body.phone,
            TechnicianInvite.status.in_(LIVE_INVITE_STATUSES),
        )
    )
    if live is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{body.phone} has already been invited",
        )

    own_id = await _own_membership_id(session, principal)
    invite = TechnicianInvite(
        company_id=principal.company_id,
        phone=body.phone,
        region_id=region.id,
        invited_by_user_id=principal.user_id,
        invited_by_membership_id=own_id,
        manager_membership_id=body.managerId or own_id,
        daily_job_cap=body.dailyJobCap,
        status=PENDING,
        # 256 bits. Stored in clear because the console shows a copyable link
        # and a resend must re-send the same one — both impossible against a
        # hash-only column. Single-use and 14 days are the mitigations.
        token=secrets.token_urlsafe(32),
        expires_at=_now() + timedelta(days=settings.INVITE_EXPIRY_DAYS),
        created_by=principal.user_id,
    )
    session.add(invite)
    await session.flush()  # invite.id, needed by the coverage rows

    await set_invite_pincodes(
        session, invite=invite, pincodes=body.pincodes, actor_id=principal.user_id
    )

    await _send_and_record(session, invite)
    await session.commit()
    return (await _invites_out(session, [invite]))[0]


async def _load_invite(
    session: AsyncSession, principal: Principal, invite_id: uuid.UUID
) -> TechnicianInvite:
    _own_id, own = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )
    stmt = select(TechnicianInvite).where(
        TechnicianInvite.id == invite_id,
        TechnicianInvite.company_id == principal.company_id,
    )
    stmt = _visible_invites(stmt, principal, own)
    invite = await session.scalar(stmt)
    if invite is None:
        raise _not_found("Invite")
    return invite


async def resend_invite(
    session: AsyncSession, principal: Principal, invite_id: uuid.UUID
) -> TechnicianInviteOut:
    invite = await _load_invite(session, principal, invite_id)
    if invite.status == REGISTERED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This technician has already registered",
        )
    if invite.status == CANCELLED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This invite was cancelled"
        )
    if invite.expires_at <= _now():
        invite.status = EXPIRED
        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This invite has expired — send a new one",
        )

    # Resending RESTARTS the clock. A manager resending on day 13 otherwise
    # hands out a link that dies tomorrow, with nothing on screen saying so —
    # and their only real fix would be cancel-then-reinvite, which is more work
    # and changes the link. A resend is a fresh attempt to reach someone, so it
    # gets a fresh window. Still single-use, still cancellable, so nothing here
    # becomes permanent.
    invite.expires_at = _now() + timedelta(days=settings.INVITE_EXPIRY_DAYS)

    await _send_and_record(session, invite)
    invite.updated_by = principal.user_id
    await session.commit()
    return (await _invites_out(session, [invite]))[0]


async def cancel_invite(
    session: AsyncSession, principal: Principal, invite_id: uuid.UUID
) -> None:
    invite = await _load_invite(session, principal, invite_id)
    if invite.status == REGISTERED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This technician has already registered",
        )
    invite.status = CANCELLED
    invite.updated_by = principal.user_id
    await session.commit()

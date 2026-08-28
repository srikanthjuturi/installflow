"""Self-registration from an invite link. Unauthenticated by definition.

The flow is four calls:

    GET  /onboarding/invites/{token}              who invited you, which region
    POST /onboarding/invites/{token}/otp          code to the invited number
    POST /onboarding/invites/{token}/otp/verify   -> a 15-minute registration token
    POST /onboarding/invites/{token}/register     creates everything, signs you in

The OTP step is not ceremony. The invite token arrives over WhatsApp and is
forwardable, so without proving possession of the phone, whoever receives a
forwarded message could mint an account that accepts jobs and earns money
against someone else's number. The registration token is a JWT of type
`invite_reg`, which `get_current_principal` rejects outright — it can never be
used as a session token.
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from collections import defaultdict

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import jwt

from app.core.config import settings
from app.core.notifications import notify
from app.core.realtime import publish_notification
from app.core.schemas import ListParams
from app.core.security import _create_token, decode_token
from app.features.auth.otp_service import consume_code, issue_code, sign_in
from app.features.auth.schemas import LoginResponse, OtpRequestResponse
from app.features.masters.service import get_tree
from app.models.role import AREA_MANAGER
from app.models.membership import Membership
from app.features.onboarding.schemas import (
    InviteResolveOut,
    RegistrationTokenOut,
    SelfRegisterRequest,
)
from app.features.technicians import service as tech_service
from app.models.company import Company
from app.models.otp import PURPOSE_INVITE
from app.models.technician import (
    ACTIVE,
    CANCELLED,
    EXPIRED,
    LIVE_INVITE_STATUSES,
    MODE_INVITE,
    REG_SELF,
    REGISTERED,
    TechnicianInvite,
    TechnicianProfile,
)
from app.models.territory import Region
from app.models.user import User

REG_TOKEN_TYPE = "invite_reg"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _gone(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_410_GONE, detail=detail)


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


async def _load_invite(
    session: AsyncSession, token: str, *, lock: bool = False
) -> TechnicianInvite:
    stmt = select(TechnicianInvite).where(TechnicianInvite.token == token)
    if lock:
        # Serialises two taps of the same button: the second waits, then sees
        # status='registered' and takes the replay path.
        stmt = stmt.with_for_update()
    invite = await session.scalar(stmt)
    if invite is None:
        # Unknown and cancelled are indistinguishable here on purpose, so a
        # token cannot be probed for existence.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="This invite link is not valid"
        )
    return invite


async def _assert_usable(session: AsyncSession, invite: TechnicianInvite) -> None:
    if invite.status == REGISTERED:
        raise _conflict("This invite has already been used")
    if invite.status == CANCELLED:
        raise _conflict("This invite was cancelled — ask your manager for a new link")
    if invite.expires_at <= _now():
        if invite.status in LIVE_INVITE_STATUSES:
            invite.status = EXPIRED
            await session.commit()
        raise _gone("This invite has expired — ask your manager for a new link")


async def resolve_invite(session: AsyncSession, token: str) -> InviteResolveOut:
    invite = await _load_invite(session, token)
    await _assert_usable(session, invite)

    company = await session.scalar(
        select(Company).where(Company.id == invite.company_id)
    )
    region = await session.scalar(select(Region).where(Region.id == invite.region_id))
    inviter = (
        await session.scalar(select(User).where(User.id == invite.invited_by_user_id))
        if invite.invited_by_user_id
        else None
    )

    # The catalogue, read with the inviting company's scope rather than a
    # caller's — there is no caller here.
    #
    # Every attribute `get_tree` touches has to be present: this is a duck-typed
    # stand-in, so anything the real Principal grows and this does not is an
    # AttributeError at runtime rather than a type error at build time. It is
    # never a vendor — a vendor does not invite technicians — but saying so
    # explicitly is what keeps the catalogue unfiltered here.
    class _AnonPrincipal:
        company_id = invite.company_id
        user_id = None
        is_vendor = False
        vendor_id = None

    categories = await get_tree(session, _AnonPrincipal())  # type: ignore[arg-type]
    assigned = await tech_service.invite_pincodes(session, invite.id)
    if not assigned:
        # Invites created before coverage moved onto them carry none, and a
        # technician registered from one would be offered no job ever, with
        # nothing on their phone explaining why. Refuse, and name the fix.
        raise _conflict(
            "This invite has no service areas yet — ask your manager to send a "
            "new one"
        )

    return InviteResolveOut(
        phone=invite.phone,
        companyName=company.name if company else "Reliance GreenTech Service",
        regionName=region.name if region else "—",
        invitedByName=inviter.full_name if inviter else None,
        expiresAt=invite.expires_at,
        regionId=invite.region_id,
        dailyJobCap=invite.daily_job_cap,
        categories=categories,
        pincodes=assigned,
    )


async def request_invite_code(
    session: AsyncSession, token: str, request_ip: str | None
) -> OtpRequestResponse:
    invite = await _load_invite(session, token)
    await _assert_usable(session, invite)
    return await issue_code(
        session,
        phone=invite.phone,
        purpose=PURPOSE_INVITE,
        invite_id=invite.id,
        request_ip=request_ip,
    )


async def verify_invite_code(
    session: AsyncSession, token: str, code: str
) -> RegistrationTokenOut:
    invite = await _load_invite(session, token)
    await _assert_usable(session, invite)
    await consume_code(
        session, phone=invite.phone, code=code, purpose=PURPOSE_INVITE
    )

    expires_at = _now() + timedelta(minutes=settings.REGISTRATION_TOKEN_MINUTES)
    return RegistrationTokenOut(
        registrationToken=_create_token(
            invite.id,
            timedelta(minutes=settings.REGISTRATION_TOKEN_MINUTES),
            token_type=REG_TOKEN_TYPE,
            extra_claims={"phone": invite.phone},
        ),
        expiresAt=expires_at,
    )


def _decode_registration_token(
    registration_token: str, invite: TechnicianInvite
) -> None:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Verify your mobile number before registering",
    )
    try:
        payload = decode_token(registration_token)
    except jwt.PyJWTError:
        raise unauthorized from None
    if payload.get("type") != REG_TOKEN_TYPE:
        raise unauthorized
    if str(payload.get("sub")) != str(invite.id):
        raise unauthorized


async def _inviter_name(
    session: AsyncSession, invite: TechnicianInvite
) -> str | None:
    """Who sent the invite, by name.

    A name rather than an id, and copied into the notification rather than
    joined at read time — the same rule `ticket_events.actor_label` follows:
    renaming somebody later must not rewrite the record of what happened.
    """
    if invite.invited_by_user_id is None:
        return None
    return await session.scalar(
        select(User.full_name).where(User.id == invite.invited_by_user_id)
    )


async def register(
    session: AsyncSession,
    token: str,
    registration_token: str,
    body: SelfRegisterRequest,
) -> LoginResponse:
    """Create the technician, in one transaction, and sign them in.

    Everything the technician typed is committed here and nowhere earlier: until
    the OTP was verified the invite token was the only credential, so an
    abandoned registration leaves no partial server record and an intercepted
    link writes nothing.
    """
    invite = await _load_invite(session, token, lock=True)
    _decode_registration_token(registration_token, invite)

    if invite.status == REGISTERED:
        # Replay — the classic lost-response-on-a-flaky-connection case. The
        # holder of a valid registration token for THIS invite is the person
        # who just registered, so hand back a fresh session rather than
        # stranding them in a field with a 409.
        user = await session.scalar(
            select(User).where(User.id == invite.registered_user_id)
        )
        if user is not None:
            return await sign_in(session, user)
        raise _conflict("This invite has already been used")

    await _assert_usable(session, invite)

    subcategory_ids = await tech_service.validate_subcategories(
        session, invite.company_id, body.subcategoryIds
    )

    # Coverage comes from the INVITE, decided by the manager who sent it. There
    # is no pincode field in the request any more, so nothing a client sends can
    # widen it — which is what the old "is this inside your manager's area?"
    # check existed to police.
    assigned = await tech_service.invite_pincodes(session, invite.id)

    actor = invite.invited_by_user_id

    user = await tech_service.reuse_or_create_user(
        session,
        phone=invite.phone,
        full_name=body.fullName,
        profile_image_url=body.profileImageUrl,
        # created_by is the INVITING MANAGER throughout: the row exists on their
        # authority. That the technician typed it is carried by
        # registered_by='self', not by overloading this.
        actor_id=actor,
    )
    await session.flush()

    membership = await tech_service.reuse_or_create_membership(
        session,
        user=user,
        company_id=invite.company_id,
        manager_id=invite.manager_membership_id or invite.invited_by_membership_id,
        actor_id=actor,
    )
    await session.flush()
    await tech_service.set_membership_region(
        session, membership=membership, region_id=invite.region_id, actor_id=actor
    )

    now = _now()
    profile = TechnicianProfile(
        membership_id=membership.id,
        company_id=invite.company_id,
        code=await tech_service.next_code(session, invite.company_id),
        region_id=invite.region_id,
        daily_job_cap=body.dailyJobCap or invite.daily_job_cap,
        status=ACTIVE,
        onboarding_mode=MODE_INVITE,
        appointed_by_user_id=invite.invited_by_user_id,
        appointed_by_membership_id=invite.invited_by_membership_id,
        appointed_at=invite.created_at,
        registered_by=REG_SELF,
        registered_at=now,
        invite_id=invite.id,
        created_by=actor,
    )
    session.add(profile)
    await session.flush()

    await tech_service.set_certifications(
        session, profile=profile, subcategory_ids=subcategory_ids, actor_id=actor
    )
    # Copied, not joined: the invite records what was offered and stays as it
    # was; the profile owns what this technician actually covers.
    await tech_service.set_coverage(
        session, profile=profile, pincodes=assigned, actor_id=actor
    )

    invite.status = REGISTERED
    invite.registered_at = now
    invite.registered_user_id = user.id
    invite.registered_membership_id = membership.id
    invite.updated_by = user.id

    # Somebody sent this invite days ago and has had no way of knowing it
    # landed. Nothing else in the system says "they registered": the invite
    # quietly changes status and the technician appears in a list nobody was
    # watching.
    #
    # No separate addressing for the inviting manager, and none is needed. A
    # manager may only invite into territory they already cover — the area
    # manager into his own states, everyone above him into all of India — so a
    # notification scoped to the technician's own pincode reaches BOTH the
    # person who invited them and the area manager responsible for where they
    # will work. Adding a recipient field to reach somebody the territory rule
    # already reaches would be a second, weaker copy of who-sees-what.
    inviter = await _inviter_name(session, invite)
    detail = f"{profile.code} · covers {tech_service.coverage_summary(assigned)}"
    if inviter:
        detail += f" · invited by {inviter}"

    raised = await notify(
        session,
        company_id=invite.company_id,
        kind="technician_joined",
        title=f"{body.fullName} registered as a technician",
        detail=detail,
        to=f"/technicians/{profile.id}",
        # The FIRST covered pincode anchors the territory. A technician usually
        # covers a handful of neighbouring codes inside one manager's states, so
        # one anchor reaches the right person; where a senior manager has spread
        # coverage across two areas, the second area manager reads it in the
        # technicians list rather than the bell. None means no coverage at all,
        # which is company-wide — and a technician nobody can offer work to is
        # exactly the anomaly everyone should see.
        pincode=assigned[0] if assigned else None,
    )
    await publish_notification(
        session,
        company_id=invite.company_id,
        pincode=assigned[0] if assigned else None,
        notification_id=raised.id,
    )

    # sign_in commits, so the whole registration lands in one transaction.
    return await sign_in(session, user)


"""Partner invites: create, send over WhatsApp, list, resend, cancel.

Territory works exactly as it does for users — an invite is stamped with a
region, and who can see it follows from that. The inviter is recorded on the row
because "who sent this link" is half the point of the feature.
"""

import secrets
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import Principal
from app.core.schemas import ListParams
from app.core.scope import ALL_INDIA_ROLES, own_scope
from app.features.partners.schemas import InviteCreateRequest, PartnerInviteOut
from app.integrations import whatsapp
from app.models.membership import Membership
from app.models.partner import (
    CANCELLED,
    FAILED,
    PENDING,
    REGISTERED,
    SENT,
    PartnerInvite,
)
from app.models.role import AREA_MANAGER, REGIONAL_HEAD
from app.models.territory import Region
from app.models.user import User


def _invite_link(token: str) -> str:
    return f"{settings.INVITE_LINK_BASE.rstrip('/')}/{token}"


def _out(invite: PartnerInvite, region: Region, inviter: User | None) -> PartnerInviteOut:
    return PartnerInviteOut(
        id=invite.id,
        partnerType=invite.partner_type,
        phone=invite.phone,
        fullName=invite.full_name,
        status=invite.status,
        regionId=invite.region_id,
        regionName=region.name,
        invitedByName=(inviter.full_name or inviter.email) if inviter else None,
        invitedByEmail=inviter.email if inviter else None,
        inviteLink=_invite_link(invite.token),
        failureReason=invite.wa_error,
        sentAt=invite.sent_at,
        registeredAt=invite.registered_at,
        createdAt=invite.created_at,
    )


def _visible(stmt, principal: Principal, own):
    """Which invites this caller may see — the users rule, applied to regions."""
    if principal.role in ALL_INDIA_ROLES:
        return stmt
    if principal.role in (REGIONAL_HEAD, AREA_MANAGER):
        region_ids = own.region_ids
        if not region_ids:
            # No territory yet: only what they sent themselves.
            return stmt.where(PartnerInvite.invited_by_user_id == principal.user_id)
        return stmt.where(
            or_(
                PartnerInvite.region_id.in_(region_ids),
                PartnerInvite.invited_by_user_id == principal.user_id,
            )
        )
    return stmt.where(PartnerInvite.invited_by_user_id == principal.user_id)


async def _resolve_region(
    session: AsyncSession, principal: Principal, requested: uuid.UUID | None, own
) -> Region:
    """The region to stamp — and a check that the caller may use it."""
    all_india = principal.role in ALL_INDIA_ROLES
    own_ids = own.region_ids

    region_id = requested
    if region_id is None:
        # Unambiguous only when the caller holds exactly one region.
        if len(own_ids) == 1:
            region_id = next(iter(own_ids))
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Select the region this partner will work in",
            )

    if not all_india and region_id not in own_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only invite partners into your own regions",
        )

    region = await session.scalar(select(Region).where(Region.id == region_id))
    if region is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown region"
        )
    return region


async def _load(
    session: AsyncSession, principal: Principal, invite_id: uuid.UUID
) -> PartnerInvite:
    _own_id, own = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )
    stmt = select(PartnerInvite).where(
        PartnerInvite.id == invite_id,
        PartnerInvite.company_id == principal.company_id,
    )
    invite = await session.scalar(_visible(stmt, principal, own))
    if invite is None:
        # Territory-filtered, so another region's invite reads as absent.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found"
        )
    return invite


async def _send_and_record(session: AsyncSession, invite: PartnerInvite) -> None:
    """Send, then write the outcome onto the row. Never raises on rejection."""
    result = await whatsapp.send_invite(
        invite.phone, _invite_link(invite.token), invite.partner_type
    )
    if result.ok:
        invite.status = SENT
        invite.wa_message_id = result.message_id
        invite.wa_error = None
        invite.sent_at = datetime.now(timezone.utc)
    else:
        invite.status = FAILED
        invite.wa_error = result.error


async def create_invite(
    session: AsyncSession, principal: Principal, body: InviteCreateRequest
) -> PartnerInviteOut:
    own_membership_id, own = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )
    region = await _resolve_region(session, principal, body.regionId, own)

    # One live invite per number per company (the partial unique index is the
    # real guard; this is the friendly message).
    clash = await session.scalar(
        select(PartnerInvite).where(
            PartnerInvite.company_id == principal.company_id,
            PartnerInvite.phone == body.phone,
            PartnerInvite.status != CANCELLED,
        )
    )
    if clash is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{body.phone} has already been invited as a {clash.partner_type}",
        )

    invite = PartnerInvite(
        company_id=principal.company_id,
        partner_type=body.partnerType,
        phone=body.phone,
        full_name=body.fullName,
        region_id=region.id,
        invited_by_user_id=principal.user_id,
        invited_by_membership_id=own_membership_id,
        status=PENDING,
        token=secrets.token_urlsafe(24),
        created_by=principal.user_id,
    )
    session.add(invite)
    await session.flush()

    await _send_and_record(session, invite)
    await session.commit()
    await session.refresh(invite)

    inviter = await session.scalar(select(User).where(User.id == principal.user_id))
    return _out(invite, region, inviter)


async def list_invites(
    session: AsyncSession,
    principal: Principal,
    params: ListParams,
    partner_type: str | None = None,
    status_filter: str | None = None,
) -> tuple[list[PartnerInviteOut], int]:
    _own_id, own = await own_scope(
        session, user_id=principal.user_id, company_id=principal.company_id
    )
    stmt = (
        select(PartnerInvite, Region, User)
        .join(Region, Region.id == PartnerInvite.region_id)
        .outerjoin(User, User.id == PartnerInvite.invited_by_user_id)
        .where(PartnerInvite.company_id == principal.company_id)
    )
    stmt = _visible(stmt, principal, own)

    if partner_type:
        stmt = stmt.where(PartnerInvite.partner_type == partner_type)
    if params.search:
        term = f"%{params.search.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(PartnerInvite.phone).like(term),
                func.lower(PartnerInvite.full_name).like(term),
            )
        )
    if status_filter:
        stmt = stmt.where(PartnerInvite.status == status_filter)

    stmt = stmt.order_by(PartnerInvite.created_at.desc())

    total = await session.scalar(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    )
    rows = (
        await session.execute(
            stmt.limit(params.limit).offset((params.page - 1) * params.limit)
        )
    ).all()
    return [_out(i, r, u) for i, r, u in rows], int(total or 0)


async def resend_invite(
    session: AsyncSession, principal: Principal, invite_id: uuid.UUID
) -> PartnerInviteOut:
    invite = await _load(session, principal, invite_id)
    if invite.status == REGISTERED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This partner has already registered",
        )
    if invite.status == CANCELLED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This invite was cancelled"
        )

    invite.updated_by = principal.user_id
    await _send_and_record(session, invite)
    await session.commit()
    await session.refresh(invite)

    region = await session.scalar(select(Region).where(Region.id == invite.region_id))
    inviter = await session.scalar(
        select(User).where(User.id == invite.invited_by_user_id)
    )
    return _out(invite, region, inviter)


async def cancel_invite(
    session: AsyncSession, principal: Principal, invite_id: uuid.UUID
) -> None:
    invite = await _load(session, principal, invite_id)
    if invite.status == REGISTERED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This partner has already registered",
        )
    invite.status = CANCELLED
    invite.updated_by = principal.user_id
    await session.commit()
